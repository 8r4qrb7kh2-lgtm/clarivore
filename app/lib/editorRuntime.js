import { createEditorRenderer } from "./restaurantRuntime/editor-screen.js";

export function createEditorRuntime(options = {}) {
  const onEditorSaveApi =
    typeof options.onEditorSaveApi === "function" ? options.onEditorSaveApi : () => {};
  const onCollectAllBrandItems =
    typeof options.onCollectAllBrandItems === "function"
      ? options.onCollectAllBrandItems
      : () => {};
  const onOpenBrandVerification =
    typeof options.onOpenBrandVerification === "function"
      ? options.onOpenBrandVerification
      : () => {};
  const onOpenChangeLog =
    typeof options.onOpenChangeLog === "function" ? options.onOpenChangeLog : () => {};
  const onUpdateLastConfirmedText =
    typeof options.onUpdateLastConfirmedText === "function"
      ? options.onUpdateLastConfirmedText
      : () => {};
  const renderApp = typeof options.renderApp === "function" ? options.renderApp : () => {};

  const renderEditor = createEditorRenderer({
    ...options,
    setEditorSaveApi: (api) => {
      onEditorSaveApi(api);
    },
    setCollectAllBrandItems: (collector) => {
      onCollectAllBrandItems(collector);
    },
    setOpenBrandVerification: (openFn) => {
      onOpenBrandVerification(openFn);
    },
    setOpenChangeLog: (openFn) => {
      onOpenChangeLog(openFn);
    },
    setUpdateLastConfirmedText: (updater) => {
      onUpdateLastConfirmedText(updater);
    },
    renderApp: () => {
      renderApp();
    },
  });

  return { renderEditor };
}
