import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  commitRestaurantWrite,
  loadCurrentRestaurantWrite,
  stageRestaurantWrite,
} from "../../lib/restaurantWriteGatewayClient";
import { queryKeys } from "../../lib/queryKeys";

const CONFIRM_INFO_MAX_PHOTOS = 6;
const CONFIRM_INFO_MAX_PHOTO_CHARS = 450000;

function normalizeConfirmInfoPhotoList(values) {
  const safePhotos = (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value) => value.length <= CONFIRM_INFO_MAX_PHOTO_CHARS);
  return safePhotos.slice(0, CONFIRM_INFO_MAX_PHOTOS);
}

// Centralize all restaurant writes and read-backs used by the editor/viewer shell.
export function useRestaurantPersistence({
  supabaseClient,
  boot,
  slug,
  inviteToken,
  isQrVisit,
  editorAuthorName,
  pushToast,
}) {
  const queryClient = useQueryClient();

  // Keep the expected write version in a ref so staged writes always use the latest commit sequence.
  const restaurantWriteVersionRef = useRef(0);
  useEffect(() => {
    const nextVersion = Number(boot?.restaurant?.write_version);
    restaurantWriteVersionRef.current = Number.isFinite(nextVersion)
      ? Math.max(Math.floor(nextVersion), 0)
      : 0;
  }, [boot?.restaurant?.id, boot?.restaurant?.write_version]);

  const bootQueryKey = useMemo(
    () => queryKeys.restaurant.boot(slug, inviteToken, isQrVisit),
    [inviteToken, isQrVisit, slug],
  );

  // After commit, update our local expected version to avoid stale-version conflicts.
  const applyWriteVersionsFromCommit = useCallback(
    (payload, targetRestaurantId = "") => {
      const restaurantId = String(targetRestaurantId || boot?.restaurant?.id || "").trim();
      if (!restaurantId) return;
      const rows = Array.isArray(payload?.nextWriteVersions)
        ? payload.nextWriteVersions
        : [];
      const matched = rows.find(
        (row) => String(row?.restaurantId || "").trim() === restaurantId,
      );
      const nextVersion = Number(matched?.writeVersion);
      if (!Number.isFinite(nextVersion)) return;
      restaurantWriteVersionRef.current = Math.max(Math.floor(nextVersion), 0);
    },
    [boot?.restaurant?.id],
  );

  // Shared writer for full restaurant-scope operations.
  const stageRestaurantScopeWrite = useCallback(
    async ({ operationType, operationPayload, summary }) => {
      if (!boot?.restaurant?.id) throw new Error("Restaurant missing.");

      return await stageRestaurantWrite({
        supabase: supabaseClient,
        payload: {
          scopeType: "RESTAURANT",
          restaurantId: boot.restaurant.id,
          operationType,
          operationPayload,
          summary,
          author: editorAuthorName,
          expectedWriteVersion: restaurantWriteVersionRef.current,
        },
      });
    },
    [boot?.restaurant?.id, editorAuthorName, supabaseClient],
  );

  // Shared committer that also refreshes the boot query cache.
  const commitStagedWrite = useCallback(
    async ({ batchId, targetRestaurantId }) => {
      const payload = await commitRestaurantWrite({
        supabase: supabaseClient,
        batchId,
      });
      applyWriteVersionsFromCommit(payload, targetRestaurantId);
      queryClient.invalidateQueries({ queryKey: bootQueryKey });
      return payload;
    },
    [applyWriteVersionsFromCommit, bootQueryKey, queryClient, supabaseClient],
  );

  // Save the full overlay/menu snapshot.
  const saveEditorDraftMutation = useMutation({
    mutationFn: async ({ overlays, menuImage, menuImages, changePayload }) => {
      if (!supabaseClient) throw new Error("Supabase is not configured.");
      if (!boot?.restaurant?.id) throw new Error("Restaurant missing.");

      const sanitized = Array.isArray(overlays) ? overlays : [];
      const imageList = Array.isArray(menuImages) ? menuImages.filter(Boolean) : [];
      const stageResult = await stageRestaurantScopeWrite({
        operationType: "MENU_STATE_REPLACE",
        summary: "Save menu state",
        operationPayload: {
          overlays: sanitized,
          baselineOverlays: sanitized,
          menuImage,
          menuImages: imageList,
          changePayload: changePayload || {},
        },
      });
      await commitStagedWrite({
        batchId: stageResult.batchId,
        targetRestaurantId: boot.restaurant.id,
      });
      return { overlays: sanitized, menuImage, menuImages: imageList };
    },
  });

  // Record an "allergen info confirmed" event.
  const confirmInfoMutation = useMutation({
    mutationFn: async ({ timestamp, photos, changePayload }) => {
      if (!supabaseClient) throw new Error("Supabase is not configured.");
      if (!boot?.restaurant?.id) throw new Error("Restaurant missing.");

      const safePhotos = normalizeConfirmInfoPhotoList(photos);
      if (!safePhotos.length) {
        throw new Error("Upload at least one menu photo before confirming.");
      }

      const confirmedAt = timestamp || new Date().toISOString();
      const stageResult = await stageRestaurantScopeWrite({
        operationType: "CONFIRM_INFO",
        summary: "Confirm allergen information",
        operationPayload: {
          confirmedAt,
          photos: safePhotos,
          changePayload:
            changePayload || {
              author: editorAuthorName,
              general: ["Allergen information confirmed"],
              items: {},
            },
        },
      });
      await commitStagedWrite({
        batchId: stageResult.batchId,
        targetRestaurantId: boot.restaurant.id,
      });
      return { confirmedAt };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bootQueryKey });
      pushToast({
        tone: "success",
        title: "Confirmed",
        description: "Confirmation recorded.",
      });
    },
  });

  // Save website/phone/delivery/menu links.
  const saveRestaurantSettingsMutation = useMutation({
    mutationFn: async ({ website, phone, delivery_url, menu_url }) => {
      if (!supabaseClient) throw new Error("Supabase is not configured.");
      if (!boot?.restaurant?.id) throw new Error("Restaurant missing.");

      const stageResult = await stageRestaurantScopeWrite({
        operationType: "RESTAURANT_SETTINGS_UPDATE",
        summary: "Update restaurant settings",
        operationPayload: {
          website: website || null,
          phone: phone || null,
          delivery_url: delivery_url || null,
          menu_url: menu_url || null,
          changePayload: {
            author: editorAuthorName,
            general: ["Restaurant settings updated"],
            items: {},
          },
        },
      });
      await commitStagedWrite({
        batchId: stageResult.batchId,
        targetRestaurantId: boot.restaurant.id,
      });
      return { website, phone, delivery_url, menu_url };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bootQueryKey });
      pushToast({
        tone: "success",
        title: "Saved",
        description: "Restaurant settings were updated.",
      });
    },
  });

  // Add/remove loved dishes for the current user and patch cache immediately.
  const toggleFavoriteMutation = useMutation({
    mutationFn: async ({ dishName, shouldLove }) => {
      if (!supabaseClient) throw new Error("Supabase is not configured.");
      const user = boot?.user;
      if (!user?.id) {
        throw new Error("Sign in to save loved dishes.");
      }
      if (!boot?.restaurant?.id) {
        throw new Error("Restaurant is not loaded yet.");
      }

      if (shouldLove) {
        const { error } = await supabaseClient.from("user_loved_dishes").upsert(
          {
            user_id: user.id,
            restaurant_id: boot.restaurant.id,
            dish_name: dishName,
          },
          {
            onConflict: "user_id,restaurant_id,dish_name",
          },
        );
        if (error) throw error;
        return { dishName, loved: true };
      }

      const { error } = await supabaseClient
        .from("user_loved_dishes")
        .delete()
        .eq("user_id", user.id)
        .eq("restaurant_id", boot.restaurant.id)
        .eq("dish_name", dishName);
      if (error) throw error;

      return { dishName, loved: false };
    },
    onSuccess: (result) => {
      queryClient.setQueryData(bootQueryKey, (current) => {
        if (!current) return current;
        const lovedSet = new Set(current.lovedDishNames || []);
        if (result.loved) {
          lovedSet.add(result.dishName);
        } else {
          lovedSet.delete(result.dishName);
        }
        return {
          ...current,
          lovedDishNames: Array.from(lovedSet),
        };
      });
      pushToast({
        tone: result.loved ? "success" : "neutral",
        title: result.loved ? "Loved dish saved" : "Loved dish removed",
        description: result.dishName,
      });
    },
  });

  const saveDraft = useCallback(
    async (payload) => {
      return await saveEditorDraftMutation.mutateAsync(payload || {});
    },
    [saveEditorDraftMutation],
  );

  const confirmInfo = useCallback(
    async (payload) => {
      return await confirmInfoMutation.mutateAsync(payload || {});
    },
    [confirmInfoMutation],
  );

  const saveRestaurantSettings = useCallback(
    async (payload) => {
      return await saveRestaurantSettingsMutation.mutateAsync(payload || {});
    },
    [saveRestaurantSettingsMutation],
  );

  const toggleFavorite = useCallback(
    async (payload) => {
      return await toggleFavoriteMutation.mutateAsync(payload || {});
    },
    [toggleFavoriteMutation],
  );

  // Stage row-level menu changes for the pending save review modal.
  const preparePendingSave = useCallback(
    async ({
      overlayUpserts,
      overlayDeletes,
      overlayBaselines,
      overlayOrder,
      overlayOrderProvided,
      changedFields,
      menuImage,
      menuImages,
      menuImagesProvided,
      changePayload,
      stateHash,
    }) => {
      if (!boot?.restaurant?.id) throw new Error("Restaurant missing.");
      const includeMenuImages = menuImagesProvided === true;

      return await stageRestaurantWrite({
        supabase: supabaseClient,
        payload: {
          scopeType: "RESTAURANT",
          restaurantId: boot.restaurant.id,
          operationType: "MENU_STATE_REPLACE",
          operationPayload: {
            overlayUpserts: Array.isArray(overlayUpserts) ? overlayUpserts : [],
            overlayDeletes: Array.isArray(overlayDeletes) ? overlayDeletes : [],
            overlayBaselines: Array.isArray(overlayBaselines) ? overlayBaselines : [],
            overlayOrder: Array.isArray(overlayOrder) ? overlayOrder : [],
            overlayOrderProvided: overlayOrderProvided === true,
            changedFields: Array.isArray(changedFields)
              ? changedFields.filter((field) => field === "overlays" || field === "menuImages")
              : [],
            ...(includeMenuImages
              ? {
                  menuImage: String(menuImage || ""),
                  menuImages: Array.isArray(menuImages) ? menuImages.filter(Boolean) : [],
                }
              : {}),
            menuImagesProvided: includeMenuImages,
            changePayload,
            stateHash,
          },
          summary: "Menu edits staged",
          author: editorAuthorName,
          expectedWriteVersion: restaurantWriteVersionRef.current,
        },
      });
    },
    [boot?.restaurant?.id, editorAuthorName, supabaseClient],
  );

  const applyPendingSave = useCallback(
    async ({ batchId, targetRestaurantId }) => {
      if (!boot?.restaurant?.id) throw new Error("Restaurant missing.");
      return await commitStagedWrite({
        batchId,
        targetRestaurantId: targetRestaurantId || boot.restaurant.id,
      });
    },
    [boot?.restaurant?.id, commitStagedWrite],
  );

  // Read recent change logs for the editor history panel.
  const loadChangeLogs = useCallback(async () => {
    if (!supabaseClient) throw new Error("Supabase is not configured.");
    if (!boot?.restaurant?.id) return [];

    const { data, error } = await supabaseClient
      .from("change_logs")
      .select("*")
      .eq("restaurant_id", boot.restaurant.id)
      .order("timestamp", { ascending: false })
      .limit(80);

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }, [boot?.restaurant?.id, supabaseClient]);

  // Read the current staged pending-save snapshot and convert it into table rows.
  const loadPendingSaveTable = useCallback(
    async (restaurantId) => {
      if (!boot?.restaurant?.id) {
        return { batch: null, rows: [] };
      }

      const safeRestaurantId = String(restaurantId || boot.restaurant.id).trim();
      const payload = await loadCurrentRestaurantWrite({
        supabase: supabaseClient,
        scopeType: "RESTAURANT",
        restaurantId: safeRestaurantId,
      });

      const reviewSummary =
        payload?.reviewSummary && typeof payload.reviewSummary === "object"
          ? payload.reviewSummary
          : {};
      const rows = Array.isArray(reviewSummary?.menuRows)
        ? reviewSummary.menuRows
        : [];
      const batch = payload?.batch && typeof payload.batch === "object"
        ? payload.batch
        : null;

      return {
        batch: batch
          ? {
              ...batch,
              row_count: Number(reviewSummary?.rowCount) || rows.length || 0,
              state_hash: String(reviewSummary?.stateHash || ""),
            }
          : null,
        rows,
      };
    },
    [boot?.restaurant?.id, supabaseClient],
  );

  return {
    saveDraft,
    confirmInfo,
    saveRestaurantSettings,
    toggleFavorite,
    preparePendingSave,
    applyPendingSave,
    loadChangeLogs,
    loadPendingSaveTable,
  };
}
