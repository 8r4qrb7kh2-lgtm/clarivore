"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Modal, Textarea } from "../../../components/ui";
import { CLARIVORE_LOGO_SRC } from "../../../components/clarivoreBrand";
import ConfirmToggleButton from "../../../components/ingredient-scan/ConfirmToggleButton";
import {
  buildAllergenRows as buildDishAllergenRows,
  buildAllergenCrossRows as buildDishAllergenCrossRows,
  buildDietRows as buildDishDietRows,
  buildDietCrossRows as buildDishDietCrossRows,
  mergeSectionRows as mergeDishSectionRows,
} from "../shared/dishDetailRows";
import {
  asText,
  normalizeToken,
  fileToDataUrl,
  buildAllergenDisplay,
  buildDietDisplay,
  dedupeTokenList,
  readTokenState,
  nextTokenState,
  getChipToneClass,
  getChipBorderClass,
  buildPersistedIngredientSignature,
  buildRowManualOverrideMessages,
  buildRowConflictMessages,
  normalizePreviewOptions,
  normalizeBrandEntry,
  normalizeIngredientEntry,
  deriveDishStateFromIngredients,
} from "./editorUtils";

function DishEditorModal({
  editor,
  runtimeConfigHealth,
  saveIssueJumpRequest,
  onSaveIssueJumpHandled,
  confirmationGuide,
  onGuideBack,
  onGuideForward,
  onGuideCancel,
}) {
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
  const [processInputBusy, setProcessInputBusy] = useState(false);
  const [dictateActive, setDictateActive] = useState(false);
  const [modalError, setModalError] = useState("");
  const recipeTextareaRef = useRef(null);
  const dictationRecognitionRef = useRef(null);
  const ingredientRowRefs = useRef({});
  const runtimeMissingKeys = Array.isArray(runtimeConfigHealth?.missing)
    ? runtimeConfigHealth.missing
    : [];
  const aiActionsBlocked = Boolean(runtimeConfigHealth?.blocked);
  const runtimeBlockedTitle = runtimeMissingKeys.length
    ? `Runtime configuration missing: ${runtimeMissingKeys.join(", ")}`
    : "Runtime configuration missing.";

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

  useEffect(() => {
    if (!editor.dishEditorOpen) {
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
      setProcessInputBusy(false);
      setDictateActive(false);
      setModalError("");
    }
  }, [editor.dishEditorOpen]);

  useEffect(() => {
    setLastAppliedIngredientNameByRow({});
  }, [overlay?._editorKey]);

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
      if (!asText(dataUrl)) {
        throw new Error("Failed to read image.");
      }
      setAppealPhotoByRow((current) => ({
        ...current,
        [ingredientIndex]: {
          dataUrl,
          fileName: asText(file.name),
        },
      }));
      setAppealPhotoErrorByRow((current) => ({
        ...current,
        [ingredientIndex]: "",
      }));
    } catch (_error) {
      setAppealPhotoErrorByRow((current) => ({
        ...current,
        [ingredientIndex]: "Failed to read image. Try another photo.",
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

  const cycleIngredientTokenState = useCallback(
    (ingredientIndex, type, token) => {
      const value = asText(token);
      if (!value) return;
      const ingredientName =
        asText(ingredients[ingredientIndex]?.name) || `Ingredient ${ingredientIndex + 1}`;
      const dishName = asText(overlay?.id || "Dish");
      const containsField = type === "diet" ? "diets" : "allergens";
      const crossField =
        type === "diet"
          ? "crossContaminationDiets"
          : "crossContaminationAllergens";

      const currentIngredient = ingredients[ingredientIndex];
      const currentState = readTokenState({
        containsValues: currentIngredient?.[containsField],
        crossValues: currentIngredient?.[crossField],
        token: value,
      });
      const nextState = nextTokenState(currentState);
      const categoryLabel = type === "diet" ? "diet" : "allergen";
      const changeText =
        nextState === "contains"
          ? `${dishName}: ${ingredientName}: added ${value} ${categoryLabel} (contains)`
          : nextState === "cross"
            ? `${dishName}: ${ingredientName}: ${value} ${categoryLabel} marked cross-contamination risk`
            : `${dishName}: ${ingredientName}: removed ${value} ${categoryLabel}`;
      const changeKey = `ingredient-flag:${normalizeToken(dishName)}:${ingredientIndex}:${type}:${normalizeToken(value)}`;

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
          changeText,
          changeKey,
          recordHistory: true,
        },
      );
    },
    [applyIngredientChanges, ingredients, overlay?.id],
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

      const hasAssignedBrand = (Array.isArray(ingredient?.brands)
        ? ingredient.brands
        : []
      ).some((brand) => asText(brand?.name));
      const requiresBrandBeforeConfirm =
        Boolean(ingredient?.brandRequired) &&
        !hasAssignedBrand &&
        ingredient?.confirmed !== true;

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
    [applyIngredientChanges, ingredients],
  );

  const addIngredientRow = useCallback(() => {
    const dishName = asText(overlay?.id || "Dish");
    const nextIngredientName = `Ingredient ${ingredients.length + 1}`;
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
        changeText: `${dishName}: Ingredient row added: ${nextIngredientName}`,
        recordHistory: true,
      },
    );
    setLastAppliedIngredientNameByRow({});
  }, [applyIngredientChanges, ingredients.length, overlay?.id]);

  const removeIngredientRow = useCallback(
    (ingredientIndex) => {
      const removedName = asText(ingredients[ingredientIndex]?.name) || "Ingredient";
      applyIngredientChanges(
        (current) => current.filter((_, index) => index !== ingredientIndex),
        {
          changeText: `${overlay?.id || "Dish"}: Ingredient row removed: ${removedName}`,
          recordHistory: true,
        },
      );
      setLastAppliedIngredientNameByRow({});
    },
    [applyIngredientChanges, ingredients, overlay?.id],
  );

  const analyzeIngredientForSmartDetection = useCallback(
    async (ingredientIndex) => {
      const ingredient = ingredients[ingredientIndex];
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
    [editor, ingredients, overlay?.id, overlay?.name],
  );

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

          return {
            ...item,
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
            brands:
              preserveExistingBrand && hasBrand ? existingBrands : [],
          };
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
    async (ingredientIndex) => {
      const ingredientNameAtApply =
        typeof ingredients[ingredientIndex]?.name === "string"
          ? ingredients[ingredientIndex].name
          : ingredients[ingredientIndex]?.name == null
            ? ""
            : String(ingredients[ingredientIndex].name);
      setApplyBusyByRow((current) => ({ ...current, [ingredientIndex]: true }));
      setModalError("");
      const detection = await analyzeIngredientForSmartDetection(ingredientIndex);
      setApplyBusyByRow((current) => ({ ...current, [ingredientIndex]: false }));

      if (!detection?.success) {
        setModalError(
          detection?.errorMessage || "Failed to analyze ingredient name.",
        );
        return;
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
    },
    [
      analyzeIngredientForSmartDetection,
      applyIngredientDetectionResult,
      ingredients,
    ],
  );

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
                ...item,
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
          return {
            ...ingredient,
            allergens: allergensList,
            diets: dietsList,
            crossContaminationAllergens: crossAllergens,
            crossContaminationDiets: crossDiets,
            aiDetectedAllergens: allergensList,
            aiDetectedDiets: dietsList,
            aiDetectedCrossContaminationAllergens: crossAllergens,
            aiDetectedCrossContaminationDiets: crossDiets,
            brands: [normalizedBrand],
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
          message: "Capture ingredient label photo.",
          error: "",
        },
      }));

      editor
        .openIngredientLabelScan({
          ingredientName,
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
              return {
                ...item,
                allergens: brandItem.allergens,
                diets: brandItem.diets,
                crossContaminationAllergens: brandItem.crossContaminationAllergens,
                crossContaminationDiets: brandItem.crossContaminationDiets,
                aiDetectedAllergens: brandItem.allergens,
                aiDetectedDiets: brandItem.diets,
                aiDetectedCrossContaminationAllergens:
                  brandItem.crossContaminationAllergens,
                aiDetectedCrossContaminationDiets: brandItem.crossContaminationDiets,
                brands: [brandItem],
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
      setAppealFeedbackByRow((current) => ({
        ...current,
        [ingredientIndex]: { tone: "", message: "" },
      }));

      const result = await editor.submitIngredientAppeal({
        dishName: asText(overlay?.id || overlay?.name),
        ingredientName,
        managerMessage,
        photoDataUrl,
      });

      setAppealBusyByRow((current) => ({ ...current, [ingredientIndex]: false }));

      if (!result?.success) {
        setAppealFeedbackByRow((current) => ({
          ...current,
          [ingredientIndex]: {
            tone: "error",
            message:
              result?.error?.message || "Failed to submit appeal. Please try again.",
          },
        }));
        return;
      }

      setAppealMessageByRow((current) => ({ ...current, [ingredientIndex]: "" }));
      setAppealPhotoByRow((current) => ({ ...current, [ingredientIndex]: null }));
      setAppealPhotoErrorByRow((current) => ({ ...current, [ingredientIndex]: "" }));
      setAppealOpenByRow((current) => ({ ...current, [ingredientIndex]: false }));
      setAppealFeedbackByRow((current) => ({
        ...current,
        [ingredientIndex]: {
          tone: "success",
          message: "Appeal submitted for review.",
        },
      }));
    },
    [
      appealMessageByRow,
      appealPhotoByRow,
      editor,
      ingredients,
      overlay?.id,
      overlay?.name,
    ],
  );

  const handleCloseDishEditor = useCallback(() => {
    setModalError("");
    editor.pushHistory();
    editor.closeDishEditor();
  }, [editor]);

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
    if (processInputBusy) return;
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
    try {
      const result = await editor.runAiDishAnalysis({ overrideText: liveText });
      if (result?.success && result?.result) {
        await editor.applyAiResultToSelectedOverlay(result.result);
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
      setProcessInputBusy(false);
    }
  };

  const isIngredientGenerationBusy =
    processInputBusy || editor.aiAssistDraft.loading;
  const hasIngredientRows = ingredients.length > 0;
  const hasProcessableInput = Boolean(
    asText(editor.aiAssistDraft.text) || asText(editor.aiAssistDraft.imageData),
  );
  const showPostProcessSections = hasIngredientRows;

  useEffect(() => {
    if (!editor.dishEditorOpen) return;
    if (!saveIssueJumpRequest) return;
    if (
      saveIssueJumpRequest.overlayKey &&
      saveIssueJumpRequest.overlayKey !== overlay?._editorKey
    ) {
      return;
    }

    const targetToken = normalizeToken(saveIssueJumpRequest.ingredientName);
    if (!targetToken) {
      onSaveIssueJumpHandled?.();
      return;
    }

    const targetIndex = ingredients.findIndex(
      (ingredient) => normalizeToken(ingredient?.name) === targetToken,
    );
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

  return (
    <Modal
      open={editor.dishEditorOpen}
      onOpenChange={(open) => {
        if (!open) {
          editor.pushHistory();
          editor.closeDishEditor();
        }
      }}
      className="restaurant-legacy-editor-dish-modal-shell"
    >
      {!overlay ? (
        <p className="note">Select an overlay to edit.</p>
      ) : (
        <div className="restaurant-legacy-editor-dish-modal">
          {confirmationGuide ? (
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 5,
                marginBottom: 10,
                display: "flex",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(127,29,29,0.65)",
                  background: "rgba(76, 9, 9, 0.92)",
                }}
              >
                <span style={{ fontSize: "0.84rem", color: "#ffd0d0", fontWeight: 600 }}>
                  Confirming rows {confirmationGuide.currentIndex + 1} of {confirmationGuide.issues.length}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="btn btnSmall"
                    disabled={!confirmationGuide.canBack}
                    onClick={onGuideBack}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="btn btnSmall"
                    disabled={!confirmationGuide.canForward}
                    onClick={onGuideForward}
                  >
                    Forward
                  </button>
                  <button
                    type="button"
                    className="btn btnDanger btnSmall"
                    onClick={onGuideCancel}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="restaurant-legacy-editor-dish-head">
            <h2>Dish editor</h2>
            <div className="restaurant-legacy-editor-dish-head-actions">
              <button
                type="button"
                className="btn btnDanger"
                onClick={() => setShowDeleteWarning(true)}
              >
                🗑 Delete
              </button>
              <button
                type="button"
                className="btn"
                onClick={handleCloseDishEditor}
              >
                Done
              </button>
            </div>
          </div>

          <label className="restaurant-legacy-editor-dish-label">
            Dish name:
            <input
              className="restaurant-legacy-editor-dish-name-input"
              value={overlay.id || ""}
              placeholder="Item name"
              aria-label="Dish name"
              onChange={(event) =>
                editor.updateSelectedOverlay({
                  id: event.target.value,
                  name: event.target.value,
                })
              }
            />
          </label>

          <p className="restaurant-legacy-editor-dish-subcopy">
            Upload recipe photos or describe the dish ingredients below.
          </p>

          <div className="restaurant-legacy-editor-dish-media-row">
            <label className="btn" htmlFor="dish-editor-upload-photo">
              📁 Upload photos
            </label>
            <input
              id="dish-editor-upload-photo"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const imageData = await fileToDataUrl(file);
                editor.setAiAssistDraft((current) => ({
                  ...current,
                  text: "",
                  imageData,
                }));
                event.target.value = "";
              }}
            />
            <label className="btn" htmlFor="dish-editor-take-photo">
              📷 Take photo
            </label>
            <input
              id="dish-editor-take-photo"
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const imageData = await fileToDataUrl(file);
                editor.setAiAssistDraft((current) => ({
                  ...current,
                  text: "",
                  imageData,
                }));
                event.target.value = "";
              }}
            />
          </div>

          <div className="restaurant-legacy-editor-dish-or">OR</div>

          <div className="restaurant-legacy-editor-dish-text-wrap">
            <Textarea
              ref={recipeTextareaRef}
              rows={5}
              value={editor.aiAssistDraft.text}
              className="restaurant-legacy-editor-dish-textarea"
              onChange={(event) =>
                editor.setAiAssistDraft((current) => ({
                  ...current,
                  imageData: "",
                  text: event.target.value,
                }))
              }
            />
            <div className="restaurant-legacy-editor-dish-text-actions">
              <button
                type="button"
                className="btn"
                onClick={handleDictate}
              >
                {dictateActive ? "⏹ Stop dictation" : "🎙 Dictate"}
              </button>
              <button
                type="button"
                className="btn btnPrimary"
                onClick={() =>
                  editor.setAiAssistDraft((current) => ({
                    ...current,
                    text:
                      current.text ||
                      `Create a generic recipe for ${overlay.id || overlay.name || "this dish"}.`,
                  }))
                }
              >
                ✨ Generate generic {overlay.id || "dish"} recipe
              </button>
            </div>
          </div>

          {editor.aiAssistDraft.error ? (
            <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
              {editor.aiAssistDraft.error}
            </p>
          ) : null}

          <div
            className={`restaurant-legacy-editor-dish-generation-wrap ${isIngredientGenerationBusy ? "is-processing" : ""}`}
          >
            <Button
              tone="success"
              loading={isIngredientGenerationBusy}
              disabled={aiActionsBlocked || isIngredientGenerationBusy}
              title={aiActionsBlocked ? runtimeBlockedTitle : ""}
              onClick={onProcessInput}
              className="restaurant-legacy-editor-dish-process-btn"
            >
              ✓ Process Input
            </Button>

            {!showPostProcessSections ? (
              <p className="note m-0 mt-2 text-sm">
                Add recipe text or a photo, then run <strong>Process Input</strong> to populate ingredient rows.
              </p>
            ) : null}

            {showPostProcessSections ? (
            <div className="restaurant-legacy-editor-dish-ingredients">
              <h3>Ingredients</h3>
              {ingredients.length ? (
                <div className="restaurant-legacy-editor-dish-ingredient-list">
                  {ingredients.map((ingredient, index) => {
                  const currentIngredientName =
                    typeof ingredient?.name === "string"
                      ? ingredient.name
                      : ingredient?.name == null
                        ? ""
                        : String(ingredient.name);
                  const showApplyButton =
                    currentIngredientName !==
                    (lastAppliedIngredientNameByRow[index] ?? "");
                  const selectedBrandName = asText(ingredient?.brands?.[0]?.name);
                  const selectedBrandImage = asText(
                    ingredient?.brands?.[0]?.brandImage ||
                      ingredient?.brands?.[0]?.image ||
                      ingredient?.brandImage,
                  );
                  const hasAssignedBrand = Boolean(selectedBrandName);
                  const requiresBrandBeforeConfirm =
                    Boolean(ingredient?.brandRequired) &&
                    !hasAssignedBrand &&
                    ingredient?.confirmed !== true;
                  const manualOverrideMessages = buildRowManualOverrideMessages({
                    ingredient,
                    allergens,
                    diets,
                    formatAllergenLabel: editor.config.formatAllergenLabel,
                    formatDietLabel: editor.config.formatDietLabel,
                  });
                  const manualOverrideText = manualOverrideMessages.join("; ");
                  const conflictMessages = buildRowConflictMessages({
                    ingredient,
                    allergens,
                    diets,
                    getDietAllergenConflicts: editor.config.getDietAllergenConflicts,
                    formatAllergenLabel: editor.config.formatAllergenLabel,
                    formatDietLabel: editor.config.formatDietLabel,
                  });
                  const conflictWarningText = conflictMessages.join("; ");
                  const searchOpen = searchOpenRow === index;
                  const searchTerm = asText(searchQueryByRow[index]).toLowerCase();
                  const appealOpen = Boolean(appealOpenByRow[index]);
                  const appealMessage = String(appealMessageByRow[index] ?? "");
                  const appealPhoto = appealPhotoByRow[index] || null;
                  const appealPhotoDataUrl = asText(
                    appealPhoto?.dataUrl || appealPhoto,
                  );
                  const appealPhotoFileName = asText(appealPhoto?.fileName);
                  const appealPhotoError = asText(appealPhotoErrorByRow[index]);
                  const appealBusy = Boolean(appealBusyByRow[index]);
                  const appealFeedback = appealFeedbackByRow[index];
                  const canSubmitAppeal =
                    !appealBusy &&
                    appealMessage.trim().length > 0 &&
                    Boolean(appealPhotoDataUrl);
                  const scanState = scanStateByRow[index] || {};
                  const scanPhase = asText(scanState?.phase);
                  const scanMessage = asText(scanState?.message);
                  const scanError = asText(scanState?.error);
                  const hasReviewReady =
                    scanPhase === "ready_for_review" || scanPhase === "review_open";
                  const isScanProcessing = scanPhase === "processing";
                  const isScanCapture = scanPhase === "capture_open";
                  const scanButtonText = hasReviewReady
                    ? "Review scan results"
                    : isScanProcessing
                      ? "Analyzing..."
                      : isScanCapture
                        ? "Capture open..."
                        : "Add new item";
                  const scanButtonDisabled =
                    aiActionsBlocked || isScanProcessing || isScanCapture;
                  const matchingBrands = existingBrandItems
                    .filter((brand) => {
                      if (
                        normalizeToken(brand.name) === normalizeToken(selectedBrandName)
                      ) {
                        return false;
                      }
                      if (!searchTerm) return true;
                      return brand.name.toLowerCase().includes(searchTerm);
                    })
                    .slice(0, 8);
                    return (
                    <div
                      key={`ingredient-row-${index}`}
                      className="restaurant-legacy-editor-dish-ingredient-card"
                      ref={(node) => {
                        ingredientRowRefs.current[index] = node;
                      }}
                    >
                      <div className="restaurant-legacy-editor-dish-ingredient-main">
                        <div className="restaurant-legacy-editor-dish-ingredient-name-col">
                          <div className="restaurant-legacy-editor-dish-ingredient-name-row">
                            <input
                              className="restaurant-legacy-editor-dish-ingredient-name-input"
                              value={ingredient.name}
                              onChange={(event) =>
                                updateIngredientName(index, event.target.value)
                              }
                            />
                            {showApplyButton ? (
                              <button
                                type="button"
                                className="btn btnSmall btnWarning"
                                disabled={Boolean(applyBusyByRow[index])}
                                onClick={() => applyIngredientSmartDetection(index)}
                              >
                                {applyBusyByRow[index] ? "Applying..." : "Apply"}
                              </button>
                            ) : null}
                          </div>

                        <div
                          className={`restaurant-legacy-editor-dish-ingredient-brand ${ingredient.brandRequired && !hasAssignedBrand ? "is-required" : ""}`}
                        >
                          {hasAssignedBrand ? (
                            <span className="restaurant-legacy-editor-dish-ingredient-brand-selected">
                              Selected: {selectedBrandName}
                            </span>
                          ) : null}
                          {hasAssignedBrand && selectedBrandImage ? (
                            <img
                              src={selectedBrandImage}
                              alt={`${selectedBrandName} thumbnail`}
                              className="restaurant-legacy-editor-dish-ingredient-brand-thumb"
                            />
                          ) : null}
                          {hasAssignedBrand ? (
                            <div className="restaurant-legacy-editor-dish-ingredient-brand-actions">
                              <button
                                type="button"
                                className="btn btnDanger btnSmall"
                                disabled={Boolean(applyBusyByRow[index])}
                                onClick={() => removeIngredientBrandItem(index)}
                              >
                                {applyBusyByRow[index] ? "Removing..." : "Remove item"}
                              </button>
                            </div>
                          ) : (
                            <>
                              <span>
                                {ingredient.brandRequired
                                  ? "⚠ Brand assignment required"
                                  : "✓ Brand assignment optional"}
                              </span>
                              {ingredient.brandRequirementReason ? (
                                <span className="restaurant-legacy-editor-dish-ingredient-brand-reason">
                                  {ingredient.brandRequirementReason}
                                </span>
                              ) : null}
                              <div className="restaurant-legacy-editor-dish-ingredient-brand-actions">
                                <button
                                  type="button"
                                  className="btn btnSmall"
                                  onClick={() =>
                                    setSearchOpenRow((current) =>
                                      current === index ? -1 : index,
                                    )
                                  }
                                >
                                  Search existing items
                                </button>
                                <button
                                  type="button"
                                  className="btn btnSuccess btnSmall"
                                  disabled={scanButtonDisabled}
                                  title={aiActionsBlocked ? runtimeBlockedTitle : ""}
                                  onClick={() => {
                                    if (hasReviewReady) {
                                      reviewIngredientScanResult(index);
                                      return;
                                    }
                                    scanIngredientBrandItem(index);
                                  }}
                                >
                                  {scanButtonText}
                                </button>
                                {ingredient.brandRequired ? (
                                  <button
                                    type="button"
                                    className="btn btnDanger btnSmall"
                                    onClick={() =>
                                      setAppealOpenByRow((current) => ({
                                        ...current,
                                        [index]: !current[index],
                                      }))
                                    }
                                  >
                                    Submit appeal
                                  </button>
                                ) : null}
                              </div>
                              {scanMessage ? (
                                <span
                                  style={{
                                    display: "block",
                                    marginTop: 6,
                                    color: scanError ? "#fecaca" : "#93c5fd",
                                    fontSize: "0.78rem",
                                  }}
                                >
                                  {scanMessage}
                                </span>
                              ) : null}
                              {scanError ? (
                                <span
                                  style={{
                                    display: "block",
                                    marginTop: 4,
                                    color: "#fca5a5",
                                    fontSize: "0.78rem",
                                  }}
                                >
                                  {scanError}
                                </span>
                              ) : null}
                              {searchOpen ? (
                                <div className="restaurant-legacy-editor-dish-brand-search">
                                  <input
                                    className="restaurant-legacy-editor-dish-brand-search-input"
                                    value={searchQueryByRow[index] || ""}
                                    placeholder="Search brand item names"
                                    onChange={(event) =>
                                      setSearchQueryByRow((current) => ({
                                        ...current,
                                        [index]: event.target.value,
                                      }))
                                    }
                                  />
                                  <div className="restaurant-legacy-editor-dish-brand-search-results">
                                    {matchingBrands.length ? (
                                      matchingBrands.map((brand) => (
                                        <button
                                          key={`${index}-${brand.name}`}
                                          type="button"
                                          className="restaurant-legacy-editor-dish-brand-search-result"
                                          onClick={() =>
                                            applyExistingBrandItem(index, brand)
                                          }
                                        >
                                          {brand.name}
                                        </button>
                                      ))
                                    ) : (
                                      <p className="restaurant-legacy-editor-dish-brand-search-empty">
                                        No matching brand items in this menu.
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ) : null}
                              {ingredient.brandRequired && appealOpen ? (
                                <div className="restaurant-legacy-editor-dish-appeal-wrap">
                                  <textarea
                                    className="restaurant-legacy-editor-dish-appeal-input"
                                    placeholder="Briefly explain why this ingredient should not require brand assignment."
                                    value={appealMessage}
                                    onChange={(event) =>
                                      setAppealMessageByRow((current) => ({
                                        ...current,
                                        [index]: event.target.value,
                                      }))
                                    }
                                  />
                                  <div className="restaurant-legacy-editor-dish-appeal-photo-row">
                                    <label className="btn btnSmall" htmlFor={`appeal-photo-${index}`}>
                                      {appealPhotoDataUrl ? "Replace photo" : "Take/upload photo"}
                                    </label>
                                    <input
                                      id={`appeal-photo-${index}`}
                                      type="file"
                                      accept="image/*"
                                      capture="environment"
                                      className="restaurant-legacy-editor-dish-appeal-photo-input"
                                      onChange={(event) =>
                                        handleAppealPhotoChange(index, event.target.files?.[0] || null)
                                      }
                                    />
                                    {appealPhotoDataUrl ? (
                                      <button
                                        type="button"
                                        className="btn btnSmall"
                                        disabled={appealBusy}
                                        onClick={() => clearAppealPhoto(index)}
                                      >
                                        Remove photo
                                      </button>
                                    ) : null}
                                  </div>
                                  {appealPhotoDataUrl ? (
                                    <div className="restaurant-legacy-editor-dish-appeal-photo-preview-wrap">
                                      <img
                                        src={appealPhotoDataUrl}
                                        alt="Appeal evidence"
                                        className="restaurant-legacy-editor-dish-appeal-photo-preview"
                                      />
                                      <span className="restaurant-legacy-editor-dish-appeal-photo-name">
                                        {appealPhotoFileName || "Selected photo"}
                                      </span>
                                    </div>
                                  ) : null}
                                  {appealPhotoError ? (
                                    <span className="restaurant-legacy-editor-dish-appeal-feedback is-error">
                                      {appealPhotoError}
                                    </span>
                                  ) : null}
                                  <div className="restaurant-legacy-editor-dish-appeal-actions">
                                    <button
                                      type="button"
                                      className="btn btnSmall btnDanger"
                                      disabled={!canSubmitAppeal}
                                      onClick={() => submitIngredientAppeal(index)}
                                    >
                                      {appealBusy ? "Submitting..." : "Send appeal"}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btnSmall"
                                      disabled={appealBusy}
                                      onClick={() =>
                                        setAppealOpenByRow((current) => ({
                                          ...current,
                                          [index]: false,
                                        }))
                                      }
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                              {appealFeedback?.message ? (
                                <span
                                  className={`restaurant-legacy-editor-dish-appeal-feedback ${appealFeedback.tone === "success" ? "is-success" : "is-error"}`}
                                >
                                  {appealFeedback.message}
                                </span>
                              ) : null}
                            </>
                          )}
                        </div>

                        <label className="restaurant-legacy-editor-dish-inline-check">
                          <input
                            type="checkbox"
                            checked={Boolean(ingredient.removable)}
                            onChange={(event) =>
                              toggleIngredientRemovable(index, event.target.checked)
                            }
                          />
                          Can be removed/replaced
                        </label>
                      </div>

                      <div className="restaurant-legacy-editor-dish-ingredient-flags">
                        <div className="restaurant-legacy-editor-dish-detection-note">
                          <div className="restaurant-legacy-editor-dish-detection-key-row">
                            <span className="restaurant-legacy-editor-dish-key-box restaurant-legacy-editor-dish-key-box-solid" />
                            <span>Contains</span>
                            <span className="restaurant-legacy-editor-dish-key-box restaurant-legacy-editor-dish-key-box-dashed" />
                            <span>Cross-contamination risk</span>
                          </div>
                          <div className="restaurant-legacy-editor-dish-detection-key-row">
                            <span className="restaurant-legacy-editor-dish-key-dot restaurant-legacy-editor-dish-key-dot-smart" />
                            <span>Smart detection</span>
                            <span className="restaurant-legacy-editor-dish-key-dot restaurant-legacy-editor-dish-key-dot-manual" />
                            <span>Manual override</span>
                          </div>
                        </div>
                      </div>

                      <div className="restaurant-legacy-editor-dish-ingredient-pills">
                        <div className="restaurant-legacy-editor-dish-pill-column">
                          {allergens.map((allergen) => {
                            const selectedState = readTokenState({
                              containsValues: ingredient.allergens,
                              crossValues: ingredient.crossContaminationAllergens,
                              token: allergen,
                            });
                            const smartState = readTokenState({
                              containsValues: ingredient.aiDetectedAllergens,
                              crossValues:
                                ingredient.aiDetectedCrossContaminationAllergens,
                              token: allergen,
                            });
                            const toneClass = getChipToneClass({
                              selectedState,
                              smartState,
                            });
                            const borderClass = getChipBorderClass(selectedState);
                            return (
                              <button
                                key={`${index}-allergen-${allergen}`}
                                type="button"
                                className={`restaurant-legacy-editor-dish-chip ${toneClass} ${borderClass}`}
                                onClick={() => cycleIngredientTokenState(index, "allergen", allergen)}
                              >
                                {editor.config.formatAllergenLabel(allergen)}
                              </button>
                            );
                          })}
                        </div>
                        <div className="restaurant-legacy-editor-dish-pill-column">
                          {diets.map((diet) => {
                            const selectedState = readTokenState({
                              containsValues: ingredient.diets,
                              crossValues: ingredient.crossContaminationDiets,
                              token: diet,
                            });
                            const smartState = readTokenState({
                              containsValues: ingredient.aiDetectedDiets,
                              crossValues: ingredient.aiDetectedCrossContaminationDiets,
                              token: diet,
                            });
                            const toneClass = getChipToneClass({
                              selectedState,
                              smartState,
                            });
                            const borderClass = getChipBorderClass(selectedState);
                            return (
                              <button
                                key={`${index}-diet-${diet}`}
                                type="button"
                                className={`restaurant-legacy-editor-dish-chip ${toneClass} ${borderClass}`}
                                onClick={() => cycleIngredientTokenState(index, "diet", diet)}
                              >
                                {editor.config.formatDietLabel(diet)}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="restaurant-legacy-editor-dish-ingredient-status-col">
                        <ConfirmToggleButton
                          confirmed={ingredient.confirmed === true}
                          pendingLabel="Mark confirmed"
                          confirmedLabel="Confirmed"
                          disabled={requiresBrandBeforeConfirm}
                          onClick={() => toggleIngredientConfirmed(index)}
                        />
                      </div>
                    </div>

                    <div className="restaurant-legacy-editor-dish-ingredient-footer">
                      <div className="restaurant-legacy-editor-dish-ingredient-meta">
                        {manualOverrideText ? (
                          <span className="restaurant-legacy-editor-dish-manual-warning">
                            {manualOverrideText}
                          </span>
                        ) : null}
                        {conflictWarningText ? (
                          <span className="restaurant-legacy-editor-dish-conflict-warning">
                            {conflictWarningText}
                          </span>
                        ) : null}
                        {ingredient.brandRequired && !hasAssignedBrand ? (
                          <span className="restaurant-legacy-editor-dish-brand-warning">
                            Assign a brand item before marking this ingredient confirmed.
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="btn btnDanger btnSmall"
                        onClick={() => removeIngredientRow(index)}
                      >
                        Delete
                      </button>
                    </div>
                    </div>
                    );
                  })}
                </div>
              ) : (
                <p className="note m-0 text-sm">
                  Run <strong>Process Input</strong> to infer ingredient allergens and diets.
                </p>
              )}

              {modalError ? (
                <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
                  {modalError}
                </p>
              ) : null}

              <div className="restaurant-legacy-editor-dish-ingredient-actions">
                <button type="button" className="btn btnSmall" onClick={addIngredientRow}>
                  Add ingredient
                </button>
              </div>
            </div>
            ) : null}

            {isIngredientGenerationBusy ? (
              <div
                className="restaurant-legacy-editor-dish-generation-overlay"
                role="status"
                aria-live="polite"
              >
                <div className="restaurant-legacy-editor-dish-generation-overlay-stack">
                  <img
                    src={CLARIVORE_LOGO_SRC}
                    alt="Clarivore logo"
                    className="restaurant-legacy-editor-dish-generation-overlay-logo"
                  />
                  <span
                    className="restaurant-legacy-editor-dish-generation-overlay-spinner"
                    aria-hidden="true"
                  />
                  <span className="restaurant-legacy-editor-dish-generation-overlay-text">
                    Processing input and building ingredient rows...
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          {showPostProcessSections ? (
          <div className="restaurant-legacy-editor-dish-preview">
            <h3>Preview: What customers will see</h3>
            <div className="restaurant-legacy-editor-dish-preview-panel">
              <h4>Allergens:</h4>
              <div className="restaurant-legacy-dish-popover-section">
                {previewAllergenRows.length ? (
                  previewAllergenRows.map((row) => (
                    <div key={row.key} className={`dish-row ${row.tone}`}>
                      <div className="dish-row-title">{row.title}</div>
                      {row.reasonBullet ? (
                        <ul className="dish-row-reasons">
                          <li>{row.reasonBullet}</li>
                        </ul>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="dish-row-empty">No saved allergens.</p>
                )}
              </div>

              <h4>Diets:</h4>
              <div className="restaurant-legacy-dish-popover-section">
                {previewDietRows.length ? (
                  previewDietRows.map((row) => (
                    <div key={row.key} className={`dish-row ${row.tone}`}>
                      <div className="dish-row-title">{row.title}</div>
                      {row.reasonBullet ? (
                        <ul className="dish-row-reasons">
                          <li>{row.reasonBullet}</li>
                        </ul>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="dish-row-empty">No saved diets.</p>
                )}
              </div>
            </div>
          </div>
          ) : null}

          {showDeleteWarning ? (
            <div id="editorDeleteWarning" style={{ display: "block", background: "#1a0a0a", border: "2px solid #dc2626", borderRadius: 8, padding: 20, margin: "16px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <span style={{ fontSize: "2rem" }}>🗑️</span>
                <div>
                  <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "#dc2626", marginBottom: 4 }}>
                    Delete this dish?
                  </div>
                  <div style={{ fontSize: "0.95rem", color: "#d1d5db" }}>
                    This action cannot be undone.
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  type="button"
                  className="btn btnDanger"
                  style={{ flex: 1, padding: 12, fontSize: "1rem", background: "#dc2626", borderColor: "#b91c1c" }}
                  onClick={() => {
                    editor.removeOverlay(overlay._editorKey);
                    editor.closeDishEditor();
                  }}
                >
                  🗑 Delete
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ flex: 1, padding: 12, fontSize: "1rem", background: "rgba(76,90,212,0.2)", borderColor: "rgba(76,90,212,0.4)" }}
                  onClick={() => setShowDeleteWarning(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

        </div>
      )}
    </Modal>
  );
}

export { DishEditorModal };
