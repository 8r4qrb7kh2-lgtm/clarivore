"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button, Input, Modal, Textarea } from "../../../components/ui";
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
  buildMinimapViewport,
  computeMinimapJumpTarget,
  resolveMostVisiblePageIndex,
} from "../shared/minimapGeometry";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function asText(value) {
  return String(value || "").trim();
}

function normalizeToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseOverlayNumber(value) {
  const parsed =
    typeof value === "string" ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  let next = parsed;
  if (Math.abs(next) > 0 && Math.abs(next) <= 1.2) {
    next *= 100;
  } else if (Math.abs(next) > 150 && Math.abs(next) <= 1200) {
    next /= 10;
  }
  return clamp(next, 0, 100);
}

async function fileToDataUrl(file) {
  if (!file) return "";
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function normalizePageIndexList(values, pageCount = Number.POSITIVE_INFINITY) {
  const maxPage = Number.isFinite(Number(pageCount))
    ? Math.max(Number(pageCount) - 1, 0)
    : Number.POSITIVE_INFINITY;
  const seen = new Set();
  const output = [];

  (Array.isArray(values) ? values : []).forEach((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const safe = Math.max(0, Math.floor(numeric));
    if (safe > maxPage) return;
    if (seen.has(safe)) return;
    seen.add(safe);
    output.push(safe);
  });

  return output;
}

function remapPageIndexListForMove(values, fromIndex, toIndex, pageCount) {
  const safeCount = Math.max(Number(pageCount) || 0, 1);
  const safeFrom = clamp(Number(fromIndex) || 0, 0, safeCount - 1);
  const safeTo = clamp(Number(toIndex) || 0, 0, safeCount - 1);
  if (safeFrom === safeTo) {
    return normalizePageIndexList(values, safeCount);
  }

  const remapIndex = (index) => {
    if (index === safeFrom) return safeTo;
    if (safeFrom < safeTo && index > safeFrom && index <= safeTo) return index - 1;
    if (safeFrom > safeTo && index >= safeTo && index < safeFrom) return index + 1;
    return index;
  };

  return normalizePageIndexList(
    (Array.isArray(values) ? values : []).map((value) => remapIndex(Number(value) || 0)),
    safeCount,
  );
}

function remapPageIndexListForRemove(values, removedIndex, pageCountBefore) {
  const safeBefore = Math.max(Number(pageCountBefore) || 0, 1);
  const safeRemoved = clamp(Number(removedIndex) || 0, 0, safeBefore - 1);
  const safeAfter = Math.max(safeBefore - 1, 1);

  const remapped = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .filter((value) => value !== safeRemoved)
    .map((value) => (value > safeRemoved ? value - 1 : value));

  return normalizePageIndexList(remapped, safeAfter);
}

function parseChangePayload(log) {
  if (!log?.changes) return null;
  if (typeof log.changes === "object") return log.changes;
  if (typeof log.changes !== "string") return null;
  try {
    return JSON.parse(log.changes);
  } catch {
    return null;
  }
}

function hasChangeSnapshot(log) {
  const parsed = parseChangePayload(log);
  return Boolean(
    parsed?.snapshot ||
      parsed?.__editorSnapshot ||
      (parsed?.meta && parsed.meta.snapshot),
  );
}

function formatLogTimestamp(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildAllergenDisplay(editor, overlay) {
  const configured = Array.isArray(editor.config?.allergens)
    ? editor.config.allergens
    : [];
  const fallback = Array.isArray(overlay?.allergens) ? overlay.allergens : [];
  const union = [...configured, ...fallback];
  const seen = new Set();
  return union.filter((item) => {
    const key = asText(item);
    if (!key) return false;
    const token = normalizeToken(key);
    if (!token || seen.has(token)) return false;
    seen.add(token);
    return true;
  });
}

function buildDietDisplay(editor, overlay) {
  const configured = Array.isArray(editor.config?.diets) ? editor.config.diets : [];
  const fallback = Array.isArray(overlay?.diets) ? overlay.diets : [];
  const union = [...configured, ...fallback];
  const seen = new Set();
  return union.filter((item) => {
    const key = asText(item);
    if (!key) return false;
    const token = normalizeToken(key);
    if (!token || seen.has(token)) return false;
    seen.add(token);
    return true;
  });
}

function dedupeTokenList(values) {
  const output = [];
  const seen = new Set();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = asText(value);
    if (!text) return;
    const token = normalizeToken(text);
    if (!token || seen.has(token)) return;
    seen.add(token);
    output.push(text);
  });
  return output;
}

function includesToken(values, target) {
  const token = normalizeToken(target);
  if (!token) return false;
  return (Array.isArray(values) ? values : []).some(
    (value) => normalizeToken(value) === token,
  );
}

function readTokenState({
  containsValues,
  crossValues,
  token,
}) {
  if (includesToken(containsValues, token)) return "contains";
  if (includesToken(crossValues, token)) return "cross";
  return "none";
}

function nextTokenState(current) {
  if (current === "none") return "contains";
  if (current === "contains") return "cross";
  return "none";
}

function getChipToneClass({ selectedState, smartState }) {
  if (selectedState === "none" && smartState === "none") return "chip-none";
  if (selectedState !== "none" && selectedState === smartState) return "chip-smart";
  return "chip-manual";
}

function getChipBorderClass(selectedState) {
  if (selectedState === "contains") return "chip-contains";
  if (selectedState === "cross") return "chip-cross";
  return "";
}

function formatTokenStateLabel(state) {
  if (state === "contains") return "contains";
  if (state === "cross") return "cross-contamination";
  return "none";
}

function normalizeBrandForSignature(brand) {
  const normalized = normalizeBrandEntry(brand);
  if (!normalized) return null;
  return {
    name: normalized.name,
    allergens: dedupeTokenList(normalized.allergens),
    diets: dedupeTokenList(normalized.diets),
    crossContaminationAllergens: dedupeTokenList(
      normalized.crossContaminationAllergens,
    ),
    crossContaminationDiets: dedupeTokenList(normalized.crossContaminationDiets),
    ingredientsList: Array.isArray(normalized.ingredientsList)
      ? normalized.ingredientsList.map((line) => asText(line)).filter(Boolean)
      : [],
  };
}

function buildPersistedIngredientSignature(ingredient) {
  const base = ingredient && typeof ingredient === "object" ? ingredient : {};
  return JSON.stringify({
    name: asText(base.name),
    allergens: dedupeTokenList(base.allergens),
    diets: dedupeTokenList(base.diets),
    crossContaminationAllergens: dedupeTokenList(base.crossContaminationAllergens),
    crossContaminationDiets: dedupeTokenList(base.crossContaminationDiets),
    brands: (Array.isArray(base.brands) ? base.brands : [])
      .map((brand) => normalizeBrandForSignature(brand))
      .filter(Boolean),
    brandRequired: Boolean(base.brandRequired),
    brandRequirementReason: asText(base.brandRequirementReason),
    removable: Boolean(base.removable),
  });
}

function buildRowManualOverrideMessages({
  ingredient,
  allergens,
  diets,
  formatAllergenLabel,
  formatDietLabel,
}) {
  const allergenTokens = dedupeTokenList([
    ...(Array.isArray(allergens) ? allergens : []),
    ...(Array.isArray(ingredient?.allergens) ? ingredient.allergens : []),
    ...(Array.isArray(ingredient?.crossContaminationAllergens)
      ? ingredient.crossContaminationAllergens
      : []),
    ...(Array.isArray(ingredient?.aiDetectedAllergens)
      ? ingredient.aiDetectedAllergens
      : []),
    ...(Array.isArray(ingredient?.aiDetectedCrossContaminationAllergens)
      ? ingredient.aiDetectedCrossContaminationAllergens
      : []),
  ]);
  const dietTokens = dedupeTokenList([
    ...(Array.isArray(diets) ? diets : []),
    ...(Array.isArray(ingredient?.diets) ? ingredient.diets : []),
    ...(Array.isArray(ingredient?.crossContaminationDiets)
      ? ingredient.crossContaminationDiets
      : []),
    ...(Array.isArray(ingredient?.aiDetectedDiets) ? ingredient.aiDetectedDiets : []),
    ...(Array.isArray(ingredient?.aiDetectedCrossContaminationDiets)
      ? ingredient.aiDetectedCrossContaminationDiets
      : []),
  ]);

  const messages = [];

  allergenTokens.forEach((token) => {
    const selectedState = readTokenState({
      containsValues: ingredient?.allergens,
      crossValues: ingredient?.crossContaminationAllergens,
      token,
    });
    const smartState = readTokenState({
      containsValues: ingredient?.aiDetectedAllergens,
      crossValues: ingredient?.aiDetectedCrossContaminationAllergens,
      token,
    });
    if (selectedState === smartState) return;
    messages.push(
      `Manual override: ${formatAllergenLabel(token)} is currently ${formatTokenStateLabel(selectedState)} (smart: ${formatTokenStateLabel(smartState)})`,
    );
  });

  dietTokens.forEach((token) => {
    const selectedState = readTokenState({
      containsValues: ingredient?.diets,
      crossValues: ingredient?.crossContaminationDiets,
      token,
    });
    const smartState = readTokenState({
      containsValues: ingredient?.aiDetectedDiets,
      crossValues: ingredient?.aiDetectedCrossContaminationDiets,
      token,
    });
    if (selectedState === smartState) return;
    messages.push(
      `Manual override: ${formatDietLabel(token)} is currently ${formatTokenStateLabel(selectedState)} (smart: ${formatTokenStateLabel(smartState)})`,
    );
  });

  return dedupeTokenList(messages);
}

function buildRowConflictMessages({
  ingredient,
  allergens,
  diets,
  getDietAllergenConflicts,
  formatAllergenLabel,
  formatDietLabel,
}) {
  if (typeof getDietAllergenConflicts !== "function") return [];

  const selectedAllergenEntries = dedupeTokenList([
    ...(Array.isArray(allergens) ? allergens : []),
    ...(Array.isArray(ingredient?.allergens) ? ingredient.allergens : []),
    ...(Array.isArray(ingredient?.crossContaminationAllergens)
      ? ingredient.crossContaminationAllergens
      : []),
  ])
    .map((token) => {
      const state = readTokenState({
        containsValues: ingredient?.allergens,
        crossValues: ingredient?.crossContaminationAllergens,
        token,
      });
      return {
        token,
        state,
      };
    })
    .filter((entry) => entry.state !== "none");

  const selectedDietEntries = dedupeTokenList([
    ...(Array.isArray(diets) ? diets : []),
    ...(Array.isArray(ingredient?.diets) ? ingredient.diets : []),
    ...(Array.isArray(ingredient?.crossContaminationDiets)
      ? ingredient.crossContaminationDiets
      : []),
  ])
    .map((token) => {
      const state = readTokenState({
        containsValues: ingredient?.diets,
        crossValues: ingredient?.crossContaminationDiets,
        token,
      });
      return {
        token,
        state,
      };
    })
    .filter((entry) => entry.state !== "none");

  const resolveSelectedAllergenState = (target) => {
    const targetToken = normalizeToken(target);
    if (!targetToken) return "none";
    for (const entry of selectedAllergenEntries) {
      if (normalizeToken(entry.token) === targetToken) {
        return entry.state;
      }
    }
    return "none";
  };

  const messages = [];
  selectedDietEntries.forEach(({ token: diet, state: dietState }) => {
    const conflicts = dedupeTokenList(getDietAllergenConflicts(diet));
    conflicts.forEach((allergen) => {
      const allergenState = resolveSelectedAllergenState(allergen);
      if (allergenState === "none") return;

      const formattedDiet = formatDietLabel(diet);
      const formattedAllergen = formatAllergenLabel(allergen);
      if (dietState === "contains" && allergenState === "contains") {
        messages.push(
          `Conflict warning: ${formattedDiet} conflicts with ${formattedAllergen} because both are marked as contains.`,
        );
        return;
      }

      messages.push(
        `Cross-contamination warning: ${formattedDiet} may be compromised by ${formattedAllergen} (${formatTokenStateLabel(dietState)} diet selection and ${formatTokenStateLabel(allergenState)} allergen risk).`,
      );
    });
  });

  return dedupeTokenList(messages);
}

function normalizePreviewOptions(values, { formatLabel, getEmoji }) {
  return dedupeTokenList(values).map((value) => ({
    key: value,
    label: formatLabel(value),
    emoji: getEmoji(value),
  }));
}

function normalizeBrandEntry(brand) {
  const base = brand && typeof brand === "object" ? brand : {};
  const name = asText(base.name || base.productName);
  if (!name) return null;
  return {
    ...base,
    name,
    allergens: dedupeTokenList(base.allergens),
    diets: dedupeTokenList(base.diets),
    crossContaminationAllergens: dedupeTokenList(base.crossContaminationAllergens),
    crossContaminationDiets: dedupeTokenList(base.crossContaminationDiets),
    ingredientsList: Array.isArray(base.ingredientsList)
      ? base.ingredientsList.map((line) => asText(line)).filter(Boolean)
      : [],
  };
}

function normalizeIngredientEntry(ingredient, index) {
  const base = ingredient && typeof ingredient === "object" ? ingredient : {};
  return {
    ...base,
    name: asText(base.name) || `Ingredient ${index + 1}`,
    allergens: dedupeTokenList(base.allergens),
    diets: dedupeTokenList(base.diets),
    crossContaminationAllergens: dedupeTokenList(base.crossContaminationAllergens),
    crossContaminationDiets: dedupeTokenList(base.crossContaminationDiets),
    aiDetectedAllergens: dedupeTokenList(base.aiDetectedAllergens),
    aiDetectedDiets: dedupeTokenList(base.aiDetectedDiets),
    aiDetectedCrossContaminationAllergens: dedupeTokenList(
      base.aiDetectedCrossContaminationAllergens,
    ),
    aiDetectedCrossContaminationDiets: dedupeTokenList(
      base.aiDetectedCrossContaminationDiets,
    ),
    brands: (Array.isArray(base.brands) ? base.brands : [])
      .map((brand) => normalizeBrandEntry(brand))
      .filter(Boolean),
    brandRequired: Boolean(base.brandRequired),
    brandRequirementReason: asText(base.brandRequirementReason),
    removable: Boolean(base.removable),
    confirmed: base.confirmed === true,
    contains: true,
  };
}

function computeIngredientDietBlockers(ingredients, diets) {
  const rows = Array.isArray(ingredients) ? ingredients : [];
  const list = dedupeTokenList(diets);
  const output = {};

  list.forEach((diet) => {
    const blockers = rows
      .filter((ingredient) => !includesToken(ingredient?.diets, diet))
      .map((ingredient) => ({
        ingredient: asText(ingredient?.name) || "Ingredient",
        removable: Boolean(ingredient?.removable),
      }));
    if (blockers.length) output[diet] = blockers;
  });

  return output;
}

function deriveDishStateFromIngredients({
  ingredients,
  existingDetails,
  configuredDiets,
}) {
  const rows = (Array.isArray(ingredients) ? ingredients : []).map((ingredient, index) =>
    normalizeIngredientEntry(ingredient, index),
  );
  const details =
    existingDetails && typeof existingDetails === "object" ? existingDetails : {};
  const nextDetails = { ...details };

  const allergenMap = new Map();
  const crossAllergenSet = new Set();
  const crossDietSet = new Set();
  const contributingRows = rows;

  rows.forEach((ingredient) => {
    const ingredientName = asText(ingredient?.name) || "Ingredient";
    dedupeTokenList(ingredient?.allergens).forEach((allergen) => {
      const token = normalizeToken(allergen);
      if (!token) return;
      const current = allergenMap.get(token) || {
        label: allergen,
        items: [],
        removableFlags: [],
      };
      current.items.push(ingredientName);
      current.removableFlags.push(Boolean(ingredient?.removable));
      allergenMap.set(token, current);
    });
    dedupeTokenList(ingredient?.crossContaminationAllergens).forEach((allergen) => {
      crossAllergenSet.add(allergen);
    });
    dedupeTokenList(ingredient?.crossContaminationDiets).forEach((diet) => {
      crossDietSet.add(diet);
    });
  });

  const allergens = Array.from(allergenMap.values()).map((entry) => entry.label);
  const removable = [];
  allergenMap.forEach((entry) => {
    const uniqueItems = dedupeTokenList(entry.items);
    nextDetails[entry.label] = `Contains ${uniqueItems.join(", ")}`;
    const allContributingRowsRemovable =
      entry.removableFlags.length > 0 && entry.removableFlags.every(Boolean);
    if (allContributingRowsRemovable) {
      removable.push({
        allergen: entry.label,
        component: uniqueItems.join(", "),
      });
    }
  });

  const candidateDiets = dedupeTokenList([
    ...(Array.isArray(configuredDiets) ? configuredDiets : []),
    ...contributingRows.flatMap((ingredient) => ingredient?.diets || []),
  ]);

  const diets = contributingRows.length
    ? candidateDiets.filter((diet) =>
        contributingRows.every(
          (ingredient) => includesToken(ingredient?.diets, diet),
        ),
      )
    : [];

  return {
    ingredients: rows,
    allergens,
    diets,
    details: nextDetails,
    removable,
    crossContaminationAllergens: Array.from(crossAllergenSet),
    crossContaminationDiets: Array.from(crossDietSet),
    ingredientsBlockingDiets: computeIngredientDietBlockers(
      contributingRows,
      candidateDiets,
    ),
  };
}

function DishEditorModal({ editor, runtimeConfigHealth }) {
  const overlay = editor.selectedOverlay;
  const [showDeleteWarning, setShowDeleteWarning] = useState(false);
  const [applyBusyByRow, setApplyBusyByRow] = useState({});
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
  const [modalError, setModalError] = useState("");
  const recipeTextareaRef = useRef(null);
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
      setShowDeleteWarning(false);
      setApplyBusyByRow({});
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
      setModalError("");
    }
  }, [editor.dishEditorOpen]);

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
      const current = ingredients;
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
        existingDetails: overlay?.details,
        configuredDiets: editor.config?.diets,
      });
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
    [editor, ingredients, overlay?.details],
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
        changeText: `${overlay?.id || "Dish"}: Added ingredient`,
        recordHistory: true,
      },
    );
  }, [applyIngredientChanges, overlay?.id]);

  const removeIngredientRow = useCallback(
    (ingredientIndex) => {
      const removedName = asText(ingredients[ingredientIndex]?.name) || "Ingredient";
      applyIngredientChanges(
        (current) => current.filter((_, index) => index !== ingredientIndex),
        {
          changeText: `${overlay?.id || "Dish"}: Removed ingredient ${removedName}`,
          recordHistory: true,
        },
      );
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
    },
    [
      analyzeIngredientForSmartDetection,
      applyIngredientDetectionResult,
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
              const existing = (Array.isArray(item.brands) ? item.brands : [])
                .map((brand) => normalizeBrandEntry(brand))
                .filter(Boolean)
                .filter((brand) => normalizeToken(brand.name) !== normalizeToken(brandItem.name));
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
                brands: [brandItem, ...existing],
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

  const handleSaveToDish = useCallback(() => {
    const confirmationIssues = editor.getIngredientConfirmationIssues(overlay);
    if (confirmationIssues.length) {
      setModalError(
        confirmationIssues[0]?.message ||
          "Every ingredient row must be confirmed before saving this dish.",
      );
      return;
    }
    setModalError("");
    editor.pushHistory();
    editor.closeDishEditor();
  }, [editor, overlay]);

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
                onClick={() => {
                  editor.pushHistory();
                  editor.closeDishEditor();
                }}
              >
                ×
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
                onClick={() =>
                  editor.setAiAssistDraft((current) => ({
                    ...current,
                    text:
                      current.text ||
                      `Ingredients for ${overlay.id || overlay.name || "this dish"}: `,
                  }))
                }
              >
                🎙 Dictate
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

            <div className="restaurant-legacy-editor-dish-ingredients">
              <h3>Ingredients</h3>
              {ingredients.length ? (
                <div className="restaurant-legacy-editor-dish-ingredient-list">
                  {ingredients.map((ingredient, index) => {
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
                      key={`${ingredient?.name || "ingredient"}-${index}`}
                      className="restaurant-legacy-editor-dish-ingredient-card"
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
                            <button
                              type="button"
                              className="btn btnSmall"
                              disabled={Boolean(applyBusyByRow[index])}
                              onClick={() => applyIngredientSmartDetection(index)}
                            >
                              {applyBusyByRow[index] ? "Applying..." : "Apply"}
                            </button>
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
                <button
                  type="button"
                  className="btn btnPrimary btnSmall"
                  onClick={handleSaveToDish}
                >
                  ✓ Save to Dish
                </button>
              </div>
            </div>

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

function ChangeLogModal({ editor }) {
  return (
    <Modal
      open={editor.changeLogOpen}
      onOpenChange={(open) => editor.setChangeLogOpen(open)}
      title="Change Log"
      className="max-w-[860px]"
    >
      {editor.loadingChangeLogs ? (
        <p className="note">Loading change log...</p>
      ) : editor.changeLogError ? (
        <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
          {editor.changeLogError}
        </p>
      ) : !editor.changeLogs.length ? (
        <p className="note">No changes recorded yet.</p>
      ) : (
        <div className="space-y-3 max-h-[65vh] overflow-auto pr-1">
          {editor.changeLogs.map((log) => {
            const parsed = parseChangePayload(log);
            const items = parsed?.items && typeof parsed.items === "object" ? parsed.items : {};
            const general = Array.isArray(parsed?.general) ? parsed.general : [];

            return (
              <div key={log.id || `${log.timestamp}-${log.type}`} className="rounded-xl border border-[#2a3261] bg-[rgba(17,22,48,0.75)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[#e9eefc]">
                    {parsed?.author || log.description || "Manager"}
                  </span>
                  <span className="text-xs text-[#a7b2d1]">{formatLogTimestamp(log.timestamp)}</span>
                </div>

                {general.length ? (
                  <ul className="mt-2 mb-0 list-disc pl-5 text-sm text-[#cfd8f7]">
                    {general.map((line, index) => (
                      <li key={`${log.id}-general-${index}`}>{line}</li>
                    ))}
                  </ul>
                ) : null}

                {Object.entries(items).map(([dishName, changes]) => (
                  <div key={`${log.id}-${dishName}`} className="mt-2">
                    <div className="text-sm font-medium text-[#dbe3ff]">{dishName}</div>
                    <ul className="mb-0 mt-1 list-disc pl-5 text-sm text-[#c7d2f4]">
                      {(Array.isArray(changes) ? changes : []).map((line, idx) => (
                        <li key={`${log.id}-${dishName}-${idx}`}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ))}

                {Array.isArray(log.photos) && log.photos.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {log.photos.map((photo, index) => (
                      <a
                        key={`${log.id}-photo-${index}`}
                        href={photo}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img
                          src={photo}
                          alt={`Change log photo ${index + 1}`}
                          className="h-[64px] w-[96px] rounded border border-[#2a3261] object-cover"
                        />
                      </a>
                    ))}
                  </div>
                ) : null}

                {hasChangeSnapshot(log) ? (
                  <div className="mt-2 flex justify-end">
                    <Button
                      size="compact"
                      tone="primary"
                      onClick={() => editor.restoreFromChangeLog(log)}
                    >
                      Restore this version
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

function ConfirmInfoModal({ editor }) {
  const [photos, setPhotos] = useState([]);
  const [step, setStep] = useState("capture");

  useEffect(() => {
    if (!editor.confirmInfoOpen) {
      setPhotos([]);
      setStep("capture");
    }
  }, [editor.confirmInfoOpen]);

  const addFiles = async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    const values = [];
    for (const file of list) {
      // eslint-disable-next-line no-await-in-loop
      const url = await fileToDataUrl(file);
      if (url) values.push(url);
    }
    if (values.length) {
      setPhotos((current) => [...current, ...values]);
    }
  };

  return (
    <Modal
      open={editor.confirmInfoOpen}
      onOpenChange={(open) => editor.setConfirmInfoOpen(open)}
      title="Confirm Allergen Information"
      className="max-w-[820px]"
    >
      <div className="space-y-3">
        <p className="note m-0 text-sm">
          Take photos of your current menu to confirm that it aligns with the menu on Clarivore.
        </p>

        <div className="flex items-center gap-2">
          <label className="btn" htmlFor="confirm-photos-input">
            Upload photos
          </label>
          <input
            id="confirm-photos-input"
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            className="hidden"
            onChange={async (event) => {
              await addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <span className="text-xs text-[#a7b2d1]">{photos.length} photo(s)</span>
        </div>

        {photos.length ? (
          <div className="flex flex-wrap gap-2">
            {photos.map((photo, index) => (
              <div key={`confirm-photo-${index}`} className="relative">
                <img
                  src={photo}
                  alt={`Menu confirmation ${index + 1}`}
                  className="h-[72px] w-[110px] rounded border border-[#2a3261] object-cover"
                />
                <button
                  type="button"
                  className="btn btnDanger"
                  style={{
                    position: "absolute",
                    top: -8,
                    right: -8,
                    width: 22,
                    height: 22,
                    minWidth: 22,
                    padding: 0,
                    borderRadius: "50%",
                  }}
                  onClick={() =>
                    setPhotos((current) => current.filter((_, i) => i !== index))
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {step === "capture" ? (
          <div className="rounded-lg border border-[#2a3261] bg-[rgba(6,10,28,0.55)] p-3 text-sm text-[#ced8f8]">
            Are all dishes clearly visible in these photos?
            <div className="mt-2 flex gap-2">
              <Button size="compact" tone="success" onClick={() => setStep("current")}>✓ Yes</Button>
              <Button
                size="compact"
                tone="danger"
                onClick={() => {
                  setPhotos([]);
                  setStep("capture");
                }}
              >
                ✗ No
              </Button>
            </div>
          </div>
        ) : null}

        {step === "current" ? (
          <div className="rounded-lg border border-[#2a3261] bg-[rgba(6,10,28,0.55)] p-3 text-sm text-[#ced8f8]">
            Are these photos of your most current menu?
            <div className="mt-2 flex gap-2">
              <Button
                size="compact"
                tone="success"
                loading={editor.confirmBusy}
                onClick={async () => {
                  const result = await editor.confirmInfo(photos);
                  if (result?.success) {
                    editor.setConfirmInfoOpen(false);
                  }
                }}
              >
                ✓ Yes, confirm
              </Button>
              <Button
                size="compact"
                tone="danger"
                onClick={() => editor.setConfirmInfoOpen(false)}
              >
                ✗ Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {editor.confirmError ? (
          <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
            {editor.confirmError}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function MenuPagesModal({ editor }) {
  const replaceInputsRef = useRef({});
  const addInputRef = useRef(null);
  const [sessionSnapshot, setSessionSnapshot] = useState(null);
  const [imageChangedPageIndices, setImageChangedPageIndices] = useState([]);
  const [removeUnmatchedPageIndices, setRemoveUnmatchedPageIndices] = useState([]);
  const [sessionDirty, setSessionDirty] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const wasOpenRef = useRef(false);

  const markSessionDirty = useCallback(() => {
    setSessionDirty(true);
  }, []);

  const markImagePageChanged = useCallback((pageIndex) => {
    const safePage = Math.max(0, Math.floor(Number(pageIndex) || 0));
    setSessionDirty(true);
    setImageChangedPageIndices((current) =>
      current.includes(safePage) ? current : [...current, safePage],
    );
    setRemoveUnmatchedPageIndices((current) =>
      current.includes(safePage) ? current : [...current, safePage],
    );
  }, []);

  useEffect(() => {
    if (editor.menuPagesOpen && !wasOpenRef.current) {
      setSessionSnapshot(
        typeof editor.createDraftSnapshot === "function"
          ? editor.createDraftSnapshot()
          : null,
      );
      setImageChangedPageIndices([]);
      setRemoveUnmatchedPageIndices([]);
      setSessionDirty(false);
      setSaveBusy(false);
      setSaveError("");
      setSaveNotice("");
    } else if (!editor.menuPagesOpen && wasOpenRef.current) {
      setSessionSnapshot(null);
      setImageChangedPageIndices([]);
      setRemoveUnmatchedPageIndices([]);
      setSessionDirty(false);
      setSaveBusy(false);
      setSaveError("");
      setSaveNotice("");
    }

    wasOpenRef.current = editor.menuPagesOpen;
  }, [editor.createDraftSnapshot, editor.menuPagesOpen]);

  const closeMenuModal = useCallback(() => {
    editor.setMenuPagesOpen(false);
  }, [editor]);

  const handleCancel = useCallback(() => {
    if (saveBusy) return;
    if (sessionSnapshot && typeof editor.restoreDraftSnapshot === "function") {
      editor.restoreDraftSnapshot(sessionSnapshot);
    }
    closeMenuModal();
  }, [closeMenuModal, editor.restoreDraftSnapshot, saveBusy, sessionSnapshot]);

  const handleSave = useCallback(async () => {
    if (saveBusy) return;
    setSaveError("");
    setSaveNotice("");

    if (!sessionDirty) {
      closeMenuModal();
      return;
    }

    const pageCount = Math.max(editor.draftMenuImages.length, 1);
    const pagesToAnalyze = normalizePageIndexList(imageChangedPageIndices, pageCount);
    const pagesToRemoveUnmatched = normalizePageIndexList(
      removeUnmatchedPageIndices,
      pageCount,
    );

    if (!pagesToAnalyze.length) {
      closeMenuModal();
      return;
    }

    setSaveBusy(true);
    try {
      const result = await editor.analyzeMenuPagesAndMergeOverlays({
        pageIndices: pagesToAnalyze,
        removeUnmatchedPageIndices: pagesToRemoveUnmatched,
        requireDetectionsForPageIndices: pagesToAnalyze,
      });

      if (!result?.success) {
        const errorLines = Array.isArray(result?.errors) ? result.errors : [];
        const firstError = errorLines[0] || "Failed to run menu analysis.";
        const suffix =
          errorLines.length > 1 ? ` (${errorLines.length} pages failed)` : "";
        setSaveError(`${firstError}${suffix}`);
        return;
      }

      setSaveNotice(
        `Analysis complete: ${result.updatedCount || 0} updated, ${result.addedCount || 0} added, ${result.removedCount || 0} removed.`,
      );
      closeMenuModal();
    } catch (error) {
      setSaveError(error?.message || "Failed to run menu analysis.");
    } finally {
      setSaveBusy(false);
    }
  }, [
    closeMenuModal,
    editor.analyzeMenuPagesAndMergeOverlays,
    editor.draftMenuImages.length,
    imageChangedPageIndices,
    removeUnmatchedPageIndices,
    saveBusy,
    sessionDirty,
  ]);

  return (
    <Modal
      open={editor.menuPagesOpen}
      onOpenChange={(open) => {
        if (open) {
          editor.setMenuPagesOpen(true);
          return;
        }
        handleCancel();
      }}
      title="Edit menu images"
      className="max-w-[980px]"
      closeOnOverlay={false}
      closeOnEsc={false}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            size="compact"
            variant="outline"
            disabled={saveBusy}
            onClick={handleCancel}
          >
            Cancel
          </Button>
          <Button
            size="compact"
            tone="primary"
            loading={saveBusy}
            onClick={handleSave}
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button
            size="compact"
            tone="primary"
            disabled={saveBusy}
            onClick={() => addInputRef.current?.click()}
          >
            Add Page
          </Button>
          <input
            ref={addInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const image = await fileToDataUrl(file);
              editor.addMenuPage(image);
              markImagePageChanged(editor.draftMenuImages.length);
              event.target.value = "";
            }}
          />
        </div>

        {saveNotice ? (
          <p className="m-0 rounded-lg border border-[#2a3261] bg-[rgba(12,18,44,0.62)] px-3 py-2 text-sm text-[#ced8f8]">
            {saveNotice}
          </p>
        ) : null}

        {saveError ? (
          <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
            {saveError}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {editor.draftMenuImages.map((image, index) => (
            <div
              key={`menu-page-${index}`}
              className="rounded-xl border border-[#2a3261] bg-[rgba(17,22,48,0.8)] p-2"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-[#c4cfec]">Page {index + 1}</span>
                <div className="flex gap-1">
                  <Button
                    size="compact"
                    variant="outline"
                    disabled={saveBusy || index <= 0}
                    className="min-w-[30px] px-2"
                    onClick={() => {
                      const pageCount = Math.max(editor.draftMenuImages.length, 1);
                      editor.moveMenuPage(index, index - 1);
                      setImageChangedPageIndices((current) =>
                        remapPageIndexListForMove(current, index, index - 1, pageCount),
                      );
                      setRemoveUnmatchedPageIndices((current) =>
                        remapPageIndexListForMove(current, index, index - 1, pageCount),
                      );
                      markSessionDirty();
                    }}
                    title="Move page up"
                    aria-label={`Move page ${index + 1} up`}
                  >
                    ↑
                  </Button>
                  <Button
                    size="compact"
                    variant="outline"
                    disabled={saveBusy || index >= editor.draftMenuImages.length - 1}
                    className="min-w-[30px] px-2"
                    onClick={() => {
                      const pageCount = Math.max(editor.draftMenuImages.length, 1);
                      editor.moveMenuPage(index, index + 1);
                      setImageChangedPageIndices((current) =>
                        remapPageIndexListForMove(current, index, index + 1, pageCount),
                      );
                      setRemoveUnmatchedPageIndices((current) =>
                        remapPageIndexListForMove(current, index, index + 1, pageCount),
                      );
                      markSessionDirty();
                    }}
                    title="Move page down"
                    aria-label={`Move page ${index + 1} down`}
                  >
                    ↓
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-[#2a3261] bg-[#070b16] p-1">
                {image ? (
                  <img
                    src={image}
                    alt={`Menu page ${index + 1}`}
                    className="h-[180px] w-full rounded object-contain"
                  />
                ) : (
                  <div className="flex h-[180px] items-center justify-center text-xs text-[#9ea9c8]">
                    No image
                  </div>
                )}
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="compact"
                  variant="outline"
                  disabled={saveBusy}
                  onClick={() => replaceInputsRef.current[index]?.click()}
                >
                  Replace
                </Button>
                {editor.draftMenuImages.length > 1 ? (
                  <Button
                    size="compact"
                    tone="danger"
                    variant="outline"
                    disabled={saveBusy}
                    onClick={() => {
                      const pageCount = Math.max(editor.draftMenuImages.length, 1);
                      editor.removeMenuPage(index);
                      setImageChangedPageIndices((current) =>
                        remapPageIndexListForRemove(current, index, pageCount),
                      );
                      setRemoveUnmatchedPageIndices((current) =>
                        remapPageIndexListForRemove(current, index, pageCount),
                      );
                      markSessionDirty();
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>

              <input
                ref={(node) => {
                  replaceInputsRef.current[index] = node;
                }}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const imageData = await fileToDataUrl(file);
                  editor.replaceMenuPage(index, imageData);
                  markImagePageChanged(index);
                  event.target.value = "";
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function RestaurantSettingsModal({ editor }) {
  return (
    <Modal
      open={editor.restaurantSettingsOpen}
      onOpenChange={(open) => editor.setRestaurantSettingsOpen(open)}
      title="Restaurant settings"
      className="max-w-[720px]"
    >
      <div className="space-y-3">
        <label className="space-y-1 text-sm text-[#bdd0ff] block">
          Website
          <Input
            value={editor.restaurantSettingsDraft.website || ""}
            onChange={(event) =>
              editor.setRestaurantSettingsDraft((current) => ({
                ...current,
                website: event.target.value,
              }))
            }
          />
        </label>

        <label className="space-y-1 text-sm text-[#bdd0ff] block">
          Phone
          <Input
            value={editor.restaurantSettingsDraft.phone || ""}
            onChange={(event) =>
              editor.setRestaurantSettingsDraft((current) => ({
                ...current,
                phone: event.target.value,
              }))
            }
          />
        </label>

        <label className="space-y-1 text-sm text-[#bdd0ff] block">
          Delivery URL
          <Input
            value={editor.restaurantSettingsDraft.delivery_url || ""}
            onChange={(event) =>
              editor.setRestaurantSettingsDraft((current) => ({
                ...current,
                delivery_url: event.target.value,
              }))
            }
          />
        </label>

        <label className="space-y-1 text-sm text-[#bdd0ff] block">
          Menu URL
          <Input
            value={editor.restaurantSettingsDraft.menu_url || ""}
            onChange={(event) =>
              editor.setRestaurantSettingsDraft((current) => ({
                ...current,
                menu_url: event.target.value,
              }))
            }
          />
        </label>

        {editor.settingsSaveError ? (
          <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
            {editor.settingsSaveError}
          </p>
        ) : null}

        <div className="flex gap-2 justify-end">
          <Button
            size="compact"
            variant="outline"
            onClick={() => editor.setRestaurantSettingsOpen(false)}
          >
            Cancel
          </Button>
          <Button
            size="compact"
            tone="primary"
            loading={editor.settingsSaveBusy}
            onClick={async () => {
              const result = await editor.saveRestaurantSettings();
              if (result?.success) {
                editor.setRestaurantSettingsOpen(false);
              }
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function RestaurantEditor({ editor, onNavigate, runtimeConfigHealth }) {
  const menuScrollRef = useRef(null);
  const pageRefs = useRef([]);
  const pageImageRefs = useRef([]);
  const overlayInteractionRef = useRef(null);
  const mappingDragRef = useRef(null);

  const [scrollSnapshot, setScrollSnapshot] = useState({
    scrollTop: 0,
    clientHeight: 1,
    scrollHeight: 1,
  });
  const [mappedRectPreview, setMappedRectPreview] = useState(null);

  const legacySaveButtonVisible = Boolean(
    editor.isDirty ||
      editor.isSaving ||
      editor.saveStatus === "saved" ||
      editor.saveStatus === "error",
  );
  const legacySaveButtonLabel = editor.isSaving
    ? "Saving..."
    : editor.saveStatus === "saved"
      ? "Saved"
      : editor.saveStatus === "error"
        ? "Retry save"
        : "Save to site";
  const legacySaveButtonClass =
    editor.saveStatus === "error"
      ? "btnDanger"
      : editor.saveStatus === "saved"
        ? "btnSuccess"
        : "btnPrimary";

  const detectDishes = editor.detectWizardState.dishes || [];
  const mappedCount = detectDishes.filter((dish) => dish.mapped).length;
  const allMapped = detectDishes.length > 0 && mappedCount >= detectDishes.length;
  const currentWizardDish = detectDishes[editor.detectWizardState.currentIndex] || null;
  const mappingEnabled =
    editor.detectWizardOpen &&
    !editor.detectWizardState.loading &&
    Boolean(currentWizardDish) &&
    !allMapped;

  const triggerSave = useCallback(async () => {
    if (editor.isSaving) return;
    await editor.save();
  }, [editor]);

  const refreshScrollSnapshot = useCallback(() => {
    const scrollNode = menuScrollRef.current;
    if (!scrollNode) return;

    const next = {
      scrollTop: scrollNode.scrollTop,
      clientHeight: Math.max(scrollNode.clientHeight, 1),
      scrollHeight: Math.max(scrollNode.scrollHeight, 1),
    };

    setScrollSnapshot((current) => {
      if (
        current.scrollTop === next.scrollTop &&
        current.clientHeight === next.clientHeight &&
        current.scrollHeight === next.scrollHeight
      ) {
        return current;
      }
      return next;
    });

    const pageNodes = editor.overlaysByPage.map(
      (_, index) => pageRefs.current[index] || pageImageRefs.current[index],
    );
    const bestPage = resolveMostVisiblePageIndex(scrollNode, pageNodes, editor.activePageIndex);

    if (bestPage !== editor.activePageIndex) {
      editor.jumpToPage(bestPage);
    }
  }, [editor]);

  useEffect(() => {
    const scrollNode = menuScrollRef.current;
    if (!scrollNode) return undefined;

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        refreshScrollSnapshot();
      });
    };

    schedule();
    scrollNode.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(schedule)
        : null;

    if (resizeObserver) {
      resizeObserver.observe(scrollNode);
      pageRefs.current.forEach((node) => node && resizeObserver.observe(node));
      pageImageRefs.current.forEach((node) => node && resizeObserver.observe(node));
    }

    return () => {
      scrollNode.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (resizeObserver) resizeObserver.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [refreshScrollSnapshot, editor.overlaysByPage.length]);

  useEffect(() => {
    const imageNodes = pageImageRefs.current.filter(Boolean);
    if (!imageNodes.length) return undefined;

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        refreshScrollSnapshot();
      });
    };

    imageNodes.forEach((node) => {
      node.addEventListener("load", schedule);
      if (node.complete) schedule();
    });

    return () => {
      imageNodes.forEach((node) => node.removeEventListener("load", schedule));
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [editor.overlaysByPage, refreshScrollSnapshot]);

  const minimapViewport = useMemo(() => {
    const scrollNode = menuScrollRef.current;
    const pageNode = pageRefs.current[editor.activePageIndex] || pageImageRefs.current[editor.activePageIndex];
    return buildMinimapViewport(scrollNode, pageNode);
  }, [editor.activePageIndex, scrollSnapshot.clientHeight, scrollSnapshot.scrollTop]);

  const jumpFromMinimap = useCallback(
    (event) => {
      const scrollNode = menuScrollRef.current;
      const pageNode = pageRefs.current[editor.activePageIndex] || pageImageRefs.current[editor.activePageIndex];
      if (!scrollNode || !pageNode) return;

      const bounds = event.currentTarget.getBoundingClientRect();
      if (!bounds.height) return;
      const ratio = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
      const target = computeMinimapJumpTarget(scrollNode, pageNode, ratio);

      scrollNode.scrollTo({ top: target, behavior: "smooth" });
    },
    [editor.activePageIndex],
  );

  const getOverlaySnapTargets = useCallback(
    (pageIndex, overlayKey) => {
      const page = editor.overlaysByPage[pageIndex];
      if (!page) {
        return { xEdges: [], yEdges: [] };
      }

      const xEdges = [];
      const yEdges = [];
      page.overlays.forEach((overlay) => {
        if (overlay._editorKey === overlayKey) return;
        const x = parseOverlayNumber(overlay.x);
        const y = parseOverlayNumber(overlay.y);
        const w = parseOverlayNumber(overlay.w);
        const h = parseOverlayNumber(overlay.h);
        xEdges.push(x, x + w);
        yEdges.push(y, y + h);
      });

      return { xEdges, yEdges };
    },
    [editor.overlaysByPage],
  );

  const snapValue = (value, targets, threshold) => {
    for (const target of targets) {
      if (Math.abs(value - target) < threshold) {
        return target;
      }
    }
    return value;
  };

  const stopOverlayInteraction = useCallback((changeLabel) => {
    const interaction = overlayInteractionRef.current;
    if (!interaction) return;

    window.removeEventListener("pointermove", interaction.onMove);
    window.removeEventListener("pointerup", interaction.onUp);

    if (
      interaction.captureTarget &&
      typeof interaction.captureTarget.releasePointerCapture === "function" &&
      Number.isFinite(Number(interaction.pointerId))
    ) {
      try {
        interaction.captureTarget.releasePointerCapture(interaction.pointerId);
      } catch {
        // Ignore pointer release failures.
      }
    }

    overlayInteractionRef.current = null;

    if (interaction.overlayName) {
      editor.updateOverlay(
        interaction.overlayKey,
        (overlay) => overlay,
        {
          changeText:
            changeLabel || `${interaction.overlayName}: Adjusted overlay position`,
          recordHistory: true,
        },
      );
    }
  }, [editor]);

  const startDragOverlay = useCallback(
    (event, overlay, pageIndex) => {
      if (mappingEnabled) return;
      if (!overlay?._editorKey) return;
      if (event.button !== 0) return;
      if (event.target.closest(".handle") || event.target.closest(".editBadge")) return;

      event.preventDefault();
      editor.selectOverlay(overlay._editorKey);

      const pointerId = Number.isFinite(Number(event.pointerId))
        ? Number(event.pointerId)
        : null;
      const captureTarget = event.currentTarget;
      if (
        captureTarget &&
        typeof captureTarget.setPointerCapture === "function" &&
        pointerId !== null
      ) {
        try {
          captureTarget.setPointerCapture(pointerId);
        } catch {
          // Ignore pointer capture failures.
        }
      }

      const pageNode = pageRefs.current[pageIndex];
      if (!pageNode) return;
      const pageRect = pageNode.getBoundingClientRect();

      const start = {
        x: event.clientX,
        y: event.clientY,
        left: parseOverlayNumber(overlay.x),
        top: parseOverlayNumber(overlay.y),
      };

      const onMove = (moveEvent) => {
        const dx = ((moveEvent.clientX - start.x) / Math.max(pageRect.width, 1)) * 100;
        const dy = ((moveEvent.clientY - start.y) / Math.max(pageRect.height, 1)) * 100;

        const width = parseOverlayNumber(overlay.w);
        const height = parseOverlayNumber(overlay.h);

        const nextX = clamp(start.left + dx, 0, 100 - width);
        const nextY = clamp(start.top + dy, 0, 100 - height);

        editor.updateOverlay(overlay._editorKey, {
          x: nextX,
          y: nextY,
        });
      };

      const onUp = () => {
        stopOverlayInteraction(`${overlay.id || "Dish"}: Adjusted overlay position`);
      };

      overlayInteractionRef.current = {
        overlayKey: overlay._editorKey,
        overlayName: overlay.id || "Dish",
        pointerId,
        captureTarget,
        onMove,
        onUp,
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [editor, mappingEnabled, stopOverlayInteraction],
  );

  const startResizeOverlay = useCallback(
    (event, overlay, pageIndex, corner) => {
      if (mappingEnabled) return;
      if (!overlay?._editorKey) return;
      if (event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();
      editor.selectOverlay(overlay._editorKey);

      const pointerId = Number.isFinite(Number(event.pointerId))
        ? Number(event.pointerId)
        : null;
      const captureTarget = event.currentTarget;
      if (
        captureTarget &&
        typeof captureTarget.setPointerCapture === "function" &&
        pointerId !== null
      ) {
        try {
          captureTarget.setPointerCapture(pointerId);
        } catch {
          // Ignore pointer capture failures.
        }
      }

      const pageNode = pageRefs.current[pageIndex];
      if (!pageNode) return;
      const pageRect = pageNode.getBoundingClientRect();
      const snapThreshold = 0.3;
      const snapTargets = getOverlaySnapTargets(pageIndex, overlay._editorKey);

      const start = {
        x: event.clientX,
        y: event.clientY,
        left: parseOverlayNumber(overlay.x),
        top: parseOverlayNumber(overlay.y),
        width: parseOverlayNumber(overlay.w),
        height: parseOverlayNumber(overlay.h),
      };

      const onMove = (moveEvent) => {
        const dx = ((moveEvent.clientX - start.x) / Math.max(pageRect.width, 1)) * 100;
        const dy = ((moveEvent.clientY - start.y) / Math.max(pageRect.height, 1)) * 100;

        let x = start.left;
        let y = start.top;
        let w = start.width;
        let h = start.height;

        if (corner === "se") {
          w = start.width + dx;
          h = start.height + dy;
        }
        if (corner === "ne") {
          w = start.width + dx;
          h = start.height - dy;
          y = start.top + dy;
        }
        if (corner === "sw") {
          w = start.width - dx;
          h = start.height + dy;
          x = start.left + dx;
        }
        if (corner === "nw") {
          w = start.width - dx;
          h = start.height - dy;
          x = start.left + dx;
          y = start.top + dy;
        }

        w = clamp(w, 1, 100);
        h = clamp(h, 0.5, 100);
        x = clamp(x, 0, 100 - w);
        y = clamp(y, 0, 100 - h);

        const right = x + w;
        const bottom = y + h;

        if (corner === "se") {
          const snappedRight = snapValue(right, snapTargets.xEdges, snapThreshold);
          const snappedBottom = snapValue(bottom, snapTargets.yEdges, snapThreshold);
          if (snappedRight !== right) w = clamp(snappedRight - x, 1, 100);
          if (snappedBottom !== bottom) h = clamp(snappedBottom - y, 0.5, 100);
        }

        if (corner === "ne") {
          const snappedRight = snapValue(right, snapTargets.xEdges, snapThreshold);
          const snappedTop = snapValue(y, snapTargets.yEdges, snapThreshold);
          if (snappedRight !== right) w = clamp(snappedRight - x, 1, 100);
          if (snappedTop !== y) {
            const oldBottom = y + h;
            y = snappedTop;
            h = clamp(oldBottom - y, 0.5, 100);
          }
        }

        if (corner === "sw") {
          const snappedLeft = snapValue(x, snapTargets.xEdges, snapThreshold);
          const snappedBottom = snapValue(bottom, snapTargets.yEdges, snapThreshold);
          if (snappedLeft !== x) {
            const oldRight = x + w;
            x = snappedLeft;
            w = clamp(oldRight - x, 1, 100);
          }
          if (snappedBottom !== bottom) h = clamp(snappedBottom - y, 0.5, 100);
        }

        if (corner === "nw") {
          const snappedLeft = snapValue(x, snapTargets.xEdges, snapThreshold);
          const snappedTop = snapValue(y, snapTargets.yEdges, snapThreshold);
          if (snappedLeft !== x) {
            const oldRight = x + w;
            x = snappedLeft;
            w = clamp(oldRight - x, 1, 100);
          }
          if (snappedTop !== y) {
            const oldBottom = y + h;
            y = snappedTop;
            h = clamp(oldBottom - y, 0.5, 100);
          }
        }

        w = clamp(w, 1, 100);
        h = clamp(h, 0.5, 100);
        x = clamp(x, 0, 100 - w);
        y = clamp(y, 0, 100 - h);

        editor.updateOverlay(overlay._editorKey, {
          x,
          y,
          w,
          h,
        });
      };

      const onUp = () => {
        stopOverlayInteraction(`${overlay.id || "Dish"}: Adjusted overlay position`);
      };

      overlayInteractionRef.current = {
        overlayKey: overlay._editorKey,
        overlayName: overlay.id || "Dish",
        pointerId,
        captureTarget,
        onMove,
        onUp,
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [editor, getOverlaySnapTargets, mappingEnabled, stopOverlayInteraction],
  );

  useEffect(() => {
    return () => {
      stopOverlayInteraction();
    };
  }, [stopOverlayInteraction]);

  const onPagePointerDown = useCallback(
    (event, pageIndex) => {
      if (!mappingEnabled) return;
      if (event.button !== 0) return;

      const pageNode = pageRefs.current[pageIndex];
      if (!pageNode) return;
      const rect = pageNode.getBoundingClientRect();

      const startX = clamp(((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100, 0, 100);
      const startY = clamp(((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100, 0, 100);

      mappingDragRef.current = {
        pageIndex,
        startX,
        startY,
        currentX: startX,
        currentY: startY,
      };

      setMappedRectPreview({
        pageIndex,
        x: startX,
        y: startY,
        w: 0,
        h: 0,
      });

      const onMove = (moveEvent) => {
        const moveX = clamp(
          ((moveEvent.clientX - rect.left) / Math.max(rect.width, 1)) * 100,
          0,
          100,
        );
        const moveY = clamp(
          ((moveEvent.clientY - rect.top) / Math.max(rect.height, 1)) * 100,
          0,
          100,
        );

        const drag = mappingDragRef.current;
        if (!drag) return;

        drag.currentX = moveX;
        drag.currentY = moveY;

        const x = Math.min(drag.startX, moveX);
        const y = Math.min(drag.startY, moveY);
        const w = Math.abs(moveX - drag.startX);
        const h = Math.abs(moveY - drag.startY);

        setMappedRectPreview({ pageIndex, x, y, w, h });
      };

      const onUp = () => {
        const drag = mappingDragRef.current;
        mappingDragRef.current = null;
        setMappedRectPreview(null);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);

        if (!drag) return;
        const x = Math.min(drag.startX, drag.currentX);
        const y = Math.min(drag.startY, drag.currentY);
        const w = Math.abs(drag.currentX - drag.startX);
        const h = Math.abs(drag.currentY - drag.startY);

        if (w <= 1 || h <= 1) return;
        editor.mapDetectedDish({ x, y, w, h, pageIndex: drag.pageIndex });
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [editor, mappingEnabled],
  );

  if (!editor.canEdit) {
    return (
      <section className="rounded-2xl border border-[rgba(124,156,255,0.2)] bg-[rgba(11,14,34,0.82)] p-4">
        <p className="m-0 text-sm text-[#b9c6eb]">
          You do not have edit access for this restaurant.
        </p>
      </section>
    );
  }

  return (
    <section className="restaurant-legacy-editor">
      <div className="editorLayout restaurant-legacy-editor-layout">
        <div className="editorHeaderStack restaurant-legacy-editor-header">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="m-0 text-[2.6rem] leading-none text-[#eaf0ff]">Webpage editor</h1>
          </div>

          <div className="editorHeaderRow hasMiniMap">
            <div className="editorMiniMapSlot">
              <div className="restaurant-legacy-page-card">
                <button
                  type="button"
                  className="restaurant-legacy-page-thumb"
                  onPointerDown={jumpFromMinimap}
                  onClick={jumpFromMinimap}
                  title="Jump to menu area"
                >
                  {editor.draftMenuImages[editor.activePageIndex] ? (
                    <img
                      src={editor.draftMenuImages[editor.activePageIndex]}
                      alt={`Menu thumbnail page ${editor.activePageIndex + 1}`}
                    />
                  ) : (
                    <span>No page</span>
                  )}
                  <span
                    className="restaurant-legacy-page-thumb-viewport"
                    style={{
                      top: `${minimapViewport.topRatio * 100}%`,
                      height: `${minimapViewport.heightRatio * 100}%`,
                    }}
                  />
                </button>
                <div className="restaurant-legacy-page-footer">
                  Page {editor.activePageIndex + 1} of {editor.draftMenuImages.length}
                </div>
              </div>
            </div>

            <div className="editorControlColumn">
              <div className="editorToolbarScale">
                <div className="editorToolbar">
                  <div className="editorGroup">
                    <div className="editorGroupLabel">Editing</div>
                    <div className="editorGroupButtons">
                      <button className="btn btnPrimary" onClick={editor.addOverlay}>
                        + Add overlay
                      </button>
                      <button
                        className="btn"
                        onClick={editor.undo}
                        disabled={!editor.canUndo}
                        style={{ opacity: editor.canUndo ? 1 : 0.5 }}
                      >
                        ↶ Undo
                      </button>
                      <button
                        className="btn"
                        onClick={editor.redo}
                        disabled={!editor.canRedo}
                        style={{ opacity: editor.canRedo ? 1 : 0.5 }}
                      >
                        ↷ Redo
                      </button>
                      {legacySaveButtonVisible ? (
                        <button
                          className={`btn ${legacySaveButtonClass}`}
                          onClick={triggerSave}
                          disabled={editor.isSaving}
                        >
                          {legacySaveButtonLabel}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="editorGroup">
                    <div className="editorGroupLabel">Menu pages</div>
                    <div className="editorGroupButtons">
                      <button className="btn" onClick={() => editor.setMenuPagesOpen(true)}>
                        🗂 Edit menu images
                      </button>
                      <button className="btn" onClick={() => editor.setChangeLogOpen(true)}>
                        📋 View log of changes
                      </button>
                    </div>
                  </div>

                  <div className="editorGroup">
                    <div className="editorGroupLabel">Restaurant</div>
                    <div className="editorGroupButtons">
                      <button
                        className="btn"
                        onClick={() => editor.setRestaurantSettingsOpen(true)}
                      >
                        ⚙ Restaurant settings
                      </button>
                      <button
                        className="btn btnDanger"
                        onClick={() => editor.setConfirmInfoOpen(true)}
                      >
                        Confirm information is up-to-date
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="editorNoteRow">
                <div className="note" id="editorNote">
                  Drag to move. Drag any corner to resize. Click ✏️ to edit details.
                </div>
              </div>

              {editor.saveError ? (
                <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
                  {editor.saveError}
                </p>
              ) : null}
            </div>
          </div>

          {editor.detectWizardOpen ? (
            <div id="detectedDishesPanel" style={{ display: "block", background: "#1a2351", border: "1px solid #2a3261", borderRadius: 12, padding: 20, marginBottom: 4, textAlign: "center" }}>
              <div style={{ fontSize: "1.3rem", fontWeight: 600, marginBottom: 8 }} id="currentDishName">
                {editor.detectWizardState.loading
                  ? "Detecting dishes..."
                  : allMapped
                    ? "All items mapped!"
                    : currentWizardDish?.name || "No dishes detected"}
              </div>
              <div className="note" style={{ marginBottom: 12 }}>
                {mappingEnabled
                  ? "Press and drag on the menu to create an overlay for this item"
                  : allMapped
                    ? "All detected dishes are mapped."
                    : editor.detectWizardState.error || ""}
              </div>
              <div style={{ display: "flex", gap: 12, justifyContent: "center", alignItems: "center", fontSize: 14, flexWrap: "wrap" }}>
                <button
                  className="btn"
                  id="prevDishBtn"
                  style={{ padding: "6px 12px", fontSize: 13 }}
                  disabled={editor.detectWizardState.currentIndex <= 0}
                  onClick={() => editor.setDetectWizardIndex(editor.detectWizardState.currentIndex - 1)}
                >
                  ← Previous
                </button>
                <span id="dishProgress" style={{ color: "#a8b2d6" }}>
                  {editor.detectWizardState.loading
                    ? "Analyzing..."
                    : `${mappedCount} of ${detectDishes.length} mapped`}
                </span>
                <button
                  className="btn"
                  id="nextDishBtn"
                  style={{ padding: "6px 12px", fontSize: 13 }}
                  disabled={editor.detectWizardState.currentIndex >= detectDishes.length - 1}
                  onClick={() => editor.setDetectWizardIndex(editor.detectWizardState.currentIndex + 1)}
                >
                  Next →
                </button>
                <button
                  className="btn btnSuccess"
                  id="finishMappingBtn"
                  style={{ padding: "6px 12px", fontSize: 13, display: mappedCount > 0 ? "inline-flex" : "none" }}
                  onClick={editor.closeDetectWizard}
                >
                  ✓ Finish Mapping
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div
          ref={menuScrollRef}
          className="restaurant-legacy-editor-stage restaurant-legacy-editor-scroll"
          style={{ cursor: mappingEnabled ? "crosshair" : "default" }}
        >
          <div
            className="restaurant-legacy-editor-canvas"
            style={{
              zoom: editor.zoomScale,
            }}
          >
            {editor.overlaysByPage.map((page) => (
              <div
                key={`editor-page-${page.pageIndex}`}
                ref={(node) => {
                  pageRefs.current[page.pageIndex] = node;
                }}
                className="restaurant-legacy-editor-page"
                style={{ position: "relative", width: "100%" }}
                onPointerDown={(event) => onPagePointerDown(event, page.pageIndex)}
              >
                {page.image ? (
                  <img
                    src={page.image}
                    alt={`Menu page ${page.pageIndex + 1}`}
                    className="restaurant-legacy-editor-image"
                    ref={(node) => {
                      pageImageRefs.current[page.pageIndex] = node;
                    }}
                  />
                ) : (
                  <div className="restaurant-legacy-no-image">No menu image available.</div>
                )}

                {page.overlays.map((overlay) => {
                  const isSelected = editor.selectedOverlayKey === overlay._editorKey;
                  return (
                    <div
                      key={overlay._editorKey}
                      className={`editBox ${isSelected ? "active" : ""}`}
                      style={{
                        left: `${parseOverlayNumber(overlay.x)}%`,
                        top: `${parseOverlayNumber(overlay.y)}%`,
                        width: `${parseOverlayNumber(overlay.w)}%`,
                        height: `${parseOverlayNumber(overlay.h)}%`,
                        pointerEvents: mappingEnabled ? "none" : "auto",
                      }}
                      title={overlay.id || "Dish"}
                      onPointerDown={(event) => startDragOverlay(event, overlay, page.pageIndex)}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        editor.selectOverlay(overlay._editorKey);
                      }}
                    >
                      <button
                        type="button"
                        className="editBadge"
                        title="Edit this item"
                        onClick={(event) => {
                          event.stopPropagation();
                          editor.openDishEditor(overlay._editorKey);
                        }}
                      >
                        ✏️
                      </button>

                      {(["nw", "ne", "sw", "se"]).map((corner) => (
                        <div
                          key={`${overlay._editorKey}-${corner}`}
                          className={`handle ${corner}`}
                          onPointerDown={(event) =>
                            startResizeOverlay(event, overlay, page.pageIndex, corner)
                          }
                        />
                      ))}
                    </div>
                  );
                })}

                {mappedRectPreview && mappedRectPreview.pageIndex === page.pageIndex ? (
                  <div
                    style={{
                      position: "absolute",
                      left: `${mappedRectPreview.x}%`,
                      top: `${mappedRectPreview.y}%`,
                      width: `${mappedRectPreview.w}%`,
                      height: `${mappedRectPreview.h}%`,
                      border: "2px dashed #4caf50",
                      background: "rgba(76,175,80,0.2)",
                      pointerEvents: "none",
                      zIndex: 1000,
                    }}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="restaurant-legacy-help-fab">
        {typeof onNavigate === "function" ? (
          <a
            href="/help-contact"
            onClick={(event) => {
              event.preventDefault();
              onNavigate("/help-contact");
            }}
          >
            Help
          </a>
        ) : (
          <Link href="/help-contact">Help</Link>
        )}
      </footer>

      <DishEditorModal editor={editor} runtimeConfigHealth={runtimeConfigHealth} />
      <ChangeLogModal editor={editor} />
      <ConfirmInfoModal editor={editor} />
      <MenuPagesModal editor={editor} />
      <RestaurantSettingsModal editor={editor} />
    </section>
  );
}

export default RestaurantEditor;
