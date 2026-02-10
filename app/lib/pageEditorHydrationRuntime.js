import { createEditorRuntime } from "./editorRuntime.js";
import { createPageRouterRuntime } from "./pageRouterRuntime.js";
import { createUnsavedGuardRuntime } from "./unsavedGuardRuntime.js";
import { createHydrationRuntime } from "./hydrationRuntime.js";

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
