const scriptPromises = new Map();

export function loadScript(src, options = {}) {
  if (!src) {
    return Promise.reject(new Error("Missing script source."));
  }

  if (scriptPromises.has(src)) {
    return scriptPromises.get(src);
  }

  const existing = document.querySelector(
    `script[data-next-runtime="1"][src="${src}"]`,
  );
  if (existing) {
    const existingPromise = new Promise((resolve, reject) => {
      if (existing.dataset.loaded === "1") {
        resolve(existing);
        return;
      }
      existing.addEventListener("load", () => resolve(existing), { once: true });
      existing.addEventListener(
        "error",
        () => {
          scriptPromises.delete(src);
          reject(new Error(`Failed to load script: ${src}`));
        },
        { once: true },
      );
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
    node.dataset.nextRuntime = "1";
    node.onload = () => {
      node.dataset.loaded = "1";
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

