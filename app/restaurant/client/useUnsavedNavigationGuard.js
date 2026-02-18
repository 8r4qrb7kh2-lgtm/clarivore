import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildModeHref,
  isGuardableInternalHref,
} from "./navigationModeUtils";

export function useUnsavedNavigationGuard({
  activeView,
  setActiveView,
  editor,
  router,
  searchParams,
  slug,
  restaurantSlug,
}) {
  // Modal UI state for the "leave with unsaved changes" guard.
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);
  const [unsavedPromptCopy, setUnsavedPromptCopy] = useState(
    "Would you like to save before leaving editor mode?",
  );
  const [unsavedPromptError, setUnsavedPromptError] = useState("");
  const [unsavedPromptSaving, setUnsavedPromptSaving] = useState(false);

  // This holds the intended navigation target while the modal is open.
  const pendingNavigationRef = useRef(null);

  // Persist manager mode so reopening the restaurant keeps the same tab.
  const commitMode = useCallback(
    (nextMode) => {
      const normalized = nextMode === "editor" ? "editor" : "viewer";
      setActiveView(normalized);
      try {
        localStorage.setItem("clarivoreManagerMode", normalized);
      } catch {
        // Storage failures are ignored so navigation still works.
      }
    },
    [setActiveView],
  );

  // Perform navigation after guard checks (and optional mode changes) are complete.
  const executePendingNavigation = useCallback(
    (pending) => {
      if (!pending || typeof pending !== "object") return;

      const nextMode =
        pending.nextMode === "editor"
          ? "editor"
          : pending.nextMode === "viewer"
            ? "viewer"
            : "";
      if (nextMode) {
        commitMode(nextMode);
      }

      const href = String(pending.href || "").trim();
      if (!href) return;

      if (typeof window !== "undefined") {
        const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (href === current) return;
      }

      if (pending.replace) {
        router.replace(href);
      } else {
        router.push(href);
      }
    },
    [commitMode, router],
  );

  // If editor is dirty, delay navigation and open confirmation modal.
  const queueNavigationWithUnsavedGuard = useCallback(
    (pending, promptCopy = "Would you like to save before leaving editor mode?") => {
      const leavingDirtyEditor = activeView === "editor" && Boolean(editor?.isDirty);
      if (leavingDirtyEditor) {
        pendingNavigationRef.current = pending;
        setUnsavedPromptCopy(promptCopy);
        setUnsavedPromptError("");
        setUnsavedPromptSaving(false);
        setUnsavedPromptOpen(true);
        return;
      }
      executePendingNavigation(pending);
    },
    [activeView, editor?.isDirty, executePendingNavigation],
  );

  // Public mode switch used by AppTopbar.
  const setMode = useCallback(
    (nextMode) => {
      const normalized = nextMode === "editor" ? "editor" : "viewer";
      if (normalized === activeView) return;

      const modeHref = buildModeHref({
        mode: normalized,
        slug: restaurantSlug || slug,
        searchParams,
      });

      queueNavigationWithUnsavedGuard(
        {
          nextMode: normalized,
          href: modeHref,
        },
        "Would you like to save before leaving editor mode?",
      );
    },
    [
      activeView,
      queueNavigationWithUnsavedGuard,
      restaurantSlug,
      searchParams,
      slug,
    ],
  );

  // Public in-app navigation helper used by topbar and editor/viewer children.
  const onRestaurantNavigate = useCallback(
    (href) => {
      if (!isGuardableInternalHref(href)) return;
      let targetHref = String(href || "").trim();

      if (typeof window !== "undefined") {
        try {
          const parsed = new URL(targetHref, window.location.href);
          if (parsed.origin !== window.location.origin) {
            window.location.href = targetHref;
            return;
          }
          targetHref = `${parsed.pathname}${parsed.search}${parsed.hash}`;
        } catch {
          return;
        }
      }

      queueNavigationWithUnsavedGuard(
        { href: targetHref },
        "You have unsaved changes. Save before leaving this page?",
      );
    },
    [queueNavigationWithUnsavedGuard],
  );

  // Global link interception catches plain anchor clicks that bypass our explicit handlers.
  useEffect(() => {
    const onDocumentClick = (event) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const link = event.target?.closest?.("a[href]");
      if (!link) return;
      if (link.hasAttribute("data-unsaved-nav")) return;
      if (link.target === "_blank" || link.hasAttribute("download")) return;

      const href = link.getAttribute("href");
      if (!isGuardableInternalHref(href)) return;

      try {
        const targetUrl = new URL(href, window.location.href);
        if (targetUrl.origin !== window.location.origin) return;
        const targetHref = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
        const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (targetHref === currentHref) return;

        event.preventDefault();
        queueNavigationWithUnsavedGuard(
          { href: targetHref },
          "You have unsaved changes. Save before leaving this page?",
        );
      } catch {
        // Ignore malformed URLs.
      }
    };

    document.addEventListener("click", onDocumentClick, true);
    return () => document.removeEventListener("click", onDocumentClick, true);
  }, [queueNavigationWithUnsavedGuard]);

  // Shared close/open logic so modal cannot be closed during active save attempt.
  const onOpenChange = useCallback((open) => {
    if (!open && unsavedPromptSaving) return;
    setUnsavedPromptOpen(open);
    if (open) return;

    pendingNavigationRef.current = null;
    setUnsavedPromptError("");
    setUnsavedPromptSaving(false);
  }, [unsavedPromptSaving]);

  const onSaveThenLeave = useCallback(async () => {
    if (unsavedPromptSaving) return;
    setUnsavedPromptSaving(true);
    setUnsavedPromptError("");

    try {
      const result = await editor.save();
      if (result?.success) {
        const pending = pendingNavigationRef.current;
        pendingNavigationRef.current = null;
        setUnsavedPromptOpen(false);
        executePendingNavigation(pending);
        return;
      }

      setUnsavedPromptError(
        editor.saveError || result?.error?.message || "Failed to save changes.",
      );
    } catch (error) {
      setUnsavedPromptError(error?.message || "Failed to save changes.");
    } finally {
      setUnsavedPromptSaving(false);
    }
  }, [editor, executePendingNavigation, unsavedPromptSaving]);

  const onLeaveWithoutSaving = useCallback(() => {
    editor.discardUnsavedChanges();
    const pending = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    setUnsavedPromptOpen(false);
    setUnsavedPromptError("");
    executePendingNavigation(pending);
  }, [editor, executePendingNavigation]);

  const onStayHere = useCallback(() => {
    pendingNavigationRef.current = null;
    setUnsavedPromptOpen(false);
    setUnsavedPromptError("");
  }, []);

  return {
    setMode,
    onRestaurantNavigate,
    modal: {
      open: unsavedPromptOpen,
      copy: unsavedPromptCopy,
      error: unsavedPromptError,
      saving: unsavedPromptSaving,
      onOpenChange,
      onSaveThenLeave,
      onLeaveWithoutSaving,
      onStayHere,
    },
  };
}
