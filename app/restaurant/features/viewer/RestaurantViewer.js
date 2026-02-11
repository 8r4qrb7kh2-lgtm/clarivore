"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "../../../components/ui";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseLastConfirmed(value) {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not available";
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

function overlayKey(overlay, index) {
  return `${String(overlay?.id || "dish").replace(/[^a-zA-Z0-9_-]/g, "-")}-${
    overlay?.pageIndex || 0
  }-${index}`;
}

function overlaySignature(overlay) {
  return [
    String(overlay?.id || "").trim(),
    String(Number(overlay?.pageIndex) || 0),
    String(parseOverlayNumber(overlay?.x)),
    String(parseOverlayNumber(overlay?.y)),
    String(parseOverlayNumber(overlay?.w)),
    String(parseOverlayNumber(overlay?.h)),
  ].join("::");
}

function statusBorderColor(status) {
  if (status === "safe") return "#22c55e";
  if (status === "removable") return "#facc15";
  if (status === "unsafe") return "#ef4444";
  return "rgba(255,255,255,0.45)";
}

function statusPulseColor(status) {
  if (status === "safe") return "rgba(34, 197, 94, 0.55)";
  if (status === "removable") return "rgba(250, 204, 21, 0.55)";
  if (status === "unsafe") return "rgba(239, 68, 68, 0.58)";
  return "rgba(255, 255, 255, 0.46)";
}

function includesPreference(values, preference) {
  const target = normalizeToken(preference);
  if (!target) return false;
  return (Array.isArray(values) ? values : []).some(
    (value) => normalizeToken(value) === target,
  );
}

function dedupeByToken(values) {
  const seen = new Set();
  const output = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = String(value || "").trim();
    if (!text) return;
    const token = normalizeToken(text);
    if (!token || seen.has(token)) return;
    seen.add(token);
    output.push(text);
  });
  return output;
}

function normalizeReason(value) {
  return String(value || "")
    .trim()
    .replace(/^contains\s+/i, "")
    .replace(/^due to\s+/i, "");
}

function formatOxfordList(values) {
  const cleaned = dedupeByToken((values || []).map(normalizeReason)).filter(Boolean);
  if (!cleaned.length) return "";
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(", ")}, and ${cleaned[cleaned.length - 1]}`;
}

function buildDueBullet(values, fallback = "due to flagged menu entry") {
  const phrase = formatOxfordList(Array.isArray(values) ? values : []);
  return phrase ? `due to ${phrase}` : fallback;
}

function lookupDetailByKey(dish, key) {
  if (!dish?.details || typeof dish.details !== "object") return "";
  const target = normalizeToken(key);
  if (!target) return "";
  for (const [detailKey, detailValue] of Object.entries(dish.details)) {
    if (String(detailKey || "").startsWith("__")) continue;
    if (normalizeToken(detailKey) === target) {
      return String(detailValue || "").trim();
    }
  }
  return "";
}

function lookupDetailByKeys(dish, keys) {
  for (const key of keys) {
    const detail = lookupDetailByKey(dish, key);
    if (detail) return detail;
  }
  return "";
}

function parseDetailReasons(detail) {
  return dedupeByToken(
    String(detail || "")
      .split(/\n|;|,/)
      .map((part) => normalizeReason(part)),
  );
}

function readIngredientNames(dish, matcher) {
  const ingredients = Array.isArray(dish?.ingredients) ? dish.ingredients : [];
  return dedupeByToken(
    ingredients
      .filter((ingredient) => matcher(ingredient || {}))
      .map((ingredient) => ingredient?.name),
  );
}

function buildAllergenRows(dish, savedAllergens) {
  if (!savedAllergens.length) return [];

  return savedAllergens.map((item) => {
    const contains =
      includesPreference(dish?.allergens, item.key) ||
      includesPreference(dish?.allergens, item.label);
    const detail = contains
      ? lookupDetailByKeys(dish, [item.key, item.label])
      : "";
    const detailReasons = parseDetailReasons(detail);
    const ingredientReasons = contains
      ? readIngredientNames(dish, (ingredient) =>
          includesPreference(ingredient?.allergens, item.key) ||
          includesPreference(ingredient?.allergens, item.label),
        )
      : [];
    const reasonBullet = contains
      ? buildDueBullet(detailReasons.length ? detailReasons : ingredientReasons)
      : "";
    return {
      key: item.key,
      tone: contains ? "bad" : "good",
      title: contains
        ? `${item.emoji || "⚠"} Contains ${item.label}`
        : `${item.emoji || "✓"} This dish is free of ${item.label}`,
      reasonBullet,
    };
  });
}

function buildDietRows(dish, savedDiets) {
  if (!savedDiets.length) return [];

  return savedDiets.map((item) => {
    const compatible =
      includesPreference(dish?.diets, item.key) ||
      includesPreference(dish?.diets, item.label);
    const detail = !compatible
      ? lookupDetailByKeys(dish, [item.key, item.label])
      : "";
    const detailReasons = parseDetailReasons(detail);
    const blockers = Array.isArray(dish?.ingredientsBlockingDiets?.[item.label])
      ? dish.ingredientsBlockingDiets[item.label]
      : Array.isArray(dish?.ingredientsBlockingDiets?.[item.key])
        ? dish.ingredientsBlockingDiets[item.key]
        : [];
    const blockerReasons = blockers.map(
      (entry) => entry?.ingredient || entry?.name || "",
    );
    const reasonBullet = !compatible
      ? buildDueBullet(detailReasons.length ? detailReasons : blockerReasons)
      : "";
    return {
      key: item.key,
      tone: compatible ? "good" : "bad",
      title: compatible
        ? `${item.emoji || "✓"} This dish is ${item.label}`
        : `${item.emoji || "⚠"} This dish is not ${item.label}`,
      reasonBullet,
    };
  });
}

function buildAllergenCrossRows(dish, savedAllergens) {
  const crossAllergens = Array.isArray(dish?.crossContamination)
    ? dish.crossContamination
    : [];

  return savedAllergens
    .filter(
      (item) =>
        includesPreference(crossAllergens, item.key) ||
        includesPreference(crossAllergens, item.label),
    )
    .map((item) => {
      const detail = lookupDetailByKeys(dish, [
        `cross contamination ${item.key}`,
        `cross contamination ${item.label}`,
        `cross ${item.key}`,
        `cross ${item.label}`,
        `crosscontamination ${item.key}`,
        `crosscontamination ${item.label}`,
      ]);
      const detailReasons = parseDetailReasons(detail);
      const ingredientReasons = readIngredientNames(dish, (ingredient) => {
        return (
          includesPreference(ingredient?.crossContamination, item.key) ||
          includesPreference(ingredient?.crossContamination, item.label)
        );
      });

      return {
        key: `cross-allergen-${item.key}`,
        tone: "cross",
        title: `Cross-contamination risk for ${item.label}`,
        reasonBullet: buildDueBullet(
          detailReasons.length ? detailReasons : ingredientReasons,
        ),
      };
    });
}

function buildDietCrossRows(dish, savedDiets) {
  const crossDiets = Array.isArray(dish?.crossContaminationDiets)
    ? dish.crossContaminationDiets
    : [];

  return savedDiets
    .filter(
      (item) =>
        includesPreference(crossDiets, item.key) ||
        includesPreference(crossDiets, item.label),
    )
    .map((item) => {
      const detail = lookupDetailByKeys(dish, [
        `cross contamination ${item.key}`,
        `cross contamination ${item.label}`,
        `cross ${item.key}`,
        `cross ${item.label}`,
        `crosscontamination ${item.key}`,
        `crosscontamination ${item.label}`,
      ]);
      const detailReasons = parseDetailReasons(detail);
      const ingredientReasons = readIngredientNames(dish, (ingredient) => {
        return (
          includesPreference(ingredient?.crossContaminationDiets, item.key) ||
          includesPreference(ingredient?.crossContaminationDiets, item.label)
        );
      });

      return {
        key: `cross-diet-${item.key}`,
        tone: "cross",
        title: `Cross-contamination risk for ${item.label}`,
        reasonBullet: buildDueBullet(
          detailReasons.length ? detailReasons : ingredientReasons,
        ),
      };
    });
}

function mergeSectionRows(baseRows, crossRows) {
  const merged = [...(Array.isArray(baseRows) ? baseRows : [])];
  (Array.isArray(crossRows) ? crossRows : []).forEach((crossRow) => {
    const duplicateIndex = merged.findIndex(
      (row) => normalizeToken(row?.title) === normalizeToken(crossRow?.title),
    );
    if (duplicateIndex >= 0) {
      merged.splice(duplicateIndex + 1, 0, crossRow);
    } else {
      merged.push(crossRow);
    }
  });
  return merged;
}

function computeOverlapArea(a, b) {
  const xOverlap = Math.max(
    0,
    Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left),
  );
  const yOverlap = Math.max(
    0,
    Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top),
  );
  return xOverlap * yOverlap;
}

function getVisibleSlice(imageNode, viewportNode) {
  if (!imageNode || !viewportNode) return null;
  const imageRect = imageNode.getBoundingClientRect();
  const viewportRect = viewportNode.getBoundingClientRect();
  if (imageRect.height <= 0 || viewportRect.height <= 0) return null;

  const visibleTop = Math.max(imageRect.top, viewportRect.top);
  const visibleBottom = Math.min(imageRect.bottom, viewportRect.bottom);
  const visibleHeight = Math.max(0, visibleBottom - visibleTop);
  const offsetTop = Math.max(0, visibleTop - imageRect.top);

  return {
    offsetTop,
    visibleHeight,
    imageHeight: imageRect.height,
  };
}

function pickBestPopupPosition({
  overlayRect,
  stageWidth,
  stageHeight,
  popupWidth,
  popupHeight,
}) {
  const clampLeft = (left) => clamp(left, 10, Math.max(stageWidth - popupWidth - 10, 10));
  const clampTop = (top) => clamp(top, 10, Math.max(stageHeight - popupHeight - 10, 10));
  const overlayBottom = overlayRect.top + overlayRect.height;
  const overlayCenterX = overlayRect.left + overlayRect.width / 2;

  const candidates = [
    { left: overlayRect.left + overlayRect.width + 16, top: overlayRect.top },
    { left: overlayRect.left - popupWidth - 16, top: overlayRect.top },
    { left: overlayCenterX - popupWidth / 2, top: overlayRect.top - popupHeight - 14 },
    { left: overlayCenterX - popupWidth / 2, top: overlayBottom + 14 },
    { left: overlayCenterX - popupWidth / 2, top: overlayRect.top },
  ].map((candidate) => ({
    left: clampLeft(candidate.left),
    top: clampTop(candidate.top),
  }));

  let best = candidates[0];
  let leastOverlap = Number.POSITIVE_INFINITY;

  candidates.forEach((candidate) => {
    const popupRect = {
      left: candidate.left,
      top: candidate.top,
      width: popupWidth,
      height: popupHeight,
    };
    const overlap = computeOverlapArea(popupRect, overlayRect);
    if (overlap < leastOverlap) {
      leastOverlap = overlap;
      best = candidate;
    }
  });

  return best;
}

function parseOverlayNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return clamp(numeric, 0, 100);
}

export function RestaurantViewer({
  restaurant,
  viewer,
  orderFlow,
  lovedDishes,
  favoriteBusyDish,
}) {
  const [selectedOverlay, setSelectedOverlay] = useState(null);
  const [acknowledgedReferenceNote, setAcknowledgedReferenceNote] = useState(false);
  const [scrollSnapshot, setScrollSnapshot] = useState({
    scrollTop: 0,
    scrollHeight: 1,
    clientHeight: 1,
  });
  const [activePageIndex, setActivePageIndex] = useState(0);

  const menuScrollRef = useRef(null);
  const pageRefs = useRef([]);
  const pageImageRefs = useRef([]);
  const selectedDish = selectedOverlay;
  const selectedOverlaySignature = selectedDish ? overlaySignature(selectedDish) : "";

  const dismissReferenceNote = useCallback(() => {
    setAcknowledgedReferenceNote(true);
  }, []);

  const lastConfirmedLabel = useMemo(
    () => parseLastConfirmed(restaurant?.last_confirmed),
    [restaurant?.last_confirmed],
  );

  const refreshScrollSnapshot = useCallback(() => {
    const scrollNode = menuScrollRef.current;
    if (!scrollNode) return;

    const next = {
      scrollTop: scrollNode.scrollTop,
      scrollHeight: Math.max(scrollNode.scrollHeight, 1),
      clientHeight: Math.max(scrollNode.clientHeight, 1),
    };

    setScrollSnapshot((current) => {
      if (
        current.scrollTop === next.scrollTop &&
        current.scrollHeight === next.scrollHeight &&
        current.clientHeight === next.clientHeight
      ) {
        return current;
      }
      return next;
    });

    let resolvedPage = 0;
    let bestVisibleHeight = 0;
    pageImageRefs.current.forEach((imageNode, index) => {
      if (!imageNode) return;
      const visibleSlice = getVisibleSlice(imageNode, scrollNode);
      const visibleHeight = visibleSlice?.visibleHeight || 0;
      if (visibleHeight > bestVisibleHeight) {
        bestVisibleHeight = visibleHeight;
        resolvedPage = index;
      }
    });

    if (bestVisibleHeight <= 0) {
      const marker = next.scrollTop + 1;
      pageRefs.current.forEach((node, index) => {
        if (!node) return;
        const pageTop = node.offsetTop;
        const pageBottom = pageTop + node.offsetHeight;
        if (marker >= pageTop && marker < pageBottom) {
          resolvedPage = index;
        }
      });
    }
    setActivePageIndex(resolvedPage);
  }, []);

  useEffect(() => {
    if (!acknowledgedReferenceNote) {
      return undefined;
    }
    refreshScrollSnapshot();
    const animationFrame = window.requestAnimationFrame(() => {
      refreshScrollSnapshot();
    });
    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [acknowledgedReferenceNote, refreshScrollSnapshot, viewer.menuPages.length]);

  useEffect(() => {
    if (!acknowledgedReferenceNote) {
      return undefined;
    }
    const scrollNode = menuScrollRef.current;
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
      pageRefs.current.forEach((node) => {
        if (node) resizeObserver.observe(node);
      });
      pageImageRefs.current.forEach((node) => {
        if (node) resizeObserver.observe(node);
      });
    }

    return () => {
      scrollNode.removeEventListener("scroll", scheduleRefresh);
      window.removeEventListener("resize", scheduleRefresh);
      if (resizeObserver) resizeObserver.disconnect();
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [acknowledgedReferenceNote, refreshScrollSnapshot, viewer.menuPages.length]);

  useEffect(() => {
    if (!acknowledgedReferenceNote) {
      return undefined;
    }

    let animationFrame = 0;
    const scheduleRefresh = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        refreshScrollSnapshot();
      });
    };

    const imageNodes = pageImageRefs.current.filter(Boolean);
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
  }, [acknowledgedReferenceNote, refreshScrollSnapshot, viewer.menuPages.length]);

  const scrollToPage = useCallback(
    (pageIndex, behavior = "smooth") => {
      const targetIndex = clamp(
        Number(pageIndex) || 0,
        0,
        Math.max(viewer.pageCount - 1, 0),
      );
      const scrollNode = menuScrollRef.current;
      const pageNode = pageImageRefs.current[targetIndex] || pageRefs.current[targetIndex];
      if (!scrollNode || !pageNode) return;
      scrollNode.scrollTo({
        top: pageNode.offsetTop,
        behavior,
      });
    },
    [viewer.pageCount],
  );

  const centerOverlayInView = useCallback(
    (overlay, behavior = "smooth") => {
      if (!overlay) return;
      const scrollNode = menuScrollRef.current;
      if (!scrollNode) return;

      const pageIndex = clamp(
        Number(overlay.pageIndex) || 0,
        0,
        Math.max(viewer.pageCount - 1, 0),
      );
      const pageNode = pageImageRefs.current[pageIndex] || pageRefs.current[pageIndex];
      if (!pageNode) return;

      const pageHeight = Math.max(pageNode.offsetHeight, 1);
      const overlayTop =
        pageNode.offsetTop +
        (parseOverlayNumber(overlay.y) / 100) * pageHeight;
      const overlayHeight =
        (parseOverlayNumber(overlay.h) / 100) * pageHeight;
      const overlayCenter = overlayTop + overlayHeight / 2;
      const targetTop = overlayCenter - scrollNode.clientHeight / 2;
      const maxScroll = Math.max(
        scrollNode.scrollHeight - scrollNode.clientHeight,
        0,
      );

      scrollNode.scrollTo({
        top: clamp(targetTop, 0, maxScroll),
        behavior,
      });
    },
    [viewer.pageCount],
  );

  const jumpFromMinimap = useCallback(
    (event) => {
      const scrollNode = menuScrollRef.current;
      const pageNode =
        pageImageRefs.current[activePageIndex] || pageRefs.current[activePageIndex];
      if (!scrollNode || !pageNode) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const ratio = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
      const pageHeight = Math.max(pageNode.offsetHeight, 1);
      const maxScroll = Math.max(
        scrollSnapshot.scrollHeight - scrollSnapshot.clientHeight,
        0,
      );
      const targetWithinPage = ratio * pageHeight - scrollSnapshot.clientHeight / 2;
      const target = pageNode.offsetTop + targetWithinPage;
      scrollNode.scrollTo({
        top: clamp(target, 0, maxScroll),
        behavior: "smooth",
      });
    },
    [activePageIndex, scrollSnapshot.clientHeight, scrollSnapshot.scrollHeight],
  );

  const actionButtons = [
    {
      key: "website",
      label: "Restaurant website",
      href: restaurant?.website || "",
      disabled: !restaurant?.website,
      tone: "primary",
      external: true,
    },
    {
      key: "call",
      label: "Call restaurant",
      href: restaurant?.phone ? `tel:${restaurant.phone}` : "",
      disabled: !restaurant?.phone,
      tone: "primary",
      external: true,
    },
    {
      key: "feedback",
      label: "Send feedback",
      href: "/help-contact",
      disabled: false,
      tone: "primary",
      external: false,
    },
    {
      key: "report",
      label: "Report issue",
      href: "/report-issue",
      disabled: false,
      tone: "danger",
      external: false,
    },
  ];

  const minimapViewport = useMemo(() => {
    const scrollNode = menuScrollRef.current;
    const pageNode =
      pageImageRefs.current[activePageIndex] || pageRefs.current[activePageIndex];
    if (!scrollNode || !pageNode) {
      return {
        topRatio: 0,
        heightRatio: 0.2,
      };
    }
    const slice = getVisibleSlice(pageNode, scrollNode);
    if (slice && slice.visibleHeight > 0) {
      const topRatio = clamp(slice.offsetTop / slice.imageHeight, 0, 1);
      const heightRatio = clamp(slice.visibleHeight / slice.imageHeight, 0.03, 1);
      return {
        topRatio: clamp(topRatio, 0, Math.max(1 - heightRatio, 0)),
        heightRatio,
      };
    }

    const pageHeight = Math.max(pageNode.offsetHeight, 1);
    const pageTop = pageNode.offsetTop;
    const viewportTop = scrollSnapshot.scrollTop;
    const viewportBottom = viewportTop + scrollSnapshot.clientHeight;
    const visibleTop = clamp(viewportTop - pageTop, 0, pageHeight);
    const visibleBottom = clamp(viewportBottom - pageTop, 0, pageHeight);
    const visibleHeight = Math.max(visibleBottom - visibleTop, 0);
    const topRatio = clamp(visibleTop / pageHeight, 0, 1);
    const heightRatio = clamp(visibleHeight / pageHeight, 0.03, 1);
    return {
      topRatio: clamp(topRatio, 0, Math.max(1 - heightRatio, 0)),
      heightRatio,
    };
  }, [
    acknowledgedReferenceNote,
    activePageIndex,
    scrollSnapshot.clientHeight,
    scrollSnapshot.scrollHeight,
    scrollSnapshot.scrollTop,
    viewer.menuPages.length,
  ]);

  const selectedDishAllergenRows = useMemo(
    () =>
      mergeSectionRows(
        buildAllergenRows(selectedDish, viewer.savedAllergens),
        buildAllergenCrossRows(selectedDish, viewer.savedAllergens),
      ),
    [selectedDish, viewer.savedAllergens],
  );
  const selectedDishDietRows = useMemo(
    () =>
      mergeSectionRows(
        buildDietRows(selectedDish, viewer.savedDiets),
        buildDietCrossRows(selectedDish, viewer.savedDiets),
      ),
    [selectedDish, viewer.savedDiets],
  );

  const selectedDishPageIndex = selectedDish
    ? clamp(Number(selectedDish.pageIndex) || 0, 0, Math.max(viewer.pageCount - 1, 0))
    : 0;
  const selectedDishPageNode =
    pageImageRefs.current[selectedDishPageIndex] ||
    pageRefs.current[selectedDishPageIndex];
  const selectedDishPopupStyle = useMemo(() => {
    const scrollNode = menuScrollRef.current;
    if (!selectedDish || !selectedDishPageNode || !scrollNode) {
      return {
        left: "14px",
        top: "14px",
      };
    }

    const stageRect = scrollNode.getBoundingClientRect();
    const pageRect = selectedDishPageNode.getBoundingClientRect();
    const pageHeight = Math.max(pageRect.height, 1);
    const pageWidth = Math.max(pageRect.width, 1);
    const popupWidth = 340;
    const popupHeight = 420;

    const overlayX = (parseOverlayNumber(selectedDish.x) / 100) * pageWidth;
    const overlayY = (parseOverlayNumber(selectedDish.y) / 100) * pageHeight;
    const overlayW = (parseOverlayNumber(selectedDish.w) / 100) * pageWidth;
    const overlayH = (parseOverlayNumber(selectedDish.h) / 100) * pageHeight;

    const overlayViewportTop = pageRect.top - stageRect.top + overlayY;
    const overlayViewportLeft = pageRect.left - stageRect.left + overlayX;

    const stageWidth = scrollNode.clientWidth || pageWidth;
    const stageHeight = scrollNode.clientHeight || pageHeight;
    if (stageWidth <= 720) {
      return {
        top: "10px",
        left: "10px",
      };
    }
    const overlayRect = {
      left: overlayViewportLeft,
      top: overlayViewportTop,
      width: overlayW,
      height: overlayH,
    };
    const position = pickBestPopupPosition({
      overlayRect,
      stageWidth,
      stageHeight,
      popupWidth,
      popupHeight,
    });

    const safeTop = position.top;
    const safeLeft = position.left;
    return {
      top: `${safeTop}px`,
      left: `${safeLeft}px`,
    };
  }, [
    scrollSnapshot.scrollTop,
    scrollSnapshot.clientHeight,
    selectedDish,
    selectedDishPageNode,
  ]);

  return (
    <section className="restaurant-legacy-viewer">
      <div className="restaurant-legacy-header">
        <h1 className="restaurant-legacy-title">{restaurant?.name || "Restaurant"}</h1>

        <div className="restaurant-legacy-meta-row">
          <div className="restaurant-legacy-page-card">
            <button
              type="button"
              className="restaurant-legacy-page-thumb"
              onClick={jumpFromMinimap}
              title="Jump to area on menu page"
            >
              {viewer.menuPages[activePageIndex]?.image ? (
                <img
                  src={viewer.menuPages[activePageIndex].image}
                  alt={`Menu thumbnail page ${activePageIndex + 1}`}
                />
              ) : (
                <span>No page</span>
              )}
              <span
                className="restaurant-legacy-page-thumb-viewport"
                style={{
                  top: `${minimapViewport.topRatio * 100}%`,
                  height: `${minimapViewport.heightRatio * 100}%`,
                }}
              />
            </button>
            <div className="restaurant-legacy-page-footer">
              Page {activePageIndex + 1} of {viewer.pageCount}
            </div>
            {viewer.pageCount > 1 ? (
              <div className="restaurant-legacy-page-controls">
                <button
                  type="button"
                  onClick={() =>
                    scrollToPage(clamp(activePageIndex - 1, 0, viewer.pageCount - 1))
                  }
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() =>
                    scrollToPage(clamp(activePageIndex + 1, 0, viewer.pageCount - 1))
                  }
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>

          <div className="restaurant-legacy-preference-wrap">
            <div className="preference-row">
              <div className="preference-panel pill">
                <div className="preference-header">
                  <div className="preference-title">Saved allergens</div>
                  <Link href="/account" className="btnLink preference-edit">
                    Edit
                  </Link>
                </div>
                <div className="preference-chips chips">
                  {viewer.savedAllergens.length ? (
                    viewer.savedAllergens.map((item) => (
                      <span key={item.key} className="chip active preference-chip">
                        {item.emoji || "⚠"} {item.label}
                      </span>
                    ))
                  ) : (
                    <span className="note">No saved allergens</span>
                  )}
                </div>
              </div>

              <div className="preference-panel pill">
                <div className="preference-header">
                  <div className="preference-title">Saved diets</div>
                  <Link href="/account" className="btnLink preference-edit">
                    Edit
                  </Link>
                </div>
                <div className="preference-chips chips">
                  {viewer.savedDiets.length ? (
                    viewer.savedDiets.map((item) => (
                      <span key={item.key} className="chip active preference-chip">
                        {item.emoji || "✓"} {item.label}
                      </span>
                    ))
                  ) : (
                    <span className="note">No saved diets</span>
                  )}
                </div>
              </div>
            </div>

            <div className="restaurant-legacy-actions-row">
              {actionButtons.map((action) =>
                action.disabled ? (
                  <button
                    key={action.key}
                    type="button"
                    className={`restaurant-legacy-action-btn ${action.tone === "danger" ? "danger" : ""}`}
                    disabled
                  >
                    {action.label}
                  </button>
                ) : action.external ? (
                  <a
                    key={action.key}
                    href={action.href}
                    className={`restaurant-legacy-action-btn ${action.tone === "danger" ? "danger" : ""}`}
                    target={action.href.startsWith("http") ? "_blank" : undefined}
                    rel={action.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  >
                    {action.label}
                  </a>
                ) : (
                  <Link
                    key={action.key}
                    href={action.href}
                    className={`restaurant-legacy-action-btn ${action.tone === "danger" ? "danger" : ""}`}
                  >
                    {action.label}
                  </Link>
                ),
              )}
            </div>

            <p className="restaurant-legacy-confirmed-text">
              Last confirmed by restaurant staff: {lastConfirmedLabel}
            </p>
          </div>
        </div>

        <div className="restaurant-legacy-legend">
          <p>
            <span className="legend-box safe" /> Complies ·{" "}
            <span className="legend-box removable" /> Can be modified to comply ·{" "}
            <span className="legend-box unsafe" /> Cannot be modified to comply
          </p>
          <p>⚠ Cross-contamination risk · Tap dishes for details · Pinch menu to zoom in/out</p>
        </div>
      </div>

      <div
        className={`restaurant-legacy-menu-stage ${
          acknowledgedReferenceNote ? "" : "is-locked"
        }`}
      >
        <div
          ref={menuScrollRef}
          className={`restaurant-legacy-menu-scroll ${
            acknowledgedReferenceNote ? "" : "is-blurred"
          }`}
        >
          {viewer.menuPages.map((page) => (
            <div
              key={`page-${page.pageIndex}`}
              className="restaurant-legacy-menu-page"
              ref={(node) => {
                pageRefs.current[page.pageIndex] = node;
              }}
            >
              {page.image ? (
                <img
                  src={page.image}
                  alt={`${restaurant?.name || "Restaurant"} menu page ${page.pageIndex + 1}`}
                  className="restaurant-legacy-menu-image"
                  ref={(node) => {
                    pageImageRefs.current[page.pageIndex] = node;
                  }}
                />
              ) : (
                <div className="restaurant-legacy-no-image">No menu image available.</div>
              )}

              {page.overlays.map((overlay, index) => (
                <button
                  key={overlayKey(overlay, index)}
                  type="button"
                  title={overlay.name || overlay.id || "Dish"}
                  aria-label={overlay.name || overlay.id || "Dish"}
                  onClick={() => {
                    if (!acknowledgedReferenceNote) return;
                    viewer.selectDish(overlay.id);
                    setSelectedOverlay(overlay);
                    centerOverlayInView(overlay, "smooth");
                    window.requestAnimationFrame(() => {
                      centerOverlayInView(overlay, "auto");
                    });
                  }}
                  className={`restaurant-legacy-overlay ${
                    selectedOverlaySignature &&
                    overlaySignature(overlay) === selectedOverlaySignature
                      ? "is-selected"
                      : ""
                  }`}
                  style={{
                    left: `${parseOverlayNumber(overlay.x)}%`,
                    top: `${parseOverlayNumber(overlay.y)}%`,
                    width: `${parseOverlayNumber(overlay.w)}%`,
                    height: `${parseOverlayNumber(overlay.h)}%`,
                    borderColor: statusBorderColor(overlay.compatibilityStatus),
                    "--overlay-pulse-color": statusPulseColor(overlay.compatibilityStatus),
                  }}
                >
                  <span className="restaurant-legacy-overlay-warning">
                    {overlay.hasCrossContamination ? "⚠" : ""}
                  </span>
                  <span className="restaurant-legacy-overlay-info">i</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        {acknowledgedReferenceNote && selectedDish ? (
          <aside className="restaurant-legacy-dish-popover" style={selectedDishPopupStyle}>
            <header className="restaurant-legacy-dish-popover-header">
              <h2>{selectedDish.name || "Dish details"}</h2>
              <div className="restaurant-legacy-dish-popover-actions">
                <button
                  type="button"
                  aria-label="Toggle favorite dish"
                  onClick={() => viewer.toggleFavoriteDish(selectedDish)}
                  disabled={favoriteBusyDish === selectedDish.id}
                >
                  {lovedDishes.has(selectedDish.id) ? "♥" : "♡"}
                </button>
                <button
                  type="button"
                  aria-label="Close dish details"
                  onClick={() => setSelectedOverlay(null)}
                >
                  ×
                </button>
              </div>
            </header>

            <div className="restaurant-legacy-dish-popover-body">
              <section className="restaurant-legacy-dish-popover-section">
                <h3>Allergens:</h3>
                {selectedDishAllergenRows.length ? (
                  selectedDishAllergenRows.map((row) => (
                    <div key={row.key} className={`dish-row ${row.tone}`}>
                      <div className="dish-row-title">{row.title}</div>
                      {row.reasonBullet ? (
                        <ul className="dish-row-reasons">
                          <li>{row.reasonBullet}</li>
                        </ul>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="dish-row-empty">No saved allergens.</p>
                )}
              </section>

              <section className="restaurant-legacy-dish-popover-section">
                <h3>Diets:</h3>
                {selectedDishDietRows.length ? (
                  selectedDishDietRows.map((row) => (
                    <div key={row.key} className={`dish-row ${row.tone}`}>
                      <div className="dish-row-title">{row.title}</div>
                      {row.reasonBullet ? (
                        <ul className="dish-row-reasons">
                          <li>{row.reasonBullet}</li>
                        </ul>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="dish-row-empty">No saved diets.</p>
                )}
              </section>
            </div>

            <Button
              size="compact"
              tone="primary"
              className="restaurant-legacy-dish-order-btn"
              onClick={() => {
                viewer.addDishToOrder(selectedDish);
                orderFlow.addDish(selectedDish);
              }}
            >
              Add to order
            </Button>
          </aside>
        ) : null}

        {!acknowledgedReferenceNote ? (
          <div
            className="restaurant-legacy-reference-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Reference notice"
          >
            <div className="restaurant-legacy-reference-modal-card">
              <p className="restaurant-legacy-reference-modal-text">
                Reference only. Always inform staff about your allergens.
              </p>
              <button type="button" onClick={dismissReferenceNote}>
                I understand
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <footer className="restaurant-legacy-help-fab">
        <Link href="/help-contact">Help</Link>
      </footer>
    </section>
  );
}

export default RestaurantViewer;
