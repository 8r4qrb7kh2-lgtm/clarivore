import { createPageUiRuntime } from "../../lib/pageUiRuntime.js";
import { createPageUiOptions } from "../../lib/pageUiOptionsRuntime.js";

export function createRestaurantPageUiBundle(options = {}) {
  const pageUiRuntime = createPageUiRuntime(createPageUiOptions(options));
  return {
    pageUiRuntime,
    renderTopbar: pageUiRuntime.renderTopbar,
    overlayUiRuntime: pageUiRuntime.overlayUiRuntime,
    restaurantViewRuntime: pageUiRuntime.restaurantViewRuntime,
  };
}
