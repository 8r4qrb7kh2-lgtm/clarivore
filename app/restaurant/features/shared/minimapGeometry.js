function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getPageMetrics(scrollNode, pageNode) {
  if (!scrollNode || !pageNode) return null;

  const viewportTop = Math.max(Number(scrollNode.scrollTop) || 0, 0);
  const viewportHeight = Math.max(Number(scrollNode.clientHeight) || 0, 1);
  const pageTop = Math.max(Number(pageNode.offsetTop) || 0, 0);
  const pageHeight = Math.max(Number(pageNode.offsetHeight) || 0, 1);

  return {
    viewportTop,
    viewportHeight,
    pageTop,
    pageHeight,
  };
}

export function computeVisibleSliceForPage(scrollNode, pageNode) {
  const metrics = getPageMetrics(scrollNode, pageNode);
  if (!metrics) return null;

  const viewportBottom = metrics.viewportTop + metrics.viewportHeight;
  const pageBottom = metrics.pageTop + metrics.pageHeight;

  const visibleTop = clamp(
    Math.max(metrics.viewportTop, metrics.pageTop) - metrics.pageTop,
    0,
    metrics.pageHeight,
  );
  const visibleBottom = clamp(
    Math.min(viewportBottom, pageBottom) - metrics.pageTop,
    0,
    metrics.pageHeight,
  );
  const visibleHeight = Math.max(visibleBottom - visibleTop, 0);

  return {
    offsetTop: visibleTop,
    visibleHeight,
    pageHeight: metrics.pageHeight,
  };
}

export function resolveMostVisiblePageIndex(scrollNode, pageNodes, fallbackIndex = 0) {
  const nodes = Array.isArray(pageNodes) ? pageNodes : [];
  if (!scrollNode || !nodes.length) return Math.max(Number(fallbackIndex) || 0, 0);

  const topScroll = Math.max(Number(scrollNode.scrollTop) || 0, 0);
  if (topScroll <= 2 && nodes[0]) {
    return 0;
  }

  let bestIndex = clamp(Number(fallbackIndex) || 0, 0, Math.max(nodes.length - 1, 0));
  let bestVisibleHeight = -1;

  if (typeof scrollNode.getBoundingClientRect === "function") {
    const viewportHeight = Math.max(Number(scrollNode.clientHeight) || 0, 0);
    const scrollRect = scrollNode.getBoundingClientRect();
    const viewportMidpoint = scrollRect.top + viewportHeight / 2;

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (!node || typeof node.getBoundingClientRect !== "function") continue;
      const rect = node.getBoundingClientRect();
      const rectHeight = Math.max(Number(rect.height) || 0, 0);
      if (rectHeight <= 0) continue;
      if (viewportMidpoint >= rect.top && viewportMidpoint < rect.bottom) {
        return index;
      }
    }
  }

  nodes.forEach((node, index) => {
    if (!node) return;
    const slice = computeVisibleSliceForPage(scrollNode, node);
    const visibleHeight = slice?.visibleHeight || 0;
    if (visibleHeight > bestVisibleHeight) {
      bestVisibleHeight = visibleHeight;
      bestIndex = index;
    }
  });

  if (bestVisibleHeight > 0) {
    return bestIndex;
  }

  const marker = (Number(scrollNode.scrollTop) || 0) + 1;
  nodes.forEach((node, index) => {
    if (!node) return;
    const pageTop = Number(node.offsetTop) || 0;
    const pageBottom = pageTop + Math.max(Number(node.offsetHeight) || 0, 1);
    if (marker >= pageTop && marker < pageBottom) {
      bestIndex = index;
    }
  });

  return bestIndex;
}

export function buildMinimapViewport(scrollNode, pageNode) {
  const slice = computeVisibleSliceForPage(scrollNode, pageNode);
  if (!slice) {
    return { topRatio: 0, heightRatio: 0.2 };
  }

  const pageHeight = Math.max(slice.pageHeight, 1);
  const topRatio = clamp(slice.offsetTop / pageHeight, 0, 1);
  const heightRatio = clamp(slice.visibleHeight / pageHeight, 0.03, 1);

  return {
    topRatio: clamp(topRatio, 0, Math.max(1 - heightRatio, 0)),
    heightRatio,
  };
}

export function computeMinimapJumpTarget(scrollNode, pageNode, clickRatio) {
  const metrics = getPageMetrics(scrollNode, pageNode);
  if (!metrics) return 0;

  const ratio = clamp(Number(clickRatio) || 0, 0, 1);
  const maxScroll = Math.max((Number(scrollNode.scrollHeight) || 0) - metrics.viewportHeight, 0);
  const targetWithinPage = ratio * metrics.pageHeight - metrics.viewportHeight / 2;
  const target = metrics.pageTop + targetWithinPage;

  return clamp(target, 0, maxScroll);
}

export default {
  computeVisibleSliceForPage,
  resolveMostVisiblePageIndex,
  buildMinimapViewport,
  computeMinimapJumpTarget,
};
