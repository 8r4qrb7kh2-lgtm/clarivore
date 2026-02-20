const scriptPromises = new Map();
const DEFAULT_SCRIPT_TIMEOUT_MS = 15_000;

function removeScriptNode(node) {
  if (node?.parentNode) {
    node.parentNode.removeChild(node);
  }
}

export function loadScript(src, options = {}) {
  if (!src) {
    return Promise.reject(new Error("Missing script source."));
  }

  if (typeof document === "undefined") {
    return Promise.reject(
      new Error("Script loading is only available in the browser."),
    );
  }

  if (scriptPromises.has(src)) {
    return scriptPromises.get(src);
  }

  const existing = document.querySelector(
    `script[data-next-runtime="1"][src="${src}"]`,
  );
  if (existing?.dataset?.loaded === "1") {
    return Promise.resolve(existing);
  }
  if (existing) {
    // Remove stale runtime script nodes so retries don't wait on events that already fired.
    removeScriptNode(existing);
  }

  const timeoutMs =
    Number.isFinite(Number(options?.timeoutMs)) && Number(options.timeoutMs) > 0
      ? Math.max(Math.floor(Number(options.timeoutMs)), 1_000)
      : DEFAULT_SCRIPT_TIMEOUT_MS;

  const scriptPromise = new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = null;
    const node = document.createElement("script");

    const fail = (message) => {
      if (settled) return;
      settled = true;
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      scriptPromises.delete(src);
      node.dataset.failed = "1";
      removeScriptNode(node);
      reject(new Error(message));
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      node.dataset.loaded = "1";
      node.dataset.failed = "0";
      resolve(node);
    };

    node.src = src;
    if (options.type) node.type = options.type;
    if (options.defer) node.defer = true;
    node.async = Boolean(options.async);
    node.dataset.nextRuntime = "1";
    node.onload = succeed;
    node.onerror = () => fail(`Failed to load script: ${src}`);
    timeoutId = window.setTimeout(
      () => fail(`Timed out loading script: ${src}`),
      timeoutMs,
    );
    document.body.appendChild(node);
  });

  scriptPromises.set(src, scriptPromise);
  return scriptPromise;
}
