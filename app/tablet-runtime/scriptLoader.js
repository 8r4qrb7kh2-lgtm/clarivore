export function loadScript(src, options = {}) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(
      `script[data-next-runtime="1"][src="${src}"]`,
    );
    if (existing) {
      if (existing.dataset.loaded === "1") {
        resolve(existing);
        return;
      }
      existing.addEventListener("load", () => resolve(existing), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error(`Failed to load script: ${src}`)),
        { once: true },
      );
      return;
    }

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
    node.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.body.appendChild(node);
  });
}

export async function loadTabletRuntime({ moduleSrc }) {
  const loaded = [];
  loaded.push(
    await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"),
  );
  loaded.push(await loadScript("/js/auth-redirect.js", { defer: true }));
  loaded.push(await loadScript(moduleSrc, { type: "module" }));
  return loaded;
}

