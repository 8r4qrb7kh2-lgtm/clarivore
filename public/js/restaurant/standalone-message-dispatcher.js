function buildLegacyAccountUrl(params = {}) {
  const query = new URLSearchParams();
  if (params.slug) query.set("returnSlug", params.slug);
  if (params.redirect) query.set("redirect", params.redirect);
  const qs = query.toString();
  return "account.html" + (qs ? `?${qs}` : "");
}

function navigateLegacy(message = {}) {
  if (message.type === "navigate") {
    if (message.to === "/restaurants") window.location.href = "restaurants.html";
    else if (message.to === "/favorites")
      window.location.href = "favorites.html";
    else if (message.to === "/dish-search")
      window.location.href = "dish-search.html";
    else if (message.to === "/my-dishes")
      window.location.href = "my-dishes.html";
    else if (message.to === "/report-issue")
      window.location.href = "report-issue.html";
    else if (message.to === "/accounts")
      window.location.href = buildLegacyAccountUrl({
        slug: message.slug,
        redirect: message.redirect,
      });
    else if (message.to) window.location.href = message.to;
    return true;
  }

  if (message.type === "signIn") {
    window.location.href = buildLegacyAccountUrl({
      slug: message.slug,
      redirect: message.redirect,
    });
    return true;
  }

  if (message.type === "openRestaurant") {
    window.location.href = `restaurant.html?slug=${message.slug}`;
    return true;
  }

  return false;
}

function parseAiIngredients(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function normalizeRowText(row) {
  const name = String(row?.name || row?.ingredient || "").trim();
  if (name) return name;
  const list = Array.isArray(row?.ingredientsList)
    ? row.ingredientsList.filter(Boolean)
    : [];
  if (list.length) return list.join(", ");
  return "";
}

function coerceRowIndex(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function uploadInlineImage({
  client,
  dataUrl,
  label,
  inlinePrefix,
  maxInlineLength,
  imageBucket,
  cache,
}) {
  if (
    !dataUrl ||
    typeof dataUrl !== "string" ||
    !dataUrl.startsWith(inlinePrefix)
  ) {
    return dataUrl;
  }
  if (cache.has(dataUrl)) {
    return cache.get(dataUrl);
  }

  let publicUrl = null;
  try {
    if (client?.storage) {
      const blob = await (await fetch(dataUrl)).blob();
      const ext = blob.type && blob.type.includes("png") ? "png" : "jpg";
      const filePath = `ingredient-images/${label}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.${ext}`;
      const { error: uploadError } = await client.storage
        .from(imageBucket)
        .upload(filePath, blob, {
          contentType: blob.type || "image/jpeg",
          upsert: false,
        });
      if (uploadError) {
        console.warn(
          "Inline image upload failed - keeping fallback data URL:",
          uploadError,
        );
      } else {
        const { data: urlData } = client.storage
          .from(imageBucket)
          .getPublicUrl(filePath);
        if (urlData?.publicUrl) {
          publicUrl = urlData.publicUrl;
        }
      }
    }
  } catch (uploadErr) {
    console.warn(
      "Inline image upload exception - keeping fallback data URL:",
      uploadErr,
    );
  }

  let finalValue = publicUrl || dataUrl;
  if (!publicUrl && dataUrl.length > maxInlineLength) {
    console.warn("Dropping large inline image to avoid save failure.");
    finalValue = "";
  }
  cache.set(dataUrl, finalValue);
  return finalValue;
}

async function sanitizeAiIngredientsImages({
  client,
  aiIngredients,
  inlinePrefix,
  maxInlineLength,
  imageBucket,
  cache,
}) {
  if (!aiIngredients) return aiIngredients;
  const raw =
    typeof aiIngredients === "string"
      ? aiIngredients
      : JSON.stringify(aiIngredients);
  if (!raw || !raw.includes(inlinePrefix)) {
    return aiIngredients;
  }
  let rows = null;
  try {
    rows = JSON.parse(raw);
  } catch (parseErr) {
    console.warn("Failed to parse aiIngredients for sanitizing.");
    return aiIngredients;
  }
  if (!Array.isArray(rows)) return aiIngredients;

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    row.ingredientsImage = await uploadInlineImage({
      client,
      dataUrl: row.ingredientsImage,
      label: "label",
      inlinePrefix,
      maxInlineLength,
      imageBucket,
      cache,
    });
    row.brandImage = await uploadInlineImage({
      client,
      dataUrl: row.brandImage,
      label: "brand",
      inlinePrefix,
      maxInlineLength,
      imageBucket,
      cache,
    });
    if (Array.isArray(row.brands)) {
      for (const brand of row.brands) {
        if (!brand || typeof brand !== "object") continue;
        brand.ingredientsImage = await uploadInlineImage({
          client,
          dataUrl: brand.ingredientsImage,
          label: "label",
          inlinePrefix,
          maxInlineLength,
          imageBucket,
          cache,
        });
        brand.brandImage = await uploadInlineImage({
          client,
          dataUrl: brand.brandImage,
          label: "brand",
          inlinePrefix,
          maxInlineLength,
          imageBucket,
          cache,
        });
      }
    }
  }

  return JSON.stringify(rows);
}

async function loadIngredientLookup(client) {
  const [allergensRes, dietsRes] = await Promise.all([
    client
      .from("allergens")
      .select("id, key, is_active")
      .eq("is_active", true),
    client
      .from("diets")
      .select("id, label, is_active, is_supported")
      .eq("is_active", true),
  ]);
  if (allergensRes.error) throw allergensRes.error;
  if (dietsRes.error) throw dietsRes.error;

  const allergenIdByKey = new Map();
  (allergensRes.data || []).forEach((row) => {
    if (row?.key && row?.id) {
      allergenIdByKey.set(row.key, row.id);
    }
  });

  const dietIdByLabel = new Map();
  const supportedDietLabels = [];
  (dietsRes.data || []).forEach((row) => {
    const label = String(row?.label || "").trim();
    if (!label || !row?.id) return;
    dietIdByLabel.set(label, row.id);
    if (row?.is_supported !== false) {
      supportedDietLabels.push(label);
    }
  });

  return { allergenIdByKey, dietIdByLabel, supportedDietLabels };
}

async function syncIngredientStatusTablesDirect({
  client,
  restaurantId,
  overlays,
  lookup,
}) {
  const overlaysArray = Array.isArray(overlays) ? overlays : [];
  for (const overlay of overlaysArray) {
    const dishName = overlay?.id || overlay?.name;
    if (!dishName) continue;

    const rows = parseAiIngredients(overlay?.aiIngredients);

    const { error: deleteError } = await client
      .from("dish_ingredient_rows")
      .delete()
      .eq("restaurant_id", restaurantId)
      .eq("dish_name", dishName);
    if (deleteError) throw deleteError;

    if (!rows.length) continue;

    const rowPayload = rows.map((row, idx) => ({
      restaurant_id: restaurantId,
      dish_name: dishName,
      row_index: coerceRowIndex(row?.index, idx),
      row_text: normalizeRowText(row) || null,
    }));

    const { data: insertedRows, error: insertError } = await client
      .from("dish_ingredient_rows")
      .insert(rowPayload)
      .select("id, row_index");
    if (insertError) throw insertError;

    const rowIdByIndex = new Map(
      (insertedRows || []).map((row) => [row.row_index, row.id]),
    );

    const allergenEntries = [];
    const dietEntries = [];
    const supportedDietLabels = lookup.supportedDietLabels || [];

    rows.forEach((row, idx) => {
      const rowIndex = coerceRowIndex(row?.index, idx);
      const rowId = rowIdByIndex.get(rowIndex);
      if (!rowId) return;

      const isRemovable = row?.removable === true;
      const allergens = Array.isArray(row?.allergens) ? row.allergens : [];
      const crossContamination = Array.isArray(row?.crossContamination)
        ? row.crossContamination
        : [];
      const allergenStatus = new Map();

      allergens.forEach((key) => {
        if (!key) return;
        allergenStatus.set(key, {
          is_violation: true,
          is_cross_contamination: false,
        });
      });
      crossContamination.forEach((key) => {
        if (!key) return;
        const existing = allergenStatus.get(key) || {
          is_violation: false,
          is_cross_contamination: false,
        };
        existing.is_cross_contamination = true;
        allergenStatus.set(key, existing);
      });

      allergenStatus.forEach((status, key) => {
        const allergenId = lookup.allergenIdByKey.get(key);
        if (!allergenId) return;
        allergenEntries.push({
          ingredient_row_id: rowId,
          allergen_id: allergenId,
          is_violation: status.is_violation,
          is_cross_contamination: status.is_cross_contamination,
          is_removable: isRemovable,
        });
      });

      const diets = Array.isArray(row?.diets) ? row.diets : [];
      const crossContaminationDiets = Array.isArray(row?.crossContaminationDiets)
        ? row.crossContaminationDiets
        : [];
      const dietSet = new Set(diets);
      const crossContaminationSet = new Set(crossContaminationDiets);
      const compatible = new Set([...dietSet, ...crossContaminationSet]);

      supportedDietLabels.forEach((label) => {
        const dietId = lookup.dietIdByLabel.get(label);
        if (!dietId) return;
        if (crossContaminationSet.has(label)) {
          dietEntries.push({
            ingredient_row_id: rowId,
            diet_id: dietId,
            is_violation: false,
            is_cross_contamination: true,
            is_removable: isRemovable,
          });
          return;
        }
        if (!compatible.has(label)) {
          dietEntries.push({
            ingredient_row_id: rowId,
            diet_id: dietId,
            is_violation: true,
            is_cross_contamination: false,
            is_removable: isRemovable,
          });
        }
      });
    });

    if (allergenEntries.length) {
      const { error: allergenError } = await client
        .from("dish_ingredient_allergens")
        .insert(allergenEntries);
      if (allergenError) throw allergenError;
    }
    if (dietEntries.length) {
      const { error: dietError } = await client
        .from("dish_ingredient_diets")
        .insert(dietEntries);
      if (dietError) throw dietError;
    }
  }
}

async function syncIngredientStatusTables({ client, restaurantId, overlays }) {
  const overlaysArray = Array.isArray(overlays) ? overlays : [];
  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult?.data?.session?.access_token || null;
  if (!accessToken) {
    throw new Error("Missing auth session for ingredient sync.");
  }

  const minimalOverlays = overlaysArray.map((overlay) => ({
    id: overlay?.id,
    name: overlay?.name,
    dishName: overlay?.id || overlay?.name,
    aiIngredients: overlay?.aiIngredients,
  }));

  try {
    const response = await fetch("/api/ingredient-status-sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        restaurantId,
        overlays: minimalOverlays,
      }),
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Ingredient sync failed (${response.status}): ${message}`);
    }
  } catch (error) {
    console.warn("Prisma ingredient sync failed, falling back to direct sync.", error);
    const lookup = await loadIngredientLookup(client);
    await syncIngredientStatusTablesDirect({
      client,
      restaurantId,
      overlays,
      lookup,
    });
  }
}

function toRestaurantId(restaurant) {
  return restaurant?._id || restaurant?.id || null;
}

function toAuthorName(state) {
  let authorName = "Manager";
  if (state.user?.name) {
    authorName = state.user.name;
  } else if (
    state.user?.user_metadata?.first_name ||
    state.user?.user_metadata?.last_name
  ) {
    const first = state.user.user_metadata.first_name || "";
    const last = state.user.user_metadata.last_name || "";
    authorName = `${first} ${last}`.trim();
  } else if (state.user?.email) {
    authorName = state.user.email.split("@")[0];
  }
  return authorName;
}

async function handleSaveOverlays({
  message,
  state,
  normalizeRestaurant,
  insertChangeLogEntry,
}) {
  let payload = {};
  let overlaysToSave = [];

  try {
    const client = window.supabaseClient;
    if (!client) throw new Error("Supabase client not ready.");
    const restaurantId = toRestaurantId(state.restaurant);
    if (!restaurantId) throw new Error("Restaurant not loaded yet.");

    const inlinePrefix = "data:image";
    const maxInlineLength = 200000;
    const imageBucket = "ingredient-appeals";
    const uploadedImageCache = new Map();

    overlaysToSave = [];
    for (const overlay of message.overlays || []) {
      const savedOverlay = { ...overlay };
      if (overlay.aiIngredients !== undefined) {
        savedOverlay.aiIngredients = await sanitizeAiIngredientsImages({
          client,
          aiIngredients: overlay.aiIngredients,
          inlinePrefix,
          maxInlineLength,
          imageBucket,
          cache: uploadedImageCache,
        });
      }
      if (overlay.aiIngredientSummary !== undefined) {
        savedOverlay.aiIngredientSummary = overlay.aiIngredientSummary;
      }
      if (overlay.recipeDescription !== undefined) {
        savedOverlay.recipeDescription = overlay.recipeDescription;
      }
      overlaysToSave.push(savedOverlay);
    }

    payload = { overlays: overlaysToSave };
    if (
      message.menuImages &&
      Array.isArray(message.menuImages) &&
      message.menuImages.length > 0
    ) {
      payload.menu_images = message.menuImages;
      payload.menu_image = message.menuImages[0] || "";
    } else if (message.menuImage) {
      payload.menu_image = message.menuImage;
      if (!message.menuImages) {
        payload.menu_images = [message.menuImage];
      }
    }
    if (message.restaurantSettings) {
      payload.website = message.restaurantSettings.website;
      payload.phone = message.restaurantSettings.phone;
      payload.delivery_url = message.restaurantSettings.delivery_url;
      console.log("Saving restaurant settings:", message.restaurantSettings);
    }

    console.log(
      "Saving overlays with aiIngredients preservation:",
      overlaysToSave.map((o) => ({
        id: o.id,
        hasAiIngredients: !!o.aiIngredients,
        aiIngredientsLength: o.aiIngredients
          ? typeof o.aiIngredients === "string"
            ? o.aiIngredients.length
            : JSON.stringify(o.aiIngredients).length
          : 0,
      })),
    );

    const { error } = await client
      .from("restaurants")
      .update(payload)
      .eq("id", restaurantId);
    if (error) {
      console.error("Supabase update error:", error);
      console.error("Error details:", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        payloadSize: JSON.stringify(payload).length,
        overlaysCount: overlaysToSave.length,
        payloadKeys: Object.keys(payload),
        restaurantId,
        sampleOverlay: overlaysToSave[0]
          ? {
              id: overlaysToSave[0].id,
              hasAiIngredients: !!overlaysToSave[0].aiIngredients,
              aiIngredientsLength: overlaysToSave[0].aiIngredients
                ? typeof overlaysToSave[0].aiIngredients === "string"
                  ? overlaysToSave[0].aiIngredients.length
                  : JSON.stringify(overlaysToSave[0].aiIngredients).length
                : 0,
              keys: Object.keys(overlaysToSave[0]),
            }
          : null,
        fullPayload: JSON.stringify(payload, null, 2),
      });
      throw error;
    }

    await syncIngredientStatusTables({
      client,
      restaurantId,
      overlays: overlaysToSave,
    });

    console.log(
      "Saved overlays response:",
      overlaysToSave.map((o) => ({
        id: o.id,
        hasAiIngredients: !!o.aiIngredients,
        aiIngredientsLength: o.aiIngredients
          ? typeof o.aiIngredients === "string"
            ? o.aiIngredients.length
            : JSON.stringify(o.aiIngredients).length
          : 0,
      })),
    );

    const nextRestaurant = {
      ...(state.restaurant || {}),
      overlays: overlaysToSave,
    };
    if (Object.prototype.hasOwnProperty.call(payload, "menu_images")) {
      nextRestaurant.menu_images = payload.menu_images;
      nextRestaurant.menu_image = payload.menu_image;
      nextRestaurant.menuImages = payload.menu_images;
      nextRestaurant.menuImage = payload.menu_image;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "menu_image")) {
      nextRestaurant.menu_image = payload.menu_image;
      nextRestaurant.menuImage = payload.menu_image;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "website")) {
      nextRestaurant.website = payload.website;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "phone")) {
      nextRestaurant.phone = payload.phone;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "delivery_url")) {
      nextRestaurant.delivery_url = payload.delivery_url;
    }

    const updatedRestaurant = normalizeRestaurant(nextRestaurant);
    if (state.restaurant) {
      state.restaurant = updatedRestaurant;
    }

    if (
      message.restaurantSettings &&
      typeof window.updateOriginalRestaurantSettings === "function"
    ) {
      window.updateOriginalRestaurantSettings({
        website: message.restaurantSettings.website,
        phone: message.restaurantSettings.phone,
        delivery_url: message.restaurantSettings.delivery_url,
      });
    }

    window.postMessage(
      { type: "overlaysSaved", restaurant: updatedRestaurant },
      "*",
    );

    const rawChangePayload = message.changes;
    let changePayload = null;
    if (
      rawChangePayload &&
      typeof rawChangePayload === "object" &&
      !Array.isArray(rawChangePayload)
    ) {
      changePayload = rawChangePayload;
    } else if (typeof rawChangePayload === "string") {
      try {
        changePayload = JSON.parse(rawChangePayload);
      } catch (_) {
        changePayload = null;
      }
    }

    let authorName = toAuthorName(state);
    if (changePayload && changePayload.author) {
      authorName = changePayload.author;
    }

    const storedChanges = changePayload
      ? JSON.stringify(changePayload)
      : typeof rawChangePayload === "string"
        ? rawChangePayload
        : "Menu overlays updated.";

    try {
      await insertChangeLogEntry({
        restaurantId,
        timestamp: new Date().toISOString(),
        type: "update",
        description: authorName,
        changes: storedChanges,
        userEmail: state.user?.email || null,
      });
      console.log("Change log entry saved successfully:", {
        restaurantId,
        authorName,
        changesLength: storedChanges.length,
      });
    } catch (logError) {
      console.error("Change log insert failed:", logError);
      console.error("Change log insert context:", {
        restaurantId,
        authorName,
        userEmail: state.user?.email,
        isAuthenticated: !!state.user,
        changesLength: storedChanges?.length || 0,
      });
    }
  } catch (err) {
    console.error("Saving overlays failed", err);
    const errorPayload = payload || {};
    console.error("Error details:", {
      message: err.message,
      code: err.code,
      details: err.details,
      hint: err.hint,
      stack: err.stack,
      payloadSize: JSON.stringify(errorPayload).length,
      overlaysCount: overlaysToSave.length,
      payloadKeys: Object.keys(payload),
      samplePayload: payload.overlays ? payload.overlays[0] : null,
    });
    window.postMessage(
      {
        type: "saveFailed",
        message: err.message || "Unknown error occurred",
        error: err,
      },
      "*",
    );
  }
}

async function handleConfirmAllergens({
  message,
  state,
  normalizeRestaurant,
  insertChangeLogEntry,
}) {
  try {
    const client = window.supabaseClient;
    if (!client) throw new Error("Supabase client not ready.");
    const restaurantId = toRestaurantId(state.restaurant);
    if (!restaurantId) throw new Error("Restaurant not loaded yet.");
    const timestamp = message.timestamp || new Date().toISOString();

    const { data: updated, error } = await client
      .from("restaurants")
      .update({ last_confirmed: timestamp })
      .eq("id", restaurantId)
      .select()
      .single();
    if (error) throw error;

    try {
      const userName = toAuthorName(state);
      const confirmPayload = {
        author: userName,
        general: ["Information confirmed to be up-to-date"],
        items: {},
      };
      await insertChangeLogEntry({
        restaurantId,
        timestamp,
        type: "confirm",
        description: userName,
        changes: JSON.stringify(confirmPayload),
        userEmail: state.user?.email || null,
        photos: message.photos || (message.photo ? [message.photo] : []),
      });
    } catch (logError) {
      console.error("Change log insert failed", logError);
    }

    window.postMessage(
      {
        type: "confirmationSaved",
        restaurant: normalizeRestaurant(updated),
        timestamp,
      },
      "*",
    );
  } catch (err) {
    console.error("Confirmation failed", err);
    window.postMessage(
      { type: "confirmationFailed", message: err.message },
      "*",
    );
  }
}

async function handleGetChangeLog({ message, state, fetchChangeLogEntries }) {
  try {
    const logs = await fetchChangeLogEntries(
      message.restaurantId || toRestaurantId(state.restaurant),
    );
    window.postMessage({ type: "changeLog", logs: logs || [] }, "*");
  } catch (err) {
    console.error("Loading change log failed", err);
    window.postMessage(
      { type: "changeLog", logs: [], error: err.message },
      "*",
    );
  }
}

export function createStandaloneMessageDispatcher(options = {}) {
  const {
    state,
    normalizeRestaurant,
    insertChangeLogEntry,
    fetchChangeLogEntries,
  } = options;

  return function dispatchStandaloneMessage(message = {}) {
    if (!message || typeof message !== "object") return false;
    if (navigateLegacy(message)) return true;

    if (message.type === "saveOverlays") {
      void handleSaveOverlays({
        message,
        state,
        normalizeRestaurant,
        insertChangeLogEntry,
      });
      return true;
    }

    if (message.type === "confirmAllergens") {
      void handleConfirmAllergens({
        message,
        state,
        normalizeRestaurant,
        insertChangeLogEntry,
      });
      return true;
    }

    if (message.type === "getChangeLog") {
      void handleGetChangeLog({ message, state, fetchChangeLogEntries });
      return true;
    }

    return false;
  };
}
