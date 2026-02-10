export function createPageOffsetRuntime() {
  let rootOffsetPadding = "0";

  function updateRootOffset() {
    const root = document.getElementById("root");
    const topbar = document.getElementById("topbarOuter");
    if (!root || !topbar) return;
    if (!document.body.classList.contains("menuScrollLocked")) return;
    const topbarBottom = Math.round(topbar.getBoundingClientRect().bottom);
    root.style.cssText = `position:fixed;top:${topbarBottom}px;left:0;right:0;bottom:0;display:flex;flex-direction:column;overflow:hidden;padding:${rootOffsetPadding};box-sizing:border-box;`;
  }

  function setRootOffsetPadding(padding) {
    rootOffsetPadding = padding;
    updateRootOffset();
  }

  return {
    updateRootOffset,
    setRootOffsetPadding,
  };
}
