const scriptPromises = new Map();

export function loadScript(src, options = {}) {
  if (scriptPromises.has(src)) {
    return scriptPromises.get(src);
  }

  const existing = document.querySelector(
    `script[data-restaurant-script="1"][data-restaurant-src="${src}"]`,
  );

  if (existing) {
    const existingPromise = new Promise((resolve, reject) => {
      if (existing.dataset.restaurantLoaded === "1") {
        resolve(existing);
        return;
      }
      existing.addEventListener("load", () => resolve(existing), { once: true });
      existing.addEventListener("error", () => {
        scriptPromises.delete(src);
        reject(new Error(`Failed to load script: ${src}`));
      }, { once: true });
    });
    scriptPromises.set(src, existingPromise);
    return existingPromise;
  }

  const scriptPromise = new Promise((resolve, reject) => {
    const node = document.createElement("script");
    node.src = src;
    if (options.type) node.type = options.type;
    if (options.defer) node.defer = true;
    node.async = Boolean(options.async);
    node.dataset.restaurantScript = "1";
    node.dataset.restaurantSrc = src;
    node.onload = () => {
      node.dataset.restaurantLoaded = "1";
      resolve(node);
    };
    node.onerror = () => {
      scriptPromises.delete(src);
      reject(new Error(`Failed to load script: ${src}`));
    };
    document.body.appendChild(node);
  });

  scriptPromises.set(src, scriptPromise);
  return scriptPromise;
}

export async function loadRestaurantDependencies() {
  const loaded = [];
  loaded.push(await loadScript("https://unpkg.com/@zxing/library@latest", { defer: true }));
  loaded.push(await loadScript("https://docs.opencv.org/4.5.2/opencv.js", { defer: true }));
  loaded.push(await loadScript("/js/allergen-diet-config.js", { defer: true }));
  return loaded;
}

let runtimeModulePromise = null;

export async function loadRestaurantRuntimeModule() {
  if (!runtimeModulePromise) {
    runtimeModulePromise = import(
      /* webpackIgnore: true */
      "/js/restaurant-page.js"
    );
  }
  return runtimeModulePromise;
}
