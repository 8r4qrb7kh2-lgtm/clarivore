import { createClient } from "@supabase/supabase-js";

export const DEFAULT_PUSH_PUBLIC_KEY =
  "BLwHDRRCZBQE_RHLUlRBgrKcKjHGKxIM4UaYWkRHzUMfQZIkNVBERTHL2cvJ1koMTUYlpgfEdslZjj0nh3DLSG0";

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const supabaseClient =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export function isNativePlatform() {
  if (typeof window === "undefined") return false;
  if (window.Capacitor?.isNativePlatform) {
    return window.Capacitor.isNativePlatform();
  }
  if (window.Capacitor?.getPlatform) {
    return window.Capacitor.getPlatform() !== "web";
  }
  const protocol = window.location.protocol;
  if (protocol === "capacitor:" || protocol === "ionic:" || protocol === "file:") {
    return true;
  }
  if (window.navigator?.userAgent?.includes("Capacitor")) {
    return true;
  }
  return false;
}
