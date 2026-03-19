"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildAllergenRows as buildDishAllergenRows,
  buildAllergenCrossRows as buildDishAllergenCrossRows,
  buildDietRows as buildDishDietRows,
  buildDietCrossRows as buildDishDietCrossRows,
  mergeSectionRows as mergeDishSectionRows,
} from "../../shared/dishDetailRows";
import {
  asText,
  normalizeToken,
  fileToDataUrl,
  buildAllergenDisplay,
  buildDietDisplay,
  dedupeTokenList,
  readTokenState,
  nextTokenState,
  buildPersistedIngredientSignature,
  normalizePreviewOptions,
  normalizeBrandEntry,
  normalizeIngredientEntry,
  deriveDishStateFromIngredients,
} from "../editorUtils";
import {
  applyIngredientBrandSelectionFields,
  clearIngredientBrandSelectionFields,
} from "./brandSelectionFields";
import {
  applyIngredientBrandAppeal,
  buildPendingIngredientBrandAppeal,
  clearIngredientBrandAppeal,
} from "./brandAppealState";
import { mergeAppealPendingMap } from "./appealPendingState.js";

function coerceIngredientNameForApply(value) {
  if (typeof value?.name === "string") return value.name;
  if (value?.name == null) return "";
  return String(value.name);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const APPEAL_TARGET_PHOTO_BYTES = 320 * 1024;
const APPEAL_MAX_PHOTO_BYTES = 768 * 1024;
const APPEAL_MAX_PHOTO_EDGE = 1600;
const APPEAL_COMPRESSION_QUALITIES = [0.9, 0.82, 0.74, 0.66, 0.58];

function estimateDataUrlBytes(dataUrl) {
  const safe = asText(dataUrl);
  if (!safe.startsWith("data:")) return safe.length;
  const commaIndex = safe.indexOf(",");
  if (commaIndex < 0) return safe.length;
  const base64 = safe.slice(commaIndex + 1);
  if (!base64) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function loadDataUrlImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load image for compression."));
    image.src = dataUrl;
  });
}

async function compressAppealPhotoDataUrl(dataUrl) {
  const safe = asText(dataUrl);
  if (!safe) return "";
  if (!safe.startsWith("data:image/")) return safe;
  if (estimateDataUrlBytes(safe) <= APPEAL_TARGET_PHOTO_BYTES) {
    return safe;
  }

  try {
    const image = await loadDataUrlImage(safe);
    const naturalWidth = Number(image?.naturalWidth || image?.width) || 0;
    const naturalHeight = Number(image?.naturalHeight || image?.height) || 0;
    if (!naturalWidth || !naturalHeight) return safe;

    const largestEdge = Math.max(naturalWidth, naturalHeight);
    const scale = Math.min(1, APPEAL_MAX_PHOTO_EDGE / largestEdge);
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) return safe;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    let bestCandidate = "";
    for (const quality of APPEAL_COMPRESSION_QUALITIES) {
      const candidate = canvas.toDataURL("image/jpeg", quality);
      if (!candidate) continue;
      bestCandidate = candidate;
      if (estimateDataUrlBytes(candidate) <= APPEAL_TARGET_PHOTO_BYTES) {
        return candidate;
      }
    }

    return bestCandidate || safe;
  } catch {
    return safe;
  }
}

function booleanFlagMapsEqual(left, right) {
  const leftKeys = Object.keys(left || {});
  const rightKeys = Object.keys(right || {});
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every((key) => Boolean(left?.[key]) === Boolean(right?.[key]));
}

export function useDishEditorController({
  editor,
  runtimeConfigHealth,
  saveIssueJumpRequest,
  onSaveIssueJumpHandled,
}) {
  // Data boundary: no direct database reads happen in this hook; it only uses the editor state passed in.
  // Base modal selection state comes directly from the shared editor store.
  const overlay = editor.selectedOverlay;
  const [showDeleteWarning, setShowDeleteWarning] = useState(false);
  const [applyBusyByRow, setApplyBusyByRow] = useState({});
  const [lastAppliedIngredientNameByRow, setLastAppliedIngredientNameByRow] = useState({});
  const [scanStateByRow, setScanStateByRow] = useState({});
  const [searchOpenRow, setSearchOpenRow] = useState(-1);
  const [searchQueryByRow, setSearchQueryByRow] = useState({});
  const [appealOpenByRow, setAppealOpenByRow] = useState({});
  const [appealMessageByRow, setAppealMessageByRow] = useState({});
  const [appealPhotoByRow, setAppealPhotoByRow] = useState({});
  const [appealPhotoErrorByRow, setAppealPhotoErrorByRow] = useState({});
  const [appealBusyByRow, setAppealBusyByRow] = useState({});
  const [appealFeedbackByRow, setAppealFeedbackByRow] = useState({});
  const [appealPendingByRow, setAppealPendingByRow] = useState({});
  const [processInputBusy, setProcessInputBusy] = useState(false);
  const [autoApplyBusy, setAutoApplyBusy] = useState(false);
  const [dictateActive, setDictateActive] = useState(false);
  const [modalError, setModalError] = useState("");
  const recipeTextareaRef = useRef(null);
  const dictationRecognitionRef = useRef(null);
  const ingredientRowRefs = useRef({});
  const autoApplyRunIdRef = useRef(0);
  const activeOverlayKeyRef = useRef(asText(overlay?._editorKey));
  const dishEditorOpenRef = useRef(Boolean(editor.dishEditorOpen));

  // Runtime configuration gates AI-powered actions and displays user-safe messaging.
  const runtimeMissingKeys = Array.isArray(runtimeConfigHealth?.missing)
    ? runtimeConfigHealth.missing
    : [];
  const aiActionsBlocked = Boolean(runtimeConfigHealth?.blocked);
  const runtimeBlockedTitle = runtimeMissingKeys.length
    ? `Runtime configuration missing: ${runtimeMissingKeys.join(", ")}`
    : "Runtime configuration missing.";

  // Derived overlays, ingredients, and preview rows feed both editor controls and preview UI.
  const allergens = useMemo(
    () => buildAllergenDisplay(editor, overlay),
    [editor, overlay],
  );

  const diets = useMemo(() => buildDietDisplay(editor, overlay), [editor, overlay]);
  const ingredients = useMemo(
    () =>
      (Array.isArray(overlay?.ingredients) ? overlay.ingredients : []).map((ingredient, index) =>
        normalizeIngredientEntry(ingredient, index),
      ),
    [overlay?.ingredients],
  );
  const latestIngredientsRef = useRef(ingredients);
  const latestOverlayDetailsRef = useRef(overlay?.details);

  // Refs preserve the latest normalized state for async callbacks without stale closures.
  useEffect(() => {
    latestIngredientsRef.current = ingredients;
  }, [ingredients]);

  useEffect(() => {
    latestOverlayDetailsRef.current = overlay?.details;
  }, [overlay?.details]);

  const existingBrandItems = useMemo(() => {
    const map = new Map();
    (Array.isArray(editor.overlays) ? editor.overlays : []).forEach((dish) => {
      (Array.isArray(dish?.ingredients) ? dish.ingredients : []).forEach((ingredient) => {
        (Array.isArray(ingredient?.brands) ? ingredient.brands : []).forEach((brand) => {
          const normalized = normalizeBrandEntry(brand);
          if (!normalized) return;
          const key = normalizeToken(normalized.name);
          if (!key || map.has(key)) return;
          map.set(key, normalized);
        });
      });
    });
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  }, [editor.overlays]);
  const previewAllergenOptions = useMemo(
    () =>
      normalizePreviewOptions(allergens, {
        formatLabel: editor.config.formatAllergenLabel,
        getEmoji: editor.config.getAllergenEmoji,
      }),
    [allergens, editor.config.formatAllergenLabel, editor.config.getAllergenEmoji],
  );
  const previewDietOptions = useMemo(
    () =>
      normalizePreviewOptions(diets, {
        formatLabel: editor.config.formatDietLabel,
        getEmoji: editor.config.getDietEmoji,
      }),
    [diets, editor.config.formatDietLabel, editor.config.getDietEmoji],
  );
  const previewAllergenRows = useMemo(
    () =>
      mergeDishSectionRows(
        buildDishAllergenRows(overlay, previewAllergenOptions),
        buildDishAllergenCrossRows(overlay, previewAllergenOptions),
      ),
    [overlay, previewAllergenOptions],
  );
  const previewDietRows = useMemo(
    () =>
      mergeDishSectionRows(
        buildDishDietRows(overlay, previewDietOptions),
        buildDishDietCrossRows(overlay, previewDietOptions),
      ),
    [overlay, previewDietOptions],
  );

  // Modal close/reset keeps transient row-level UI state out of future editing sessions.
  useEffect(() => {
    if (!editor.dishEditorOpen) {
      autoApplyRunIdRef.current += 1;
      if (dictationRecognitionRef.current) {
        dictationRecognitionRef.current.stop();
        dictationRecognitionRef.current = null;
      }
      setShowDeleteWarning(false);
      setApplyBusyByRow({});
      setLastAppliedIngredientNameByRow({});
      setScanStateByRow({});
      setSearchOpenRow(-1);
      setSearchQueryByRow({});
      setAppealOpenByRow({});
      setAppealMessageByRow({});
      setAppealPhotoByRow({});
      setAppealPhotoErrorByRow({});
      setAppealBusyByRow({});
      setAppealFeedbackByRow({});
      setAppealPendingByRow({});
      setProcessInputBusy(false);
      setAutoApplyBusy(false);
      setDictateActive(false);
      setModalError("");
    }
  }, [editor.dishEditorOpen]);

  useEffect(() => {
    activeOverlayKeyRef.current = asText(overlay?._editorKey);
    autoApplyRunIdRef.current += 1;
    setAutoApplyBusy(false);
  }, [overlay?._editorKey]);

  useEffect(() => {
    dishEditorOpenRef.current = Boolean(editor.dishEditorOpen);
  }, [editor.dishEditorOpen]);

  useEffect(() => {
    // Seed row baselines for Apply visibility whenever a dish is opened.
    const seeded = {};
    ingredients.forEach((ingredient, index) => {
      seeded[index] = coerceIngredientNameForApply(ingredient);
    });
    setLastAppliedIngredientNameByRow(seeded);
  }, [overlay?._editorKey]);

  useEffect(() => {
    // Keep index-based row baselines aligned when row count changes.
    setLastAppliedIngredientNameByRow((current) => {
      const next = { ...current };
      let changed = false;

      ingredients.forEach((ingredient, index) => {
        if (Object.prototype.hasOwnProperty.call(next, index)) return;
        next[index] = coerceIngredientNameForApply(ingredient);
        changed = true;
      });

      Object.keys(next).forEach((key) => {
        const numeric = Number(key);
        if (!Number.isFinite(numeric) || numeric < 0 || numeric >= ingredients.length) {
          delete next[key];
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [ingredients.length]);

  useEffect(() => {
    if (!editor.dishEditorOpen) return;
    setAppealPendingByRow((current) => {
      const nextPendingByRow = mergeAppealPendingMap(current, ingredients);
      return booleanFlagMapsEqual(current, nextPendingByRow) ? current : nextPendingByRow;
    });
  }, [editor.dishEditorOpen, ingredients]);

  useEffect(() => {
    return () => {
      if (dictationRecognitionRef.current) {
        dictationRecognitionRef.current.stop();
        dictationRecognitionRef.current = null;
      }
    };
  }, []);

  const handleAppealPhotoChange = useCallback(async (ingredientIndex, file) => {
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      setAppealPhotoErrorByRow((current) => ({
        ...current,
        [ingredientIndex]: "Upload a valid image file.",
      }));
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      const compressedDataUrl = await compressAppealPhotoDataUrl(dataUrl);
      if (!asText(compressedDataUrl)) {
        throw new Error("Failed to read image.");
      }
      if (estimateDataUrlBytes(compressedDataUrl) > APPEAL_MAX_PHOTO_BYTES) {
        throw new Error("Appeal photo is too large. Use an image under 768 KB.");
      }
      setAppealPhotoByRow((current) => ({
        ...current,
        [ingredientIndex]: {
          dataUrl: compressedDataUrl,
          fileName: asText(file.name),
        },
      }));
      setAppealPhotoErrorByRow((current) => ({
        ...current,
        [ingredientIndex]: "",
      }));
    } catch (error) {
      setAppealPhotoErrorByRow((current) => ({
        ...current,
        [ingredientIndex]:
          asText(error?.message) || "Failed to read image. Try another photo.",
      }));
    }
  }, []);

  const clearAppealPhoto = useCallback((ingredientIndex) => {
    setAppealPhotoByRow((current) => ({
      ...current,
      [ingredientIndex]: null,
    }));
    setAppealPhotoErrorByRow((current) => ({
      ...current,
      [ingredientIndex]: "",
    }));
  }, []);

  const clearIngredientScanState = useCallback((ingredientIndex) => {
    setScanStateByRow((current) => {
      if (!current || !Object.prototype.hasOwnProperty.call(current, ingredientIndex)) {
        return current;
      }
      const next = { ...current };
      delete next[ingredientIndex];
      return next;
    });
  }, []);

  // Route all ingredient writes through a single path so derived overlay fields stay in sync.
  const applyIngredientChanges = useCallback(
    (updater, options = {}) => {
      const current = Array.isArray(latestIngredientsRef.current)
        ? latestIngredientsRef.current
        : [];
      const nextRaw = typeof updater === "function" ? updater(current) : updater;
      const nextList = Array.isArray(nextRaw)
        ? nextRaw.map((item, index) => normalizeIngredientEntry(item, index))
        : [];
      const nextListWithConfirmation = nextList.map((row, index) => {
        const previousRow = current[index];
        if (!previousRow) return row;
        const previousSig = buildPersistedIngredientSignature(previousRow);
        const nextSig = buildPersistedIngredientSignature(row);
        if (previousSig !== nextSig) {
          return {
            ...row,
            confirmed: false,
          };
        }
        return row;
      });
      const derived = deriveDishStateFromIngredients({
        ingredients: nextListWithConfirmation,
        existingDetails: latestOverlayDetailsRef.current,
        configuredDiets: editor.config?.diets,
      });
      latestIngredientsRef.current = derived.ingredients;
      latestOverlayDetailsRef.current = derived.details;
      editor.updateSelectedOverlay(
        {
          ingredients: derived.ingredients,
          allergens: derived.allergens,
          diets: derived.diets,
          details: derived.details,
          removable: derived.removable,
          crossContaminationAllergens: derived.crossContaminationAllergens,
          crossContaminationDiets: derived.crossContaminationDiets,
          ingredientsBlockingDiets: derived.ingredientsBlockingDiets,
        },
        options,
      );
    },
    [editor],
  );

  // Config-aware token normalization keeps manual toggles consistent with backend expectations.
  const normalizeAllergenList = useCallback(
    (values) =>
      typeof editor.config?.normalizeAllergenList === "function"
        ? editor.config.normalizeAllergenList(values)
        : dedupeTokenList(values),
    [editor.config],
  );

  const normalizeDietList = useCallback(
    (values) =>
      typeof editor.config?.normalizeDietList === "function"
        ? editor.config.normalizeDietList(values)
        : dedupeTokenList(values),
    [editor.config],
  );

  const updateIngredientName = useCallback(
    (ingredientIndex, value) => {
      applyIngredientChanges((current) =>
        current.map((ingredient, index) =>
          index === ingredientIndex ? { ...ingredient, name: value } : ingredient,
        ),
      );
    },
    [applyIngredientChanges],
  );

  // Each click advances through none -> contains -> cross for a compact tri-state control.
  const cycleIngredientTokenState = useCallback(
    (ingredientIndex, type, token) => {
      const value = asText(token);
      if (!value) return;
      const containsField = type === "diet" ? "diets" : "allergens";
      const crossField =
        type === "diet"
          ? "crossContaminationDiets"
          : "crossContaminationAllergens";

      applyIngredientChanges((current) =>
        current.map((ingredient, index) => {
          if (index !== ingredientIndex) return ingredient;
          const containsValues = dedupeTokenList(ingredient?.[containsField]);
          const crossValues = dedupeTokenList(ingredient?.[crossField]);
          const currentState = readTokenState({
            containsValues,
            crossValues,
            token: value,
          });
          const nextState = nextTokenState(currentState);
          const tokenKey = normalizeToken(value);

          const nextContains = containsValues.filter(
            (entry) => normalizeToken(entry) !== tokenKey,
          );
          const nextCross = crossValues.filter(
            (entry) => normalizeToken(entry) !== tokenKey,
          );

          if (nextState === "contains") {
            nextContains.push(value);
          } else if (nextState === "cross") {
            nextCross.push(value);
          }

          return {
            ...ingredient,
            [containsField]: dedupeTokenList(nextContains),
            [crossField]: dedupeTokenList(nextCross),
          };
        }),
        {
          recordHistory: true,
        },
      );
    },
    [applyIngredientChanges],
  );

  const toggleIngredientRemovable = useCallback(
    (ingredientIndex, checked) => {
      applyIngredientChanges((current) =>
        current.map((ingredient, index) =>
          index === ingredientIndex
            ? { ...ingredient, removable: Boolean(checked) }
            : ingredient,
        ),
      );
    },
    [applyIngredientChanges],
  );

  const toggleIngredientConfirmed = useCallback(
    (ingredientIndex) => {
      const ingredient = ingredients[ingredientIndex];
      if (!ingredient) return;
      const appealPending = appealPendingByRow[ingredientIndex] === true;

      const hasAssignedBrand = (Array.isArray(ingredient?.brands)
        ? ingredient.brands
        : []
      ).some((brand) => asText(brand?.name));
      const ingredientNameAtConfirm = coerceIngredientNameForApply(ingredient);
      const hasPendingNameApply =
        !hasAssignedBrand &&
        ingredientNameAtConfirm !==
          (lastAppliedIngredientNameByRow[ingredientIndex] ?? ingredientNameAtConfirm);
      const requiresBrandBeforeConfirm =
        Boolean(ingredient?.brandRequired) &&
        !hasAssignedBrand &&
        !appealPending &&
        ingredient?.confirmed !== true;

      if (hasPendingNameApply) {
        setModalError("Apply the ingredient name before confirming this ingredient.");
        return;
      }

      if (requiresBrandBeforeConfirm) {
        setModalError("Assign a brand item before confirming this ingredient.");
        return;
      }

      setModalError("");
      applyIngredientChanges((current) =>
        current.map((item, index) =>
          index === ingredientIndex
            ? { ...item, confirmed: item?.confirmed === false }
            : item,
        ),
      );
    },
    [
      appealPendingByRow,
      applyIngredientChanges,
      ingredients,
      lastAppliedIngredientNameByRow,
    ],
  );

  const addIngredientRow = useCallback(() => {
    const nextIngredientName = `Ingredient ${ingredients.length + 1}`;
    const nextIndex = ingredients.length;
    const stableOverlayKey = asText(overlay?._editorKey || overlay?.overlayKey);
    applyIngredientChanges(
      (current) => [
        ...current,
        normalizeIngredientEntry(
          {
            name: `Ingredient ${current.length + 1}`,
            allergens: [],
            diets: [],
            crossContaminationAllergens: [],
            crossContaminationDiets: [],
            aiDetectedAllergens: [],
            aiDetectedDiets: [],
            aiDetectedCrossContaminationAllergens: [],
            aiDetectedCrossContaminationDiets: [],
            brands: [],
            brandRequired: false,
            brandRequirementReason: "",
            removable: false,
            confirmed: false,
          },
          current.length,
        ),
      ],
      {
        changeText: `Ingredient row added: ${nextIngredientName}`,
        changeKey: stableOverlayKey
          ? `ingredient-row:${stableOverlayKey}:added:${nextIndex}`
          : "",
        recordHistory: true,
      },
    );
    // New rows should not show Apply until the manager edits the row name.
    setLastAppliedIngredientNameByRow((current) => ({
      ...current,
      [nextIndex]: nextIngredientName,
    }));
  }, [applyIngredientChanges, ingredients.length, overlay?._editorKey, overlay?.overlayKey]);

  const removeIngredientRow = useCallback(
    (ingredientIndex) => {
      const removedName = asText(ingredients[ingredientIndex]?.name) || "Ingredient";
      const stableOverlayKey = asText(overlay?._editorKey || overlay?.overlayKey);
      applyIngredientChanges(
        (current) => current.filter((_, index) => index !== ingredientIndex),
        {
          changeText: `Ingredient row removed: ${removedName}`,
          changeKey: stableOverlayKey
            ? `ingredient-row:${stableOverlayKey}:removed:${ingredientIndex}`
            : "",
          recordHistory: true,
        },
      );
      // Shift baselines for index-based rows after deletion.
      setLastAppliedIngredientNameByRow((current) => {
        const next = {};
        Object.keys(current || {}).forEach((key) => {
          const numeric = Number(key);
          if (!Number.isFinite(numeric)) return;
          if (numeric < ingredientIndex) {
            next[numeric] = current[key];
            return;
          }
          if (numeric > ingredientIndex) {
            next[numeric - 1] = current[key];
          }
        });
        return next;
      });
      setAppealPendingByRow((current) => {
        const next = {};
        Object.keys(current || {}).forEach((key) => {
          const numeric = Number(key);
          if (!Number.isFinite(numeric)) return;
          if (numeric < ingredientIndex) {
            next[numeric] = current[key];
            return;
          }
          if (numeric > ingredientIndex) {
            next[numeric - 1] = current[key];
          }
        });
        return next;
      });
    },
    [applyIngredientChanges, ingredients, overlay?._editorKey, overlay?.overlayKey],
  );

  // Smart detection pipeline: name analysis + scan requirement + row mutation.
  const analyzeIngredientForSmartDetection = useCallback(
    async (ingredientIndex) => {
      const currentRows = Array.isArray(latestIngredientsRef.current)
        ? latestIngredientsRef.current
        : [];
      const ingredient = currentRows[ingredientIndex];
      const ingredientName = asText(ingredient?.name);
      if (!ingredientName) {
        return {
          success: false,
          errorMessage: "Ingredient name is required before applying smart detection.",
        };
      }

      try {
        const dishName = asText(overlay?.id || overlay?.name);
        const [nameAnalysis, scanRequirement] = await Promise.all([
          editor.analyzeIngredientName({
            ingredientName,
            dishName,
          }),
          editor.analyzeIngredientScanRequirement({
            ingredientName,
            dishName,
          }),
        ]);

        if (!nameAnalysis?.success) {
          return {
            success: false,
            errorMessage:
              nameAnalysis?.error?.message || "Failed to analyze ingredient name.",
          };
        }

        return {
          success: true,
          analysis: nameAnalysis.result || {},
          scanRequirement,
        };
      } catch (error) {
        return {
          success: false,
          errorMessage: asText(error?.message) || "Failed to analyze ingredient name.",
        };
      }
    },
    [editor, overlay?.id, overlay?.name],
  );

  // Apply a normalized analysis payload to a single row while preserving editor invariants.
  const applyIngredientDetectionResult = useCallback(
    ({
      ingredientIndex,
      analysis,
      scanRequirement,
      preserveExistingBrand = true,
    }) => {
      const safeAnalysis =
        analysis && typeof analysis === "object" ? analysis : {};
      const scanData = scanRequirement?.success ? scanRequirement.result : null;
      const nextAllergens = normalizeAllergenList(safeAnalysis.allergens);
      const nextDiets = normalizeDietList(safeAnalysis.diets);
      const nextCrossAllergens = normalizeAllergenList(
        safeAnalysis.crossContaminationAllergens,
      );
      const nextCrossDiets = normalizeDietList(
        safeAnalysis.crossContaminationDiets,
      );

      applyIngredientChanges((current) =>
        current.map((item, itemIndex) => {
          if (itemIndex !== ingredientIndex) return item;
          const existingBrands = Array.isArray(item.brands) ? item.brands : [];
          const hasBrand = existingBrands.some((brand) => asText(brand?.name));
          const hasScanDecision =
            scanRequirement?.success &&
            typeof scanData?.needsScan === "boolean";
          const needsScan = hasScanDecision
            ? Boolean(scanData?.needsScan)
            : Boolean(item.brandRequired);
          const requirementReason = hasScanDecision
            ? needsScan
              ? asText(scanData?.reasoning)
              : ""
            : asText(item.brandRequirementReason);
          const nextBase =
            preserveExistingBrand && hasBrand
              ? applyIngredientBrandSelectionFields(item, existingBrands[0])
              : clearIngredientBrandSelectionFields(item);

          const nextItem = {
            ...nextBase,
            allergens: nextAllergens,
            diets: nextDiets,
            crossContaminationAllergens: nextCrossAllergens,
            crossContaminationDiets: nextCrossDiets,
            aiDetectedAllergens: normalizeAllergenList(
              safeAnalysis.aiDetectedAllergens || nextAllergens,
            ),
            aiDetectedDiets: normalizeDietList(
              safeAnalysis.aiDetectedDiets || nextDiets,
            ),
            aiDetectedCrossContaminationAllergens: normalizeAllergenList(
              safeAnalysis.aiDetectedCrossContaminationAllergens || nextCrossAllergens,
            ),
            aiDetectedCrossContaminationDiets: normalizeDietList(
              safeAnalysis.aiDetectedCrossContaminationDiets || nextCrossDiets,
            ),
            brandRequired: needsScan,
            brandRequirementReason: requirementReason,
            confirmed: false,
            brands: preserveExistingBrand && hasBrand ? existingBrands : [],
          };

          const nextHasAssignedBrand = (Array.isArray(nextItem.brands) ? nextItem.brands : [])
            .some((brand) => asText(brand?.name));
          return !needsScan || nextHasAssignedBrand
            ? clearIngredientBrandAppeal(nextItem)
            : nextItem;
        }),
      );
    },
    [
      applyIngredientChanges,
      normalizeAllergenList,
      normalizeDietList,
    ],
  );

  const applyIngredientSmartDetection = useCallback(
    async (ingredientIndex, { suppressModalError = false, shouldContinue } = {}) => {
      if (typeof shouldContinue === "function" && !shouldContinue()) {
        return { success: false, cancelled: true };
      }

      const currentRows = Array.isArray(latestIngredientsRef.current)
        ? latestIngredientsRef.current
        : [];
      const ingredient = currentRows[ingredientIndex];
      const ingredientNameAtApply = coerceIngredientNameForApply(ingredient);
      const hasAssignedBrand = (Array.isArray(ingredient?.brands) ? ingredient.brands : []).some(
        (brand) => asText(brand?.name),
      );

      // Brand-assigned rows are source-of-truth from the selected brand item.
      // Apply should only clear the row's dirty-name state, not mutate brand/allergen/diet values.
      if (hasAssignedBrand) {
        if (typeof shouldContinue === "function" && !shouldContinue()) {
          return { success: false, cancelled: true };
        }
        setLastAppliedIngredientNameByRow((current) => ({
          ...current,
          [ingredientIndex]: ingredientNameAtApply,
        }));
        if (!suppressModalError) setModalError("");
        return { success: true };
      }

      setApplyBusyByRow((current) => ({ ...current, [ingredientIndex]: true }));
      if (!suppressModalError) setModalError("");
      const detection = await analyzeIngredientForSmartDetection(ingredientIndex);
      setApplyBusyByRow((current) => ({ ...current, [ingredientIndex]: false }));

      if (typeof shouldContinue === "function" && !shouldContinue()) {
        return { success: false, cancelled: true };
      }

      if (!detection?.success) {
        const errorMessage =
          detection?.errorMessage || "Failed to analyze ingredient name.";
        if (!suppressModalError) {
          setModalError(errorMessage);
        }
        return {
          success: false,
          errorMessage,
        };
      }

      applyIngredientDetectionResult({
        ingredientIndex,
        analysis: detection.analysis,
        scanRequirement: detection.scanRequirement,
        preserveExistingBrand: true,
      });
      setLastAppliedIngredientNameByRow((current) => ({
        ...current,
        [ingredientIndex]: ingredientNameAtApply,
      }));
      return { success: true };
    },
    [
      analyzeIngredientForSmartDetection,
      applyIngredientDetectionResult,
    ],
  );

  // Wait for freshly generated rows to land in local editor state before auto-applying row analysis.
  const waitForGeneratedRows = useCallback(async (expectedNames, { shouldContinue } = {}) => {
    const safeNames = (Array.isArray(expectedNames) ? expectedNames : []).map((name) =>
      asText(name),
    );
    if (!safeNames.length) return true;

    const targetTokens = safeNames.map((name) => normalizeToken(name));
    const timeoutAt = Date.now() + 3000;

    while (Date.now() < timeoutAt) {
      if (typeof shouldContinue === "function" && !shouldContinue()) {
        return false;
      }
      const currentRows = Array.isArray(latestIngredientsRef.current)
        ? latestIngredientsRef.current
        : [];
      if (currentRows.length >= safeNames.length) {
        const hasExpectedOrder = targetTokens.every((token, index) => {
          if (!token) return true;
          return normalizeToken(currentRows[index]?.name) === token;
        });
        if (hasExpectedOrder) return true;
      }
      await sleep(25);
    }
    return true;
  }, []);

  const runAutoApplyForAllRows = useCallback(async (expectedNames, { shouldContinue } = {}) => {
    const safeNames = (Array.isArray(expectedNames) ? expectedNames : []).map((name) =>
      asText(name),
    );
    if (!safeNames.length) return { failedRows: [], cancelled: false };

    const generated = await waitForGeneratedRows(safeNames, { shouldContinue });
    if (!generated) {
      return { failedRows: [], cancelled: true };
    }

    const applyResults = await Promise.allSettled(
      safeNames.map(async (ingredientName, index) => {
        if (typeof shouldContinue === "function" && !shouldContinue()) {
          return {
            ingredientName,
            cancelled: true,
          };
        }

        const applied = await applyIngredientSmartDetection(index, {
          suppressModalError: true,
          shouldContinue,
        });

        return {
          ingredientName,
          applied,
        };
      }),
    );

    if (typeof shouldContinue === "function" && !shouldContinue()) {
      return { failedRows: [], cancelled: true };
    }

    const failedRows = applyResults.flatMap((result, index) => {
      const fallbackName = safeNames[index] || `Ingredient ${index + 1}`;
      if (result.status !== "fulfilled") {
        return [fallbackName];
      }

      if (result.value?.cancelled || result.value?.applied?.cancelled) {
        return [];
      }

      if (result.value?.applied?.success) {
        return [];
      }

      return [result.value?.ingredientName || fallbackName];
    });

    return { failedRows, cancelled: false };
  }, [applyIngredientSmartDetection, waitForGeneratedRows]);

  const removeIngredientBrandItem = useCallback(
    async (ingredientIndex) => {
      const ingredientName = asText(ingredients[ingredientIndex]?.name);
      if (!ingredientName) {
        setModalError("Ingredient name is required before removing a brand item.");
        return;
      }

      setModalError("");
      setSearchOpenRow((current) => (current === ingredientIndex ? -1 : current));
      setSearchQueryByRow((current) => ({ ...current, [ingredientIndex]: "" }));
      clearIngredientScanState(ingredientIndex);
      setAppealOpenByRow((current) => ({ ...current, [ingredientIndex]: false }));
      setAppealMessageByRow((current) => ({ ...current, [ingredientIndex]: "" }));
      setAppealPhotoByRow((current) => ({ ...current, [ingredientIndex]: null }));
      setAppealPhotoErrorByRow((current) => ({ ...current, [ingredientIndex]: "" }));
      setAppealFeedbackByRow((current) => ({
        ...current,
        [ingredientIndex]: { tone: "", message: "" },
      }));
      setApplyBusyByRow((current) => ({ ...current, [ingredientIndex]: true }));

      applyIngredientChanges((current) =>
        current.map((item, itemIndex) =>
          itemIndex === ingredientIndex
            ? {
                ...clearIngredientBrandSelectionFields(item),
                brands: [],
                allergens: [],
                diets: [],
                crossContaminationAllergens: [],
                crossContaminationDiets: [],
                aiDetectedAllergens: [],
                aiDetectedDiets: [],
                aiDetectedCrossContaminationAllergens: [],
                aiDetectedCrossContaminationDiets: [],
                confirmed: false,
              }
            : item,
        ),
      );

      const detection = await analyzeIngredientForSmartDetection(ingredientIndex);
      if (!detection?.success) {
        setModalError(
          detection?.errorMessage || "Failed to analyze ingredient name.",
        );
        setApplyBusyByRow((current) => ({ ...current, [ingredientIndex]: false }));
        return;
      }

      applyIngredientDetectionResult({
        ingredientIndex,
        analysis: detection.analysis,
        scanRequirement: detection.scanRequirement,
        preserveExistingBrand: false,
      });
      setApplyBusyByRow((current) => ({ ...current, [ingredientIndex]: false }));
    },
    [
      analyzeIngredientForSmartDetection,
      applyIngredientChanges,
      applyIngredientDetectionResult,
      clearIngredientScanState,
      ingredients,
    ],
  );

  const applyExistingBrandItem = useCallback(
    (ingredientIndex, brandItem) => {
      const normalizedBrand = normalizeBrandEntry(brandItem);
      if (!normalizedBrand) return;
      applyIngredientChanges((current) =>
        current.map((ingredient, index) => {
          if (index !== ingredientIndex) return ingredient;
          const allergensList = normalizeAllergenList(normalizedBrand.allergens);
          const dietsList = normalizeDietList(normalizedBrand.diets);
          const crossAllergens = normalizeAllergenList(
            normalizedBrand.crossContaminationAllergens,
          );
          const crossDiets = normalizeDietList(
            normalizedBrand.crossContaminationDiets,
          );
          const nextIngredient = applyIngredientBrandSelectionFields(
            ingredient,
            normalizedBrand,
          );
          return {
            ...clearIngredientBrandAppeal(nextIngredient),
            allergens: allergensList,
            diets: dietsList,
            crossContaminationAllergens: crossAllergens,
            crossContaminationDiets: crossDiets,
            aiDetectedAllergens: allergensList,
            aiDetectedDiets: dietsList,
            aiDetectedCrossContaminationAllergens: crossAllergens,
            aiDetectedCrossContaminationDiets: crossDiets,
            confirmed: true,
          };
        }),
      );
      setSearchOpenRow(-1);
      setSearchQueryByRow((current) => ({ ...current, [ingredientIndex]: "" }));
      clearIngredientScanState(ingredientIndex);
      setModalError("");
    },
    [
      applyIngredientChanges,
      clearIngredientScanState,
      normalizeAllergenList,
      normalizeDietList,
    ],
  );

  const scanIngredientBrandItem = useCallback(
    (ingredientIndex) => {
      if (aiActionsBlocked) {
        setModalError(`${runtimeBlockedTitle} Add the missing env vars and redeploy.`);
        return;
      }

      const ingredient = ingredients[ingredientIndex];
      const ingredientName = asText(ingredient?.name);
      if (!ingredientName) {
        setModalError("Ingredient name is required before scanning a brand item.");
        return;
      }

      setModalError("");
      setScanStateByRow((current) => ({
        ...current,
        [ingredientIndex]: {
          sessionId: "",
          phase: "capture_open",
          message: "Capture product front photo.",
          error: "",
        },
      }));

      editor
        .openIngredientLabelScan({
          ingredientName,
          scanProfile: "dish_editor_brand",
          onPhaseChange: (event) => {
            const phase = asText(event?.phase);
            const sessionId = asText(event?.sessionId);
            const message = asText(event?.message);
            const error = asText(event?.error);

            setScanStateByRow((current) => {
              const previous = current[ingredientIndex] || {};
              if (phase === "cancelled") {
                const next = { ...current };
                delete next[ingredientIndex];
                return next;
              }

              return {
                ...current,
                [ingredientIndex]: {
                  ...previous,
                  sessionId: sessionId || previous.sessionId || "",
                  phase: phase || previous.phase || "",
                  message:
                    message ||
                    (phase === "processing"
                      ? "Analyzing ingredient label in background..."
                      : previous.message || ""),
                  error:
                    phase === "failed"
                      ? error || message || "Ingredient label scan failed."
                      : "",
                },
              };
            });
          },
        })
        .then((result) => {
          if (!result?.success) {
            const errorMessage =
              result?.error?.message || "Ingredient label scan failed.";
            setModalError(errorMessage);
            setScanStateByRow((current) => ({
              ...current,
              [ingredientIndex]: {
                ...(current[ingredientIndex] || {}),
                phase: "failed",
                message: errorMessage,
                error: errorMessage,
              },
            }));
            return;
          }

          const payload = result?.result;
          if (!payload) {
            clearIngredientScanState(ingredientIndex);
            return;
          }

          const brandName = asText(payload.productName) || ingredientName;
          const brandItem = normalizeBrandEntry({
            name: brandName,
            allergens: normalizeAllergenList(payload.allergens),
            diets: normalizeDietList(payload.diets),
            crossContaminationAllergens: normalizeAllergenList(
              payload.crossContaminationAllergens,
            ),
            crossContaminationDiets: normalizeDietList(payload.crossContaminationDiets),
            ingredientsList: Array.isArray(payload.ingredientsList)
              ? payload.ingredientsList
              : [],
            parsedIngredientsList: Array.isArray(payload.parsedIngredientsList)
              ? payload.parsedIngredientsList
              : [],
            brandImage: asText(payload.brandImage),
            ingredientsImage: asText(payload.ingredientsImage),
          });
          if (!brandItem) {
            clearIngredientScanState(ingredientIndex);
            return;
          }

          let applied = false;
          applyIngredientChanges((current) =>
            current.map((item, itemIndex) => {
              if (itemIndex !== ingredientIndex) return item;
              if (normalizeToken(item?.name) !== normalizeToken(ingredientName)) {
                return item;
              }
              applied = true;
              const nextItem = applyIngredientBrandSelectionFields(item, brandItem);
              return {
                ...clearIngredientBrandAppeal(nextItem),
                allergens: brandItem.allergens,
                diets: brandItem.diets,
                crossContaminationAllergens: brandItem.crossContaminationAllergens,
                crossContaminationDiets: brandItem.crossContaminationDiets,
                aiDetectedAllergens: brandItem.allergens,
                aiDetectedDiets: brandItem.diets,
                aiDetectedCrossContaminationAllergens:
                  brandItem.crossContaminationAllergens,
                aiDetectedCrossContaminationDiets: brandItem.crossContaminationDiets,
                confirmed: true,
              };
            }),
          );
          if (!applied) {
            setModalError(
              "Ingredient row changed before scan completed. Please run the scan again.",
            );
          }
          clearIngredientScanState(ingredientIndex);
        });
    },
    [
      aiActionsBlocked,
      applyIngredientChanges,
      clearIngredientScanState,
      editor,
      ingredients,
      normalizeAllergenList,
      normalizeDietList,
      runtimeBlockedTitle,
    ],
  );

  const reviewIngredientScanResult = useCallback(
    async (ingredientIndex) => {
      const state = scanStateByRow[ingredientIndex];
      const sessionId = asText(state?.sessionId);
      if (!sessionId) {
        setModalError("No scan session found for this ingredient row.");
        return;
      }

      const result = await editor.resumeIngredientLabelScan({ sessionId });
      if (!result?.success) {
        const errorMessage =
          result?.error?.message || "Unable to reopen scan results.";
        setModalError(errorMessage);
        setScanStateByRow((current) => ({
          ...current,
          [ingredientIndex]: {
            ...(current[ingredientIndex] || {}),
            phase: "failed",
            message: errorMessage,
            error: errorMessage,
          },
        }));
      }
    },
    [editor, scanStateByRow],
  );

  const submitIngredientAppeal = useCallback(
    async (ingredientIndex) => {
      const ingredient = ingredients[ingredientIndex];
      const ingredientName = asText(ingredient?.name);
      const managerMessageRaw = String(appealMessageByRow[ingredientIndex] ?? "");
      const managerMessage = managerMessageRaw.trim();
      const photoEntry = appealPhotoByRow[ingredientIndex];
      const photoDataUrl = asText(photoEntry?.dataUrl || photoEntry);
      if (!ingredientName) {
        setModalError("Ingredient name is required before submitting an appeal.");
        return;
      }
      if (!managerMessage) {
        setAppealFeedbackByRow((current) => ({
          ...current,
          [ingredientIndex]: {
            tone: "error",
            message: "Enter a short reason before submitting an appeal.",
          },
        }));
        return;
      }
      if (!photoDataUrl) {
        setAppealPhotoErrorByRow((current) => ({
          ...current,
          [ingredientIndex]: "Take or upload a photo before submitting an appeal.",
        }));
        setAppealFeedbackByRow((current) => ({
          ...current,
          [ingredientIndex]: {
            tone: "error",
            message: "Appeal photo is required.",
          },
        }));
        return;
      }

      setAppealBusyByRow((current) => ({ ...current, [ingredientIndex]: true }));
      setModalError("");
      setAppealFeedbackByRow((current) => ({
        ...current,
        [ingredientIndex]: { tone: "", message: "" },
      }));

      const submittedAt = new Date().toISOString();
      const nextAppeal = buildPendingIngredientBrandAppeal({
        existingAppeal: ingredient?.brandAppeal,
        managerMessage,
        photoDataUrl,
        submittedAt,
      });

      applyIngredientChanges((current) =>
        current.map((item, itemIndex) =>
          itemIndex === ingredientIndex
            ? applyIngredientBrandAppeal(item, nextAppeal)
            : item,
        ),
        {
          recordHistory: true,
        },
      );
      setAppealBusyByRow((current) => ({ ...current, [ingredientIndex]: false }));

      setAppealMessageByRow((current) => ({ ...current, [ingredientIndex]: "" }));
      setAppealPhotoByRow((current) => ({ ...current, [ingredientIndex]: null }));
      setAppealPhotoErrorByRow((current) => ({ ...current, [ingredientIndex]: "" }));
      setAppealOpenByRow((current) => ({ ...current, [ingredientIndex]: false }));
      setAppealPendingByRow((current) => ({ ...current, [ingredientIndex]: true }));
      setAppealFeedbackByRow((current) => ({
        ...current,
        [ingredientIndex]: {
          tone: "success",
          message: "Appeal added. Save to Site to submit it.",
        },
      }));
    },
    [
      appealMessageByRow,
      appealPhotoByRow,
      applyIngredientChanges,
      ingredients,
      setModalError,
    ],
  );

  // Row-scoped UI setters are centralized here to keep child row props simple.
  const setIngredientRowRef = useCallback((index, node) => {
    ingredientRowRefs.current[index] = node;
  }, []);

  const toggleIngredientSearchOpen = useCallback((ingredientIndex) => {
    setSearchOpenRow((current) => (current === ingredientIndex ? -1 : ingredientIndex));
  }, []);

  const updateIngredientSearchQuery = useCallback((ingredientIndex, value) => {
    setSearchQueryByRow((current) => ({
      ...current,
      [ingredientIndex]: value,
    }));
  }, []);

  const toggleIngredientAppealOpen = useCallback((ingredientIndex) => {
    setAppealOpenByRow((current) => ({
      ...current,
      [ingredientIndex]: !current[ingredientIndex],
    }));
  }, []);

  const closeIngredientAppeal = useCallback((ingredientIndex) => {
    setAppealOpenByRow((current) => ({
      ...current,
      [ingredientIndex]: false,
    }));
  }, []);

  const updateIngredientAppealMessage = useCallback((ingredientIndex, value) => {
    setAppealMessageByRow((current) => ({
      ...current,
      [ingredientIndex]: value,
    }));
  }, []);

  const handleCloseDishEditor = useCallback(() => {
    if (Object.values(applyBusyByRow).some((value) => Boolean(value))) {
      setModalError("Please wait for Apply to finish before leaving this dish editor.");
      return;
    }
    setModalError("");
    editor.pushHistory();
    editor.closeDishEditor();
  }, [applyBusyByRow, editor]);

  const handleDictate = useCallback(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      editor.setAiAssistDraft((current) => ({
        ...current,
        error:
          "Voice dictation is not supported in this browser. Please type your ingredients.",
      }));
      return;
    }

    if (dictationRecognitionRef.current) {
      dictationRecognitionRef.current.stop();
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    const initialText = asText(
      recipeTextareaRef.current?.value || editor.aiAssistDraft.text,
    );

    recognition.onstart = () => {
      setDictateActive(true);
      editor.setAiAssistDraft((current) => ({
        ...current,
        error: "",
      }));
    };

    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += ` ${asText(event.results[index]?.[0]?.transcript)}`;
      }
      const spokenText = asText(transcript);
      const nextText = [initialText, spokenText].filter(Boolean).join(" ");
      editor.setAiAssistDraft((current) => ({
        ...current,
        imageData: "",
        text: nextText,
      }));
    };

    recognition.onerror = (event) => {
      const errorCode = asText(event?.error) || "unknown_error";
      const denied = errorCode === "not-allowed" || errorCode === "service-not-allowed";
      editor.setAiAssistDraft((current) => ({
        ...current,
        error: denied
          ? "Microphone permission is blocked. Allow microphone access and try again."
          : `Dictation failed (${errorCode}). Try again.`,
      }));
    };

    recognition.onend = () => {
      dictationRecognitionRef.current = null;
      setDictateActive(false);
    };

    dictationRecognitionRef.current = recognition;
    recognition.start();
  }, [editor]);

  const onProcessInput = async () => {
    if (processInputBusy || autoApplyBusy) return;
    autoApplyRunIdRef.current += 1;
    setProcessInputBusy(true);
    if (aiActionsBlocked) {
      editor.setAiAssistDraft((current) => ({
        ...current,
        loading: false,
        error: `${runtimeBlockedTitle} Add the missing env vars and redeploy.`,
      }));
      setProcessInputBusy(false);
      return;
    }

    const liveText = asText(
      recipeTextareaRef.current?.value || editor.aiAssistDraft.text,
    );
    const overlayKeyAtStart = asText(overlay?._editorKey);
    let startedBackgroundApply = false;
    try {
      const result = await editor.runAiDishAnalysis({ overrideText: liveText });
      if (result?.success && result?.result) {
        await editor.applyAiResultToSelectedOverlay(result.result);
        const createdNames = (Array.isArray(result.result.ingredients)
          ? result.result.ingredients
          : []
        ).map((ingredient, index) => asText(ingredient?.name) || `Ingredient ${index + 1}`);
        const runId = autoApplyRunIdRef.current + 1;
        autoApplyRunIdRef.current = runId;
        startedBackgroundApply = true;
        setAutoApplyBusy(createdNames.length > 0);
        setProcessInputBusy(false);

        void (async () => {
          const shouldContinue = () =>
            autoApplyRunIdRef.current === runId &&
            dishEditorOpenRef.current &&
            normalizeToken(activeOverlayKeyRef.current) === normalizeToken(overlayKeyAtStart);
          const autoApplyResult = await runAutoApplyForAllRows(createdNames, {
            shouldContinue,
          });

          if (autoApplyRunIdRef.current !== runId) {
            return;
          }

          setAutoApplyBusy(false);

          const currentRows = Array.isArray(latestIngredientsRef.current)
            ? latestIngredientsRef.current
            : [];
          setLastAppliedIngredientNameByRow(() => {
            const next = {};
            currentRows.forEach((ingredient, index) => {
              next[index] = coerceIngredientNameForApply(ingredient);
            });
            return next;
          });
          if (autoApplyResult.cancelled) {
            return;
          }
          if (autoApplyResult.failedRows.length) {
            setModalError(
              `Automatic Apply failed for: ${autoApplyResult.failedRows.join(", ")}. Run Apply on those rows.`,
            );
          } else {
            setModalError("");
          }
        })();
        return;
      }

      const failureReason = asText(result?.error?.message || editor.aiAssistDraft.error);
      editor.setAiAssistDraft((current) => ({
        ...current,
        loading: false,
        error: failureReason
          ? `AI processing failed; existing ingredient rows were not changed. ${failureReason}`
          : "AI processing failed; existing ingredient rows were not changed.",
      }));
    } finally {
      if (!startedBackgroundApply) {
        setProcessInputBusy(false);
      }
    }
  };

  const isIngredientGenerationBusy =
    processInputBusy || editor.aiAssistDraft.loading;
  const isApplyingIngredientName = useMemo(
    () => autoApplyBusy || Object.values(applyBusyByRow).some((value) => Boolean(value)),
    [applyBusyByRow, autoApplyBusy],
  );
  const hasIngredientRows = ingredients.length > 0;
  const showPostProcessSections = hasIngredientRows;

  useEffect(() => {
    if (!editor.dishEditorOpen || !isApplyingIngredientName) return undefined;

    const leaveMessage = "are you sure you wanna leave?";
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = leaveMessage;
      return leaveMessage;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [editor.dishEditorOpen, isApplyingIngredientName]);

  // Save-review jump requests scroll directly to the relevant ingredient row in this modal.
  useEffect(() => {
    if (!editor.dishEditorOpen) return;
    if (!saveIssueJumpRequest) return;
    if (
      saveIssueJumpRequest.overlayKey &&
      saveIssueJumpRequest.overlayKey !== overlay?._editorKey
    ) {
      return;
    }

    const requestedIndex = Number(saveIssueJumpRequest.ingredientIndex);
    const hasRequestedIndex =
      Number.isFinite(requestedIndex) &&
      requestedIndex >= 0 &&
      requestedIndex < ingredients.length;
    const targetToken = normalizeToken(saveIssueJumpRequest.ingredientName);
    const targetIndex = hasRequestedIndex
      ? Math.floor(requestedIndex)
      : targetToken
        ? ingredients.findIndex(
            (ingredient) => normalizeToken(ingredient?.name) === targetToken,
          )
        : -1;
    if (targetIndex < 0) return;

    const rowNode = ingredientRowRefs.current[targetIndex];
    if (!rowNode) return;

    rowNode.scrollIntoView({ behavior: "smooth", block: "center" });
    onSaveIssueJumpHandled?.();
  }, [
    editor.dishEditorOpen,
    ingredients,
    onSaveIssueJumpHandled,
    overlay?._editorKey,
    saveIssueJumpRequest,
  ]);

  const setAssistImageFromFile = useCallback(
    async (file) => {
      if (!file) return;
      const imageData = await fileToDataUrl(file);
      editor.setAiAssistDraft((current) => ({
        ...current,
        text: "",
        imageData,
      }));
    },
    [editor],
  );

  return {
    overlay,
    showDeleteWarning,
    setShowDeleteWarning,
    recipeTextareaRef,
    aiActionsBlocked,
    runtimeBlockedTitle,
    allergens,
    diets,
    ingredients,
    existingBrandItems,
    previewAllergenRows,
    previewDietRows,
    applyBusyByRow,
    lastAppliedIngredientNameByRow,
    scanStateByRow,
    searchOpenRow,
    searchQueryByRow,
    appealOpenByRow,
    appealMessageByRow,
    appealPhotoByRow,
    appealPhotoErrorByRow,
    appealBusyByRow,
    appealFeedbackByRow,
    appealPendingByRow,
    modalError,
    dictateActive,
    isIngredientGenerationBusy,
    autoApplyBusy,
    isApplyingIngredientName,
    showPostProcessSections,
    handleCloseDishEditor,
    handleDictate,
    onProcessInput,
    updateIngredientName,
    applyIngredientSmartDetection,
    removeIngredientBrandItem,
    toggleIngredientSearchOpen,
    updateIngredientSearchQuery,
    applyExistingBrandItem,
    scanIngredientBrandItem,
    reviewIngredientScanResult,
    toggleIngredientAppealOpen,
    updateIngredientAppealMessage,
    handleAppealPhotoChange,
    clearAppealPhoto,
    submitIngredientAppeal,
    closeIngredientAppeal,
    toggleIngredientRemovable,
    cycleIngredientTokenState,
    toggleIngredientConfirmed,
    removeIngredientRow,
    addIngredientRow,
    setIngredientRowRef,
    setAssistImageFromFile,
  };
}
