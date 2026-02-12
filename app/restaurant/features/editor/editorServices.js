"use client";

function asText(value) {
  return String(value || "").trim();
}

async function parseFunctionResponse(response, functionName) {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      asText(data?.error) ||
        asText(data?.message) ||
        `Failed request to ${functionName}.`,
    );
  }

  return data;
}

async function postFunctionViaProxy(functionName, payload) {
  const response = await fetch("/api/ai-proxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      functionName,
      payload: payload || {},
    }),
  });
  return await parseFunctionResponse(response, functionName);
}

export async function detectMenuDishes({ imageData }) {
  const payload = {
    imageData: asText(imageData),
  };
  const result = await postFunctionViaProxy("detect-menu-dishes", payload);
  return {
    success: Boolean(result?.success),
    dishes: Array.isArray(result?.dishes) ? result.dishes : [],
    error: asText(result?.error),
  };
}

export async function detectMenuCorners({ imageData, width, height }) {
  const payload = {
    image: asText(imageData),
    width: Number.isFinite(Number(width)) ? Number(width) : 1000,
    height: Number.isFinite(Number(height)) ? Number(height) : 1000,
  };

  const result = await postFunctionViaProxy("detect-corners", payload);
  return {
    success: Boolean(result?.success),
    corners: result?.corners || null,
    description: asText(result?.description),
    error: asText(result?.error),
  };
}

export async function analyzeDishWithAi({ dishName, text, imageData }) {
  const payload = {
    dishName: asText(dishName),
    text: asText(text),
    imageData: asText(imageData),
  };

  const result = await postFunctionViaProxy("dish-editor", payload);
  return result;
}

export async function analyzeIngredientNameWithAi({ ingredientName, dishName }) {
  const payload = {
    ingredientText: asText(ingredientName),
    productName: asText(ingredientName),
    dishName: asText(dishName),
    analysisMode: "name",
  };

  const result = await postFunctionViaProxy("analyze-brand-allergens", payload);
  return {
    allergens: Array.isArray(result?.allergens) ? result.allergens : [],
    diets: Array.isArray(result?.diets) ? result.diets : [],
    reasoning: asText(result?.reasoning),
    error: asText(result?.error),
  };
}

export async function analyzeIngredientScanRequirement({ ingredientName, dishName }) {
  const payload = {
    ingredientName: asText(ingredientName),
    dishName: asText(dishName),
  };

  const result = await postFunctionViaProxy("analyze-ingredient-scan", payload);
  return {
    needsScan:
      typeof result?.needsScan === "boolean" ? result.needsScan : null,
    reasoning: asText(result?.reasoning),
    error: asText(result?.error),
  };
}

export async function sendMenuUpdateNotification({
  restaurantName,
  restaurantSlug,
  addedItems,
  removedItems,
  keptItems,
}) {
  const payload = {
    type: "menu_update",
    restaurantName: asText(restaurantName),
    restaurantSlug: asText(restaurantSlug),
    addedItems: Array.isArray(addedItems) ? addedItems : [],
    removedItems: Array.isArray(removedItems) ? removedItems : [],
    keptItems: Number.isFinite(Number(keptItems)) ? Number(keptItems) : 0,
  };

  return await postFunctionViaProxy("send-notification-email", payload);
}

export async function dataUrlFromImageSource(source) {
  const value = asText(source);
  if (!value) return "";
  if (value.startsWith("data:")) return value;

  const response = await fetch(value);
  if (!response.ok) {
    throw new Error("Failed to load image for processing.");
  }

  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image blob."));
    reader.readAsDataURL(blob);
  });
}

function normalizeDishName(name) {
  return asText(name).toLowerCase();
}

export function compareDishSets({ detectedDishes, existingDishNames }) {
  const detected = Array.isArray(detectedDishes)
    ? detectedDishes.map((dish) => asText(dish?.name || dish)).filter(Boolean)
    : [];

  const existing = Array.isArray(existingDishNames)
    ? existingDishNames.map((name) => asText(name)).filter(Boolean)
    : [];

  const detectedTokens = new Set(detected.map(normalizeDishName));
  const existingTokens = new Set(existing.map(normalizeDishName));

  const addedItems = detected.filter((name) => !existingTokens.has(normalizeDishName(name)));
  const removedItems = existing.filter((name) => !detectedTokens.has(normalizeDishName(name)));
  const keptItems = existing.filter((name) => detectedTokens.has(normalizeDishName(name))).length;

  return {
    addedItems,
    removedItems,
    keptItems,
  };
}

export default {
  detectMenuDishes,
  detectMenuCorners,
  analyzeDishWithAi,
  analyzeIngredientNameWithAi,
  analyzeIngredientScanRequirement,
  sendMenuUpdateNotification,
  dataUrlFromImageSource,
  compareDishSets,
};
