import { createEditorRuntime } from "./editor-runtime.js";
import { createPageRouterRuntime } from "./page-router-runtime.js";
import { createUnsavedGuardRuntime } from "./unsaved-guard-runtime.js";
import { createHydrationRuntime } from "./hydration-runtime.js";

export function createPageEditorHydrationRuntime({
  editorOptions,
  pageRouterOptions,
  unsavedGuardOptions,
  hydrationOptions,
}) {
  const editorRuntime = createEditorRuntime(editorOptions);
  const pageRouterRuntime = createPageRouterRuntime({
    ...pageRouterOptions,
    renderEditor: editorRuntime.renderEditor,
  });
  const unsavedGuardRuntime = createUnsavedGuardRuntime(unsavedGuardOptions);
  const hydrationRuntime = createHydrationRuntime({
    ...hydrationOptions,
    render: pageRouterRuntime.render,
  });

  hydrationRuntime.bindWindowPayloadListener();

  return {
    editorRuntime,
    pageRouterRuntime,
    unsavedGuardRuntime,
    hydrationRuntime,
  };
}
