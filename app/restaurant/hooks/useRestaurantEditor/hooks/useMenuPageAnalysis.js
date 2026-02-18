import { useCallback } from "react";

import { toDataUrlFromImage, readImageDimensions, normalizeImageToLetterboxedSquare } from "../utils/imageProcessing";
import {
  getSourcePageOverlays,
  normalizeDetectedDishes,
  normalizeRemappedRect,
  scoreRemapDishQuality,
  toLegacyOverlayHint,
} from "../utils/menuAnalysisHelpers";
import { mergePageDetectionsIntoOverlays } from "../utils/menuAnalysisMerge";
import { asText, clamp, normalizeToken } from "../utils/text";

// Orchestrates page-by-page menu analysis and merges detector output into overlay state.
// The API shape matches the original hook so callers can keep existing behavior.

export function useMenuPageAnalysis({
  callbacks,
  menuImagesRef,
  applyOverlayList,
  appendPendingChange,
  pushHistory,
}) {
  return useCallback(async ({
    pageIndices,
    removeUnmatchedPageIndices,
    requireDetectionsForPageIndices,
    pageSourceIndexMap,
    baselineMenuImages,
    baselineOverlays,
  } = {}) => {
    if (!callbacks?.onAnalyzeMenuImage) {
      return {
        success: false,
        updatedCount: 0,
        addedCount: 0,
        removedCount: 0,
        errors: ["Menu image analysis callback is not configured."],
        pageResults: [],
      };
    }

    const pageCount = Math.max(menuImagesRef.current.length, 1);
    const candidatePages =
      Array.isArray(pageIndices) && pageIndices.length
        ? pageIndices
        : Array.from({ length: pageCount }, (_, index) => index);
    const targetPages = Array.from(
      new Set(
        candidatePages
          .map((index) => Number(index))
          .filter((index) => Number.isFinite(index))
          .map((index) => clamp(Math.floor(index), 0, pageCount - 1)),
      ),
    );

    if (!targetPages.length) {
      return {
        success: false,
        updatedCount: 0,
        addedCount: 0,
        removedCount: 0,
        errors: ["No menu pages were selected for analysis."],
        pageResults: [],
      };
    }

    const removeUnmatchedPages = new Set(
      (Array.isArray(removeUnmatchedPageIndices) ? removeUnmatchedPageIndices : [])
        .map((index) => Number(index))
        .filter((index) => Number.isFinite(index))
        .map((index) => clamp(Math.floor(index), 0, pageCount - 1)),
    );
    const requiredDetectionPages = new Set(
      (Array.isArray(requireDetectionsForPageIndices) ? requireDetectionsForPageIndices : [])
        .map((index) => Number(index))
        .filter((index) => Number.isFinite(index))
        .map((index) => clamp(Math.floor(index), 0, pageCount - 1)),
    );

    const sourceIndexMap = Array.isArray(pageSourceIndexMap) ? pageSourceIndexMap : [];
    const baselineImageList = Array.isArray(baselineMenuImages) ? baselineMenuImages : [];
    const baselineOverlayList = Array.isArray(baselineOverlays) ? baselineOverlays : [];
    const useRemapMode = baselineImageList.length > 0 && sourceIndexMap.length > 0;

    const pageDetections = [];
    const pageResults = [];
    const errors = [];

    const addPageResult = ({
      pageIndex,
      success,
      rawDishCount,
      validDishCount,
      error,
      analysisMode,
      fallbackUsed,
    }) => {
      pageResults.push({
        pageIndex,
        success,
        rawDishCount,
        validDishCount,
        removedUnmatched: removeUnmatchedPages.has(pageIndex),
        requiredDetections: requiredDetectionPages.has(pageIndex),
        analysisMode,
        fallbackUsed,
        error: asText(error),
      });
    };

    for (const pageIndex of targetPages) {
      const imageSource = asText(menuImagesRef.current[pageIndex]);
      if (!imageSource) {
        const message = "No menu image available.";
        errors.push(`Page ${pageIndex + 1}: ${message}`);
        addPageResult({ pageIndex, success: false, rawDishCount: 0, validDishCount: 0, error: message });
        continue;
      }

      if (useRemapMode) {
        // eslint-disable-next-line no-await-in-loop
        const newNormalized = await normalizeImageToLetterboxedSquare(imageSource, 1000);
        if (!newNormalized?.dataUrl || !newNormalized?.metrics) {
          const message = "Failed to prepare new menu image for remap analysis.";
          errors.push(`Page ${pageIndex + 1}: ${message}`);
          addPageResult({ pageIndex, success: false, rawDishCount: 0, validDishCount: 0, error: message });
          continue;
        }

        const sourceIndexRaw = Number(sourceIndexMap[pageIndex]);
        const sourceIndex = Number.isFinite(sourceIndexRaw) &&
          sourceIndexRaw >= 0 &&
          sourceIndexRaw < baselineImageList.length
          ? Math.floor(sourceIndexRaw)
          : null;

        let oldNormalized = null;
        if (sourceIndex !== null) {
          const oldImageSource = asText(baselineImageList[sourceIndex]);
          if (oldImageSource) {
            // eslint-disable-next-line no-await-in-loop
            oldNormalized = await normalizeImageToLetterboxedSquare(oldImageSource, 1000);
            if (!oldNormalized?.dataUrl || !oldNormalized?.metrics) {
              oldNormalized = null;
              if (process.env.NODE_ENV !== "production") {
                console.warn("[restaurant-editor] remap old-image normalization failed; continuing without old-image hints", {
                  pageIndex: pageIndex + 1,
                  sourceIndex,
                });
              }
            }
          }
        }

        const sourcePageOverlays = getSourcePageOverlays(sourceIndex, baselineOverlayList);
        const transformedOverlays = oldNormalized?.metrics
          ? sourcePageOverlays
              .map((overlay) => toLegacyOverlayHint(overlay, oldNormalized.metrics))
              .filter(Boolean)
          : [];

        try {
          // eslint-disable-next-line no-await-in-loop
          const result = await callbacks.onAnalyzeMenuImage({
            mode: "remap",
            oldImageData: oldNormalized?.dataUrl || "",
            newImageData: newNormalized.dataUrl,
            overlays: transformedOverlays,
            imageWidth: 1000,
            imageHeight: 1000,
            pageIndex,
          });

          if (!result?.success) {
            const rawDishCount = Number.isFinite(Number(result?.rawDishCount))
              ? Number(result.rawDishCount)
              : Array.isArray(result?.updatedOverlays) || Array.isArray(result?.newOverlays)
                ? (Array.isArray(result?.updatedOverlays) ? result.updatedOverlays.length : 0) +
                  (Array.isArray(result?.newOverlays) ? result.newOverlays.length : 0)
                : 0;
            const message = asText(result?.error) || "Menu remap analysis failed.";
            errors.push(`Page ${pageIndex + 1}: ${message}`);
            addPageResult({ pageIndex, success: false, rawDishCount, validDishCount: 0, error: message });
            continue;
          }

          const rawUpdated = Array.isArray(result?.updatedOverlays)
            ? result.updatedOverlays
            : [];
          let rawNew = Array.isArray(result?.newOverlays)
            ? result.newOverlays
            : [];
          if (!rawUpdated.length && !rawNew.length && Array.isArray(result?.dishes)) {
            rawNew = result.dishes;
          }

          const seenUpdated = new Set();
          const updatedDishes = rawUpdated
            .map((dish) =>
              normalizeRemappedRect(
                dish,
                newNormalized.metrics,
                { width: newNormalized.imageWidth, height: newNormalized.imageHeight },
              ),
            )
            .filter(Boolean)
            .filter((dish) => {
              const token = normalizeToken(dish?.name);
              if (!token || seenUpdated.has(token)) return false;
              seenUpdated.add(token);
              return true;
            });

          const seenNew = new Set();
          const updatedTokens = new Set(updatedDishes.map((dish) => normalizeToken(dish?.name)));
          const newDishes = rawNew
            .map((dish) =>
              normalizeRemappedRect(
                dish,
                newNormalized.metrics,
                { width: newNormalized.imageWidth, height: newNormalized.imageHeight },
              ),
            )
            .filter(Boolean)
            .filter((dish) => {
              const token = normalizeToken(dish?.name);
              if (!token || updatedTokens.has(token) || seenNew.has(token)) return false;
              seenNew.add(token);
              return true;
            });

          const rawDishCount = Number.isFinite(Number(result?.rawDishCount))
            ? Number(result.rawDishCount)
            : rawUpdated.length + rawNew.length;
          const validDishCount = updatedDishes.length + newDishes.length;
          const remapQuality = scoreRemapDishQuality([...updatedDishes, ...newDishes]);

          if (remapQuality.isLowQuality) {
            // Low-quality remaps are replaced by a clean detect pass on the new image.
            // eslint-disable-next-line no-await-in-loop
            const fallbackResult = await callbacks.onAnalyzeMenuImage({
              mode: "detect",
              imageData: newNormalized.dataUrl,
              imageWidth: 1000,
              imageHeight: 1000,
              pageIndex,
            });

            if (!fallbackResult?.success) {
              const message =
                asText(fallbackResult?.error) ||
                "Low-quality remap fallback detection failed.";
              errors.push(`Page ${pageIndex + 1}: ${message}`);
              addPageResult({
                pageIndex,
                success: false,
                rawDishCount,
                validDishCount,
                analysisMode: "detect-fallback",
                fallbackUsed: true,
                error: message,
              });
              continue;
            }

            const fallbackRawDishCount = Number.isFinite(Number(fallbackResult?.rawDishCount))
              ? Number(fallbackResult.rawDishCount)
              : Array.isArray(fallbackResult?.dishes)
                ? fallbackResult.dishes.length
                : 0;
            const fallbackSeenTokens = new Set();
            const fallbackDishes = (Array.isArray(fallbackResult?.dishes) ? fallbackResult.dishes : [])
              .map((dish) =>
                normalizeRemappedRect(
                  dish,
                  newNormalized.metrics,
                  { width: newNormalized.imageWidth, height: newNormalized.imageHeight },
                ),
              )
              .filter(Boolean)
              .filter((dish) => {
                const token = normalizeToken(dish?.name);
                if (!token || fallbackSeenTokens.has(token)) return false;
                fallbackSeenTokens.add(token);
                return true;
              });
            const fallbackValidDishCount = fallbackDishes.length;

            if (requiredDetectionPages.has(pageIndex) && fallbackValidDishCount === 0) {
              const pageError =
                `Page ${pageIndex + 1}: Low-quality remap fallback detected no valid dish overlays. Try a clearer image or retry analysis.`;
              errors.push(pageError);
              addPageResult({
                pageIndex,
                success: false,
                rawDishCount: fallbackRawDishCount,
                validDishCount: fallbackValidDishCount,
                analysisMode: "detect-fallback",
                fallbackUsed: true,
                error: pageError,
              });
              continue;
            }

            const fallbackDetectedTokens = new Set(
              fallbackDishes.map((dish) => normalizeToken(dish?.name)).filter(Boolean),
            );
            pageDetections.push({
              pageIndex,
              mode: "detect",
              dishes: fallbackDishes,
              detectedTokens: fallbackDetectedTokens,
            });
            addPageResult({
              pageIndex,
              success: true,
              rawDishCount: fallbackRawDishCount,
              validDishCount: fallbackValidDishCount,
              analysisMode: "detect-fallback",
              fallbackUsed: true,
            });
            continue;
          }

          if (requiredDetectionPages.has(pageIndex) && validDishCount === 0) {
            const pageError =
              `Page ${pageIndex + 1}: No valid dish overlays detected. Try a clearer image or retry analysis.`;
            errors.push(pageError);
            addPageResult({
              pageIndex,
              success: false,
              rawDishCount,
              validDishCount,
              analysisMode: "remap",
              fallbackUsed: false,
              error: pageError,
            });
            continue;
          }

          const detectedTokens = new Set(
            [...updatedDishes, ...newDishes]
              .map((dish) => normalizeToken(dish?.name))
              .filter(Boolean),
          );
          pageDetections.push({
            pageIndex,
            mode: "remap",
            updatedDishes,
            newDishes,
            replacePageOverlays: updatedDishes.length === 0 && newDishes.length > 0,
            detectedTokens,
          });
          addPageResult({
            pageIndex,
            success: true,
            rawDishCount,
            validDishCount,
            analysisMode: "remap",
            fallbackUsed: false,
          });
          continue;
        } catch (error) {
          const message = asText(error?.message) || "Menu remap analysis failed.";
          errors.push(`Page ${pageIndex + 1}: ${message}`);
          addPageResult({ pageIndex, success: false, rawDishCount: 0, validDishCount: 0, error: message });
          continue;
        }
      }

      // eslint-disable-next-line no-await-in-loop
      const imageData = await toDataUrlFromImage(imageSource);
      if (!imageData) {
        const message = "Failed to prepare image for analysis.";
        errors.push(`Page ${pageIndex + 1}: ${message}`);
        addPageResult({ pageIndex, success: false, rawDishCount: 0, validDishCount: 0, error: message });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const imageDimensions = await readImageDimensions(imageData);

      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await callbacks.onAnalyzeMenuImage({
          imageData,
          imageWidth: Number(imageDimensions?.width) || undefined,
          imageHeight: Number(imageDimensions?.height) || undefined,
          pageIndex,
        });
        if (!result?.success) {
          const rawDishCount = Number.isFinite(Number(result?.rawDishCount))
            ? Number(result.rawDishCount)
            : Array.isArray(result?.dishes)
              ? result.dishes.length
              : 0;
          const message = asText(result?.error) || "Menu image analysis failed.";
          errors.push(`Page ${pageIndex + 1}: ${message}`);
          addPageResult({ pageIndex, success: false, rawDishCount, validDishCount: 0, error: message });
          continue;
        }

        const rawDishCount = Number.isFinite(Number(result?.rawDishCount))
          ? Number(result.rawDishCount)
          : Array.isArray(result?.dishes)
            ? result.dishes.length
            : 0;
        const dishes = normalizeDetectedDishes(result?.dishes, imageDimensions);
        const validDishCount = dishes.length;

        if (requiredDetectionPages.has(pageIndex) && validDishCount === 0) {
          const pageError =
            `Page ${pageIndex + 1}: No valid dish overlays detected. Try a clearer image or retry analysis.`;
          errors.push(pageError);
          addPageResult({
            pageIndex,
            success: false,
            rawDishCount,
            validDishCount,
            analysisMode: "detect",
            fallbackUsed: false,
            error: pageError,
          });
          continue;
        }

        pageDetections.push({
          pageIndex,
          mode: "detect",
          dishes,
          detectedTokens: new Set(dishes.map((dish) => normalizeToken(dish?.name))),
        });
        addPageResult({
          pageIndex,
          success: true,
          rawDishCount,
          validDishCount,
          analysisMode: "detect",
          fallbackUsed: false,
        });
      } catch (error) {
        const message = asText(error?.message) || "Menu image analysis failed.";
        errors.push(`Page ${pageIndex + 1}: ${message}`);
        addPageResult({ pageIndex, success: false, rawDishCount: 0, validDishCount: 0, error: message });
      }
    }

    if (errors.length) {
      return {
        success: false,
        updatedCount: 0,
        addedCount: 0,
        removedCount: 0,
        errors,
        pageResults,
      };
    }

    // Merge is isolated in a pure helper so this callback stays focused on analysis flow.
    const mergeSummary = { updatedCount: 0, addedCount: 0, removedCount: 0 };
    applyOverlayList((current) => {
      const result = mergePageDetectionsIntoOverlays({
        current,
        pageDetections,
        removeUnmatchedPages,
        pageCount,
      });
      mergeSummary.updatedCount = result.updatedCount;
      mergeSummary.addedCount = result.addedCount;
      mergeSummary.removedCount = result.removedCount;
      return result.next;
    });

    const { updatedCount, addedCount, removedCount } = mergeSummary;

    if (updatedCount || addedCount) {
      appendPendingChange(
        `Menu analysis: Updated ${updatedCount} overlay${updatedCount === 1 ? "" : "s"}, added ${addedCount} overlay${addedCount === 1 ? "" : "s"}, removed ${removedCount} overlay${removedCount === 1 ? "" : "s"}.`,
      );
    } else if (removedCount) {
      appendPendingChange(
        `Menu analysis: Removed ${removedCount} unmatched overlay${removedCount === 1 ? "" : "s"}.`,
      );
    } else {
      appendPendingChange("Menu analysis: No dishes detected on selected pages.");
    }

    queueMicrotask(() => pushHistory());

    return {
      success: true,
      updatedCount,
      addedCount,
      removedCount,
      errors: [],
      pageResults,
    };
  }, [appendPendingChange, applyOverlayList, callbacks, menuImagesRef, pushHistory]);
}
