export function normalizeOverlayCoords(overlays) {
  return (overlays || []).map((overlay) => {
    const item = { ...overlay };

    const num = (value) => {
      const parsed = typeof value === "string" ? parseFloat(value) : value;
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const coords = ["x", "y", "w", "h"].map((key) => num(item[key]));
    const maxCoord = Math.max(...coords, 0);
    const looksLikeThousandScale = maxCoord > 150 && maxCoord <= 1200;

    if (looksLikeThousandScale) {
      ["x", "y", "w", "h"].forEach((key) => {
        const value = num(item[key]);
        item[key] = value / 10;
      });
    }

    const x = Math.max(0, Math.min(100, num(item.x)));
    const y = Math.max(0, Math.min(100, num(item.y)));
    const w = Math.max(0.5, Math.min(100 - x, num(item.w)));
    const h = Math.max(0.5, Math.min(100 - y, num(item.h)));

    item.x = x;
    item.y = y;
    item.w = w;
    item.h = h;

    const pageIndex = Number.isFinite(num(item.pageIndex)) ? num(item.pageIndex) : 0;
    item.pageIndex = Math.floor(pageIndex);

    return item;
  });
}

export function normalizeRestaurantRow(row, deps = {}) {
  if (!row) return null;

  const normalizeAllergen =
    typeof deps.normalizeAllergen === "function"
      ? deps.normalizeAllergen
      : (value) => String(value ?? "").trim();
  const normalizeDietLabel =
    typeof deps.normalizeDietLabel === "function"
      ? deps.normalizeDietLabel
      : (value) => String(value ?? "").trim();

  const id = row._id ?? row.id;
  const menuImage = row.menuImage ?? row.menu_image;
  const menuImages = row.menuImages ?? row.menu_images;
  const menuImagesArray = menuImages
    ? Array.isArray(menuImages)
      ? menuImages
      : [menuImages]
    : menuImage
      ? [menuImage]
      : [];
  const lastConfirmed = row.lastConfirmed ?? row.last_confirmed;

  const overlays = normalizeOverlayCoords(
    Array.isArray(row.overlays) ? row.overlays : [],
  ).map((overlay) => {
    const normalizeAllergenList = (list) =>
      Array.isArray(list) ? list.map(normalizeAllergen).filter(Boolean) : [];
    const normalizeDietList = (list) =>
      Array.isArray(list) ? list.map(normalizeDietLabel).filter(Boolean) : [];
    const normalized = { ...overlay };

    normalized.allergens = normalizeAllergenList(overlay.allergens);
    normalized.diets = normalizeDietList(overlay.diets);
    normalized.crossContamination = normalizeAllergenList(
      overlay.crossContamination,
    );
    normalized.crossContaminationDiets = normalizeDietList(
      overlay.crossContaminationDiets,
    );
    normalized.removable = Array.isArray(overlay.removable)
      ? overlay.removable
          .map((value) => ({
            ...value,
            allergen: normalizeAllergen(value.allergen),
          }))
          .filter((value) => value.allergen)
      : [];

    if (Array.isArray(overlay.ingredients)) {
      normalized.ingredients = overlay.ingredients.map((ingredient) => ({
        ...ingredient,
        allergens: normalizeAllergenList(ingredient.allergens),
        diets: normalizeDietList(ingredient.diets),
        crossContamination: normalizeAllergenList(ingredient.crossContamination),
        crossContaminationDiets: normalizeDietList(
          ingredient.crossContaminationDiets,
        ),
      }));
    }

    return normalized;
  });

  return {
    _id: id,
    name: row.name,
    slug: row.slug,
    menuImage: menuImagesArray[0] || menuImage || "",
    menuImages: menuImagesArray,
    lastConfirmed,
    overlays,
    website: row.website || null,
    phone: row.phone || null,
    delivery_url: row.delivery_url || null,
  };
}
