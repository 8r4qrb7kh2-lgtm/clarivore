import { loadScript } from "../../runtime/scriptLoader";
import { ensureAllergenDietConfigGlobals } from "../../lib/allergenConfigRuntime";
import { getSupabaseClient } from "../../lib/restaurantRuntime/runtimeSessionState.js";

export { loadScript };

export async function loadRestaurantDependencies() {
  const loaded = [];
  loaded.push(await loadScript("https://unpkg.com/@zxing/library@latest", { defer: true }));
  loaded.push(await loadScript("https://docs.opencv.org/4.5.2/opencv.js", { defer: true }));
  loaded.push(await ensureAllergenDietConfigGlobals(getSupabaseClient()));
  return loaded;
}

let runtimeModulePromise = null;

export async function loadRestaurantRuntimeModule() {
  if (!runtimeModulePromise) {
    runtimeModulePromise = import("./restaurantPageRuntime.js");
  }
  return runtimeModulePromise;
}
