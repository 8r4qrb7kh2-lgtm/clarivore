import { createClient } from "@supabase/supabase-js";

export const DEFAULT_SUPABASE_URL =
  "https://fgoiyycctnwnghrvsilt.supabase.co";
export const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZnb2l5eWNjdG53bmdocnZzaWx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA0MzY1MjYsImV4cCI6MjA3NjAxMjUyNn0.xlSSXr0Gl7j-vsckrj-2anpPmp4BG2SUIdN-_dquSA8";
export const DEFAULT_PUSH_PUBLIC_KEY =
  "BLwHDRRCZBQE_RHLUlRBgrKcKjHGKxIM4UaYWkRHzUMfQZIkNVBERTHL2cvJ1koMTUYlpgfEdslZjj0nh3DLSG0";

export const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
export const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

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
