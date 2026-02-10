import { initDishEditor } from "./dish-editor.js";

export function createDishEditorRuntime(options = {}) {
  const current = options.current || {};
  const { current: _ignored, ...initOptions } = options;
  const api = initDishEditor(initOptions);

  return {
    openBrandIdentificationChoice:
      api.openBrandIdentificationChoice || current.openBrandIdentificationChoice,
    showIngredientPhotoUploadModal:
      api.showIngredientPhotoUploadModal || current.showIngredientPhotoUploadModal,
    showPhotoAnalysisLoadingInRow:
      api.showPhotoAnalysisLoadingInRow || current.showPhotoAnalysisLoadingInRow,
    hidePhotoAnalysisLoadingInRow:
      api.hidePhotoAnalysisLoadingInRow || current.hidePhotoAnalysisLoadingInRow,
    updatePhotoAnalysisLoadingStatus:
      api.updatePhotoAnalysisLoadingStatus ||
      current.updatePhotoAnalysisLoadingStatus,
    showPhotoAnalysisResultButton:
      api.showPhotoAnalysisResultButton || current.showPhotoAnalysisResultButton,
    aiAssistState: api.aiAssistState ?? current.aiAssistState ?? null,
    aiAssistSetStatus: api.aiAssistSetStatus || current.aiAssistSetStatus,
    ensureAiAssistElements:
      api.ensureAiAssistElements || current.ensureAiAssistElements,
    collectAiTableData: api.collectAiTableData || current.collectAiTableData,
    renderAiTable: api.renderAiTable || current.renderAiTable,
    openDishEditor: api.openDishEditor || current.openDishEditor,
    openImageModal: api.openImageModal || current.openImageModal,
    closeImageModal: api.closeImageModal || current.closeImageModal,
    handleDishEditorResult:
      api.handleDishEditorResult || current.handleDishEditorResult,
    handleDishEditorError:
      api.handleDishEditorError || current.handleDishEditorError,
    rebuildBrandMemoryFromRestaurant:
      api.rebuildBrandMemoryFromRestaurant ||
      current.rebuildBrandMemoryFromRestaurant,
    getAiAssistBackdrop: api.getAiAssistBackdrop || current.getAiAssistBackdrop,
    getAiAssistTableBody: api.getAiAssistTableBody || current.getAiAssistTableBody,
  };
}
