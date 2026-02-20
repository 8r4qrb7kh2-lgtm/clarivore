"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  isManagerOrOwnerUser,
} from "../lib/managerRestaurants";
import { supabaseClient as supabase } from "../lib/supabase";
import { createUnifiedTopbarItems } from "../lib/topbarLinks";
import SimpleTopbar from "./SimpleTopbar";

function resolveModeValue(mode) {
  return mode === "editor" ? "editor" : "customer";
}

function asText(value) {
  return String(value ?? "").trim();
}

function firstManagedRestaurantSlug(restaurants) {
  if (!Array.isArray(restaurants)) return "";
  const match = restaurants.find((item) => asText(item?.slug));
  return asText(match?.slug);
}

function readStoredRestaurantSlug() {
  if (typeof window === "undefined") return "";

  const helpSlug = asText(localStorage.getItem("helpAssistantRestaurantSlug"));
  if (helpSlug) return helpSlug;

  try {
    const recent = JSON.parse(localStorage.getItem("recentlyViewedRestaurants") || "[]");
    if (Array.isArray(recent) && recent.length) {
      return asText(recent[0]);
    }
  } catch {
    // Ignore storage parse errors.
  }

  return "";
}

export default function AppTopbar({
  mode = "customer",
  user = null,
  signedIn = null,
  managerRestaurants = [],
  currentRestaurantSlug = "",
  brandHref = "",
  currentPath = "",
  onModeChange,
  onSignOut,
  onNavigate,
  showModeToggle = true,
  showAuthAction = true,
  signInHref = "/account?mode=signin",
}) {
  const router = useRouter();
  const pathname = usePathname();
  const resolvedMode = resolveModeValue(mode);
  const isManagerOrOwner = isManagerOrOwnerUser(user);
  const resolvedPath = currentPath || pathname || "";
  const resolvedSignedIn =
    typeof signedIn === "boolean" ? signedIn : Boolean(user?.id);
  const resolvedRestaurantSlug = useMemo(() => {
    const explicitSlug = asText(currentRestaurantSlug);
    if (explicitSlug) return explicitSlug;

    const managedSlug = firstManagedRestaurantSlug(managerRestaurants);
    if (managedSlug) return managedSlug;

    return readStoredRestaurantSlug();
  }, [currentRestaurantSlug, managerRestaurants]);

  const navItems = useMemo(
    () =>
      createUnifiedTopbarItems({
        mode: resolvedMode,
        signedIn: resolvedSignedIn,
        managerRestaurants,
        currentRestaurantSlug: resolvedRestaurantSlug,
        currentPath: resolvedPath,
      }),
    [
      managerRestaurants,
      resolvedMode,
      resolvedPath,
      resolvedRestaurantSlug,
      resolvedSignedIn,
    ],
  );

  const handleSignOut = useCallback(async () => {
    if (typeof onSignOut === "function") {
      await onSignOut();
      return;
    }

    if (!supabase) {
      router.replace(signInHref);
      return;
    }

    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error("[app-topbar] sign-out failed", error);
    }
    router.replace(signInHref);
  }, [onSignOut, router, signInHref]);

  const handleModeToggle = useCallback(() => {
    const nextMode = resolvedMode === "editor" ? "customer" : "editor";
    try {
      localStorage.setItem("clarivoreManagerMode", nextMode);
    } catch {
      // Ignore storage failures.
    }

    if (typeof onModeChange === "function") {
      onModeChange(nextMode);
      return;
    }

    if (nextMode === "editor") {
      router.push("/manager-dashboard");
    } else {
      router.push("/home");
    }
  }, [onModeChange, resolvedMode, router]);

  return (
    <SimpleTopbar
      brandHref={brandHref || (resolvedMode === "editor" ? "/manager-dashboard" : "/home")}
      navItems={navItems}
      modeToggle={
        showModeToggle && isManagerOrOwner
          ? {
              label: resolvedMode === "editor" ? "Manager" : "Customer",
              active: resolvedMode === "editor",
              ariaLabel:
                resolvedMode === "editor"
                  ? "Switch to customer mode"
                  : "Switch to manager mode",
              onToggle: handleModeToggle,
            }
          : null
      }
      showAuthAction={showAuthAction}
      signedIn={resolvedSignedIn}
      onSignOut={handleSignOut}
      signInHref={signInHref}
      onNavigate={onNavigate}
    />
  );
}
