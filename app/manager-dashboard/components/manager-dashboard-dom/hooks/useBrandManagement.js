import { useCallback, useMemo, useState } from "react";
import { supabaseClient as supabase } from "../../../../lib/supabase";
import {
  commitRestaurantWrite,
  discardRestaurantWrite,
  stageRestaurantWrite,
} from "../../../../lib/restaurantWriteGatewayClient";
import {
  collectBrandItemsFromOverlays,
  replaceBrandInOverlays,
} from "../utils/brandUtils";

// Handles the brand-items panel: search/filter state, item expansion,
// and the staged write flow for replacing an ingredient brand.
export function useBrandManagement({
  currentRestaurantData,
  setCurrentRestaurantData,
  selectedRestaurantId,
  normalizeAllergen,
  normalizeDietLabel,
  managerDisplayName,
  setStatus,
  ingredientScan,
  DIETS,
}) {
  const [brandSearchQuery, setBrandSearchQuery] = useState("");
  const [expandedBrandKeys, setExpandedBrandKeys] = useState({});
  const [isReplacingBrand, setIsReplacingBrand] = useState(false);

  const brandItems = useMemo(
    () => collectBrandItemsFromOverlays(currentRestaurantData?.overlays || []),
    [currentRestaurantData?.overlays],
  );

  const filteredBrandItems = useMemo(() => {
    const query = String(brandSearchQuery || "").trim().toLowerCase();
    if (!query) return brandItems;

    return brandItems.filter((item) => {
      const haystack = [item.brandName, ...(item.ingredientNames || []), ...(item.dishes || [])]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [brandItems, brandSearchQuery]);

  const onToggleBrandItem = useCallback((itemKey) => {
    setExpandedBrandKeys((current) => ({
      ...current,
      [itemKey]: !current[itemKey],
    }));
  }, []);

  const onOpenDishEditor = useCallback(
    (dishName, ingredientName) => {
      // Navigates to existing restaurant editor with deep-link query params.
      const slug = currentRestaurantData?.slug || "";
      if (!slug || !dishName) return;

      const params = new URLSearchParams({
        slug,
        edit: "1",
        openAI: "true",
        dishName,
      });
      if (ingredientName) {
        params.set("ingredientName", ingredientName);
      }

      window.location.href = `/restaurant?${params.toString()}`;
    },
    [currentRestaurantData],
  );

  const onApplyBrandReplacement = useCallback(
    async (result, brandItem) => {
      if (!supabase || !selectedRestaurantId || !brandItem) return;

      // Build canonical replacement brand payload from scan result.
      const ingredientText = String(result?.ingredientText || "").trim();
      const ingredientLines = Array.isArray(result?.ingredientsList)
        ? result.ingredientsList
            .map((line) => String(line || "").trim())
            .filter(Boolean)
        : ingredientText
          ? [ingredientText]
          : [];
      const newBrandName =
        String(result?.productName || "").trim() || brandItem.brandName || "New brand item";

      const newBrand = {
        name: newBrandName,
        barcode: "",
        brandImage: result?.brandImage || "",
        image: "",
        ingredientsImage: result?.ingredientsImage || "",
        ingredientsList: ingredientLines,
        ingredientList: ingredientText || ingredientLines.join(" "),
        allergens: Array.isArray(result?.allergens) ? result.allergens : [],
        crossContaminationAllergens: Array.isArray(result?.crossContaminationAllergens)
          ? result.crossContaminationAllergens
          : [],
        diets: Array.isArray(result?.diets) ? result.diets : [],
        crossContaminationDiets: Array.isArray(result?.crossContaminationDiets)
          ? result.crossContaminationDiets
          : [],
      };

      try {
        setIsReplacingBrand(true);

        const updatedOverlays = replaceBrandInOverlays(
          currentRestaurantData?.overlays || [],
          brandItem,
          newBrand,
          normalizeAllergen,
          normalizeDietLabel,
        );

        const expectedWriteVersion = Number(currentRestaurantData?.write_version);
        const safeExpectedWriteVersion = Number.isFinite(expectedWriteVersion)
          ? Math.max(Math.floor(expectedWriteVersion), 0)
          : null;

        // Stage write first, then ask for user confirmation before commit.
        const stageResult = await stageRestaurantWrite({
          supabase,
          payload: {
            scopeType: "RESTAURANT",
            restaurantId: selectedRestaurantId,
            operationType: "BRAND_REPLACEMENT",
            operationPayload: {
              overlays: updatedOverlays,
              menuImage: currentRestaurantData?.menuImage || "",
              menuImages: Array.isArray(currentRestaurantData?.menuImages)
                ? currentRestaurantData.menuImages
                : [],
              changePayload: {
                author: managerDisplayName || "Manager",
                general: [
                  `Brand replacement: ${brandItem.brandName || "Brand"} -> ${newBrandName}`,
                ],
                items: {},
              },
            },
            summary: `Replace brand item ${brandItem.brandName || "Brand"}`,
            author: managerDisplayName || "Manager",
            ...(Number.isFinite(safeExpectedWriteVersion)
              ? { expectedWriteVersion: safeExpectedWriteVersion }
              : {}),
          },
        });

        const shouldCommit = window.confirm(
          `Review brand replacement:\n\nFrom: ${brandItem.brandName || "Unknown brand"}\nTo: ${newBrandName}\n\nApply this replacement now? Affected ingredient rows will be marked unconfirmed so each row can be reviewed again.`,
        );
        if (!shouldCommit) {
          await discardRestaurantWrite({
            supabase,
            batchId: stageResult.batchId,
          });
          setStatus("Brand replacement was canceled.", "neutral");
          return;
        }

        const commitResult = await commitRestaurantWrite({
          supabase,
          batchId: stageResult.batchId,
        });

        // Pull back returned write_version so the next staged write can enforce optimistic concurrency.
        const versionRows = Array.isArray(commitResult?.nextWriteVersions)
          ? commitResult.nextWriteVersions
          : [];
        const matchedVersion = versionRows.find(
          (row) => String(row?.restaurantId || "") === String(selectedRestaurantId),
        );
        const nextWriteVersion = Number(matchedVersion?.writeVersion);

        setCurrentRestaurantData((current) =>
          current
            ? {
                ...current,
                overlays: updatedOverlays,
                write_version: Number.isFinite(nextWriteVersion)
                  ? Math.max(Math.floor(nextWriteVersion), 0)
                  : current.write_version,
              }
            : current,
        );

        setStatus(
          "Brand item replaced. Affected ingredient rows were marked unconfirmed for re-review.",
          "success",
        );
      } catch (error) {
        console.error("[manager-dashboard-next] failed to replace brand", error);
        setStatus("Failed to replace brand item. Please try again.", "error");
      } finally {
        setIsReplacingBrand(false);
      }
    },
    [
      currentRestaurantData?.menuImage,
      currentRestaurantData?.menuImages,
      currentRestaurantData?.overlays,
      currentRestaurantData?.write_version,
      managerDisplayName,
      normalizeAllergen,
      normalizeDietLabel,
      selectedRestaurantId,
      setCurrentRestaurantData,
      setStatus,
    ],
  );

  const onReplaceBrand = useCallback(
    async (brandItem) => {
      if (!brandItem) return;

      const ingredientLabel =
        (brandItem.ingredientNames || []).filter(Boolean)[0] ||
        brandItem.brandName ||
        "Brand item";

      try {
        // Launch shared ingredient scanning flow, then apply replacement with scan output.
        const result = await ingredientScan.openScan({
          ingredientName: ingredientLabel,
          supportedDiets: DIETS,
        });

        if (!result) return;
        await onApplyBrandReplacement(result, brandItem);
      } catch (error) {
        console.error("[manager-dashboard-next] ingredient capture unavailable", error);
        setStatus("Failed to load ingredient capture. Please try again.", "error");
      }
    },
    [DIETS, ingredientScan, onApplyBrandReplacement, setStatus],
  );

  return {
    brandSearchQuery,
    setBrandSearchQuery,
    expandedBrandKeys,
    isReplacingBrand,
    brandItems,
    filteredBrandItems,
    onToggleBrandItem,
    onOpenDishEditor,
    onReplaceBrand,
  };
}
