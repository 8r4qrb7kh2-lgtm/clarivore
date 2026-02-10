const bridgeState = {
  showOverlayDetails: null,
  rerenderLayer: null,
  renderMobileInfo: null,
  currentMobileInfoItem: null,
  lastSelectedOverlay: null,
  openBrandVerification: null,
  setOverlayPulseColor: null,
  displayChangeLog: null,
  collectAllBrandItems: null,
  startInEditor: false,
  enableConsoleReporting: false,
  pendingDishToOpen: null,
  pendingIngredientToScroll: null,
  openLogOnLoad: false,
  openConfirmOnLoad: false,
  editorDirty: false,
  editorOriginalMenuImages: null,
  editorOverrideMenuImages: null,
  editorOverrideOverlays: null,
  editorOverridePendingChanges: null,
  editorOverrideCurrentPage: null,
  editorForceDirty: false,
  editorAutoOpenMenuUpload: false,
  saveReviewControl: null,
  updateOriginalRestaurantSettings: null,
  editorMiniMapResizeHandler: null,
};

const windowKeys = {
  showOverlayDetails: "showOverlayDetails",
  rerenderLayer: "__rerenderLayer__",
  renderMobileInfo: "renderMobileInfo",
  currentMobileInfoItem: "currentMobileInfoItem",
  lastSelectedOverlay: "__lastSelectedOverlay",
  openBrandVerification: "openBrandVerification",
  setOverlayPulseColor: "setOverlayPulseColor",
  displayChangeLog: "displayChangeLog",
  collectAllBrandItems: "collectAllBrandItems",
  startInEditor: "__startInEditor",
  enableConsoleReporting: "__enableConsoleReporting",
  pendingDishToOpen: "__pendingDishToOpen",
  pendingIngredientToScroll: "__pendingIngredientToScroll",
  openLogOnLoad: "__openLogOnLoad",
  openConfirmOnLoad: "__openConfirmOnLoad",
  editorDirty: "editorDirty",
  editorOriginalMenuImages: "__editorOriginalMenuImages",
  editorOverrideMenuImages: "__editorOverrideMenuImages",
  editorOverrideOverlays: "__editorOverrideOverlays",
  editorOverridePendingChanges: "__editorOverridePendingChanges",
  editorOverrideCurrentPage: "__editorOverrideCurrentPage",
  editorForceDirty: "__editorForceDirty",
  editorAutoOpenMenuUpload: "__editorAutoOpenMenuUpload",
  saveReviewControl: "__saveReviewControl",
  updateOriginalRestaurantSettings: "updateOriginalRestaurantSettings",
  editorMiniMapResizeHandler: "__editorMiniMapResizeHandler",
};

function hasWindow() {
  return typeof window !== "undefined";
}

function setBridgeValue(name, value) {
  bridgeState[name] = value;
  if (!hasWindow()) return value;
  const key = windowKeys[name];
  if (!key) return value;
  window[key] = value;
  return value;
}

function getBridgeValue(name) {
  if (!hasWindow()) return bridgeState[name];
  const key = windowKeys[name];
  if (!key) return bridgeState[name];
  const fromWindow = window[key];
  if (typeof fromWindow !== "undefined") {
    bridgeState[name] = fromWindow;
  }
  return bridgeState[name];
}

export function setShowOverlayDetails(fn) {
  return setBridgeValue("showOverlayDetails", typeof fn === "function" ? fn : null);
}

export function getShowOverlayDetails() {
  const value = getBridgeValue("showOverlayDetails");
  return typeof value === "function" ? value : null;
}

export function setRerenderLayer(fn) {
  return setBridgeValue("rerenderLayer", typeof fn === "function" ? fn : null);
}

export function getRerenderLayer() {
  const value = getBridgeValue("rerenderLayer");
  return typeof value === "function" ? value : null;
}

export function callRerenderLayer() {
  const rerender = getRerenderLayer();
  if (typeof rerender === "function") rerender();
}

export function setRenderMobileInfo(fn) {
  return setBridgeValue("renderMobileInfo", typeof fn === "function" ? fn : null);
}

export function getRenderMobileInfo() {
  const value = getBridgeValue("renderMobileInfo");
  return typeof value === "function" ? value : null;
}

export function setCurrentMobileInfoItem(item) {
  return setBridgeValue("currentMobileInfoItem", item || null);
}

export function getCurrentMobileInfoItem() {
  return getBridgeValue("currentMobileInfoItem");
}

export function setLastSelectedOverlay(value) {
  return setBridgeValue("lastSelectedOverlay", value || null);
}

export function getLastSelectedOverlay() {
  return getBridgeValue("lastSelectedOverlay");
}

export function setOpenBrandVerification(fn) {
  return setBridgeValue(
    "openBrandVerification",
    typeof fn === "function" ? fn : null,
  );
}

export function getOpenBrandVerification() {
  const value = getBridgeValue("openBrandVerification");
  return typeof value === "function" ? value : null;
}

export function setOverlayPulseColorHandler(fn) {
  return setBridgeValue(
    "setOverlayPulseColor",
    typeof fn === "function" ? fn : null,
  );
}

export function getOverlayPulseColorHandler() {
  const value = getBridgeValue("setOverlayPulseColor");
  return typeof value === "function" ? value : null;
}

export function applyOverlayPulseColor(overlay) {
  const handler = getOverlayPulseColorHandler();
  if (typeof handler === "function") {
    handler(overlay);
  }
}

export function setDisplayChangeLog(fn) {
  return setBridgeValue("displayChangeLog", typeof fn === "function" ? fn : null);
}

export function getDisplayChangeLog() {
  const value = getBridgeValue("displayChangeLog");
  return typeof value === "function" ? value : null;
}

export function setStartInEditor(value) {
  return setBridgeValue("startInEditor", value === true);
}

export function getStartInEditor() {
  return getBridgeValue("startInEditor") === true;
}

export function setEnableConsoleReporting(value) {
  return setBridgeValue("enableConsoleReporting", value === true);
}

export function getEnableConsoleReporting() {
  return getBridgeValue("enableConsoleReporting") === true;
}

export function setPendingDishToOpen(value) {
  return setBridgeValue("pendingDishToOpen", value || null);
}

export function getPendingDishToOpen() {
  return getBridgeValue("pendingDishToOpen");
}

export function setPendingIngredientToScroll(value) {
  return setBridgeValue("pendingIngredientToScroll", value || null);
}

export function getPendingIngredientToScroll() {
  return getBridgeValue("pendingIngredientToScroll");
}

export function setOpenLogOnLoad(value) {
  return setBridgeValue("openLogOnLoad", value === true);
}

export function getOpenLogOnLoad() {
  return getBridgeValue("openLogOnLoad") === true;
}

export function setOpenConfirmOnLoad(value) {
  return setBridgeValue("openConfirmOnLoad", value === true);
}

export function getOpenConfirmOnLoad() {
  return getBridgeValue("openConfirmOnLoad") === true;
}

export function setEditorDirty(value) {
  return setBridgeValue("editorDirty", value === true);
}

export function getEditorDirty() {
  return getBridgeValue("editorDirty") === true;
}

export function setEditorOriginalMenuImages(images) {
  return setBridgeValue(
    "editorOriginalMenuImages",
    Array.isArray(images) ? images : null,
  );
}

export function getEditorOriginalMenuImages() {
  const value = getBridgeValue("editorOriginalMenuImages");
  return Array.isArray(value) ? value : null;
}

export function clearEditorOriginalMenuImages() {
  return setEditorOriginalMenuImages(null);
}

export function setEditorOverrideMenuImages(images) {
  return setBridgeValue(
    "editorOverrideMenuImages",
    Array.isArray(images) ? images : null,
  );
}

export function getEditorOverrideMenuImages() {
  const value = getBridgeValue("editorOverrideMenuImages");
  return Array.isArray(value) ? value : null;
}

export function consumeEditorOverrideMenuImages() {
  const value = getEditorOverrideMenuImages();
  setEditorOverrideMenuImages(null);
  return value;
}

export function setEditorOverrideOverlays(overlays) {
  return setBridgeValue("editorOverrideOverlays", Array.isArray(overlays) ? overlays : null);
}

export function getEditorOverrideOverlays() {
  const value = getBridgeValue("editorOverrideOverlays");
  return Array.isArray(value) ? value : null;
}

export function consumeEditorOverrideOverlays() {
  const value = getEditorOverrideOverlays();
  setEditorOverrideOverlays(null);
  return value;
}

export function setEditorOverridePendingChanges(changes) {
  return setBridgeValue(
    "editorOverridePendingChanges",
    Array.isArray(changes) ? changes : null,
  );
}

export function getEditorOverridePendingChanges() {
  const value = getBridgeValue("editorOverridePendingChanges");
  return Array.isArray(value) ? value : null;
}

export function consumeEditorOverridePendingChanges() {
  const value = getEditorOverridePendingChanges();
  setEditorOverridePendingChanges(null);
  return value;
}

export function setEditorOverrideCurrentPage(value) {
  return setBridgeValue(
    "editorOverrideCurrentPage",
    Number.isInteger(value) ? value : null,
  );
}

export function getEditorOverrideCurrentPage() {
  const value = getBridgeValue("editorOverrideCurrentPage");
  return Number.isInteger(value) ? value : null;
}

export function consumeEditorOverrideCurrentPage() {
  const value = getEditorOverrideCurrentPage();
  setEditorOverrideCurrentPage(null);
  return value;
}

export function setEditorForceDirty(value) {
  return setBridgeValue("editorForceDirty", value === true);
}

export function getEditorForceDirty() {
  return getBridgeValue("editorForceDirty") === true;
}

export function consumeEditorForceDirty() {
  const value = getEditorForceDirty();
  setEditorForceDirty(false);
  return value;
}

export function setEditorAutoOpenMenuUpload(value) {
  return setBridgeValue("editorAutoOpenMenuUpload", value === true);
}

export function getEditorAutoOpenMenuUpload() {
  return getBridgeValue("editorAutoOpenMenuUpload") === true;
}

export function consumeEditorAutoOpenMenuUpload() {
  const value = getEditorAutoOpenMenuUpload();
  setEditorAutoOpenMenuUpload(false);
  return value;
}

export function resetEditorRouteFlags() {
  clearEditorOriginalMenuImages();
  setEditorOverridePendingChanges(null);
  setEditorOverrideCurrentPage(null);
  setEditorAutoOpenMenuUpload(false);
}

export function setSaveReviewControl(control) {
  return setBridgeValue(
    "saveReviewControl",
    control && typeof control === "object" ? control : null,
  );
}

export function getSaveReviewControl() {
  const value = getBridgeValue("saveReviewControl");
  return value && typeof value === "object" ? value : null;
}

export function clearSaveReviewControl() {
  return setSaveReviewControl(null);
}

export function setUpdateOriginalRestaurantSettings(fn) {
  return setBridgeValue(
    "updateOriginalRestaurantSettings",
    typeof fn === "function" ? fn : null,
  );
}

export function getUpdateOriginalRestaurantSettings() {
  const value = getBridgeValue("updateOriginalRestaurantSettings");
  return typeof value === "function" ? value : null;
}

export function setEditorMiniMapResizeHandler(fn) {
  return setBridgeValue(
    "editorMiniMapResizeHandler",
    typeof fn === "function" ? fn : null,
  );
}

export function getEditorMiniMapResizeHandler() {
  const value = getBridgeValue("editorMiniMapResizeHandler");
  return typeof value === "function" ? value : null;
}

export function setCollectAllBrandItems(fn) {
  const nextFn = typeof fn === "function" ? fn : null;
  setBridgeValue("collectAllBrandItems", nextFn);
  return nextFn;
}

export function getCollectAllBrandItems() {
  const value = getBridgeValue("collectAllBrandItems");
  if (typeof value === "function") return value;
  return null;
}
