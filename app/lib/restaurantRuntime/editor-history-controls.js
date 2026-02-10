const editorHistoryControlsState = {
  undo: null,
  redo: null,
  keyHandlerBound: false,
};

function getControlState() {
  return editorHistoryControlsState;
}

export function bindEditorHistoryControls(options = {}) {
  const { undo = () => {}, redo = () => {} } = options;

  const state = getControlState();
  state.undo = undo;
  state.redo = redo;

  const undoBtn = document.getElementById("undoBtn");
  if (undoBtn) {
    undoBtn.onclick = () => state.undo();
  }

  const redoBtn = document.getElementById("redoBtn");
  if (redoBtn) {
    redoBtn.onclick = () => state.redo();
  }

  if (!state.keyHandlerBound) {
    state.keyHandlerBound = true;
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        state.undo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "y" || (e.key === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        state.redo();
      }
    });
  }
}
