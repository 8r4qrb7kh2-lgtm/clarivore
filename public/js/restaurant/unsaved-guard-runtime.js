import { initUnsavedChangesGuard } from "./unsaved-changes.js";

export function createUnsavedGuardRuntime(deps = {}) {
  const guard = initUnsavedChangesGuard({
    collectAiTableData:
      typeof deps.collectAiTableData === "function" ? deps.collectAiTableData : () => [],
    getAiAssistBackdrop:
      typeof deps.getAiAssistBackdrop === "function" ? deps.getAiAssistBackdrop : () => null,
    getAiAssistState:
      typeof deps.getAiAssistState === "function" ? deps.getAiAssistState : () => null,
    getNameInput:
      typeof deps.getNameInput === "function" ? deps.getNameInput : () => null,
    getEditorDirty:
      typeof deps.getEditorDirty === "function" ? deps.getEditorDirty : () => false,
    onClearDirty:
      typeof deps.onClearDirty === "function" ? deps.onClearDirty : () => {},
  });

  return {
    hasUnsavedChanges: guard.hasUnsavedChanges,
    showUnsavedChangesModal: guard.showUnsavedChangesModal,
    navigateWithCheck: guard.navigateWithCheck,
  };
}
