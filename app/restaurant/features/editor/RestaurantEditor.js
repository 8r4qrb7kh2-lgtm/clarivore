"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  buildMinimapViewport,
  computeMinimapJumpTarget,
} from "../shared/minimapGeometry";
import { useMinimapSync } from "../shared/useMinimapSync";
import { asText, clamp, normalizeToken, parseOverlayNumber } from "./editorUtils";
import { DishEditorModal } from "./DishEditorModal";
import {
  ChangeLogModal,
  SaveReviewModal,
  ConfirmInfoModal,
  MenuPagesModal,
  RestaurantSettingsModal,
} from "./EditorModals";

const EDITOR_MIN_ZOOM_SCALE = 0.5;
const EDITOR_MAX_ZOOM_SCALE = 3;

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

export function RestaurantEditor({ editor, onNavigate, runtimeConfigHealth }) {
  // Canvas refs and interaction refs coordinate pointer-driven overlay editing.
  const menuScrollRef = useRef(null);
  const pageRefs = useRef([]);
  const pageImageRefs = useRef([]);
  const overlayInteractionRef = useRef(null);
  const stopOverlayInteractionRef = useRef(() => {});
  const mappingDragRef = useRef(null);
  const saveButtonRef = useRef(null);
  const zoomScaleRef = useRef(1);
  const pinchGestureRef = useRef({
    active: false,
    startDistance: 0,
    startScale: 1,
    anchorX: 0,
    anchorY: 0,
  });
  const [mappedRectPreview, setMappedRectPreview] = useState(null);
  const [saveReviewOpen, setSaveReviewOpen] = useState(false);
  const [saveIssueAlert, setSaveIssueAlert] = useState(null);
  const [saveIssueJumpRequest, setSaveIssueJumpRequest] = useState(null);
  const [confirmationGuide, setConfirmationGuide] = useState(null);

  // Save button state is tied to dirty/saving/result markers from the shared editor state.
  const saveButtonVisible = Boolean(
    editor.isDirty ||
      editor.isSaving ||
      editor.saveStatus === "saved" ||
      editor.saveStatus === "error",
  );
  const saveButtonLabel = editor.isSaving
    ? "Saving..."
    : editor.saveStatus === "saved"
      ? "Saved"
      : editor.saveStatus === "error"
        ? "Retry save"
        : "Save to site";
  const saveButtonClass =
    editor.saveStatus === "error"
      ? "btnDanger"
      : editor.saveStatus === "saved"
        ? "btnSuccess"
        : "btnPrimary";

  const detectDishes = editor.detectWizardState.dishes || [];
  const mappedCount = detectDishes.filter((dish) => dish.mapped).length;
  const allMapped = detectDishes.length > 0 && mappedCount >= detectDishes.length;
  const currentWizardDish = detectDishes[editor.detectWizardState.currentIndex] || null;
  const mappingEnabled =
    editor.detectWizardOpen &&
    !editor.detectWizardState.loading &&
    Boolean(currentWizardDish) &&
    !allMapped;

  // Save issue helpers keep unresolved row confirmations navigable from toolbar and modal.
  const resolveIssueContext = useCallback(
    (issue) => {
      const requestedOverlayKey = asText(issue?.overlayKey);
      const overlayToken = normalizeToken(issue?.overlayName);
      const rowIndexRaw = Number(issue?.rowIndex);
      const rowIndex =
        Number.isFinite(rowIndexRaw) && rowIndexRaw >= 0
          ? Math.floor(rowIndexRaw)
          : -1;
      const overlays = Array.isArray(editor.overlays) ? editor.overlays : [];
      const matchedOverlay =
        overlays.find((overlay) => asText(overlay?._editorKey) === requestedOverlayKey) ||
        overlays.find((overlay) => normalizeToken(overlay?.id || overlay?.name) === overlayToken);
      const matchedIngredients = Array.isArray(matchedOverlay?.ingredients)
        ? matchedOverlay.ingredients
        : [];
      const rowIngredientName =
        rowIndex >= 0 ? asText(matchedIngredients[rowIndex]?.name) : "";
      const ingredientName =
        asText(issue?.ingredientName || rowIngredientName) ||
        (rowIndex >= 0 ? `Ingredient ${rowIndex + 1}` : "");
      const overlayName =
        asText(issue?.overlayName || matchedOverlay?.id || matchedOverlay?.name) || "Dish";
      const overlayKey = asText(matchedOverlay?._editorKey || requestedOverlayKey);
      const ingredientToken = normalizeToken(ingredientName);
      const issueKey =
        overlayKey && rowIndex >= 0
          ? `${overlayKey}:${rowIndex}`
          : `${normalizeToken(overlayName)}:${ingredientToken}`;

      return {
        ...issue,
        overlayKey,
        overlayName,
        ingredientName,
        rowIndex,
        message:
          asText(issue?.message) ||
          `${overlayName}: ${ingredientName || "Ingredient"} must be confirmed before saving`,
        issueKey,
        canJump: Boolean(overlayKey && (rowIndex >= 0 || ingredientToken)),
      };
    },
    [editor.overlays],
  );

  const buildActiveConfirmationIssueKeys = useCallback(() => {
    return new Set(
      editor
        .getIngredientConfirmationIssues()
        .map((issue) => resolveIssueContext(issue).issueKey),
    );
  }, [editor, resolveIssueContext]);

  const buildJumpableConfirmationIssues = useCallback(() => {
    return editor
      .getIngredientConfirmationIssues()
      .map((issue) => resolveIssueContext(issue))
      .filter((issue) => issue.canJump);
  }, [editor, resolveIssueContext]);

  const returnToWebpageEditor = useCallback(() => {
    if (!editor.dishEditorOpen) return;
    editor.pushHistory();
    editor.closeDishEditor();
    window.setTimeout(() => {
      saveButtonRef.current?.focus?.();
    }, 0);
  }, [editor]);

  const requestJumpToIssue = useCallback(
    (issue) => {
      if (!issue?.canJump) return;
      editor.selectOverlay(issue.overlayKey);
      editor.openDishEditor(issue.overlayKey);
      setSaveIssueJumpRequest({
        requestId: Date.now(),
        overlayKey: issue.overlayKey,
        ingredientName: issue.ingredientName,
        ingredientIndex:
          Number.isFinite(Number(issue?.rowIndex)) && Number(issue.rowIndex) >= 0
            ? Math.floor(Number(issue.rowIndex))
            : undefined,
      });
    },
    [editor],
  );

  const triggerSave = useCallback(async () => {
    if (editor.isSaving) return;
    const resolvedIssues = editor
      .getIngredientConfirmationIssues()
      .map((issue) => resolveIssueContext(issue));
    if (resolvedIssues.length) {
      setConfirmationGuide(null);
      setSaveIssueAlert({
        ...resolvedIssues[0],
        issueCount: resolvedIssues.length,
      });
      return;
    }

    setSaveIssueAlert(null);
    const staged = await editor.preparePendingSave();
    if (!staged?.success) {
      return;
    }
    setSaveReviewOpen(true);
  }, [editor, resolveIssueContext]);

  const startConfirmationGuide = useCallback(() => {
    const guideIssues = buildJumpableConfirmationIssues();
    if (!guideIssues.length) return;
    setSaveIssueAlert(null);
    setConfirmationGuide({ issues: guideIssues, currentIndex: 0, confirmedHistory: [] });
    requestJumpToIssue(guideIssues[0]);
  }, [buildJumpableConfirmationIssues, requestJumpToIssue]);

  const goToPreviousGuideIssue = useCallback(() => {
    setConfirmationGuide((current) => {
      if (!current) return current;
      const history = Array.isArray(current.confirmedHistory)
        ? current.confirmedHistory
        : [];
      if (!history.length) return current;

      const currentIssueKey = current.issues[current.currentIndex]?.issueKey;
      const currentHistoryIndex = currentIssueKey
        ? history.lastIndexOf(currentIssueKey)
        : -1;
      const targetHistoryIndex =
        currentHistoryIndex > 0
          ? currentHistoryIndex - 1
          : currentHistoryIndex === -1
            ? history.length - 1
            : -1;
      if (targetHistoryIndex < 0) return current;

      const targetIssueKey = history[targetHistoryIndex];
      const previousIndex = current.issues.findIndex(
        (issue) => issue.issueKey === targetIssueKey,
      );
      if (previousIndex < 0) return current;

      requestJumpToIssue(current.issues[previousIndex]);
      return {
        ...current,
        currentIndex: previousIndex,
      };
    });
  }, [requestJumpToIssue]);

  const goToNextGuideIssue = useCallback(() => {
    setConfirmationGuide((current) => {
      if (!current?.issues?.length) return current;

      const unresolvedKeys = buildActiveConfirmationIssueKeys();
      if (!unresolvedKeys.size) return current;

      const nextIndex = current.issues.findIndex(
        (issue, index) => index > current.currentIndex && unresolvedKeys.has(issue.issueKey),
      );
      const targetIndex =
        nextIndex >= 0
          ? nextIndex
          : current.issues.findIndex((issue) => unresolvedKeys.has(issue.issueKey));

      if (targetIndex < 0 || targetIndex === current.currentIndex) return current;

      requestJumpToIssue(current.issues[targetIndex]);
      return {
        ...current,
        currentIndex: targetIndex,
      };
    });
  }, [buildActiveConfirmationIssueKeys, requestJumpToIssue]);

  const cancelConfirmationGuide = useCallback(() => {
    setConfirmationGuide(null);
  }, []);

  const confirmSaveFromReview = useCallback(async () => {
    if (editor.isSaving) return;
    const result = await editor.save();
    if (result?.success) {
      setSaveReviewOpen(false);
    }
  }, [editor]);

  useEffect(() => {
    if (!saveReviewOpen) return;
    if (editor.pendingSaveBatchId) return;
    setSaveReviewOpen(false);
  }, [editor.pendingSaveBatchId, saveReviewOpen]);

  useEffect(() => {
    if (!saveIssueAlert?.issueKey) return;
    const activeIssueKeys = buildActiveConfirmationIssueKeys();
    if (!activeIssueKeys.has(saveIssueAlert.issueKey)) {
      setSaveIssueAlert(null);
    }
  }, [buildActiveConfirmationIssueKeys, saveIssueAlert]);

  useEffect(() => {
    if (!confirmationGuide?.issues?.length) return;

    const unresolvedKeys = buildActiveConfirmationIssueKeys();

    if (!unresolvedKeys.size) {
      setConfirmationGuide(null);
      setSaveIssueAlert(null);
      returnToWebpageEditor();
      return;
    }

    const currentIssue = confirmationGuide.issues[confirmationGuide.currentIndex];
    if (!currentIssue) return;
    const confirmedHistory = Array.isArray(confirmationGuide.confirmedHistory)
      ? confirmationGuide.confirmedHistory
      : [];
    if (unresolvedKeys.has(currentIssue.issueKey)) {
      return;
    }

    if (confirmedHistory.includes(currentIssue.issueKey)) {
      return;
    }

    const nextHistory = [...confirmedHistory, currentIssue.issueKey];

    const nextIndex = confirmationGuide.issues.findIndex(
      (issue, index) =>
        index > confirmationGuide.currentIndex && unresolvedKeys.has(issue.issueKey),
    );
    if (nextIndex >= 0) {
      const nextIssue = confirmationGuide.issues[nextIndex];
      setConfirmationGuide((current) =>
        current
          ? {
              ...current,
              currentIndex: nextIndex,
              confirmedHistory: nextHistory,
            }
          : current,
      );
      requestJumpToIssue(nextIssue);
      return;
    }

    const firstRemainingIndex = confirmationGuide.issues.findIndex((issue) =>
      unresolvedKeys.has(issue.issueKey),
    );
    if (firstRemainingIndex >= 0) {
      const firstRemainingIssue = confirmationGuide.issues[firstRemainingIndex];
      setConfirmationGuide((current) =>
        current
          ? {
              ...current,
              currentIndex: firstRemainingIndex,
              confirmedHistory: nextHistory,
            }
          : current,
      );
      requestJumpToIssue(firstRemainingIssue);
      return;
    }

    setConfirmationGuide(null);
  }, [buildActiveConfirmationIssueKeys, confirmationGuide, requestJumpToIssue, returnToWebpageEditor]);

  const guideCanBack = useMemo(() => {
    if (!confirmationGuide?.issues?.length) return false;
    const history = Array.isArray(confirmationGuide.confirmedHistory)
      ? confirmationGuide.confirmedHistory
      : [];
    if (!history.length) return false;
    const currentIssueKey = confirmationGuide.issues[confirmationGuide.currentIndex]?.issueKey;
    const currentHistoryIndex = currentIssueKey
      ? history.lastIndexOf(currentIssueKey)
      : -1;
    if (currentHistoryIndex > 0) return true;
    return currentHistoryIndex === -1;
  }, [confirmationGuide]);

  const guideCanForward = useMemo(() => {
    if (!confirmationGuide?.issues?.length) return false;
    const unresolvedKeys = buildActiveConfirmationIssueKeys();
    if (!unresolvedKeys.size) return false;

    const nextIndex = confirmationGuide.issues.findIndex(
      (issue, index) =>
        index > confirmationGuide.currentIndex && unresolvedKeys.has(issue.issueKey),
    );
    if (nextIndex >= 0) return true;

    const firstRemainingIndex = confirmationGuide.issues.findIndex((issue) =>
      unresolvedKeys.has(issue.issueKey),
    );
    return firstRemainingIndex >= 0 && firstRemainingIndex !== confirmationGuide.currentIndex;
  }, [buildActiveConfirmationIssueKeys, confirmationGuide]);

  // Minimap sync keeps page and scroll position aligned while zooming/editing.
  const {
    activePageIndex: minimapActivePageIndex,
    scrollSnapshot,
    refreshScrollSnapshot,
  } = useMinimapSync({
    enabled: true,
    menuScrollRef,
    pageRefs,
    pageImageRefs,
    pageCount: editor.overlaysByPage.length,
    pageVersionKey: `${editor.overlaysByPage.length}:${editor.zoomScale}`,
    initialActivePageIndex: editor.activePageIndex,
    onActivePageChange: editor.jumpToPage,
  });

  useEffect(() => {
    zoomScaleRef.current = clamp(
      Number(editor.zoomScale) || 1,
      EDITOR_MIN_ZOOM_SCALE,
      EDITOR_MAX_ZOOM_SCALE,
    );
    refreshScrollSnapshot();
  }, [editor.zoomScale, refreshScrollSnapshot]);

  const minimapViewport = useMemo(() => {
    const scrollNode = menuScrollRef.current;
    const pageNode =
      pageRefs.current[minimapActivePageIndex] ||
      pageImageRefs.current[minimapActivePageIndex];
    return buildMinimapViewport(scrollNode, pageNode);
  }, [
    minimapActivePageIndex,
    scrollSnapshot.clientHeight,
    scrollSnapshot.clientWidth,
    scrollSnapshot.scrollLeft,
    scrollSnapshot.scrollTop,
  ]);

  const jumpFromMinimap = useCallback(
    (event) => {
      const scrollNode = menuScrollRef.current;
      const pageNode =
        pageRefs.current[minimapActivePageIndex] ||
        pageImageRefs.current[minimapActivePageIndex];
      if (!scrollNode || !pageNode) return;

      const bounds = event.currentTarget.getBoundingClientRect();
      if (!bounds.height) return;
      const ratio = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
      const target = computeMinimapJumpTarget(scrollNode, pageNode, ratio);

      scrollNode.scrollTo({ top: target, behavior: "smooth" });
    },
    [minimapActivePageIndex],
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
    const pointerX = midpoint.x - bounds.left;
    const pointerY = midpoint.y - bounds.top;
    const startScale = clamp(
      Number(zoomScaleRef.current) || 1,
      EDITOR_MIN_ZOOM_SCALE,
      EDITOR_MAX_ZOOM_SCALE,
    );

    pinchGestureRef.current = {
      active: true,
      startDistance,
      startScale,
      anchorX: (scrollNode.scrollLeft + pointerX) / Math.max(startScale, 0.001),
      anchorY: (scrollNode.scrollTop + pointerY) / Math.max(startScale, 0.001),
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

      const nextScale = clamp(
        (distance / pinch.startDistance) * pinch.startScale,
        EDITOR_MIN_ZOOM_SCALE,
        EDITOR_MAX_ZOOM_SCALE,
      );
      if (Math.abs(nextScale - zoomScaleRef.current) < 0.005) return;

      const midpoint = getTouchMidpoint(touchA, touchB);
      const bounds = scrollNode.getBoundingClientRect();
      const pointerX = midpoint.x - bounds.left;
      const pointerY = midpoint.y - bounds.top;
      const targetLeft = pinch.anchorX * nextScale - pointerX;
      const targetTop = pinch.anchorY * nextScale - pointerY;

      editor.setZoomScale(nextScale);

      window.requestAnimationFrame(() => {
        const liveScrollNode = menuScrollRef.current;
        if (!liveScrollNode) return;
        const maxLeft = Math.max(liveScrollNode.scrollWidth - liveScrollNode.clientWidth, 0);
        const maxTop = Math.max(liveScrollNode.scrollHeight - liveScrollNode.clientHeight, 0);
        liveScrollNode.scrollLeft = clamp(targetLeft, 0, maxLeft);
        liveScrollNode.scrollTop = clamp(targetTop, 0, maxTop);
        refreshScrollSnapshot();
      });
    },
    [editor, refreshScrollSnapshot],
  );

  useEffect(() => {
    const scrollNode = menuScrollRef.current;
    if (!scrollNode) return undefined;

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
  }, [continuePinchGesture, endPinchGesture, startPinchGesture]);

  const getOverlaySnapTargets = useCallback(
    (pageIndex, overlayKey) => {
      const page = editor.overlaysByPage[pageIndex];
      if (!page) {
        return { xEdges: [], yEdges: [] };
      }

      const xEdges = [];
      const yEdges = [];
      page.overlays.forEach((overlay) => {
        if (overlay._editorKey === overlayKey) return;
        const x = parseOverlayNumber(overlay.x);
        const y = parseOverlayNumber(overlay.y);
        const w = parseOverlayNumber(overlay.w);
        const h = parseOverlayNumber(overlay.h);
        xEdges.push(x, x + w);
        yEdges.push(y, y + h);
      });

      return { xEdges, yEdges };
    },
    [editor.overlaysByPage],
  );

  const snapValue = (value, targets, threshold) => {
    for (const target of targets) {
      if (Math.abs(value - target) < threshold) {
        return target;
      }
    }
    return value;
  };

  const stopOverlayInteraction = useCallback((changeLabel) => {
    const interaction = overlayInteractionRef.current;
    if (!interaction) return;

    window.removeEventListener(interaction.moveEventName || "pointermove", interaction.onMove);
    window.removeEventListener(interaction.upEventName || "pointerup", interaction.onUp);
    window.removeEventListener("pointercancel", interaction.onUp);
    if (interaction.captureTarget && interaction.onLostCapture) {
      interaction.captureTarget.removeEventListener(
        "lostpointercapture",
        interaction.onLostCapture,
      );
    }

    if (
      interaction.captureTarget &&
      typeof interaction.captureTarget.releasePointerCapture === "function" &&
      Number.isFinite(Number(interaction.pointerId))
    ) {
      try {
        interaction.captureTarget.releasePointerCapture(interaction.pointerId);
      } catch {
        // Ignore pointer release failures.
      }
    }

    overlayInteractionRef.current = null;

    if (interaction.overlayKey) {
      const overlayName = asText(interaction.overlayName) || "Dish";
      const summary = asText(changeLabel) || "Adjusted overlay position";
      editor.updateOverlay(
        interaction.overlayKey,
        (overlay) => overlay,
        {
          changeText: `${overlayName}: ${summary}`,
          changeKey: `overlay-position:${interaction.overlayKey}`,
          recordHistory: true,
        },
      );
    }
  }, [editor]);

  useEffect(() => {
    stopOverlayInteractionRef.current = stopOverlayInteraction;
  }, [stopOverlayInteraction]);

  const shouldIgnoreOverlayPointerStart = useCallback(
    (event, overlay) => {
      if (mappingEnabled) return true;
      if (pinchGestureRef.current.active) return true;
      if (!overlay?._editorKey) return true;
      if (event?.pointerType === "touch" && event?.isPrimary === false) return true;
      if (event?.type === "pointerdown" && event?.pointerType === "mouse") return true;
      if (event?.pointerType === "mouse" && event.button !== 0) return true;
      if (event?.type === "mousedown" && event.button !== 0) return true;
      return false;
    },
    [mappingEnabled],
  );

  const createOverlayInteractionMeta = useCallback((event) => {
    const pointerId = Number.isFinite(Number(event.pointerId))
      ? Number(event.pointerId)
      : null;
    const captureTarget = event.currentTarget;
    if (
      captureTarget &&
      typeof captureTarget.setPointerCapture === "function" &&
      pointerId !== null
    ) {
      try {
        captureTarget.setPointerCapture(pointerId);
      } catch {
        // Ignore pointer capture failures.
      }
    }

    return {
      pointerId,
      captureTarget,
      moveEventName: pointerId !== null ? "pointermove" : "mousemove",
      upEventName: pointerId !== null ? "pointerup" : "mouseup",
    };
  }, []);

  const beginOverlayInteraction = useCallback((overlay, interactionMeta, onMove, onUp) => {
    const onLostCapture = () => onUp();

    if (interactionMeta.captureTarget && interactionMeta.pointerId !== null) {
      interactionMeta.captureTarget.addEventListener("lostpointercapture", onLostCapture);
    }

    overlayInteractionRef.current = {
      overlayKey: overlay._editorKey,
      overlayName: asText(overlay?.id || overlay?.name) || "Dish",
      pointerId: interactionMeta.pointerId,
      captureTarget: interactionMeta.captureTarget,
      moveEventName: interactionMeta.moveEventName,
      upEventName: interactionMeta.upEventName,
      onLostCapture,
      onMove,
      onUp,
    };

    window.addEventListener(interactionMeta.moveEventName, onMove);
    window.addEventListener(interactionMeta.upEventName, onUp);
    window.addEventListener("pointercancel", onUp);
  }, []);

  const startDragOverlay = useCallback(
    (event, overlay, pageIndex) => {
      if (shouldIgnoreOverlayPointerStart(event, overlay)) return;
      if (event.target.closest(".handle") || event.target.closest(".editBadge")) return;

      event.preventDefault();
      editor.selectOverlay(overlay._editorKey);
      const interactionMeta = createOverlayInteractionMeta(event);

      const pageNode = pageRefs.current[pageIndex];
      if (!pageNode) return;
      const pageRect = pageNode.getBoundingClientRect();

      const start = {
        x: event.clientX,
        y: event.clientY,
        left: parseOverlayNumber(overlay.x),
        top: parseOverlayNumber(overlay.y),
      };

      const onMove = (moveEvent) => {
        const dx = ((moveEvent.clientX - start.x) / Math.max(pageRect.width, 1)) * 100;
        const dy = ((moveEvent.clientY - start.y) / Math.max(pageRect.height, 1)) * 100;

        const width = parseOverlayNumber(overlay.w);
        const height = parseOverlayNumber(overlay.h);

        const nextX = clamp(start.left + dx, 0, 100 - width);
        const nextY = clamp(start.top + dy, 0, 100 - height);

        editor.updateOverlay(overlay._editorKey, {
          x: nextX,
          y: nextY,
        });
      };

      const onUp = () => {
        stopOverlayInteraction("Adjusted overlay position");
      };

      beginOverlayInteraction(overlay, interactionMeta, onMove, onUp);
    },
    [
      beginOverlayInteraction,
      createOverlayInteractionMeta,
      editor,
      shouldIgnoreOverlayPointerStart,
      stopOverlayInteraction,
    ],
  );

  const startResizeOverlay = useCallback(
    (event, overlay, pageIndex, corner) => {
      if (shouldIgnoreOverlayPointerStart(event, overlay)) return;

      event.preventDefault();
      event.stopPropagation();
      editor.selectOverlay(overlay._editorKey);
      const interactionMeta = createOverlayInteractionMeta(event);

      const pageNode = pageRefs.current[pageIndex];
      if (!pageNode) return;
      const pageRect = pageNode.getBoundingClientRect();
      const snapThreshold = 0.3;
      const snapTargets = getOverlaySnapTargets(pageIndex, overlay._editorKey);

      const start = {
        x: event.clientX,
        y: event.clientY,
        left: parseOverlayNumber(overlay.x),
        top: parseOverlayNumber(overlay.y),
        width: parseOverlayNumber(overlay.w),
        height: parseOverlayNumber(overlay.h),
      };

      const onMove = (moveEvent) => {
        const dx = ((moveEvent.clientX - start.x) / Math.max(pageRect.width, 1)) * 100;
        const dy = ((moveEvent.clientY - start.y) / Math.max(pageRect.height, 1)) * 100;

        let x = start.left;
        let y = start.top;
        let w = start.width;
        let h = start.height;

        if (corner === "se") {
          w = start.width + dx;
          h = start.height + dy;
        }
        if (corner === "ne") {
          w = start.width + dx;
          h = start.height - dy;
          y = start.top + dy;
        }
        if (corner === "sw") {
          w = start.width - dx;
          h = start.height + dy;
          x = start.left + dx;
        }
        if (corner === "nw") {
          w = start.width - dx;
          h = start.height - dy;
          x = start.left + dx;
          y = start.top + dy;
        }

        w = clamp(w, 1, 100);
        h = clamp(h, 0.5, 100);
        x = clamp(x, 0, 100 - w);
        y = clamp(y, 0, 100 - h);

        const right = x + w;
        const bottom = y + h;

        if (corner === "se") {
          const snappedRight = snapValue(right, snapTargets.xEdges, snapThreshold);
          const snappedBottom = snapValue(bottom, snapTargets.yEdges, snapThreshold);
          if (snappedRight !== right) w = clamp(snappedRight - x, 1, 100);
          if (snappedBottom !== bottom) h = clamp(snappedBottom - y, 0.5, 100);
        }

        if (corner === "ne") {
          const snappedRight = snapValue(right, snapTargets.xEdges, snapThreshold);
          const snappedTop = snapValue(y, snapTargets.yEdges, snapThreshold);
          if (snappedRight !== right) w = clamp(snappedRight - x, 1, 100);
          if (snappedTop !== y) {
            const oldBottom = y + h;
            y = snappedTop;
            h = clamp(oldBottom - y, 0.5, 100);
          }
        }

        if (corner === "sw") {
          const snappedLeft = snapValue(x, snapTargets.xEdges, snapThreshold);
          const snappedBottom = snapValue(bottom, snapTargets.yEdges, snapThreshold);
          if (snappedLeft !== x) {
            const oldRight = x + w;
            x = snappedLeft;
            w = clamp(oldRight - x, 1, 100);
          }
          if (snappedBottom !== bottom) h = clamp(snappedBottom - y, 0.5, 100);
        }

        if (corner === "nw") {
          const snappedLeft = snapValue(x, snapTargets.xEdges, snapThreshold);
          const snappedTop = snapValue(y, snapTargets.yEdges, snapThreshold);
          if (snappedLeft !== x) {
            const oldRight = x + w;
            x = snappedLeft;
            w = clamp(oldRight - x, 1, 100);
          }
          if (snappedTop !== y) {
            const oldBottom = y + h;
            y = snappedTop;
            h = clamp(oldBottom - y, 0.5, 100);
          }
        }

        w = clamp(w, 1, 100);
        h = clamp(h, 0.5, 100);
        x = clamp(x, 0, 100 - w);
        y = clamp(y, 0, 100 - h);

        editor.updateOverlay(overlay._editorKey, {
          x,
          y,
          w,
          h,
        });
      };

      const onUp = () => {
        stopOverlayInteraction("Adjusted overlay position");
      };

      beginOverlayInteraction(overlay, interactionMeta, onMove, onUp);
    },
    [
      beginOverlayInteraction,
      createOverlayInteractionMeta,
      editor,
      getOverlaySnapTargets,
      shouldIgnoreOverlayPointerStart,
      stopOverlayInteraction,
    ],
  );

  useEffect(() => {
    return () => {
      stopOverlayInteractionRef.current();
    };
  }, []);

  const onPagePointerDown = useCallback(
    (event, pageIndex) => {
      if (!mappingEnabled) return;
      if (event.button !== 0) return;
      if (pinchGestureRef.current.active) return;
      if (event?.pointerType === "touch" && event?.isPrimary === false) return;

      const pageNode = pageRefs.current[pageIndex];
      if (!pageNode) return;
      const rect = pageNode.getBoundingClientRect();

      const startX = clamp(((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100, 0, 100);
      const startY = clamp(((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100, 0, 100);

      mappingDragRef.current = {
        pageIndex,
        startX,
        startY,
        currentX: startX,
        currentY: startY,
      };

      setMappedRectPreview({
        pageIndex,
        x: startX,
        y: startY,
        w: 0,
        h: 0,
      });

      const onMove = (moveEvent) => {
        const moveX = clamp(
          ((moveEvent.clientX - rect.left) / Math.max(rect.width, 1)) * 100,
          0,
          100,
        );
        const moveY = clamp(
          ((moveEvent.clientY - rect.top) / Math.max(rect.height, 1)) * 100,
          0,
          100,
        );

        const drag = mappingDragRef.current;
        if (!drag) return;

        drag.currentX = moveX;
        drag.currentY = moveY;

        const x = Math.min(drag.startX, moveX);
        const y = Math.min(drag.startY, moveY);
        const w = Math.abs(moveX - drag.startX);
        const h = Math.abs(moveY - drag.startY);

        setMappedRectPreview({ pageIndex, x, y, w, h });
      };

      const onUp = () => {
        const drag = mappingDragRef.current;
        mappingDragRef.current = null;
        setMappedRectPreview(null);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);

        if (!drag) return;
        const x = Math.min(drag.startX, drag.currentX);
        const y = Math.min(drag.startY, drag.currentY);
        const w = Math.abs(drag.currentX - drag.startX);
        const h = Math.abs(drag.currentY - drag.startY);

        if (w <= 1 || h <= 1) return;
        editor.mapDetectedDish({ x, y, w, h, pageIndex: drag.pageIndex });
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [editor, mappingEnabled],
  );

  if (!editor.canEdit) {
    return (
      <section className="rounded-2xl border border-[rgba(124,156,255,0.2)] bg-[rgba(11,14,34,0.82)] p-4">
        <p className="m-0 text-sm text-[#b9c6eb]">
          You do not have edit access for this restaurant.
        </p>
      </section>
    );
  }

  return (
    <section className="restaurant-editor">
      <div className="editorLayout restaurant-editor-layout">
        <div className="editorHeaderStack restaurant-editor-header">
          <div className="editorHeaderRow hasMiniMap">
            <div className="editorMiniMapSlot">
              <div className="restaurant-page-card">
                <button
                  type="button"
                  className="restaurant-page-thumb"
                  onPointerDown={jumpFromMinimap}
                  onClick={jumpFromMinimap}
                  title="Jump to menu area"
                >
                  {editor.draftMenuImages[minimapActivePageIndex] ? (
                    <img
                      src={editor.draftMenuImages[minimapActivePageIndex]}
                      alt={`Menu thumbnail page ${minimapActivePageIndex + 1}`}
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
                  Page {minimapActivePageIndex + 1} of {editor.draftMenuImages.length}
                </div>
              </div>
            </div>

            <div className="editorControlColumn">
              <div className="editorToolbarScale">
                <div className="editorToolbar">
                  <div className="editorGroup">
                    <div className="editorGroupLabel">Editing</div>
                    <div className="editorGroupButtons">
                      <button className="btn btnPrimary editorActionCompact" onClick={editor.addOverlay}>
                        + Add overlay
                      </button>
                      <div className="editorInlineDualButtons">
                        <button
                          className="btn editorActionCompact"
                          onClick={editor.undo}
                          disabled={!editor.canUndo}
                          style={{ flex: 1, width: "auto", minWidth: 0, opacity: editor.canUndo ? 1 : 0.5 }}
                        >
                          ↶ Undo
                        </button>
                        <button
                          className="btn editorActionCompact"
                          onClick={editor.redo}
                          disabled={!editor.canRedo}
                          style={{ flex: 1, width: "auto", minWidth: 0, opacity: editor.canRedo ? 1 : 0.5 }}
                        >
                          ↷ Redo
                        </button>
                      </div>
                      {saveButtonVisible ? (
                        <button
                          ref={saveButtonRef}
                          className={`btn ${saveButtonClass}`}
                          onClick={triggerSave}
                          disabled={editor.isSaving}
                        >
                          {saveButtonLabel}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="editorGroup">
                    <div className="editorGroupLabel">Menu pages</div>
                    <div className="editorGroupButtons">
                      <button className="btn" onClick={() => editor.setMenuPagesOpen(true)}>
                        🗂 Edit menu images
                      </button>
                      <button className="btn" onClick={() => editor.setChangeLogOpen(true)}>
                        📋 View log of changes
                      </button>
                    </div>
                  </div>

                  <div className="editorGroup">
                    <div className="editorGroupLabel">Restaurant</div>
                    <div className="editorGroupButtons">
                      <button
                        className="btn editorRestaurantSettingsBtn"
                        onClick={() => editor.setRestaurantSettingsOpen(true)}
                      >
                        ⚙ Restaurant settings
                      </button>
                      <button
                        className="btn btnDanger"
                        onClick={() => editor.setConfirmInfoOpen(true)}
                      >
                        Confirm information is up-to-date
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {saveIssueAlert ? (
                <div className="rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
                  <div>
                    {Number(saveIssueAlert.issueCount) === 1
                      ? "1 ingredient row is still unconfirmed."
                      : `${Math.max(Number(saveIssueAlert.issueCount) || 0, 1)} ingredient rows are still unconfirmed.`}
                  </div>
                  {saveIssueAlert.canJump ? (
                    <button
                      type="button"
                      className="btn btnDanger btnSmall mt-2"
                      onClick={startConfirmationGuide}
                    >
                      Confirm unconfirmed rows
                    </button>
                  ) : (
                    <div className="mt-2">
                      Open each dish and mark every ingredient row as confirmed before saving.
                    </div>
                  )}
                </div>
              ) : null}

              <div className="editorNoteRow">
                <div className="note" id="editorNote">
                  Drag to move. Drag any corner to resize. Click ✏️ to edit details.
                </div>
              </div>

              {editor.saveError ? (
                <p className="m-0 rounded-lg border border-[#a12525] bg-[rgba(139,29,29,0.32)] px-3 py-2 text-sm text-[#ffd0d0]">
                  {editor.saveError}
                </p>
              ) : null}

            </div>
          </div>

          {editor.detectWizardOpen ? (
            <div id="detectedDishesPanel" style={{ display: "block", background: "#1a2351", border: "1px solid #2a3261", borderRadius: 12, padding: 20, marginBottom: 4, textAlign: "center" }}>
              <div style={{ fontSize: "1.3rem", fontWeight: 600, marginBottom: 8 }} id="currentDishName">
                {editor.detectWizardState.loading
                  ? "Detecting dishes..."
                  : allMapped
                    ? "All items mapped!"
                    : currentWizardDish?.name || "No dishes detected"}
              </div>
              <div className="note" style={{ marginBottom: 12 }}>
                {mappingEnabled
                  ? "Press and drag on the menu to create an overlay for this item"
                  : allMapped
                    ? "All detected dishes are mapped."
                    : editor.detectWizardState.error || ""}
              </div>
              <div style={{ display: "flex", gap: 12, justifyContent: "center", alignItems: "center", fontSize: 14, flexWrap: "wrap" }}>
                <button
                  className="btn"
                  id="prevDishBtn"
                  style={{ padding: "6px 12px", fontSize: 13 }}
                  disabled={editor.detectWizardState.currentIndex <= 0}
                  onClick={() => editor.setDetectWizardIndex(editor.detectWizardState.currentIndex - 1)}
                >
                  ← Previous
                </button>
                <span id="dishProgress" style={{ color: "#a8b2d6" }}>
                  {editor.detectWizardState.loading
                    ? "Analyzing..."
                    : `${mappedCount} of ${detectDishes.length} mapped`}
                </span>
                <button
                  className="btn"
                  id="nextDishBtn"
                  style={{ padding: "6px 12px", fontSize: 13 }}
                  disabled={editor.detectWizardState.currentIndex >= detectDishes.length - 1}
                  onClick={() => editor.setDetectWizardIndex(editor.detectWizardState.currentIndex + 1)}
                >
                  Next →
                </button>
                <button
                  className="btn btnSuccess"
                  id="finishMappingBtn"
                  style={{ padding: "6px 12px", fontSize: 13, display: mappedCount > 0 ? "inline-flex" : "none" }}
                  onClick={editor.closeDetectWizard}
                >
                  ✓ Finish Mapping
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div
          ref={menuScrollRef}
          className="restaurant-editor-stage restaurant-editor-scroll"
          style={{ cursor: mappingEnabled ? "crosshair" : "default" }}
        >
          {/* Page canvas renders source images plus absolute-positioned editable overlays. */}
          <div
            className="restaurant-editor-canvas"
            style={{
              zoom: editor.zoomScale,
            }}
          >
            {editor.overlaysByPage.map((page) => (
              <div
                key={`editor-page-${page.pageIndex}`}
                ref={(node) => {
                  pageRefs.current[page.pageIndex] = node;
                }}
                className="restaurant-editor-page"
                style={{ position: "relative", width: "100%" }}
                onPointerDown={(event) => onPagePointerDown(event, page.pageIndex)}
              >
                {page.image ? (
                  <img
                    src={page.image}
                    alt={`Menu page ${page.pageIndex + 1}`}
                    className="restaurant-editor-image"
                    ref={(node) => {
                      pageImageRefs.current[page.pageIndex] = node;
                    }}
                  />
                ) : (
                  <div className="restaurant-no-image">No menu image available.</div>
                )}

                {page.overlays.map((overlay) => {
                  const isSelected = editor.selectedOverlayKey === overlay._editorKey;
                  return (
                    <div
                      key={overlay._editorKey}
                      className={`editBox ${isSelected ? "active" : ""}`}
                      style={{
                        left: `${parseOverlayNumber(overlay.x)}%`,
                        top: `${parseOverlayNumber(overlay.y)}%`,
                        width: `${parseOverlayNumber(overlay.w)}%`,
                        height: `${parseOverlayNumber(overlay.h)}%`,
                        pointerEvents: mappingEnabled ? "none" : "auto",
                      }}
                      title={overlay.id || "Dish"}
                      onPointerDown={(event) => startDragOverlay(event, overlay, page.pageIndex)}
                      onMouseDown={(event) => {
                        startDragOverlay(event, overlay, page.pageIndex);
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        editor.selectOverlay(overlay._editorKey);
                      }}
                    >
                      <button
                        type="button"
                        className="editBadge"
                        title="Edit this item"
                        onClick={(event) => {
                          event.stopPropagation();
                          editor.openDishEditor(overlay._editorKey);
                        }}
                      >
                        ✏️
                      </button>

                      {(["nw", "ne", "sw", "se"]).map((corner) => (
                        <div
                          key={`${overlay._editorKey}-${corner}`}
                          className={`handle ${corner}`}
                          onPointerDown={(event) =>
                            startResizeOverlay(event, overlay, page.pageIndex, corner)
                          }
                          onMouseDown={(event) => {
                            startResizeOverlay(event, overlay, page.pageIndex, corner);
                          }}
                        />
                      ))}
                    </div>
                  );
                })}

                {mappedRectPreview && mappedRectPreview.pageIndex === page.pageIndex ? (
                  <div
                    style={{
                      position: "absolute",
                      left: `${mappedRectPreview.x}%`,
                      top: `${mappedRectPreview.y}%`,
                      width: `${mappedRectPreview.w}%`,
                      height: `${mappedRectPreview.h}%`,
                      border: "2px dashed #4caf50",
                      background: "rgba(76,175,80,0.2)",
                      pointerEvents: "none",
                      zIndex: 1000,
                    }}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="restaurant-help-fab">
        {typeof onNavigate === "function" ? (
          <a
            href="/help-contact"
            onClick={(event) => {
              event.preventDefault();
              onNavigate("/help-contact");
            }}
          >
            Help
          </a>
        ) : (
          <Link href="/help-contact">Help</Link>
        )}
      </footer>

      <DishEditorModal
        editor={editor}
        runtimeConfigHealth={runtimeConfigHealth}
        saveIssueJumpRequest={saveIssueJumpRequest}
        onSaveIssueJumpHandled={() => setSaveIssueJumpRequest(null)}
        confirmationGuide={
          confirmationGuide
            ? {
                ...confirmationGuide,
                canBack: guideCanBack,
                canForward: guideCanForward,
              }
            : null
        }
        onGuideBack={goToPreviousGuideIssue}
        onGuideForward={goToNextGuideIssue}
        onGuideCancel={cancelConfirmationGuide}
      />
      <SaveReviewModal
        editor={editor}
        open={saveReviewOpen}
        onOpenChange={setSaveReviewOpen}
        onConfirmSave={confirmSaveFromReview}
      />
      <ChangeLogModal editor={editor} />
      <ConfirmInfoModal editor={editor} />
      <MenuPagesModal editor={editor} />
      <RestaurantSettingsModal editor={editor} />
    </section>
  );
}

export default RestaurantEditor;
