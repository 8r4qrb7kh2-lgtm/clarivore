import {
  analyzeDishWithAi,
  analyzeIngredientNameWithAi,
  analyzeIngredientScanRequirement,
  analyzeMenuImageWithAi,
  detectMenuCorners,
  detectMenuDishes,
} from "../features/editor/editorServices";
import { notifyMenuUpdateIfNeeded } from "./menuUpdateNotifier";

// Build the callback contract expected by `useRestaurantEditor`.
// This keeps RestaurantClient focused on orchestration instead of callback implementation details.
export function createRestaurantEditorCallbacks({
  supabaseClient,
  boot,
  slug,
  editorAuthorName,
  runtimeConfigBlocked,
  runtimeConfigErrorMessage,
  ingredientScan,
  persistence,
}) {
  return {
    // Keep author resolution in one place for all staged changes.
    getAuthorName: () => editorAuthorName,

    // Stage row-level diff data for pending-save review.
    onPreparePendingSave: async (payload) => {
      return await persistence.preparePendingSave(payload || {});
    },

    // Commit staged pending-save batch and notify on menu-dish changes when needed.
    onApplyPendingSave: async ({ batchId, menuImage, overlays }) => {
      const payload = await persistence.applyPendingSave({
        batchId,
        targetRestaurantId: boot?.restaurant?.id,
      });
      await notifyMenuUpdateIfNeeded({
        restaurant: boot?.restaurant,
        fallbackSlug: slug,
        menuImage,
        overlays,
      });
      return payload;
    },

    // Save a full draft snapshot and run the same menu-diff notification path.
    onSaveDraft: async ({ overlays, menuImage, menuImages, changePayload }) => {
      const result = await persistence.saveDraft({
        overlays,
        menuImage,
        menuImages,
        changePayload,
      });
      await notifyMenuUpdateIfNeeded({
        restaurant: boot?.restaurant,
        fallbackSlug: slug,
        menuImage,
        overlays,
      });
      return result;
    },

    // Confirm flow uses a standard change payload so logs stay consistent.
    onConfirmInfo: async ({ timestamp, photos }) => {
      const changePayload = {
        author: editorAuthorName,
        general: ["Allergen information confirmed"],
        items: {},
      };
      return await persistence.confirmInfo({
        timestamp,
        photos,
        changePayload,
      });
    },

    // Read helpers used by log/review modals inside the editor.
    onLoadChangeLogs: async (_restaurantId, options = {}) => {
      return await persistence.loadChangeLogs(options);
    },
    onLoadPendingSaveTable: async (restaurantId) => {
      return await persistence.loadPendingSaveTable(restaurantId);
    },
    onSaveRestaurantSettings: async (payload) => {
      return await persistence.saveRestaurantSettings(payload || {});
    },

    // AI dish analysis is blocked when required runtime config is missing.
    onAnalyzeDish: async ({ dishName, text, imageData }) => {
      if (runtimeConfigBlocked) {
        throw new Error(runtimeConfigErrorMessage);
      }
      return await analyzeDishWithAi({ dishName, text, imageData });
    },

    // Ingredient text analysis is always available through the existing API.
    onAnalyzeIngredientName: async ({ ingredientName, dishName }) => {
      return await analyzeIngredientNameWithAi({ ingredientName, dishName });
    },
    onAnalyzeIngredientScanRequirement: async ({ ingredientName, dishName }) => {
      return await analyzeIngredientScanRequirement({ ingredientName, dishName });
    },
    onAnalyzeMenuImage: async (payload) => {
      return await analyzeMenuImageWithAi(payload || {});
    },

    // Appeal submission uses the current signed-in session token.
    onSubmitIngredientAppeal: async ({
      restaurantId,
      dishName,
      ingredientName,
      managerMessage,
      photoDataUrl,
    }) => {
      if (!supabaseClient) throw new Error("Supabase is not configured.");

      const { data: sessionData, error: sessionError } =
        await supabaseClient.auth.getSession();
      if (sessionError) throw sessionError;

      const accessToken = sessionData?.session?.access_token || "";
      if (!accessToken) {
        throw new Error("You must be signed in to submit an appeal.");
      }

      const response = await fetch("/api/ingredient-scan-appeals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          restaurantId: restaurantId || boot?.restaurant?.id,
          dishName,
          ingredientName,
          managerMessage,
          photoDataUrl,
        }),
      });

      const bodyText = await response.text();
      let payload = null;
      try {
        payload = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        payload = null;
      }

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || "Unable to submit appeal right now.");
      }

      return payload;
    },

    onDetectMenuDishes: async ({ imageData }) => {
      return await detectMenuDishes({ imageData });
    },
    onDetectMenuCorners: async ({ imageData, width, height }) => {
      return await detectMenuCorners({ imageData, width, height });
    },

    // Ingredient label scanning is also gated by runtime config health.
    onOpenIngredientLabelScan: async ({ ingredientName, onPhaseChange, scanProfile }) => {
      if (runtimeConfigBlocked) {
        throw new Error(runtimeConfigErrorMessage);
      }
      return await ingredientScan.openScan({
        ingredientName,
        supportedDiets: boot?.config?.DIETS || [],
        onPhaseChange,
        scanProfile,
      });
    },
    onResumeIngredientLabelScan: async ({ sessionId }) => {
      return await ingredientScan.resumeScan({ sessionId });
    },
  };
}
