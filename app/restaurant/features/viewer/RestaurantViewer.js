"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "../../../components/ui";
import {
  buildAllergenRows as buildDishAllergenRows,
  buildAllergenCrossRows as buildDishAllergenCrossRows,
  buildDietRows as buildDishDietRows,
  buildDietCrossRows as buildDishDietCrossRows,
  mergeSectionRows as mergeDishSectionRows,
} from "../shared/dishDetailRows";
import {
  buildMinimapViewport,
  computeMinimapJumpTarget,
} from "../shared/minimapGeometry";
import { useMinimapSync } from "../shared/useMinimapSync";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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

function normalizeWebsiteHref(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;

  const compact = raw.replace(/\s+/g, "");
  if (!compact) return "";

  const hasDot = compact.includes(".");
  const isLocalhost = /^localhost(?::\d+)?$/i.test(compact);
  const isIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(compact);
  const isIpv6 = /^\[[0-9a-f:]+\](?::\d+)?$/i.test(compact);
  const withHostGuess =
    hasDot || isLocalhost || isIpv4 || isIpv6 || compact.includes(":")
      ? compact
      : `www.${compact}.com`;

  return `https://${withHostGuess}`;
}

function normalizePhoneHref(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const compact = raw.replace(/[^0-9+*#,;]/g, "");
  if (!compact || !/\d/.test(compact)) return "";
  return `tel:${compact}`;
}

function toggleSelection(values, target) {
  const targetValue = String(target || "").trim();
  if (!targetValue) return Array.isArray(values) ? values : [];
  const list = Array.isArray(values) ? values : [];
  return list.includes(targetValue)
    ? list.filter((entry) => entry !== targetValue)
    : [...list, targetValue];
}

function getTouchDistance(touchA, touchB) {
  if (!touchA || !touchB) return 0;
  const deltaX = Number(touchA.clientX || 0) - Number(touchB.clientX || 0);
  const deltaY = Number(touchA.clientY || 0) - Number(touchB.clientY || 0);
  return Math.hypot(deltaX, deltaY);
}

function getTouchMidpoint(touchA, touchB) {
  return {
    x: (Number(touchA?.clientX || 0) + Number(touchB?.clientX || 0)) / 2,
    y: (Number(touchA?.clientY || 0) + Number(touchB?.clientY || 0)) / 2,
  };
}

const MOBILE_VIEWPORT_QUERY = "(max-width: 900px)";
const MOBILE_FOCUS_ZOOM = 1.65;
const MOBILE_DISH_PANEL_FALLBACK_HEIGHT = 220;
const MOBILE_DISH_PANEL_FOCUS_GUTTER = 36;
const MOBILE_DISH_PANEL_STABLE_DELAY_MS = 80;
const MOBILE_DISH_VERTICAL_ANCHOR_RATIO = 0.5;
const MOBILE_DISH_FOCUS_EDGE_PADDING = 14;
const MENU_ZOOM_ANIMATION_MS = 260;

export function RestaurantViewer({
  restaurant,
  viewer,
  lovedDishes,
  favoriteBusyDish,
  preferenceTitlePrefix = "Saved",
  showPreferenceEdit = true,
  allowGuestPreferenceEditing = false,
  guestPreferenceOptions = { allergens: [], diets: [] },
  onSaveGuestPreferences,
  showGuestSignupPrompt = false,
  guestSignupHref = "/account?mode=signup",
}) {
  const [selectedOverlay, setSelectedOverlay] = useState(null);
  const [acknowledgedReferenceNote, setAcknowledgedReferenceNote] = useState(false);
  const [showGuestSignupBanner, setShowGuestSignupBanner] = useState(false);
  const [isEditingGuestAllergens, setIsEditingGuestAllergens] = useState(false);
  const [isEditingGuestDiets, setIsEditingGuestDiets] = useState(false);
  const [draftGuestAllergenKeys, setDraftGuestAllergenKeys] = useState([]);
  const [draftGuestDietKeys, setDraftGuestDietKeys] = useState([]);
  const [menuZoomScale, setMenuZoomScale] = useState(1);
  const [isMenuZoomAnimating, setIsMenuZoomAnimating] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [mobileDishPanelHeight, setMobileDishPanelHeight] = useState(0);

  const menuScrollRef = useRef(null);
  const pageRefs = useRef([]);
  const pageImageRefs = useRef([]);
  const mobileDishPanelRef = useRef(null);
  const mobileViewportRestoreRef = useRef(null);
  const menuZoomScaleRef = useRef(1);
  const zoomAnimationTimerRef = useRef(null);
  const scrollAnimationFrameRef = useRef(null);
  const pinchGestureRef = useRef({
    active: false,
    startDistance: 0,
    startScale: 1,
    anchorX: 0,
    anchorY: 0,
  });
  const selectedDish = selectedOverlay;
  const selectedOverlaySignature = selectedDish ? overlaySignature(selectedDish) : "";
  const preferencePrefix = String(preferenceTitlePrefix || "Saved").trim() || "Saved";
  const preferencePrefixLower = preferencePrefix.toLowerCase();

  const dismissReferenceNote = useCallback(() => {
    setAcknowledgedReferenceNote(true);
  }, []);

  useEffect(() => {
    if (!showGuestSignupPrompt || !acknowledgedReferenceNote) {
      setShowGuestSignupBanner(false);
      return undefined;
    }

    setShowGuestSignupBanner(false);
    const timer = window.setTimeout(() => {
      setShowGuestSignupBanner(true);
    }, 10000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [acknowledgedReferenceNote, showGuestSignupPrompt]);

  const lastConfirmedLabel = useMemo(
    () => parseLastConfirmed(restaurant?.last_confirmed),
    [restaurant?.last_confirmed],
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mediaQuery = window.matchMedia(MOBILE_VIEWPORT_QUERY);
    const syncViewportMode = () => {
      setIsMobileViewport(mediaQuery.matches);
    };

    syncViewportMode();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncViewportMode);
      return () => {
        mediaQuery.removeEventListener("change", syncViewportMode);
      };
    }

    mediaQuery.addListener(syncViewportMode);
    return () => {
      mediaQuery.removeListener(syncViewportMode);
    };
  }, []);

  const {
    activePageIndex,
    scrollSnapshot,
    refreshScrollSnapshot,
  } = useMinimapSync({
    enabled: acknowledgedReferenceNote,
    menuScrollRef,
    pageRefs,
    pageImageRefs,
    pageCount: viewer.pageCount,
    pageVersionKey: `${viewer.menuPages.length}:${menuZoomScale}`,
  });

  useEffect(() => {
    menuZoomScaleRef.current = menuZoomScale;
    refreshScrollSnapshot();
  }, [menuZoomScale, refreshScrollSnapshot]);

  const startMenuZoomAnimation = useCallback(() => {
    setIsMenuZoomAnimating(true);
    if (zoomAnimationTimerRef.current) {
      window.clearTimeout(zoomAnimationTimerRef.current);
    }
    zoomAnimationTimerRef.current = window.setTimeout(() => {
      setIsMenuZoomAnimating(false);
      zoomAnimationTimerRef.current = null;
    }, MENU_ZOOM_ANIMATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (!zoomAnimationTimerRef.current) return;
      window.clearTimeout(zoomAnimationTimerRef.current);
      zoomAnimationTimerRef.current = null;
    };
  }, []);

  const stopScrollAnimation = useCallback(() => {
    if (!scrollAnimationFrameRef.current) return;
    window.cancelAnimationFrame(scrollAnimationFrameRef.current);
    scrollAnimationFrameRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      stopScrollAnimation();
    };
  }, [stopScrollAnimation]);

  const animateMenuScrollTo = useCallback(
    (target, durationMs = MENU_ZOOM_ANIMATION_MS) => {
      const scrollNode = menuScrollRef.current;
      if (!scrollNode || !target) return;

      const endLeft = Number(target.left);
      const endTop = Number(target.top);
      if (!Number.isFinite(endLeft) || !Number.isFinite(endTop)) return;

      const startLeft = scrollNode.scrollLeft;
      const startTop = scrollNode.scrollTop;
      const deltaLeft = endLeft - startLeft;
      const deltaTop = endTop - startTop;

      stopScrollAnimation();

      if (
        durationMs <= 0 ||
        (Math.abs(deltaLeft) < 0.5 && Math.abs(deltaTop) < 0.5)
      ) {
        scrollNode.scrollTo({ left: endLeft, top: endTop, behavior: "auto" });
        refreshScrollSnapshot();
        return;
      }

      const startedAt = performance.now();
      const step = (now) => {
        const elapsed = now - startedAt;
        const progress = clamp(elapsed / durationMs, 0, 1);
        scrollNode.scrollLeft = startLeft + deltaLeft * progress;
        scrollNode.scrollTop = startTop + deltaTop * progress;
        refreshScrollSnapshot();
        if (progress < 1) {
          scrollAnimationFrameRef.current = window.requestAnimationFrame(step);
          return;
        }
        scrollAnimationFrameRef.current = null;
      };

      scrollAnimationFrameRef.current = window.requestAnimationFrame(step);
    },
    [refreshScrollSnapshot, stopScrollAnimation],
  );

  const endPinchGesture = useCallback(() => {
    if (!pinchGestureRef.current.active) return;
    pinchGestureRef.current.active = false;
    refreshScrollSnapshot();
  }, [refreshScrollSnapshot]);

  const startPinchGesture = useCallback((touchA, touchB) => {
    const scrollNode = menuScrollRef.current;
    if (!scrollNode || !touchA || !touchB) return;

    const startDistance = getTouchDistance(touchA, touchB);
    if (startDistance <= 0) return;

    const midpoint = getTouchMidpoint(touchA, touchB);
    const bounds = scrollNode.getBoundingClientRect();

    pinchGestureRef.current = {
      active: true,
      startDistance,
      startScale: menuZoomScaleRef.current,
      anchorX: scrollNode.scrollLeft + (midpoint.x - bounds.left),
      anchorY: scrollNode.scrollTop + (midpoint.y - bounds.top),
    };
  }, []);

  const continuePinchGesture = useCallback(
    (touchA, touchB) => {
      const scrollNode = menuScrollRef.current;
      if (!scrollNode || !touchA || !touchB || !pinchGestureRef.current.active) {
        return;
      }

      const pinch = pinchGestureRef.current;
      const distance = getTouchDistance(touchA, touchB);
      if (distance <= 0 || pinch.startDistance <= 0) return;

      const nextScale = clamp((distance / pinch.startDistance) * pinch.startScale, 1, 3);
      if (Math.abs(nextScale - menuZoomScaleRef.current) < 0.005) return;

      const midpoint = getTouchMidpoint(touchA, touchB);
      const bounds = scrollNode.getBoundingClientRect();
      const pointerX = midpoint.x - bounds.left;
      const pointerY = midpoint.y - bounds.top;
      const scaleRatio = nextScale / pinch.startScale;
      const targetLeft = pinch.anchorX * scaleRatio - pointerX;
      const targetTop = pinch.anchorY * scaleRatio - pointerY;

      setMenuZoomScale(nextScale);

      window.requestAnimationFrame(() => {
        const maxLeft = Math.max(scrollNode.scrollWidth - scrollNode.clientWidth, 0);
        const maxTop = Math.max(scrollNode.scrollHeight - scrollNode.clientHeight, 0);
        scrollNode.scrollLeft = clamp(targetLeft, 0, maxLeft);
        scrollNode.scrollTop = clamp(targetTop, 0, maxTop);
        refreshScrollSnapshot();
      });
    },
    [refreshScrollSnapshot],
  );

  useEffect(() => {
    const scrollNode = menuScrollRef.current;
    if (!scrollNode || !acknowledgedReferenceNote) return undefined;

    const onTouchStart = (event) => {
      if (event.touches.length < 2) return;
      startPinchGesture(event.touches[0], event.touches[1]);
    };

    const onTouchMove = (event) => {
      if (event.touches.length < 2 || !pinchGestureRef.current.active) return;
      event.preventDefault();
      continuePinchGesture(event.touches[0], event.touches[1]);
    };

    const onTouchEnd = (event) => {
      if (event.touches.length >= 2) {
        startPinchGesture(event.touches[0], event.touches[1]);
        return;
      }
      endPinchGesture();
    };

    scrollNode.addEventListener("touchstart", onTouchStart, { passive: true });
    scrollNode.addEventListener("touchmove", onTouchMove, { passive: false });
    scrollNode.addEventListener("touchend", onTouchEnd, { passive: true });
    scrollNode.addEventListener("touchcancel", endPinchGesture, { passive: true });

    return () => {
      scrollNode.removeEventListener("touchstart", onTouchStart);
      scrollNode.removeEventListener("touchmove", onTouchMove);
      scrollNode.removeEventListener("touchend", onTouchEnd);
      scrollNode.removeEventListener("touchcancel", endPinchGesture);
    };
  }, [
    acknowledgedReferenceNote,
    continuePinchGesture,
    endPinchGesture,
    startPinchGesture,
  ]);

  const centerOverlayInView = useCallback(
    (overlay, options = {}) => {
      if (!overlay) return;
      const scrollNode = menuScrollRef.current;
      if (!scrollNode) return;
      const {
        behavior = "smooth",
        viewportBottomInset = 0,
        verticalAnchorRatio = 0.5,
        overlayEdgePadding = 12,
        fitOverlayToViewport = false,
        targetScale = menuZoomScaleRef.current,
        returnTargetOnly = false,
      } = options;

      const pageIndex = clamp(
        Number(overlay.pageIndex) || 0,
        0,
        Math.max(viewer.pageCount - 1, 0),
      );
      const pageNode = pageImageRefs.current[pageIndex] || pageRefs.current[pageIndex];
      if (!pageNode) return;

      const pageHeight = Math.max(pageNode.offsetHeight, 1);
      const pageWidth = Math.max(pageNode.offsetWidth, 1);
      const overlayLeft =
        pageNode.offsetLeft +
        (parseOverlayNumber(overlay.x) / 100) * pageWidth;
      const overlayTop =
        pageNode.offsetTop +
        (parseOverlayNumber(overlay.y) / 100) * pageHeight;
      const overlayWidth =
        (parseOverlayNumber(overlay.w) / 100) * pageWidth;
      const overlayHeight =
        (parseOverlayNumber(overlay.h) / 100) * pageHeight;
      const currentScale = Math.max(menuZoomScaleRef.current, 0.001);
      const clampedInset = clamp(
        Number(viewportBottomInset) || 0,
        0,
        Math.max(scrollNode.clientHeight - 40, 0),
      );
      const visibleHeight = Math.max(scrollNode.clientHeight - clampedInset, 1);
      const edgePadding = clamp(
        Number(overlayEdgePadding) || 0,
        0,
        Math.max(Math.min(visibleHeight, scrollNode.clientWidth) * 0.45, 0),
      );
      let nextTargetScale = clamp(Number(targetScale) || currentScale, 1, 3);

      if (fitOverlayToViewport) {
        const verticalFitHeight = Math.max(visibleHeight - edgePadding * 2, 1);
        if (overlayHeight > 0) {
          const maxScaleByHeight = currentScale * (verticalFitHeight / overlayHeight);
          nextTargetScale = Math.min(nextTargetScale, maxScaleByHeight);
        }
      }

      const safeTargetScale = clamp(nextTargetScale, 1, 3);
      const scaleRatio = safeTargetScale / currentScale;
      const scaledOverlayLeft = overlayLeft * scaleRatio;
      const scaledOverlayTop = overlayTop * scaleRatio;
      const scaledOverlayWidth = overlayWidth * scaleRatio;
      const scaledOverlayHeight = overlayHeight * scaleRatio;
      const overlayCenterX = scaledOverlayLeft + scaledOverlayWidth / 2;
      const overlayCenterY = scaledOverlayTop + scaledOverlayHeight / 2;

      let targetTop;
      let targetLeft;

      if (fitOverlayToViewport) {
        const centeredTop = overlayCenterY - visibleHeight / 2;
        const centeredLeft = overlayCenterX - scrollNode.clientWidth / 2;
        const minTopForContain = scaledOverlayTop + scaledOverlayHeight - (visibleHeight - edgePadding);
        const maxTopForContain = scaledOverlayTop - edgePadding;
        const minLeftForContain =
          scaledOverlayLeft + scaledOverlayWidth - (scrollNode.clientWidth - edgePadding);
        const maxLeftForContain = scaledOverlayLeft - edgePadding;
        const canContainVertically = minTopForContain <= maxTopForContain;
        const canContainHorizontally = minLeftForContain <= maxLeftForContain;

        targetTop = canContainVertically
          ? clamp(centeredTop, minTopForContain, maxTopForContain)
          : centeredTop;
        targetLeft = canContainHorizontally
          ? clamp(centeredLeft, minLeftForContain, maxLeftForContain)
          : centeredLeft;
      } else {
        const anchorRatio = clamp(Number(verticalAnchorRatio) || 0.5, 0.2, 0.8);
        targetTop = overlayCenterY - visibleHeight * anchorRatio;
        targetLeft = overlayCenterX - scrollNode.clientWidth / 2;
      }

      const maxScrollTop = Math.max(
        scrollNode.scrollHeight * scaleRatio - scrollNode.clientHeight,
        0,
      );
      const maxScrollLeft = Math.max(
        scrollNode.scrollWidth * scaleRatio - scrollNode.clientWidth,
        0,
      );
      const clampedTarget = {
        top: clamp(targetTop, 0, maxScrollTop),
        left: clamp(targetLeft, 0, maxScrollLeft),
        scale: safeTargetScale,
      };

      if (returnTargetOnly) {
        return clampedTarget;
      }

      scrollNode.scrollTo({
        top: clampedTarget.top,
        left: clampedTarget.left,
        behavior,
      });
      refreshScrollSnapshot();
      return clampedTarget;
    },
    [refreshScrollSnapshot, viewer.pageCount],
  );

  const focusOverlayForCurrentViewport = useCallback(
    (overlay, options = {}) => {
      if (!overlay) return;
      const desktopBehavior = options?.behavior === "auto" ? "auto" : "smooth";
      const mobileBehavior = options?.behavior === "smooth" ? "smooth" : "auto";
      const overrideInsetRaw = Number(options?.viewportBottomInset);
      const hasOverrideInset = Number.isFinite(overrideInsetRaw);
      const viewportBottomInset = isMobileViewport
        ? hasOverrideInset
          ? Math.max(0, overrideInsetRaw)
          : Math.max(mobileDishPanelHeight, MOBILE_DISH_PANEL_FALLBACK_HEIGHT) +
            MOBILE_DISH_PANEL_FOCUS_GUTTER
        : 0;
      const recenter = (behavior = isMobileViewport ? mobileBehavior : desktopBehavior) => {
        centerOverlayInView(overlay, {
          behavior,
          viewportBottomInset,
          verticalAnchorRatio: isMobileViewport ? MOBILE_DISH_VERTICAL_ANCHOR_RATIO : 0.5,
          overlayEdgePadding: isMobileViewport ? MOBILE_DISH_FOCUS_EDGE_PADDING : 0,
          fitOverlayToViewport: isMobileViewport,
        });
      };

      if (!isMobileViewport) {
        recenter(desktopBehavior);
        return;
      }

      const requestedScale = clamp(
        Math.max(menuZoomScaleRef.current, MOBILE_FOCUS_ZOOM),
        1,
        3,
      );

      const target = centerOverlayInView(overlay, {
        behavior: "auto",
        viewportBottomInset,
        verticalAnchorRatio: MOBILE_DISH_VERTICAL_ANCHOR_RATIO,
        overlayEdgePadding: MOBILE_DISH_FOCUS_EDGE_PADDING,
        fitOverlayToViewport: true,
        targetScale: requestedScale,
        returnTargetOnly: true,
      });
      if (!target) return;
      const nextScale = clamp(Number(target.scale) || requestedScale, 1, 3);

      if (Math.abs(nextScale - menuZoomScaleRef.current) > 0.02) {
        startMenuZoomAnimation();
        setMenuZoomScale(nextScale);
        animateMenuScrollTo(target, MENU_ZOOM_ANIMATION_MS);
        return;
      }

      centerOverlayInView(overlay, {
        behavior: mobileBehavior,
        viewportBottomInset,
        verticalAnchorRatio: MOBILE_DISH_VERTICAL_ANCHOR_RATIO,
        overlayEdgePadding: MOBILE_DISH_FOCUS_EDGE_PADDING,
        fitOverlayToViewport: true,
        targetScale: nextScale,
      });
    },
    [
      animateMenuScrollTo,
      centerOverlayInView,
      isMobileViewport,
      mobileDishPanelHeight,
      startMenuZoomAnimation,
    ],
  );

  const captureViewportForMobileDishFocus = useCallback(() => {
    const scrollNode = menuScrollRef.current;
    if (!scrollNode) return;
    mobileViewportRestoreRef.current = {
      scale: menuZoomScaleRef.current,
      left: scrollNode.scrollLeft,
      top: scrollNode.scrollTop,
    };
  }, []);

  const restoreViewportAfterMobileDishClose = useCallback(() => {
    const scrollNode = menuScrollRef.current;
    const snapshot = mobileViewportRestoreRef.current;
    if (!scrollNode || !snapshot) return;
    mobileViewportRestoreRef.current = null;

    const applySnapshot = (behavior = "auto") => {
      const maxLeft = Math.max(scrollNode.scrollWidth - scrollNode.clientWidth, 0);
      const maxTop = Math.max(scrollNode.scrollHeight - scrollNode.clientHeight, 0);
      scrollNode.scrollTo({
        left: clamp(Number(snapshot.left) || 0, 0, maxLeft),
        top: clamp(Number(snapshot.top) || 0, 0, maxTop),
        behavior,
      });
      refreshScrollSnapshot();
    };

    const targetScale = clamp(Number(snapshot.scale) || 1, 1, 3);
    if (Math.abs(targetScale - menuZoomScaleRef.current) > 0.02) {
      const currentScale = Math.max(menuZoomScaleRef.current, 0.001);
      const scaleRatio = targetScale / currentScale;
      const maxLeftAtTarget = Math.max(
        scrollNode.scrollWidth * scaleRatio - scrollNode.clientWidth,
        0,
      );
      const maxTopAtTarget = Math.max(
        scrollNode.scrollHeight * scaleRatio - scrollNode.clientHeight,
        0,
      );
      const target = {
        left: clamp(Number(snapshot.left) || 0, 0, maxLeftAtTarget),
        top: clamp(Number(snapshot.top) || 0, 0, maxTopAtTarget),
      };
      startMenuZoomAnimation();
      setMenuZoomScale(targetScale);
      animateMenuScrollTo(target, MENU_ZOOM_ANIMATION_MS);
      return;
    }

    window.requestAnimationFrame(() => {
      applySnapshot("auto");
    });
  }, [animateMenuScrollTo, refreshScrollSnapshot, startMenuZoomAnimation]);

  const closeDishDetails = useCallback(() => {
    setSelectedOverlay(null);
    if (isMobileViewport) {
      restoreViewportAfterMobileDishClose();
    }
  }, [isMobileViewport, restoreViewportAfterMobileDishClose]);

  const jumpFromMinimap = useCallback(
    (event) => {
      const scrollNode = menuScrollRef.current;
      const pageNode = pageRefs.current[activePageIndex] || pageImageRefs.current[activePageIndex];
      if (!scrollNode || !pageNode) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (!bounds.height) return;
      const ratio = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
      const target = computeMinimapJumpTarget(scrollNode, pageNode, ratio);
      scrollNode.scrollTo({
        top: target,
        behavior: "smooth",
      });
    },
    [activePageIndex],
  );

  const websiteHref = normalizeWebsiteHref(restaurant?.website);
  const phoneHref = normalizePhoneHref(restaurant?.phone);
  const feedbackHref = allowGuestPreferenceEditing
    ? "/report-issue?mode=feedback"
    : "/help-contact";
  const actionButtons = [
    {
      key: "website",
      label: "Restaurant website",
      href: websiteHref,
      disabled: !websiteHref,
      tone: "primary",
      external: true,
    },
    {
      key: "call",
      label: "Call restaurant",
      href: phoneHref,
      disabled: !phoneHref,
      tone: "primary",
      external: true,
    },
    {
      key: "feedback",
      label: "Send feedback",
      href: feedbackHref,
      disabled: false,
      tone: "primary",
      external: false,
    },
    {
      key: "report",
      label: "Report issue",
      href: "/report-issue?mode=issue",
      disabled: false,
      tone: "danger",
      external: false,
    },
  ];

  const minimapViewport = useMemo(() => {
    const scrollNode = menuScrollRef.current;
    const pageNode = pageRefs.current[activePageIndex] || pageImageRefs.current[activePageIndex];
    return buildMinimapViewport(scrollNode, pageNode);
  }, [
    acknowledgedReferenceNote,
    activePageIndex,
    scrollSnapshot.clientHeight,
    scrollSnapshot.clientWidth,
    scrollSnapshot.scrollHeight,
    scrollSnapshot.scrollLeft,
    scrollSnapshot.scrollWidth,
    scrollSnapshot.scrollTop,
    viewer.menuPages.length,
  ]);

  const selectedDishAllergenRows = useMemo(
    () =>
      mergeDishSectionRows(
        buildDishAllergenRows(selectedDish, viewer.savedAllergens),
        buildDishAllergenCrossRows(selectedDish, viewer.savedAllergens),
      ),
    [selectedDish, viewer.savedAllergens],
  );
  const selectedDishDietRows = useMemo(
    () =>
      mergeDishSectionRows(
        buildDishDietRows(selectedDish, viewer.savedDiets),
        buildDishDietCrossRows(selectedDish, viewer.savedDiets),
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
    if (isMobileViewport) {
      return undefined;
    }
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
    isMobileViewport,
    scrollSnapshot.scrollTop,
    scrollSnapshot.clientHeight,
    selectedDish,
    selectedDishPageNode,
  ]);

  const savedAllergenKeys = useMemo(
    () => (Array.isArray(viewer.savedAllergens) ? viewer.savedAllergens.map((item) => item.key) : []),
    [viewer.savedAllergens],
  );
  const savedDietKeys = useMemo(
    () => (Array.isArray(viewer.savedDiets) ? viewer.savedDiets.map((item) => item.key) : []),
    [viewer.savedDiets],
  );
  const guestAllergenOptions = useMemo(
    () => (Array.isArray(guestPreferenceOptions?.allergens) ? guestPreferenceOptions.allergens : []),
    [guestPreferenceOptions?.allergens],
  );
  const guestDietOptions = useMemo(
    () => (Array.isArray(guestPreferenceOptions?.diets) ? guestPreferenceOptions.diets : []),
    [guestPreferenceOptions?.diets],
  );

  useEffect(() => {
    if (!allowGuestPreferenceEditing) {
      setIsEditingGuestAllergens(false);
      setIsEditingGuestDiets(false);
      setDraftGuestAllergenKeys([]);
      setDraftGuestDietKeys([]);
      return;
    }

    if (!isEditingGuestAllergens) {
      setDraftGuestAllergenKeys(savedAllergenKeys);
    }
  }, [allowGuestPreferenceEditing, isEditingGuestAllergens, savedAllergenKeys]);

  useEffect(() => {
    if (!allowGuestPreferenceEditing) return;
    if (!isEditingGuestDiets) {
      setDraftGuestDietKeys(savedDietKeys);
    }
  }, [allowGuestPreferenceEditing, isEditingGuestDiets, savedDietKeys]);

  useEffect(() => {
    if (!isMobileViewport || !selectedDish) {
      setMobileDishPanelHeight(0);
      return undefined;
    }

    const panelNode = mobileDishPanelRef.current;
    if (!panelNode) return undefined;

    const syncPanelHeight = () => {
      const next = panelNode.getBoundingClientRect().height || 0;
      setMobileDishPanelHeight(next);
    };

    syncPanelHeight();

    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(syncPanelHeight);
      observer.observe(panelNode);
      return () => {
        observer.disconnect();
      };
    }

    window.addEventListener("resize", syncPanelHeight);
    return () => {
      window.removeEventListener("resize", syncPanelHeight);
    };
  }, [isMobileViewport, selectedDish, selectedOverlaySignature]);

  useEffect(() => {
    if (!acknowledgedReferenceNote || !isMobileViewport || !selectedDish) {
      return undefined;
    }

    if (mobileDishPanelHeight <= 0) {
      return undefined;
    }

    const viewportBottomInset = mobileDishPanelHeight + MOBILE_DISH_PANEL_FOCUS_GUTTER;
    const timer = window.setTimeout(() => {
      focusOverlayForCurrentViewport(selectedDish, {
        behavior: "auto",
        viewportBottomInset,
      });
    }, MOBILE_DISH_PANEL_STABLE_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    acknowledgedReferenceNote,
    focusOverlayForCurrentViewport,
    isMobileViewport,
    mobileDishPanelHeight,
    selectedDish,
    selectedOverlaySignature,
  ]);

  const persistGuestSelections = useCallback(
    ({ allergens, diets }) => {
      if (typeof onSaveGuestPreferences !== "function") return;
      onSaveGuestPreferences({
        allergies: allergens,
        diets,
      });
    },
    [onSaveGuestPreferences],
  );

  const onGuestAllergenEditToggle = useCallback(() => {
    if (!allowGuestPreferenceEditing) return;
    if (!isEditingGuestAllergens) {
      setDraftGuestAllergenKeys(savedAllergenKeys);
      setIsEditingGuestAllergens(true);
      return;
    }

    persistGuestSelections({
      allergens: draftGuestAllergenKeys,
      diets: isEditingGuestDiets ? draftGuestDietKeys : savedDietKeys,
    });
    setIsEditingGuestAllergens(false);
  }, [
    allowGuestPreferenceEditing,
    draftGuestAllergenKeys,
    draftGuestDietKeys,
    isEditingGuestAllergens,
    isEditingGuestDiets,
    persistGuestSelections,
    savedAllergenKeys,
    savedDietKeys,
  ]);

  const onGuestDietEditToggle = useCallback(() => {
    if (!allowGuestPreferenceEditing) return;
    if (!isEditingGuestDiets) {
      setDraftGuestDietKeys(savedDietKeys);
      setIsEditingGuestDiets(true);
      return;
    }

    persistGuestSelections({
      allergens: isEditingGuestAllergens ? draftGuestAllergenKeys : savedAllergenKeys,
      diets: draftGuestDietKeys,
    });
    setIsEditingGuestDiets(false);
  }, [
    allowGuestPreferenceEditing,
    draftGuestAllergenKeys,
    draftGuestDietKeys,
    isEditingGuestAllergens,
    isEditingGuestDiets,
    persistGuestSelections,
    savedAllergenKeys,
    savedDietKeys,
  ]);

  const showingGuestAllergenEditor = allowGuestPreferenceEditing && isEditingGuestAllergens;
  const showingGuestDietEditor = allowGuestPreferenceEditing && isEditingGuestDiets;
  const visibleAllergenChips = showingGuestAllergenEditor
    ? guestAllergenOptions
    : viewer.savedAllergens;
  const visibleDietChips = showingGuestDietEditor ? guestDietOptions : viewer.savedDiets;

  return (
    <section className="restaurant-viewer">
      <div className="restaurant-header">
        <h1 className="restaurant-title">{restaurant?.name || "Restaurant"}</h1>

        <div className="restaurant-meta-row">
          <div className="restaurant-page-card">
            <button
              type="button"
              className="restaurant-page-thumb"
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
                className="restaurant-page-thumb-viewport"
                style={{
                  left: `${minimapViewport.leftRatio * 100}%`,
                  top: `${minimapViewport.topRatio * 100}%`,
                  width: `${minimapViewport.widthRatio * 100}%`,
                  height: `${minimapViewport.heightRatio * 100}%`,
                }}
              />
            </button>
            <div className="restaurant-page-footer">
              Page {activePageIndex + 1} of {viewer.pageCount}
            </div>
          </div>

          <div className="restaurant-preference-wrap">
            <div className="preference-row">
              <div className="preference-panel pill">
                <div className="preference-header">
                  <div className="preference-title">{preferencePrefix} allergens</div>
                  {allowGuestPreferenceEditing ? (
                    <button
                      type="button"
                      className="btnLink preference-edit"
                      onClick={onGuestAllergenEditToggle}
                    >
                      {showingGuestAllergenEditor ? "Save" : "Edit"}
                    </button>
                  ) : showPreferenceEdit ? (
                    <Link href="/account" className="btnLink preference-edit">
                      Edit
                    </Link>
                  ) : null}
                </div>
                <div
                  className={`preference-chips chips ${
                    showingGuestAllergenEditor ? "is-editing" : ""
                  }`}
                >
                  {visibleAllergenChips.length ? (
                    visibleAllergenChips.map((item) =>
                      showingGuestAllergenEditor ? (
                        <button
                          key={item.key}
                          type="button"
                          className={`chip preference-chip ${
                            draftGuestAllergenKeys.includes(item.key) ? "active" : ""
                          }`}
                          onClick={() =>
                            setDraftGuestAllergenKeys((current) =>
                              toggleSelection(current, item.key),
                            )
                          }
                        >
                          {item.emoji || "⚠"} {item.label}
                        </button>
                      ) : (
                        <span key={item.key} className="chip active preference-chip">
                          {item.emoji || "⚠"} {item.label}
                        </span>
                      ),
                    )
                  ) : (
                    <span className="note">{`No ${preferencePrefixLower} allergens`}</span>
                  )}
                </div>
              </div>

              <div className="preference-panel pill">
                <div className="preference-header">
                  <div className="preference-title">{preferencePrefix} diets</div>
                  {allowGuestPreferenceEditing ? (
                    <button
                      type="button"
                      className="btnLink preference-edit"
                      onClick={onGuestDietEditToggle}
                    >
                      {showingGuestDietEditor ? "Save" : "Edit"}
                    </button>
                  ) : showPreferenceEdit ? (
                    <Link href="/account" className="btnLink preference-edit">
                      Edit
                    </Link>
                  ) : null}
                </div>
                <div
                  className={`preference-chips chips ${
                    showingGuestDietEditor ? "is-editing" : ""
                  }`}
                >
                  {visibleDietChips.length ? (
                    visibleDietChips.map((item) =>
                      showingGuestDietEditor ? (
                        <button
                          key={item.key}
                          type="button"
                          className={`chip preference-chip ${
                            draftGuestDietKeys.includes(item.key) ? "active" : ""
                          }`}
                          onClick={() =>
                            setDraftGuestDietKeys((current) =>
                              toggleSelection(current, item.key),
                            )
                          }
                        >
                          {item.emoji || "✓"} {item.label}
                        </button>
                      ) : (
                        <span key={item.key} className="chip active preference-chip">
                          {item.emoji || "✓"} {item.label}
                        </span>
                      ),
                    )
                  ) : (
                    <span className="note">{`No ${preferencePrefixLower} diets`}</span>
                  )}
                </div>
              </div>
            </div>

            <div className="restaurant-actions-row">
              {actionButtons.map((action) =>
                action.disabled ? (
                  <button
                    key={action.key}
                    type="button"
                    className={`restaurant-action-btn ${action.tone === "danger" ? "danger" : ""}`}
                    disabled
                  >
                    {action.label}
                  </button>
                ) : action.external ? (
                  <a
                    key={action.key}
                    href={action.href}
                    className={`restaurant-action-btn ${action.tone === "danger" ? "danger" : ""}`}
                    target={action.href.startsWith("http") ? "_blank" : undefined}
                    rel={action.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  >
                    {action.label}
                  </a>
                ) : (
                  <Link
                    key={action.key}
                    href={action.href}
                    className={`restaurant-action-btn ${action.tone === "danger" ? "danger" : ""}`}
                  >
                    {action.label}
                  </Link>
                ),
              )}
            </div>

            <p className="restaurant-confirmed-text">
              Last confirmed by restaurant staff: {lastConfirmedLabel}
            </p>
          </div>
        </div>

        <div className="restaurant-legend" aria-label="Menu symbol keys">
          <div className="restaurant-legend-keys">
            <span className="restaurant-legend-item">
              <span className="legend-box safe" /> Complies
            </span>
            <span className="restaurant-legend-item">
              <span className="legend-box removable" /> Can be modified
            </span>
            <span className="restaurant-legend-item">
              <span className="legend-box unsafe" /> Cannot be modified
            </span>
          </div>
          <p className="restaurant-legend-risk">⚠ Cross-contamination risk</p>
          <p className="restaurant-legend-guidance">
            👆 Tap dishes for details · 🤏 Pinch menu to zoom in/out
          </p>
        </div>

        {!acknowledgedReferenceNote ? (
          <div className="restaurant-reference-banner">
            <span>Reference only. Always inform staff about your allergens.</span>
            <button type="button" onClick={dismissReferenceNote}>
              I understand
            </button>
          </div>
        ) : null}
      </div>

      <div
        className={`restaurant-menu-stage ${
          acknowledgedReferenceNote ? "" : "is-locked"
        }`}
      >
        <div
          ref={menuScrollRef}
          className={`restaurant-menu-scroll ${
            acknowledgedReferenceNote ? "" : "is-blurred"
          }`}
        >
          <div
            className={`restaurant-menu-track ${isMenuZoomAnimating ? "is-zoom-animating" : ""}`}
            style={{ "--menu-zoom-scale": menuZoomScale }}
          >
            {viewer.menuPages.map((page) => (
              <div
                key={`page-${page.pageIndex}`}
                className="restaurant-menu-page"
                ref={(node) => {
                  pageRefs.current[page.pageIndex] = node;
                }}
              >
                {page.image ? (
                  <img
                    src={page.image}
                    alt={`${restaurant?.name || "Restaurant"} menu page ${page.pageIndex + 1}`}
                    className="restaurant-menu-image"
                    ref={(node) => {
                      pageImageRefs.current[page.pageIndex] = node;
                    }}
                  />
                ) : (
                  <div className="restaurant-no-image">No menu image available.</div>
                )}

                {page.overlays.map((overlay, index) => (
                  <button
                    key={overlayKey(overlay, index)}
                    type="button"
                    title={overlay.name || overlay.id || "Dish"}
                    aria-label={overlay.name || overlay.id || "Dish"}
                    onClick={() => {
                      if (!acknowledgedReferenceNote) return;
                      if (isMobileViewport && !selectedOverlay) {
                        captureViewportForMobileDishFocus();
                      }
                      viewer.selectDish(overlay.id);
                      setSelectedOverlay(overlay);
                      if (!isMobileViewport) {
                        focusOverlayForCurrentViewport(overlay);
                      }
                    }}
                    className={`restaurant-overlay ${
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
                    <span className="restaurant-overlay-warning">
                      {overlay.hasCrossContamination ? "⚠" : ""}
                    </span>
                    <span className="restaurant-overlay-info">i</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {acknowledgedReferenceNote && selectedDish ? (
          <aside
            ref={isMobileViewport ? mobileDishPanelRef : null}
            className={`restaurant-dish-popover ${isMobileViewport ? "is-mobile" : ""}`}
            style={isMobileViewport ? undefined : selectedDishPopupStyle}
          >
            <header className="restaurant-dish-popover-header">
              <div className="restaurant-dish-popover-title-wrap">
                <h2>{selectedDish.name || "Dish details"}</h2>
                <button
                  type="button"
                  className="restaurant-dish-popover-favorite-btn"
                  aria-label="Toggle favorite dish"
                  onClick={() => viewer.toggleFavoriteDish(selectedDish)}
                  disabled={favoriteBusyDish === selectedDish.id}
                >
                  {lovedDishes.has(selectedDish.id) ? "♥" : "♡"}
                </button>
              </div>
              <button
                type="button"
                className="restaurant-dish-popover-close-btn"
                aria-label="Close dish details"
                onClick={closeDishDetails}
              >
                ×
              </button>
            </header>

            <div className="restaurant-dish-popover-body">
              <section className="restaurant-dish-popover-section">
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
                  <p className="dish-row-empty">{`No ${preferencePrefixLower} allergens.`}</p>
                )}
              </section>

              <section className="restaurant-dish-popover-section">
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
                  <p className="dish-row-empty">{`No ${preferencePrefixLower} diets.`}</p>
                )}
              </section>
            </div>

            <Button
              size="compact"
              tone="primary"
              className="restaurant-dish-order-btn"
              onClick={() => {
                viewer.addDishToOrder(selectedDish);
                closeDishDetails();
              }}
            >
              Add to order
            </Button>
          </aside>
        ) : null}

      </div>

      {showGuestSignupBanner ? (
        <div className="restaurant-guest-signup-banner">
          <span>
            Create a free account to save your preferences and browse other restaurants
          </span>
          <Link href={guestSignupHref}>Create a free account</Link>
        </div>
      ) : null}

      <footer className="restaurant-help-fab">
        <Link href="/help-contact">Help</Link>
      </footer>
    </section>
  );
}

export default RestaurantViewer;
