import { useCallback, useMemo, useState } from "react";
import { collectBrandItemsFromOverlays } from "../utils/brandUtils";

// Handles the brand-items panel: search/filter state, item expansion,
// and deep-links into the webpage editor for brand replacement.
export function useBrandManagement({
  currentRestaurantData,
  setStatus,
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

  const onReplaceBrand = useCallback(
    (brandItem) => {
      if (!brandItem) return;

      const slug = String(currentRestaurantData?.slug || "").trim();
      if (!slug) {
        setStatus("Select a restaurant before replacing a brand item.", "error");
        return;
      }

      try {
        setIsReplacingBrand(true);
        const params = new URLSearchParams({
          slug,
          edit: "1",
          openConfirm: "1",
          autoReplaceBrand: "1",
        });
        const brandKey = String(brandItem?.key || "").trim();
        const brandName = String(brandItem?.brandName || "").trim();
        if (brandKey) {
          params.set("replaceBrandKey", brandKey);
        }
        if (brandName) {
          params.set("replaceBrandName", brandName);
        }

        // Route into webpage editor first; replacement runs there and only persists on Save to site.
        window.location.href = `/restaurant?${params.toString()}`;
      } catch (error) {
        console.error("[manager-dashboard-next] failed to open editor for brand replace", error);
        setIsReplacingBrand(false);
        setStatus("Failed to open webpage editor for brand replacement.", "error");
      }
    },
    [currentRestaurantData?.slug, setStatus],
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
