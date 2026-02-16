"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button, Input, Modal, Textarea } from "../../../components/ui";
import { CLARIVORE_LOGO_SRC } from "../../../components/clarivoreBrand";
import AppLoadingScreen from "../../../components/AppLoadingScreen";
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
} from "../shared/minimapGeometry";
import { useMinimapSync } from "../shared/useMinimapSync";

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
  return clamp(parsed, 0, 100);
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

function formatChangeText(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (!value) return "";
  if (Array.isArray(value)) {
    return value.map((entry) => formatChangeText(entry)).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    const message =
      value.message || value.summary || value.text || value.description || value.title;
    if (message) return String(message);
    const ingredient = value.ingredient || value.ingredientName || value.name;
    const action = value.action || value.type || value.operation;
    const category = value.category || value.classification || value.mode;
    const detailParts = [ingredient, action, category]
      .map((part) => String(part || "").trim())
      .filter(Boolean);
    if (detailParts.length) return detailParts.join(" · ");
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return "";
}

function normalizeLegacyDiff(value) {
  if (value == null || value === "") return "None";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const text = value.map((entry) => formatChangeText(entry)).filter(Boolean).join(", ");
    return text || "None";
  }

  if (typeof value === "object") {
    const pairs = Object.entries(value)
      .map(([key, entry]) => {
        const text = formatChangeText(entry);
        return text ? `${key}: ${text}` : "";
      })
      .filter(Boolean);

    if (pairs.length) return pairs.join("\n");

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "None";
    }
  }

  return "None";
}

function renderChangeLine(line, key) {
  const summary = formatChangeText(line);
  const before =
    line && typeof line === "object"
      ? line.before ?? line.previous ?? line.prev ?? line.from
      : null;
  const after =
    line && typeof line === "object"
      ? line.after ?? line.next ?? line.current ?? line.to
      : null;
  const hasDiff = before != null || after != null;

  return (
    <li key={key}>
      {summary || "Updated"}
      {hasDiff ? (
        <div className="mt-1 whitespace-pre-line rounded-md border border-[#263260] bg-[rgba(10,18,50,0.72)] px-2 py-1 text-xs text-[#9fb0dd]">
          <div className="font-medium text-[#c6d5ff]">Before:</div>
          <div>{normalizeLegacyDiff(before)}</div>
          <div className="mt-1 font-medium text-[#c6d5ff]">After:</div>
          <div>{normalizeLegacyDiff(after)}</div>
        </div>
      ) : null}
    </li>
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

function formatPendingChangeLine(line) {
  const text = asText(line);
  if (!text.startsWith("__pc__:")) return text;
  const separatorIndex = text.indexOf("::", "__pc__:".length);
  if (separatorIndex < 0) return text;
  return asText(text.slice(separatorIndex + 2));
}

function parsePendingChangeLine(line) {
  const text = asText(line);
  if (!text.startsWith("__pc__:")) {
    return {
      key: "",
      text,
    };
  }

  const separatorIndex = text.indexOf("::", "__pc__:".length);
  if (separatorIndex < 0) {
    return {
      key: "",
      text,
    };
  }

  const encodedKey = text.slice("__pc__:".length, separatorIndex);
  let key = "";
  try {
    key = asText(decodeURIComponent(encodedKey));
  } catch {
    key = asText(encodedKey);
  }
  return {
    key,
    text: asText(text.slice(separatorIndex + 2)),
  };
}

function parseIngredientFlagChangeKey(key) {
  const text = asText(key);
  if (!text.startsWith("ingredient-flag:")) return null;
  const parts = text.split(":");
  if (parts.length !== 5) return null;
  const [, dishToken, ingredientRef, type, valueToken] = parts;
  if (!dishToken || !ingredientRef || !type || !valueToken) return null;
  if (type !== "allergen" && type !== "diet") return null;
  const numericIngredientIndex = Number(ingredientRef);
  return {
    dishToken,
    ingredientToken: /^\d+$/.test(ingredientRef) ? "" : ingredientRef,
    ingredientIndex:
      Number.isFinite(numericIngredientIndex) && numericIngredientIndex >= 0
        ? Math.floor(numericIngredientIndex)
        : null,
    type,
    valueToken,
  };
}

function parseOverlayPositionChangeKey(key) {
  const text = asText(key);
  if (!text.startsWith("overlay-position:")) return null;
  const dishToken = asText(text.slice("overlay-position:".length));
  if (!dishToken) return null;
  return { dishToken };
}

function parseAiAppliedDishToken(lineText) {
  const text = asText(lineText);
  const suffix = ": Applied AI ingredient analysis";
  if (!text.endsWith(suffix)) return "";
  const prefix = asText(text.slice(0, -suffix.length));
  const dishName = asText(prefix.split(":")[0]);
  return normalizeToken(dishName);
}

function findOverlayByDishToken(overlays, dishToken) {
  const token = normalizeToken(dishToken);
  if (!token) return null;
  return (Array.isArray(overlays) ? overlays : []).find(
    (overlay) => normalizeToken(overlay?.id || overlay?.name) === token,
  ) || null;
}

function findIngredientByToken(overlay, ingredientToken) {
  const token = normalizeToken(ingredientToken);
  if (!token) return null;
  return (Array.isArray(overlay?.ingredients) ? overlay.ingredients : []).find(
    (ingredient) => normalizeToken(ingredient?.name) === token,
  ) || null;
}

function getIngredientTokenStateForComparison({
  overlays,
  dishToken,
  ingredientToken,
  ingredientIndex,
  type,
  valueToken,
}) {
  const overlay = findOverlayByDishToken(overlays, dishToken);
  const ingredientRows = Array.isArray(overlay?.ingredients) ? overlay.ingredients : [];
  const ingredient =
    Number.isFinite(Number(ingredientIndex)) && Number(ingredientIndex) >= 0
      ? ingredientRows[Math.floor(Number(ingredientIndex))]
      : findIngredientByToken(overlay, ingredientToken);
  const containsField = type === "diet" ? "diets" : "allergens";
  const crossField =
    type === "diet" ? "crossContaminationDiets" : "crossContaminationAllergens";
  return readTokenState({
    containsValues: ingredient?.[containsField],
    crossValues: ingredient?.[crossField],
    token: valueToken,
  });
}

function replaceIngredientNameInPendingLine(lineText, ingredientName) {
  const text = asText(lineText);
  const replacement = asText(ingredientName);
  if (!text || !replacement) return text;

  const firstColon = text.indexOf(":");
  if (firstColon < 0) return text;
  const secondColon = text.indexOf(":", firstColon + 1);
  if (secondColon < 0) return text;

  const dishPart = asText(text.slice(0, firstColon));
  const tail = asText(text.slice(secondColon + 1));
  if (!dishPart || !tail) return text;
  return `${dishPart}: ${replacement}: ${tail}`;
}

function resolvePendingChangeLineForDisplay({ lineText, parsedKey, overlays }) {
  const text = asText(lineText);
  if (!text) return "";

  const ingredientFlagKey = parseIngredientFlagChangeKey(parsedKey);
  if (ingredientFlagKey?.dishToken) {
    const overlay = findOverlayByDishToken(overlays, ingredientFlagKey.dishToken);
    const ingredientRows = Array.isArray(overlay?.ingredients) ? overlay.ingredients : [];
    const latestIngredientName =
      Number.isFinite(Number(ingredientFlagKey.ingredientIndex)) &&
      Number(ingredientFlagKey.ingredientIndex) >= 0
        ? asText(ingredientRows[Math.floor(Number(ingredientFlagKey.ingredientIndex))]?.name)
        : "";
    if (latestIngredientName) {
      return replaceIngredientNameInPendingLine(text, latestIngredientName);
    }
  }

  const addedIngredientMatch = text.match(/^(.*?):\s*Added ingredient\s+Ingredient\s+(\d+)$/i);
  if (addedIngredientMatch) {
    const dishName = asText(addedIngredientMatch[1]);
    const ingredientIndex = Math.max(Number(addedIngredientMatch[2]) - 1, 0);
    const overlay = findOverlayByDishToken(overlays, dishName);
    const latestIngredientName = asText(
      (Array.isArray(overlay?.ingredients) ? overlay.ingredients : [])[ingredientIndex]?.name,
    );
    if (latestIngredientName) {
      return `${dishName}: Added ingredient ${latestIngredientName}`;
    }
  }

  return text;
}

function normalizeOverlayRectSignature(overlay) {
  if (!overlay) return "";
  return JSON.stringify({
    pageIndex: Number.isFinite(Number(overlay.pageIndex)) ? Number(overlay.pageIndex) : 0,
    x: parseOverlayNumber(overlay.x),
    y: parseOverlayNumber(overlay.y),
    w: parseOverlayNumber(overlay.w),
    h: parseOverlayNumber(overlay.h),
  });
}

function summarizeAiSelectionTokens(overlay) {
  const ingredientRows = Array.isArray(overlay?.ingredients) ? overlay.ingredients : [];
  const allergenStates = new Map();
  const dietStates = new Map();

  ingredientRows.forEach((ingredient) => {
    dedupeTokenList(ingredient?.aiDetectedAllergens).forEach((token) => {
      allergenStates.set(token, "contains");
    });
    dedupeTokenList(ingredient?.aiDetectedCrossContaminationAllergens).forEach((token) => {
      if (allergenStates.get(token) !== "contains") {
        allergenStates.set(token, "cross");
      }
    });

    dedupeTokenList(ingredient?.aiDetectedDiets).forEach((token) => {
      dietStates.set(token, "contains");
    });
    dedupeTokenList(ingredient?.aiDetectedCrossContaminationDiets).forEach((token) => {
      if (dietStates.get(token) !== "contains") {
        dietStates.set(token, "cross");
      }
    });
  });

  const formatStateList = (map) =>
    Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, state]) => `${name} (${state === "contains" ? "contains" : "cross-contamination risk"})`);

  return {
    allergens: formatStateList(allergenStates),
    diets: formatStateList(dietStates),
  };
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
  const rawName =
    typeof base.name === "string"
      ? base.name
      : base.name == null
        ? ""
        : String(base.name);
  const normalizedName = rawName.trim() ? rawName : `Ingredient ${index + 1}`;
  return {
    ...base,
    name: normalizedName,
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
        changeText: `${dishName}: Added ingredient ${nextIngredientName}`,
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
          changeText: `${overlay?.id || "Dish"}: Removed ingredient ${removedName}`,
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
            const general = Array.isArray(parsed?.general)
              ? parsed.general
              : parsed?.general != null
                ? [parsed.general]
                : [];
            const author = formatChangeText(parsed?.author || log.description || "Manager");
            const photos = Array.isArray(log?.photos)
              ? log.photos
                  .map((photo) => (typeof photo === "string" ? photo.trim() : ""))
                  .filter(Boolean)
              : [];

            return (
              <div key={log.id || `${log.timestamp}-${log.type}`} className="rounded-xl border border-[#2a3261] bg-[rgba(17,22,48,0.75)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[#e9eefc]">
                    {author || "Manager"}
                  </span>
                  <span className="text-xs text-[#a7b2d1]">{formatLogTimestamp(log.timestamp)}</span>
                </div>

                {general.length ? (
                  <ul className="mt-2 mb-0 list-disc pl-5 text-sm text-[#cfd8f7]">
                    {general.map((line, index) => renderChangeLine(line, `${log.id}-general-${index}`))}
                  </ul>
                ) : null}

                {Object.entries(items).map(([dishName, changes]) => (
                  <div key={`${log.id}-${dishName}`} className="mt-2">
                    <div className="text-sm font-medium text-[#dbe3ff]">{dishName}</div>
                    <ul className="mb-0 mt-1 list-disc pl-5 text-sm text-[#c7d2f4]">
                      {(Array.isArray(changes) ? changes : [changes])
                        .filter((line) => line != null)
                        .map((line, idx) => renderChangeLine(line, `${log.id}-${dishName}-${idx}`))}
                    </ul>
                  </div>
                ))}

                {photos.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {photos.map((photo, index) => (
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

              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button
          size="compact"
          tone="neutral"
          onClick={() => editor.setChangeLogOpen(false)}
        >
          Close
        </Button>
      </div>
    </Modal>
  );
}

function PendingTableModal({ editor }) {
  return (
    <Modal
      open={editor.pendingTableOpen}
      onOpenChange={(open) => editor.setPendingTableOpen(open)}
      title="Pending Changes Table"
      className="max-w-[980px]"
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="note m-0 text-sm">Live DB view of current pending batch and rows.</p>
          <Button
            size="compact"
            variant="outline"
            loading={editor.loadingPendingTable}
            onClick={() => editor.loadPendingTable()}
          >
            Refresh
          </Button>
        </div>

        {editor.loadingPendingTable ? (
          <p className="note m-0">Loading pending table...</p>
        ) : editor.pendingTableError ? (
          <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
            {editor.pendingTableError}
          </p>
        ) : !editor.pendingTableBatch ? (
          <p className="note m-0">No pending batch exists.</p>
        ) : (
          <>
            <div className="rounded-xl border border-[#2a3261] bg-[rgba(17,22,48,0.75)] p-3 text-xs text-[#c9d3f3]">
              <div><strong>batch_id:</strong> {editor.pendingTableBatch.id || "-"}</div>
              <div><strong>status:</strong> {editor.pendingTableBatch.status || "-"}</div>
              <div><strong>author:</strong> {editor.pendingTableBatch.author || "-"}</div>
              <div><strong>row_count:</strong> {Number(editor.pendingTableBatch.row_count) || 0}</div>
              <div><strong>updated_at:</strong> {formatLogTimestamp(editor.pendingTableBatch.updated_at) || "-"}</div>
            </div>

            {!editor.pendingTableRows.length ? (
              <p className="note m-0">Pending batch has no rows.</p>
            ) : (
              <div className="max-h-[56vh] overflow-auto rounded-xl border border-[#2a3261] bg-[rgba(17,22,48,0.75)] p-2">
                <table className="w-full border-collapse text-left text-xs text-[#d7e0fb]">
                  <thead>
                    <tr className="border-b border-[#2a3261] text-[#aebce4]">
                      <th className="px-2 py-1">sort_order</th>
                      <th className="px-2 py-1">dish_name</th>
                      <th className="px-2 py-1">ingredient_name</th>
                      <th className="px-2 py-1">change_type</th>
                      <th className="px-2 py-1">field_key</th>
                      <th className="px-2 py-1">summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editor.pendingTableRows.map((row) => (
                      <tr key={row.id || `${row.sort_order}-${row.summary}`} className="border-b border-[rgba(42,50,97,0.45)] align-top">
                        <td className="px-2 py-1">{Number(row.sort_order) || 0}</td>
                        <td className="px-2 py-1">{row.dish_name || "-"}</td>
                        <td className="px-2 py-1">{row.ingredient_name || "-"}</td>
                        <td className="px-2 py-1">{row.change_type || "-"}</td>
                        <td className="px-2 py-1">{row.field_key || "-"}</td>
                        <td className="px-2 py-1 whitespace-pre-wrap">{row.summary || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        <div className="flex justify-end">
          <Button
            size="compact"
            tone="neutral"
            onClick={() => editor.setPendingTableOpen(false)}
          >
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PendingTableDock({ editor }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (typeof editor?.loadPendingTable !== "function") return undefined;
    editor.loadPendingTable();

    const timer = window.setInterval(() => {
      editor.loadPendingTable();
    }, 4000);

    return () => {
      window.clearInterval(timer);
    };
  }, [editor?.loadPendingTable]);

  return (
    <div className="mt-2 rounded-xl border border-[#2a3261] bg-[rgba(17,22,48,0.75)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-[#e3ebff]">Pending changes (live)</div>
          <div className="text-xs text-[#a9b6db]">
            {editor.pendingTableBatch
              ? `batch ${editor.pendingTableBatch.id || "-"} · rows ${Number(editor.pendingTableBatch.row_count) || 0}`
              : "No pending batch"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {editor.loadingPendingTable ? (
            <span className="text-xs text-[#9fb0dd]">Refreshing…</span>
          ) : null}
          <Button
            size="compact"
            variant="outline"
            loading={editor.loadingPendingTable}
            onClick={() => editor.loadPendingTable()}
          >
            Refresh
          </Button>
          <Button
            size="compact"
            variant="outline"
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? "Expand" : "Collapse"}
          </Button>
          <Button
            size="compact"
            variant="outline"
            onClick={() => editor.setPendingTableOpen(true)}
          >
            Open modal
          </Button>
        </div>
      </div>

      {!collapsed ? (
        <div className="mt-2">
          {editor.pendingTableError ? (
            <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
              {editor.pendingTableError}
            </p>
          ) : !editor.pendingTableRows.length ? (
            <p className="note m-0 text-sm">
              No pending rows yet. Rows appear for staged ingredient-row field changes.
            </p>
          ) : (
            <div className="max-h-[220px] overflow-auto rounded-lg border border-[#2a3261] bg-[rgba(10,18,50,0.72)]">
              <table className="w-full border-collapse text-left text-xs text-[#d7e0fb]">
                <thead>
                  <tr className="border-b border-[#2a3261] text-[#aebce4]">
                    <th className="px-2 py-1">order</th>
                    <th className="px-2 py-1">dish</th>
                    <th className="px-2 py-1">ingredient</th>
                    <th className="px-2 py-1">summary</th>
                  </tr>
                </thead>
                <tbody>
                  {editor.pendingTableRows.slice(0, 50).map((row) => (
                    <tr
                      key={row.id || `${row.sort_order}-${row.summary}`}
                      className="border-b border-[rgba(42,50,97,0.45)] align-top"
                    >
                      <td className="px-2 py-1">{Number(row.sort_order) || 0}</td>
                      <td className="px-2 py-1">{row.dish_name || "-"}</td>
                      <td className="px-2 py-1">{row.ingredient_name || "-"}</td>
                      <td className="px-2 py-1 whitespace-pre-wrap">{row.summary || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SaveReviewModal({ editor, open, onOpenChange, onConfirmSave }) {
  const [expandedRows, setExpandedRows] = useState({});
  const changes = useMemo(
    () => (Array.isArray(editor.pendingSaveRows) ? editor.pendingSaveRows : []),
    [editor.pendingSaveRows],
  );

  useEffect(() => {
    if (open) return;
    setExpandedRows({});
  }, [open]);

  return (
    <Modal
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          editor.clearPendingSaveBatch();
        }
      }}
      title="Review your changes"
      className="max-w-[760px]"
    >
      <div className="space-y-3">
        <p className="note m-0 text-sm">Confirm everything looks right before saving to the website.</p>

        {!changes.length ? (
          <p className="note m-0">No ingredient-row status changes were detected for this save.</p>
        ) : (
          <div className="max-h-[52vh] space-y-2 overflow-auto pr-1">
            {changes.map((entry) => (
              <div
                key={`pending-change-${entry.id || entry.sortOrder || entry.summary}`}
                className="rounded-xl border border-[#2a3261] bg-[rgba(17,22,48,0.75)] px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-[#dce4ff]">
                    {asText(entry.summary) || "Ingredient row updated"}
                  </span>
                  <div className="flex items-center gap-2">
                    {entry.beforeValue != null || entry.afterValue != null ? (
                      <Button
                        size="compact"
                        variant="outline"
                        onClick={() =>
                          setExpandedRows((current) => ({
                            ...current,
                            [entry.id || entry.sortOrder || entry.summary]:
                              !current[entry.id || entry.sortOrder || entry.summary],
                          }))
                        }
                      >
                        {expandedRows[entry.id || entry.sortOrder || entry.summary]
                          ? "Hide details"
                          : "Show details"}
                      </Button>
                    ) : null}
                  </div>
                </div>

                {expandedRows[entry.id || entry.sortOrder || entry.summary] ? (
                  <div className="mt-2 rounded-md border border-[#263260] bg-[rgba(10,18,50,0.72)] px-2 py-1 text-xs text-[#9fb0dd]">
                    <div className="font-medium text-[#c6d5ff]">Before:</div>
                    <div className="whitespace-pre-wrap">{normalizeLegacyDiff(entry.beforeValue)}</div>
                    <div className="mt-1 font-medium text-[#c6d5ff]">After:</div>
                    <div className="whitespace-pre-wrap">{normalizeLegacyDiff(entry.afterValue)}</div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {editor.pendingSaveError ? (
          <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
            {editor.pendingSaveError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button
            size="compact"
            variant="outline"
            onClick={() => {
              editor.clearPendingSaveBatch();
              onOpenChange(false);
            }}
          >
            Cancel save
          </Button>
          <Button
            size="compact"
            tone="primary"
            loading={editor.isSaving || editor.pendingSavePreparing}
            disabled={editor.isSaving || editor.pendingSavePreparing || !editor.pendingSaveBatchId}
            onClick={onConfirmSave}
          >
            Confirm &amp; Save
          </Button>
        </div>
      </div>
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
  const [pageSourceIndexMap, setPageSourceIndexMap] = useState([]);
  const [imageChangedPageIndices, setImageChangedPageIndices] = useState([]);
  const [removeUnmatchedPageIndices, setRemoveUnmatchedPageIndices] = useState([]);
  const [sessionDirty, setSessionDirty] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
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
      const snapshot =
        typeof editor.createDraftSnapshot === "function"
          ? editor.createDraftSnapshot()
          : null;
      setSessionSnapshot(snapshot);
      const snapshotImages = Array.isArray(snapshot?.menuImages)
        ? snapshot.menuImages
        : [];
      const sourceMap = snapshotImages.map((_, index) => index);
      setPageSourceIndexMap(sourceMap);
      setImageChangedPageIndices([]);
      setRemoveUnmatchedPageIndices([]);
      setSessionDirty(false);
      setSaveBusy(false);
      setUploadBusy(false);
      setSaveError("");
      setSaveNotice("");
    } else if (!editor.menuPagesOpen && wasOpenRef.current) {
      setSessionSnapshot(null);
      setPageSourceIndexMap([]);
      setImageChangedPageIndices([]);
      setRemoveUnmatchedPageIndices([]);
      setSessionDirty(false);
      setSaveBusy(false);
      setUploadBusy(false);
      setSaveError("");
      setSaveNotice("");
    }

    wasOpenRef.current = editor.menuPagesOpen;
  }, [editor.createDraftSnapshot, editor.menuPagesOpen]);

  const closeMenuModal = useCallback(() => {
    editor.setMenuPagesOpen(false);
  }, [editor]);

  const handleCancel = useCallback(() => {
    if (saveBusy || uploadBusy) return;
    if (sessionSnapshot && typeof editor.restoreDraftSnapshot === "function") {
      editor.restoreDraftSnapshot(sessionSnapshot);
    }
    closeMenuModal();
  }, [closeMenuModal, editor.restoreDraftSnapshot, saveBusy, sessionSnapshot, uploadBusy]);

  const handleSave = useCallback(async () => {
    if (saveBusy || uploadBusy) return;
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
    const sourceMap =
      Array.isArray(pageSourceIndexMap) && pageSourceIndexMap.length
        ? pageSourceIndexMap
        : Array.from({ length: pageCount }, (_, index) => index);
    const baselineMenuImages = Array.isArray(sessionSnapshot?.menuImages)
      ? sessionSnapshot.menuImages
      : [];
    const baselineOverlays = Array.isArray(sessionSnapshot?.overlays)
      ? sessionSnapshot.overlays
      : [];

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
        pageSourceIndexMap: sourceMap,
        baselineMenuImages,
        baselineOverlays,
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
    pageSourceIndexMap,
    removeUnmatchedPageIndices,
    saveBusy,
    uploadBusy,
    sessionSnapshot?.menuImages,
    sessionSnapshot?.overlays,
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
            disabled={saveBusy || uploadBusy}
            onClick={handleCancel}
          >
            Cancel
          </Button>
          <Button
            size="compact"
            tone="primary"
            loading={saveBusy || uploadBusy}
            disabled={uploadBusy}
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
            disabled={saveBusy || uploadBusy}
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
              setUploadBusy(true);
              try {
                const image = await fileToDataUrl(file);
                editor.addMenuPage(image);
                setPageSourceIndexMap((current) => [...current, null]);
                markImagePageChanged(editor.draftMenuImages.length);
              } finally {
                event.target.value = "";
                setUploadBusy(false);
              }
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
                    disabled={saveBusy || uploadBusy || index <= 0}
                    className="min-w-[30px] px-2"
                    onClick={() => {
                      const pageCount = Math.max(editor.draftMenuImages.length, 1);
                      editor.moveMenuPage(index, index - 1);
                      setPageSourceIndexMap((current) => {
                        const next = [...current];
                        if (index <= 0 || index >= next.length) return current;
                        const [moved] = next.splice(index, 1);
                        next.splice(index - 1, 0, moved);
                        return next;
                      });
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
                    disabled={saveBusy || uploadBusy || index >= editor.draftMenuImages.length - 1}
                    className="min-w-[30px] px-2"
                    onClick={() => {
                      const pageCount = Math.max(editor.draftMenuImages.length, 1);
                      editor.moveMenuPage(index, index + 1);
                      setPageSourceIndexMap((current) => {
                        const next = [...current];
                        if (index < 0 || index >= next.length - 1) return current;
                        const [moved] = next.splice(index, 1);
                        next.splice(index + 1, 0, moved);
                        return next;
                      });
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
                  disabled={saveBusy || uploadBusy}
                  onClick={() => replaceInputsRef.current[index]?.click()}
                >
                  Replace
                </Button>
                {editor.draftMenuImages.length > 1 ? (
                  <Button
                    size="compact"
                    tone="danger"
                    variant="outline"
                    disabled={saveBusy || uploadBusy}
                    onClick={() => {
                      const pageCount = Math.max(editor.draftMenuImages.length, 1);
                      editor.removeMenuPage(index);
                      setPageSourceIndexMap((current) =>
                        current.filter((_, sourceIndex) => sourceIndex !== index),
                      );
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
                  setUploadBusy(true);
                  try {
                    const imageData = await fileToDataUrl(file);
                    editor.replaceMenuPage(index, imageData);
                    markImagePageChanged(index);
                  } finally {
                    event.target.value = "";
                    setUploadBusy(false);
                  }
                }}
              />
            </div>
          ))}
        </div>
      </div>
      {uploadBusy ? <AppLoadingScreen label="menu image upload" /> : null}
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
  const stopOverlayInteractionRef = useRef(() => {});
  const mappingDragRef = useRef(null);
  const [mappedRectPreview, setMappedRectPreview] = useState(null);
  const [saveReviewOpen, setSaveReviewOpen] = useState(false);
  const [saveIssueAlert, setSaveIssueAlert] = useState(null);
  const [saveIssueJumpRequest, setSaveIssueJumpRequest] = useState(null);
  const [confirmationGuide, setConfirmationGuide] = useState(null);

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

  const resolveIssueContext = useCallback(
    (issue) => {
      const overlayToken = normalizeToken(issue?.overlayName);
      const ingredientToken = normalizeToken(issue?.ingredientName);
      const matchedOverlay = (Array.isArray(editor.overlays) ? editor.overlays : []).find(
        (overlay) => normalizeToken(overlay?.id || overlay?.name) === overlayToken,
      );
      const ingredientName = asText(issue?.ingredientName);

      return {
        ...issue,
        overlayKey: matchedOverlay?._editorKey || "",
        overlayName: asText(issue?.overlayName || matchedOverlay?.id || matchedOverlay?.name),
        ingredientName,
        message:
          asText(issue?.message) ||
          `${asText(issue?.overlayName) || "Dish"}: ${ingredientName || "Ingredient"} must be confirmed before saving`,
        issueKey: `${normalizeToken(issue?.overlayName)}:${normalizeToken(issue?.ingredientName)}`,
        canJump: Boolean(matchedOverlay?._editorKey && ingredientToken),
      };
    },
    [editor.overlays],
  );

  const buildJumpableConfirmationIssues = useCallback(() => {
    return editor
      .getIngredientConfirmationIssues()
      .map((issue) => resolveIssueContext(issue))
      .filter((issue) => issue.canJump);
  }, [editor, resolveIssueContext]);

  const requestJumpToIssue = useCallback(
    (issue) => {
      if (!issue?.canJump) return;
      editor.selectOverlay(issue.overlayKey);
      editor.openDishEditor(issue.overlayKey);
      setSaveIssueJumpRequest({
        requestId: Date.now(),
        overlayKey: issue.overlayKey,
        ingredientName: issue.ingredientName,
      });
    },
    [editor],
  );

  const triggerSave = useCallback(async () => {
    if (editor.isSaving) return;
    const confirmationIssues = editor.getIngredientConfirmationIssues();
    if (confirmationIssues.length) {
      setConfirmationGuide(null);
      setSaveIssueAlert(resolveIssueContext(confirmationIssues[0]));
      return;
    }

    setSaveIssueAlert(null);
    const staged = await editor.preparePendingSave();
    if (!staged?.success) {
      return;
    }
    setSaveReviewOpen(true);
  }, [editor, resolveIssueContext]);

  const startConfirmationGuide = useCallback(() => {
    const guideIssues = buildJumpableConfirmationIssues();
    if (!guideIssues.length) return;
    setSaveIssueAlert(null);
    setConfirmationGuide({ issues: guideIssues, currentIndex: 0, confirmedHistory: [] });
    requestJumpToIssue(guideIssues[0]);
  }, [buildJumpableConfirmationIssues, requestJumpToIssue]);

  const goToPreviousGuideIssue = useCallback(() => {
    setConfirmationGuide((current) => {
      if (!current) return current;
      const history = Array.isArray(current.confirmedHistory)
        ? current.confirmedHistory
        : [];
      if (!history.length) return current;

      const currentIssueKey = current.issues[current.currentIndex]?.issueKey;
      const currentHistoryIndex = currentIssueKey
        ? history.lastIndexOf(currentIssueKey)
        : -1;
      const targetHistoryIndex =
        currentHistoryIndex > 0
          ? currentHistoryIndex - 1
          : currentHistoryIndex === -1
            ? history.length - 1
            : -1;
      if (targetHistoryIndex < 0) return current;

      const targetIssueKey = history[targetHistoryIndex];
      const previousIndex = current.issues.findIndex(
        (issue) => issue.issueKey === targetIssueKey,
      );
      if (previousIndex < 0) return current;

      requestJumpToIssue(current.issues[previousIndex]);
      return {
        ...current,
        currentIndex: previousIndex,
      };
    });
  }, [requestJumpToIssue]);

  const goToNextGuideIssue = useCallback(() => {
    setConfirmationGuide((current) => {
      if (!current?.issues?.length) return current;

      const unresolvedKeys = new Set(
        editor
          .getIngredientConfirmationIssues()
          .map(
            (issue) =>
              `${normalizeToken(issue?.overlayName)}:${normalizeToken(issue?.ingredientName)}`,
          ),
      );
      if (!unresolvedKeys.size) return current;

      const nextIndex = current.issues.findIndex(
        (issue, index) => index > current.currentIndex && unresolvedKeys.has(issue.issueKey),
      );
      const targetIndex =
        nextIndex >= 0
          ? nextIndex
          : current.issues.findIndex((issue) => unresolvedKeys.has(issue.issueKey));

      if (targetIndex < 0 || targetIndex === current.currentIndex) return current;

      requestJumpToIssue(current.issues[targetIndex]);
      return {
        ...current,
        currentIndex: targetIndex,
      };
    });
  }, [editor, requestJumpToIssue]);

  const cancelConfirmationGuide = useCallback(() => {
    setConfirmationGuide(null);
  }, []);

  const confirmSaveFromReview = useCallback(async () => {
    if (editor.isSaving) return;
    const result = await editor.save();
    if (result?.success) {
      setSaveReviewOpen(false);
    }
  }, [editor]);

  useEffect(() => {
    if (!saveReviewOpen) return;
    if (editor.pendingSaveBatchId) return;
    setSaveReviewOpen(false);
  }, [editor.pendingSaveBatchId, saveReviewOpen]);

  useEffect(() => {
    if (!saveIssueAlert?.issueKey) return;
    const activeIssueKeys = editor
      .getIngredientConfirmationIssues()
      .map(
        (issue) =>
          `${normalizeToken(issue?.overlayName)}:${normalizeToken(issue?.ingredientName)}`,
      );
    if (!activeIssueKeys.includes(saveIssueAlert.issueKey)) {
      setSaveIssueAlert(null);
    }
  }, [editor, saveIssueAlert]);

  useEffect(() => {
    if (!confirmationGuide?.issues?.length) return;

    const unresolvedKeys = new Set(
      editor
        .getIngredientConfirmationIssues()
        .map(
          (issue) =>
            `${normalizeToken(issue?.overlayName)}:${normalizeToken(issue?.ingredientName)}`,
        ),
    );

    if (!unresolvedKeys.size) {
      setConfirmationGuide(null);
      return;
    }

    const currentIssue = confirmationGuide.issues[confirmationGuide.currentIndex];
    if (!currentIssue) return;
    const confirmedHistory = Array.isArray(confirmationGuide.confirmedHistory)
      ? confirmationGuide.confirmedHistory
      : [];
    if (unresolvedKeys.has(currentIssue.issueKey)) {
      return;
    }

    if (confirmedHistory.includes(currentIssue.issueKey)) {
      return;
    }

    const nextHistory = [...confirmedHistory, currentIssue.issueKey];

    const nextIndex = confirmationGuide.issues.findIndex(
      (issue, index) =>
        index > confirmationGuide.currentIndex && unresolvedKeys.has(issue.issueKey),
    );
    if (nextIndex >= 0) {
      const nextIssue = confirmationGuide.issues[nextIndex];
      setConfirmationGuide((current) =>
        current
          ? {
              ...current,
              currentIndex: nextIndex,
              confirmedHistory: nextHistory,
            }
          : current,
      );
      requestJumpToIssue(nextIssue);
      return;
    }

    const firstRemainingIndex = confirmationGuide.issues.findIndex((issue) =>
      unresolvedKeys.has(issue.issueKey),
    );
    if (firstRemainingIndex >= 0) {
      const firstRemainingIssue = confirmationGuide.issues[firstRemainingIndex];
      setConfirmationGuide((current) =>
        current
          ? {
              ...current,
              currentIndex: firstRemainingIndex,
              confirmedHistory: nextHistory,
            }
          : current,
      );
      requestJumpToIssue(firstRemainingIssue);
      return;
    }

    setConfirmationGuide(null);
  }, [confirmationGuide, editor, requestJumpToIssue]);

  const guideCanBack = useMemo(() => {
    if (!confirmationGuide?.issues?.length) return false;
    const history = Array.isArray(confirmationGuide.confirmedHistory)
      ? confirmationGuide.confirmedHistory
      : [];
    if (!history.length) return false;
    const currentIssueKey = confirmationGuide.issues[confirmationGuide.currentIndex]?.issueKey;
    const currentHistoryIndex = currentIssueKey
      ? history.lastIndexOf(currentIssueKey)
      : -1;
    if (currentHistoryIndex > 0) return true;
    return currentHistoryIndex === -1;
  }, [confirmationGuide]);

  const guideCanForward = useMemo(() => {
    if (!confirmationGuide?.issues?.length) return false;
    const unresolvedKeys = new Set(
      editor
        .getIngredientConfirmationIssues()
        .map(
          (issue) =>
            `${normalizeToken(issue?.overlayName)}:${normalizeToken(issue?.ingredientName)}`,
        ),
    );
    if (!unresolvedKeys.size) return false;

    const nextIndex = confirmationGuide.issues.findIndex(
      (issue, index) =>
        index > confirmationGuide.currentIndex && unresolvedKeys.has(issue.issueKey),
    );
    if (nextIndex >= 0) return true;

    const firstRemainingIndex = confirmationGuide.issues.findIndex((issue) =>
      unresolvedKeys.has(issue.issueKey),
    );
    return firstRemainingIndex >= 0 && firstRemainingIndex !== confirmationGuide.currentIndex;
  }, [confirmationGuide, editor]);

  const { activePageIndex: minimapActivePageIndex, scrollSnapshot } = useMinimapSync({
    enabled: true,
    menuScrollRef,
    pageRefs,
    pageImageRefs,
    pageCount: editor.overlaysByPage.length,
    pageVersionKey: editor.overlaysByPage.length,
    initialActivePageIndex: editor.activePageIndex,
    onActivePageChange: editor.jumpToPage,
  });

  const minimapViewport = useMemo(() => {
    const scrollNode = menuScrollRef.current;
    const pageNode =
      pageRefs.current[minimapActivePageIndex] ||
      pageImageRefs.current[minimapActivePageIndex];
    return buildMinimapViewport(scrollNode, pageNode);
  }, [minimapActivePageIndex, scrollSnapshot.clientHeight, scrollSnapshot.scrollTop]);

  const jumpFromMinimap = useCallback(
    (event) => {
      const scrollNode = menuScrollRef.current;
      const pageNode =
        pageRefs.current[minimapActivePageIndex] ||
        pageImageRefs.current[minimapActivePageIndex];
      if (!scrollNode || !pageNode) return;

      const bounds = event.currentTarget.getBoundingClientRect();
      if (!bounds.height) return;
      const ratio = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
      const target = computeMinimapJumpTarget(scrollNode, pageNode, ratio);

      scrollNode.scrollTo({ top: target, behavior: "smooth" });
    },
    [minimapActivePageIndex],
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

    window.removeEventListener(interaction.moveEventName || "pointermove", interaction.onMove);
    window.removeEventListener(interaction.upEventName || "pointerup", interaction.onUp);
    window.removeEventListener("pointercancel", interaction.onUp);
    if (interaction.captureTarget && interaction.onLostCapture) {
      interaction.captureTarget.removeEventListener(
        "lostpointercapture",
        interaction.onLostCapture,
      );
    }

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
          changeKey: `overlay-position:${normalizeToken(interaction.overlayName)}`,
          recordHistory: true,
        },
      );
    }
  }, [editor]);

  useEffect(() => {
    stopOverlayInteractionRef.current = stopOverlayInteraction;
  }, [stopOverlayInteraction]);

  const startDragOverlay = useCallback(
    (event, overlay, pageIndex) => {
      if (mappingEnabled) return;
      if (!overlay?._editorKey) return;
      if (event?.type === "pointerdown" && event?.pointerType === "mouse") return;
      if (event?.pointerType === "mouse" && event.button !== 0) return;
      if (event?.type === "mousedown" && event.button !== 0) return;
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

      const moveEventName = pointerId !== null ? "pointermove" : "mousemove";
      const upEventName = pointerId !== null ? "pointerup" : "mouseup";
      const onLostCapture = () => onUp();

      if (captureTarget && pointerId !== null) {
        captureTarget.addEventListener("lostpointercapture", onLostCapture);
      }

      overlayInteractionRef.current = {
        overlayKey: overlay._editorKey,
        overlayName: overlay.id || "Dish",
        pointerId,
        captureTarget,
        moveEventName,
        upEventName,
        onLostCapture,
        onMove,
        onUp,
      };

      window.addEventListener(moveEventName, onMove);
      window.addEventListener(upEventName, onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [editor, mappingEnabled, stopOverlayInteraction],
  );

  const startResizeOverlay = useCallback(
    (event, overlay, pageIndex, corner) => {
      if (mappingEnabled) return;
      if (!overlay?._editorKey) return;
      if (event?.type === "pointerdown" && event?.pointerType === "mouse") return;
      if (event?.pointerType === "mouse" && event.button !== 0) return;
      if (event?.type === "mousedown" && event.button !== 0) return;

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

      const moveEventName = pointerId !== null ? "pointermove" : "mousemove";
      const upEventName = pointerId !== null ? "pointerup" : "mouseup";
      const onLostCapture = () => onUp();

      if (captureTarget && pointerId !== null) {
        captureTarget.addEventListener("lostpointercapture", onLostCapture);
      }

      overlayInteractionRef.current = {
        overlayKey: overlay._editorKey,
        overlayName: overlay.id || "Dish",
        pointerId,
        captureTarget,
        moveEventName,
        upEventName,
        onLostCapture,
        onMove,
        onUp,
      };

      window.addEventListener(moveEventName, onMove);
      window.addEventListener(upEventName, onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [editor, getOverlaySnapTargets, mappingEnabled, stopOverlayInteraction],
  );

  useEffect(() => {
    return () => {
      stopOverlayInteractionRef.current();
    };
  }, []);

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
                  {editor.draftMenuImages[minimapActivePageIndex] ? (
                    <img
                      src={editor.draftMenuImages[minimapActivePageIndex]}
                      alt={`Menu thumbnail page ${minimapActivePageIndex + 1}`}
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
                  Page {minimapActivePageIndex + 1} of {editor.draftMenuImages.length}
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
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="btn"
                          onClick={editor.undo}
                          disabled={!editor.canUndo}
                          style={{ flex: 1, width: "auto", opacity: editor.canUndo ? 1 : 0.5 }}
                        >
                          ↶ Undo
                        </button>
                        <button
                          className="btn"
                          onClick={editor.redo}
                          disabled={!editor.canRedo}
                          style={{ flex: 1, width: "auto", opacity: editor.canRedo ? 1 : 0.5 }}
                        >
                          ↷ Redo
                        </button>
                      </div>
                      {legacySaveButtonVisible ? (
                        <button
                          className={`btn ${legacySaveButtonClass}`}
                          onClick={triggerSave}
                          disabled={editor.isSaving}
                        >
                          {legacySaveButtonLabel}
                        </button>
                      ) : null}
                      {saveIssueAlert ? (
                        <div className="w-full mt-2 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
                          <div>Please review unconfirmed rows</div>
                          {saveIssueAlert.canJump ? (
                            <button
                              type="button"
                              className="btn btnDanger btnSmall mt-2"
                              onClick={startConfirmationGuide}
                            >
                              Review unconfirmed rows
                            </button>
                          ) : null}
                        </div>
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
                      <button className="btn" onClick={() => editor.setPendingTableOpen(true)}>
                        🧾 View pending table
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

              <PendingTableDock editor={editor} />
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
                      onMouseDown={(event) => {
                        startDragOverlay(event, overlay, page.pageIndex);
                      }}
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
                          onMouseDown={(event) => {
                            startResizeOverlay(event, overlay, page.pageIndex, corner);
                          }}
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

      <DishEditorModal
        editor={editor}
        runtimeConfigHealth={runtimeConfigHealth}
        saveIssueJumpRequest={saveIssueJumpRequest}
        onSaveIssueJumpHandled={() => setSaveIssueJumpRequest(null)}
        confirmationGuide={
          confirmationGuide
            ? {
                ...confirmationGuide,
                canBack: guideCanBack,
                canForward: guideCanForward,
              }
            : null
        }
        onGuideBack={goToPreviousGuideIssue}
        onGuideForward={goToNextGuideIssue}
        onGuideCancel={cancelConfirmationGuide}
      />
      <SaveReviewModal
        editor={editor}
        open={saveReviewOpen}
        onOpenChange={setSaveReviewOpen}
        onConfirmSave={confirmSaveFromReview}
      />
      <PendingTableModal editor={editor} />
      <ChangeLogModal editor={editor} />
      <ConfirmInfoModal editor={editor} />
      <MenuPagesModal editor={editor} />
      <RestaurantSettingsModal editor={editor} />
    </section>
  );
}

export default RestaurantEditor;
