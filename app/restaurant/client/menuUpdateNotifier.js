import {
  compareDishSets,
  dataUrlFromImageSource,
  detectMenuDishes,
  sendMenuUpdateNotification,
} from "../features/editor/editorServices";

function getRestaurantMenuImage(restaurant) {
  return restaurant?.menu_image || restaurant?.menuImage || "";
}

// When menu artwork changes, run OCR dish detection and send notifications for added/removed dishes.
export async function notifyMenuUpdateIfNeeded({
  restaurant,
  fallbackSlug,
  menuImage,
  overlays,
}) {
  const existingMenuImage = getRestaurantMenuImage(restaurant);
  const menuImageChanged = Boolean(menuImage && menuImage !== existingMenuImage);
  if (!menuImageChanged) return;

  try {
    const imageData = await dataUrlFromImageSource(menuImage);
    const detection = await detectMenuDishes({ imageData });
    if (!detection?.success) return;

    const existingDishNames = (Array.isArray(overlays) ? overlays : []).map(
      (overlay) => overlay?.id || overlay?.name || "",
    );
    const diff = compareDishSets({
      detectedDishes: detection.dishes,
      existingDishNames,
    });

    // Only send a message when menu composition actually changed.
    if (!diff.addedItems.length && !diff.removedItems.length) return;

    await sendMenuUpdateNotification({
      restaurantName: restaurant?.name || "Restaurant",
      restaurantSlug: restaurant?.slug || fallbackSlug,
      addedItems: diff.addedItems,
      removedItems: diff.removedItems,
      keptItems: diff.keptItems,
    });
  } catch (error) {
    // Notification failures should not block saving.
    console.error("[restaurant] menu-update notification failed", error);
  }
}
