"use client";

import { useCallback, useEffect, useState } from "react";
import { resolveMostVisiblePageIndex } from "./minimapGeometry";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function useMinimapSync({
  enabled = true,
  menuScrollRef,
  pageRefs,
  pageImageRefs,
  pageCount = 1,
  pageVersionKey,
  initialActivePageIndex = 0,
  onActivePageChange,
}) {
  const [scrollSnapshot, setScrollSnapshot] = useState({
    scrollLeft: 0,
    scrollTop: 0,
    scrollWidth: 1,
    scrollHeight: 1,
    clientWidth: 1,
    clientHeight: 1,
  });
  const [activePageIndex, setActivePageIndex] = useState(() =>
    clamp(Number(initialActivePageIndex) || 0, 0, Math.max(Number(pageCount) - 1, 0)),
  );

  useEffect(() => {
    setActivePageIndex((current) =>
      clamp(
        Number.isFinite(Number(initialActivePageIndex))
          ? Number(initialActivePageIndex)
          : current,
        0,
        Math.max(Number(pageCount) - 1, 0),
      ),
    );
  }, [initialActivePageIndex, pageCount]);

  const refreshScrollSnapshot = useCallback(() => {
    if (!enabled) return;
    const scrollNode = menuScrollRef?.current;
    if (!scrollNode) return;

    const next = {
      scrollLeft: scrollNode.scrollLeft,
      scrollTop: scrollNode.scrollTop,
      scrollWidth: Math.max(scrollNode.scrollWidth, 1),
      scrollHeight: Math.max(scrollNode.scrollHeight, 1),
      clientWidth: Math.max(scrollNode.clientWidth, 1),
      clientHeight: Math.max(scrollNode.clientHeight, 1),
    };

    setScrollSnapshot((current) => {
      if (
        current.scrollLeft === next.scrollLeft &&
        current.scrollTop === next.scrollTop &&
        current.scrollWidth === next.scrollWidth &&
        current.scrollHeight === next.scrollHeight &&
        current.clientWidth === next.clientWidth &&
        current.clientHeight === next.clientHeight
      ) {
        return current;
      }
      return next;
    });

    const safePageCount = Math.max(Number(pageCount) || 0, 1);
    const nodeList = Array.from({ length: safePageCount }, (_, index) =>
      pageRefs?.current?.[index] || pageImageRefs?.current?.[index],
    );

    const resolved = resolveMostVisiblePageIndex(scrollNode, nodeList, activePageIndex);
    setActivePageIndex(resolved);

    if (typeof onActivePageChange === "function") {
      onActivePageChange(resolved);
    }
  }, [
    activePageIndex,
    enabled,
    menuScrollRef,
    onActivePageChange,
    pageCount,
    pageImageRefs,
    pageRefs,
  ]);

  useEffect(() => {
    if (!enabled) return undefined;
    refreshScrollSnapshot();
    const animationFrame = window.requestAnimationFrame(() => {
      refreshScrollSnapshot();
    });
    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [enabled, refreshScrollSnapshot, pageVersionKey, pageCount]);

  useEffect(() => {
    if (!enabled) return undefined;
    const scrollNode = menuScrollRef?.current;
    if (!scrollNode) return undefined;

    let animationFrame = 0;
    const scheduleRefresh = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        refreshScrollSnapshot();
      });
    };

    scheduleRefresh();
    scrollNode.addEventListener("scroll", scheduleRefresh, { passive: true });
    window.addEventListener("resize", scheduleRefresh);

    let resizeObserver = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleRefresh);
      resizeObserver.observe(scrollNode);
      (pageRefs?.current || []).forEach((node) => {
        if (node) resizeObserver.observe(node);
      });
      (pageImageRefs?.current || []).forEach((node) => {
        if (node) resizeObserver.observe(node);
      });
    }

    return () => {
      scrollNode.removeEventListener("scroll", scheduleRefresh);
      window.removeEventListener("resize", scheduleRefresh);
      if (resizeObserver) resizeObserver.disconnect();
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [enabled, menuScrollRef, pageImageRefs, pageRefs, refreshScrollSnapshot, pageVersionKey]);

  useEffect(() => {
    if (!enabled) return undefined;

    let animationFrame = 0;
    const scheduleRefresh = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        refreshScrollSnapshot();
      });
    };

    const imageNodes = (pageImageRefs?.current || []).filter(Boolean);
    imageNodes.forEach((node) => {
      node.addEventListener("load", scheduleRefresh);
      if (node.complete) scheduleRefresh();
    });

    if (!imageNodes.length) {
      scheduleRefresh();
    }

    return () => {
      imageNodes.forEach((node) => {
        node.removeEventListener("load", scheduleRefresh);
      });
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [enabled, pageImageRefs, refreshScrollSnapshot, pageVersionKey]);

  return {
    activePageIndex,
    scrollSnapshot,
    refreshScrollSnapshot,
  };
}

export default useMinimapSync;
