const bridgeState = {
  showOverlayDetails: null,
  rerenderLayer: null,
  renderMobileInfo: null,
  currentMobileInfoItem: null,
  lastSelectedOverlay: null,
  openBrandVerification: null,
  displayChangeLog: null,
  startInEditor: false,
  pendingDishToOpen: null,
  pendingIngredientToScroll: null,
  openLogOnLoad: false,
  openConfirmOnLoad: false,
};

const windowKeys = {
  showOverlayDetails: "showOverlayDetails",
  rerenderLayer: "__rerenderLayer__",
  renderMobileInfo: "renderMobileInfo",
  currentMobileInfoItem: "currentMobileInfoItem",
  lastSelectedOverlay: "__lastSelectedOverlay",
  openBrandVerification: "openBrandVerification",
  displayChangeLog: "displayChangeLog",
  startInEditor: "__startInEditor",
  pendingDishToOpen: "__pendingDishToOpen",
  pendingIngredientToScroll: "__pendingIngredientToScroll",
  openLogOnLoad: "__openLogOnLoad",
  openConfirmOnLoad: "__openConfirmOnLoad",
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
