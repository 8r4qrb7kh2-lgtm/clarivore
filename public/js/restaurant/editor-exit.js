function resetEditorRouteFlags() {
  window.__editorOriginalMenuImages = null;
  window.__editorOverridePendingChanges = null;
  window.__editorOverrideCurrentPage = null;
  window.__editorAutoOpenMenuUpload = false;
}

function replaceButtonHandler(id, handler) {
  const oldBtn = document.getElementById(id);
  if (!oldBtn || !oldBtn.parentNode) return;
  const newBtn = oldBtn.cloneNode(true);
  oldBtn.parentNode.replaceChild(newBtn, oldBtn);
  newBtn.onclick = handler;
}

export function bindEditorBackButton(options = {}) {
  const {
    backButtonId = "backBtn",
    warningId = "editorUnsavedWarning",
    getDirty,
    setSaveState,
    getPendingChanges,
    getOverlays,
    getMenuImages,
    menuImage,
    describeOverlayChanges,
    formatChangesForLog,
    getOriginalOverlaysRef,
    send,
    exitToRestaurant,
  } = options;

  const backBtn = document.getElementById(backButtonId);
  if (!backBtn) return;

  backBtn.onclick = () => {
    if (!getDirty()) {
      resetEditorRouteFlags();
      exitToRestaurant();
      return;
    }

    const warningEl = document.getElementById(warningId);
    if (!warningEl) return;

    warningEl.style.display = "block";
    warningEl.scrollIntoView({ behavior: "smooth", block: "start" });

    const handleSaveAndExit = () => {
      warningEl.style.display = "none";
      setSaveState("saving");

      const uiChanges = [...(getPendingChanges() || [])];
      const comparisonChanges = describeOverlayChanges(
        JSON.parse(getOriginalOverlaysRef() || "[]"),
        getOverlays() || [],
      );

      const allChanges = [...uiChanges];
      comparisonChanges.forEach((change) => {
        const changeText =
          typeof change === "object" && change.text ? change.text : String(change);
        if (!uiChanges.includes(changeText)) {
          allChanges.push(change);
        }
      });

      if (allChanges.length) {
        const formattedChanges = formatChangesForLog(allChanges);
        const menuImages = getMenuImages() || [];
        send({
          type: "saveOverlays",
          overlays: getOverlays() || [],
          menuImages,
          menuImage: menuImages[0] || menuImage || "",
          changes: formattedChanges,
        });
        return;
      }

      setSaveState("saved");
    };

    const handleExitWithoutSaving = () => {
      warningEl.style.display = "none";
      resetEditorRouteFlags();
      exitToRestaurant();
    };

    const handleCancelExit = () => {
      warningEl.style.display = "none";
    };

    replaceButtonHandler("editorSaveAndExitBtn", handleSaveAndExit);
    replaceButtonHandler("editorExitWithoutSavingBtn", handleExitWithoutSaving);
    replaceButtonHandler("editorCancelExitBtn", handleCancelExit);
  };
}
