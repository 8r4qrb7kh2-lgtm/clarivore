import { useCallback } from "react";

import { buildPageMoveIndexMap } from "../utils/imageProcessing";
import { ensureOverlayVisibility } from "../utils/overlayGeometry";
import { asText, clamp } from "../utils/text";

// Page management actions for menu images.
// These handlers keep page indices and overlays aligned whenever pages are added, replaced, removed, or moved.

export function useMenuPageActions({
  activePageIndex,
  draftMenuImages,
  menuImagesRef,

  setDraftMenuImages,
  setActivePageIndex,
  setZoomScale,

  applyOverlayList,
  appendPendingChange,
  pushHistory,
}) {
  // Insert one or many pages, optionally at a specific index.
  // Overlay page indices are shifted when insertion happens in the middle.
  const addMenuPages = useCallback((images, options = {}) => {
    const values = (Array.isArray(images) ? images : [])
      .map((value) => asText(value))
      .filter(Boolean);
    if (!values.length) {
      return { added: 0, startIndex: menuImagesRef.current.length };
    }

    const currentLength = Math.max(menuImagesRef.current.length, 1);
    const requestedIndex = Number(options?.atIndex);
    const insertAt = Number.isFinite(requestedIndex)
      ? clamp(Math.floor(requestedIndex), 0, currentLength)
      : currentLength;

    setDraftMenuImages((current) => {
      const next = [...current];
      next.splice(insertAt, 0, ...values);
      menuImagesRef.current = next;
      return next;
    });

    if (insertAt < currentLength) {
      applyOverlayList((current) =>
        current.map((overlay) => {
          const page = Number.isFinite(Number(overlay.pageIndex))
            ? Number(overlay.pageIndex)
            : 0;
          if (page >= insertAt) {
            return { ...overlay, pageIndex: page + values.length };
          }
          return overlay;
        }),
      );
    }

    setActivePageIndex((current) => {
      if (Number.isFinite(Number(options?.focusIndex))) {
        return clamp(
          insertAt + Math.floor(Number(options.focusIndex)),
          0,
          Math.max(menuImagesRef.current.length - 1, 0),
        );
      }
      return clamp(current, 0, Math.max(menuImagesRef.current.length - 1, 0));
    });

    appendPendingChange(
      `Menu pages: Added ${values.length} page${values.length === 1 ? "" : "s"}`,
    );
    appendPendingChange(
      `Menu images: Uploaded ${values.length} new image${values.length === 1 ? "" : "s"}`,
    );
    queueMicrotask(() => pushHistory());

    return {
      added: values.length,
      startIndex: insertAt,
    };
  }, [appendPendingChange, applyOverlayList, menuImagesRef, pushHistory, setActivePageIndex, setDraftMenuImages]);

  // Single-page convenience wrapper.
  const addMenuPage = useCallback((imageDataUrl) => {
    const value = asText(imageDataUrl);
    if (!value) return;
    addMenuPages([value]);
  }, [addMenuPages]);

  // Replace a page with one or many segmented image sections.
  // Overlay boxes from the source page are remapped to the best target section.
  const replaceMenuPageWithSections = useCallback((index, sections) => {
    const entries = (Array.isArray(sections) ? sections : [])
      .map((section) => {
        if (typeof section === "string") {
          return {
            dataUrl: asText(section),
            yStart: 0,
            yEnd: 100,
          };
        }

        const dataUrl = asText(section?.dataUrl || section?.image);
        const rawStart = Number(section?.yStart ?? section?.bounds?.yStart ?? 0);
        const rawEnd = Number(section?.yEnd ?? section?.bounds?.yEnd ?? 100);
        return {
          dataUrl,
          yStart: clamp(Number.isFinite(rawStart) ? rawStart : 0, 0, 100),
          yEnd: clamp(Number.isFinite(rawEnd) ? rawEnd : 100, 0, 100),
        };
      })
      .filter((entry) => entry.dataUrl);

    if (!entries.length) return { replaced: false, sectionCount: 0 };

    // Normalize incoming section descriptors into clamped 0..100 Y bounds.
    const normalizedEntries = entries.map((entry, entryIndex) => {
      const defaultStart = (entryIndex * 100) / entries.length;
      const defaultEnd = ((entryIndex + 1) * 100) / entries.length;
      const yStart = Number.isFinite(entry.yStart) ? entry.yStart : defaultStart;
      const yEnd = Number.isFinite(entry.yEnd) ? entry.yEnd : defaultEnd;
      const safeStart = clamp(Math.min(yStart, yEnd), 0, 100);
      const safeEnd = clamp(Math.max(yStart, yEnd), 0, 100);
      return {
        dataUrl: entry.dataUrl,
        yStart: safeStart,
        yEnd: safeEnd <= safeStart ? Math.min(100, safeStart + 0.1) : safeEnd,
      };
    });

    const targetIndex = clamp(
      Number(index) || 0,
      0,
      Math.max(menuImagesRef.current.length - 1, 0),
    );
    const delta = normalizedEntries.length - 1;
    const nextPageCount = Math.max(menuImagesRef.current.length + delta, 1);

    // Apply image list replacement first so page count is known for overlay remaps.
    setDraftMenuImages((current) => {
      const next = [...current];
      next.splice(
        targetIndex,
        1,
        ...normalizedEntries.map((entry) => entry.dataUrl),
      );
      menuImagesRef.current = next.length ? next : [""];
      return menuImagesRef.current;
    });

    // Move/clip overlays so each one remains visible in its mapped section.
    applyOverlayList((current) =>
      current.map((overlay) => {
        const page = Number.isFinite(Number(overlay.pageIndex))
          ? Number(overlay.pageIndex)
          : 0;

        if (page < targetIndex) {
          return ensureOverlayVisibility(overlay, nextPageCount);
        }

        if (page > targetIndex) {
          return ensureOverlayVisibility(
            { ...overlay, pageIndex: page + delta },
            nextPageCount,
          );
        }

        if (normalizedEntries.length === 1) {
          return ensureOverlayVisibility(
            { ...overlay, pageIndex: targetIndex },
            nextPageCount,
          );
        }

        const top = clamp(Number(overlay.y) || 0, 0, 100);
        const height = clamp(Number(overlay.h) || 1, 0.5, 100);
        const bottom = clamp(top + height, 0, 100);
        const centerY = top + height / 2;

        let targetSectionIndex = 0;
        let bestOverlap = -1;

        normalizedEntries.forEach((entry, entryIndex) => {
          const overlap = Math.max(
            0,
            Math.min(bottom, entry.yEnd) - Math.max(top, entry.yStart),
          );
          if (overlap > bestOverlap) {
            bestOverlap = overlap;
            targetSectionIndex = entryIndex;
          }
        });

        if (bestOverlap <= 0) {
          const fallbackIndex = normalizedEntries.findIndex(
            (entry) => centerY >= entry.yStart && centerY <= entry.yEnd,
          );
          if (fallbackIndex >= 0) targetSectionIndex = fallbackIndex;
        }

        const section =
          normalizedEntries[targetSectionIndex] || normalizedEntries[0] || null;
        if (!section) {
          return ensureOverlayVisibility(
            { ...overlay, pageIndex: targetIndex },
            nextPageCount,
          );
        }

        const sectionSpan = Math.max(section.yEnd - section.yStart, 0.1);
        const clippedTop = clamp(top, section.yStart, section.yEnd);
        const clippedBottom = clamp(bottom, section.yStart, section.yEnd);
        let sectionTop = ((clippedTop - section.yStart) / sectionSpan) * 100;
        let sectionBottom = ((clippedBottom - section.yStart) / sectionSpan) * 100;

        if (sectionBottom - sectionTop < 0.5) {
          const center = ((centerY - section.yStart) / sectionSpan) * 100;
          sectionTop = clamp(center - 1, 0, 99.5);
          sectionBottom = clamp(center + 1, sectionTop + 0.5, 100);
        }

        return ensureOverlayVisibility(
          {
            ...overlay,
            pageIndex: targetIndex + targetSectionIndex,
            y: sectionTop,
            h: Math.max(0.5, sectionBottom - sectionTop),
          },
          nextPageCount,
        );
      }),
    );

    setActivePageIndex((current) => {
      if (current < targetIndex) return current;
      if (current === targetIndex) return targetIndex;
      return clamp(current + delta, 0, Math.max(nextPageCount - 1, 0));
    });

    appendPendingChange(
      `Menu pages: Replaced page ${targetIndex + 1} with ${normalizedEntries.length} section${normalizedEntries.length === 1 ? "" : "s"}`,
    );
    appendPendingChange(
      `Menu images: Uploaded replacement image for page ${targetIndex + 1}`,
    );
    queueMicrotask(() => pushHistory());

    return { replaced: true, sectionCount: normalizedEntries.length };
  }, [appendPendingChange, applyOverlayList, menuImagesRef, pushHistory, setActivePageIndex, setDraftMenuImages]);

  // Single-section convenience wrapper around replace-by-sections.
  const replaceMenuPage = useCallback((index, imageDataUrl) => {
    const value = asText(imageDataUrl);
    if (!value) return;
    replaceMenuPageWithSections(index, [value]);
  }, [replaceMenuPageWithSections]);

  // Remove a page and collapse overlay indices above the removed page.
  const removeMenuPage = useCallback((index) => {
    const targetIndex = clamp(Number(index) || 0, 0, Math.max(draftMenuImages.length - 1, 0));

    setDraftMenuImages((current) => {
      const next = current.filter((_, i) => i !== targetIndex);
      if (!next.length) {
        next.push("");
      }
      menuImagesRef.current = next;
      return next;
    });

    applyOverlayList((current) => {
      const next = current
        .filter((overlay) => {
          const page = Number.isFinite(Number(overlay.pageIndex))
            ? Number(overlay.pageIndex)
            : 0;
          return page !== targetIndex;
        })
        .map((overlay) => {
          const page = Number.isFinite(Number(overlay.pageIndex))
            ? Number(overlay.pageIndex)
            : 0;
          if (page > targetIndex) {
            return { ...overlay, pageIndex: page - 1 };
          }
          return overlay;
        });
      return next;
    });

    setActivePageIndex((current) => clamp(current, 0, Math.max(menuImagesRef.current.length - 1, 0)));
    appendPendingChange(`Menu pages: Removed page ${targetIndex + 1}`);
    queueMicrotask(() => pushHistory());
  }, [appendPendingChange, applyOverlayList, draftMenuImages.length, menuImagesRef, pushHistory, setActivePageIndex, setDraftMenuImages]);

  // Move one page to a new index and remap all overlay page indices accordingly.
  const moveMenuPage = useCallback((fromIndex, toIndex) => {
    const pageCount = Math.max(menuImagesRef.current.length, 1);
    const safeFrom = clamp(Number(fromIndex) || 0, 0, pageCount - 1);
    const safeTo = clamp(Number(toIndex) || 0, 0, pageCount - 1);
    if (safeFrom === safeTo) {
      return { moved: false, fromIndex: safeFrom, toIndex: safeTo };
    }

    const indexMap = buildPageMoveIndexMap(pageCount, safeFrom, safeTo);

    setDraftMenuImages((current) => {
      const next = [...current];
      const [movedImage] = next.splice(safeFrom, 1);
      next.splice(safeTo, 0, movedImage || "");
      menuImagesRef.current = next.length ? next : [""];
      return menuImagesRef.current;
    });

    applyOverlayList((current) =>
      current.map((overlay) => {
        const page = clamp(
          Number.isFinite(Number(overlay.pageIndex)) ? Number(overlay.pageIndex) : 0,
          0,
          pageCount - 1,
        );
        const mapped = Number.isFinite(Number(indexMap[page])) ? Number(indexMap[page]) : page;
        return ensureOverlayVisibility(
          {
            ...overlay,
            pageIndex: mapped,
          },
          pageCount,
        );
      }),
    );

    setActivePageIndex((current) => {
      const safeCurrent = clamp(Number(current) || 0, 0, pageCount - 1);
      const mapped = Number.isFinite(Number(indexMap[safeCurrent]))
        ? Number(indexMap[safeCurrent])
        : safeCurrent;
      return clamp(mapped, 0, pageCount - 1);
    });

    appendPendingChange(`Menu pages: Moved page ${safeFrom + 1} to ${safeTo + 1}`);
    queueMicrotask(() => pushHistory());

    return { moved: true, fromIndex: safeFrom, toIndex: safeTo };
  }, [appendPendingChange, applyOverlayList, menuImagesRef, pushHistory, setActivePageIndex, setDraftMenuImages]);

  // Jump active page index with bounds safety.
  const jumpToPage = useCallback((index) => {
    setActivePageIndex((current) =>
      clamp(Number(index) || current, 0, Math.max(menuImagesRef.current.length - 1, 0)),
    );
  }, [menuImagesRef, setActivePageIndex]);

  // Increment/decrement zoom in fixed steps.
  const zoomIn = useCallback(() => {
    setZoomScale((current) => clamp(Number((current + 0.25).toFixed(2)), 0.5, 3));
  }, [setZoomScale]);

  const zoomOut = useCallback(() => {
    setZoomScale((current) => clamp(Number((current - 0.25).toFixed(2)), 0.5, 3));
  }, [setZoomScale]);

  // Reset zoom to default.
  const zoomReset = useCallback(() => {
    setZoomScale(1);
  }, [setZoomScale]);

  return {
    addMenuPages,
    addMenuPage,
    replaceMenuPageWithSections,
    replaceMenuPage,
    removeMenuPage,
    moveMenuPage,
    jumpToPage,
    zoomIn,
    zoomOut,
    zoomReset,
  };
}
