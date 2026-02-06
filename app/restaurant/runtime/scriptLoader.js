export function loadScript(src, options = {}) {
  return new Promise((resolve, reject) => {
    const node = document.createElement("script");
    node.src = src;
    if (options.type) node.type = options.type;
    if (options.defer) node.defer = true;
    node.async = Boolean(options.async);
    node.dataset.restaurantScript = "1";
    node.onload = () => resolve(node);
    node.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.body.appendChild(node);
  });
}

export async function loadRestaurantDependencies() {
  const loaded = [];
  loaded.push(await loadScript("https://unpkg.com/@zxing/library@latest", { defer: true }));
  loaded.push(await loadScript("https://docs.opencv.org/4.5.2/opencv.js", { defer: true }));
  loaded.push(await loadScript("/js/allergen-diet-config.js", { defer: true }));
  return loaded;
}

export async function loadRestaurantRuntimeModule() {
  return loadScript("/js/restaurant-page.js", { type: "module" });
}
