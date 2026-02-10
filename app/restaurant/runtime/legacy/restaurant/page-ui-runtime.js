import { initFeedbackModals } from "./feedback-modals.js";
import { initRestaurantTopbar } from "../../../../lib/restaurantTopbarRuntime.js";
import { createOverlayUiRuntime } from "./overlay-ui-runtime.js";
import { createRestaurantViewRuntime } from "./restaurant-view-runtime.js";

const noop = () => {};

export function createPageUiRuntime({
  state,
  slug,
  urlQR,
  setupTopbar,
  hasUnsavedChanges,
  showUnsavedChangesModal,
  clearEditorDirty,
  updateRootOffset,
  configureModalClose,
  getIssueReportMeta,
  supabaseKey,
  overlayOptions,
  restaurantViewOptions,
}) {
  const feedbackModalsApi = initFeedbackModals({
    configureModalClose,
    state,
    getIssueReportMeta,
    SUPABASE_KEY: supabaseKey || "",
  });

  const openFeedbackModal = feedbackModalsApi.openFeedbackModal || noop;
  const openReportIssueModal = feedbackModalsApi.openReportIssueModal || noop;

  const { renderTopbar } = initRestaurantTopbar({
    state,
    urlQR,
    slug,
    setupTopbar,
    hasUnsavedChanges,
    showUnsavedChangesModal,
    clearEditorDirty,
    updateRootOffset,
  });

  const overlayUiRuntime = createOverlayUiRuntime(overlayOptions);

  const restaurantViewRuntime = createRestaurantViewRuntime({
    ...restaurantViewOptions,
    renderTopbar,
    pageTip: overlayUiRuntime.pageTip,
    getTipPinned: overlayUiRuntime.getTipPinned,
    getPinnedOverlayItem: overlayUiRuntime.getPinnedOverlayItem,
    openFeedbackModal,
    openReportIssueModal,
  });

  return {
    renderTopbar,
    openFeedbackModal,
    openReportIssueModal,
    overlayUiRuntime,
    restaurantViewRuntime,
  };
}
