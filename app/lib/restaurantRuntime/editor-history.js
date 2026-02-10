export function initEditorHistory(deps = {}) {
  const overlays = Array.isArray(deps.overlays) ? deps.overlays : [];
  const pendingChanges = Array.isArray(deps.pendingChanges)
    ? deps.pendingChanges
    : [];
  const setDirty = typeof deps.setDirty === "function" ? deps.setDirty : () => {};
  const getDrawAll =
    typeof deps.getDrawAll === "function"
      ? deps.getDrawAll
      : () => deps.drawAll;

  const clone = (value) => JSON.parse(JSON.stringify(value));

  let history = [
    {
      overlays: clone(overlays),
      pendingChanges: [],
      timestamp: Date.now(),
    },
  ];
  let historyIndex = 0;

  function updateUndoRedoButtons() {
    const undoBtn = document.getElementById("undoBtn");
    const redoBtn = document.getElementById("redoBtn");
    if (undoBtn) {
      undoBtn.disabled = historyIndex <= 0;
      undoBtn.style.opacity = historyIndex <= 0 ? "0.5" : "1";
    }
    if (redoBtn) {
      redoBtn.disabled = historyIndex >= history.length - 1;
      redoBtn.style.opacity = historyIndex >= history.length - 1 ? "0.5" : "1";
    }
  }

  function pushHistory() {
    // Remove any future history if we've undone and then made a new change
    if (historyIndex < history.length - 1) {
      history = history.slice(0, historyIndex + 1);
    }
    // Add new history entry
    history.push({
      overlays: clone(overlays),
      pendingChanges: [...pendingChanges],
      timestamp: Date.now(),
    });
    historyIndex = history.length - 1;
    // Limit history to 50 entries
    if (history.length > 50) {
      history.shift();
      historyIndex--;
    }
    updateUndoRedoButtons();
  }

  function applySnapshot(snapshot) {
    overlays.splice(0, overlays.length, ...clone(snapshot.overlays));
    pendingChanges.splice(
      0,
      pendingChanges.length,
      ...snapshot.pendingChanges,
    );
    const drawAll = getDrawAll();
    if (typeof drawAll === "function") {
      drawAll();
    }
    setDirty(true);
    updateUndoRedoButtons();
  }

  function undo() {
    if (historyIndex > 0) {
      historyIndex--;
      applySnapshot(history[historyIndex]);
    }
  }

  function redo() {
    if (historyIndex < history.length - 1) {
      historyIndex++;
      applySnapshot(history[historyIndex]);
    }
  }

  return {
    pushHistory,
    undo,
    redo,
    updateUndoRedoButtons,
    getHistoryIndex: () => historyIndex,
  };
}
