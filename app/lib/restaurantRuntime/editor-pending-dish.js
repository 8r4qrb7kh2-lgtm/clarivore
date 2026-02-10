export function openPendingDishInEditor(options = {}) {
  const { overlays = [], openItemEditor } = options;

  if (!window.__pendingDishToOpen || typeof openItemEditor !== "function") {
    return;
  }

  const pendingDish = window.__pendingDishToOpen;
  window.__pendingDishToOpen = null;

  setTimeout(() => {
    const matchIndex = overlays.findIndex((item) => {
      const itemId = (item.id || "").toLowerCase().trim();
      const searchName = (pendingDish.dishName || "").toLowerCase().trim();

      if (searchName && itemId === searchName) return true;

      if (
        pendingDish.dishId &&
        item.wpPostId &&
        item.wpPostId.toString() === pendingDish.dishId.toString()
      ) {
        return true;
      }

      if (searchName && (itemId.includes(searchName) || searchName.includes(itemId))) {
        return true;
      }

      const normalizedItem = itemId.replace(/[^a-z0-9]/g, "");
      const normalizedSearch = searchName.replace(/[^a-z0-9]/g, "");
      return (
        normalizedItem &&
        normalizedSearch &&
        normalizedItem === normalizedSearch
      );
    });

    if (matchIndex === -1) return;

    openItemEditor(overlays[matchIndex], matchIndex);

    if (pendingDish.openAI) {
      setTimeout(() => {
        const aiBtn = document.getElementById("aiAssistBtn");
        if (!aiBtn) return;
        if (pendingDish.ingredientName) {
          window.__pendingIngredientToScroll = pendingDish.ingredientName;
        }
        aiBtn.click();
      }, 500);
    }
  }, 500);
}
