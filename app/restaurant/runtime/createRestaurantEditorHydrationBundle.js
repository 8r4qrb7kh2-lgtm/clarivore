import { createPageEditorHydrationRuntime } from "../../lib/pageEditorHydrationRuntime.js";
import { createPageEditorHydrationOptions } from "../../lib/pageEditorHydrationOptionsRuntime.js";

export function createRestaurantEditorHydrationBundle(options = {}) {
  return createPageEditorHydrationRuntime(
    createPageEditorHydrationOptions(options),
  );
}
