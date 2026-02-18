import { useEffect } from "react";

import { matchOverlayByDishName } from "../utils/imageProcessing";
import { asText } from "../utils/text";

// Non-data side effects (route-driven selection, keyboard shortcuts, unload guard).
// Grouping them here keeps business logic hooks focused on data mutations.

export function useEditorGlobalEffects({
  initialDishResolved,
  setInitialDishResolved,
  params,
  draftOverlays,
  setSelectedOverlayKey,
  setActivePageIndex,
  setDishEditorOpen,
  setDishAiAssistOpen,
  setAiAssistDraft,
  canEdit,
  undo,
  redo,
  isDirty,
}) {
  useEffect(() => {
    if (initialDishResolved) return;
    if (!params?.dishName || !draftOverlays.length) return;
    const match = matchOverlayByDishName(draftOverlays, params.dishName);
    if (!match) return;

    setSelectedOverlayKey(match._editorKey);
    setActivePageIndex(match.pageIndex || 0);
    setDishEditorOpen(true);
    if (params?.openAI) {
      setDishAiAssistOpen(true);
      if (params?.ingredientName) {
        setAiAssistDraft((current) => ({
          ...current,
          text: `Ingredient focus: ${asText(params.ingredientName)}`,
        }));
      }
    }
    setInitialDishResolved(true);
  }, [
    draftOverlays,
    initialDishResolved,
    params?.dishName,
    params?.ingredientName,
    params?.openAI,
    setActivePageIndex,
    setAiAssistDraft,
    setDishAiAssistOpen,
    setDishEditorOpen,
    setInitialDishResolved,
    setSelectedOverlayKey,
  ]);

  useEffect(() => {
    if (!canEdit) return undefined;

    const handleKeyDown = (event) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const modifier = isMac ? event.metaKey : event.ctrlKey;
      if (!modifier) return;

      if (event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }

      if (
        event.key.toLowerCase() === "y" ||
        (event.key.toLowerCase() === "z" && event.shiftKey)
      ) {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canEdit, redo, undo]);

  useEffect(() => {
    if (!isDirty) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
      return "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);
}
