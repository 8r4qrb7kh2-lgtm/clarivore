// Convert URL-like flags (`1`, `true`, `yes`, `editor`) into one consistent boolean.
export function isTruthyFlag(value) {
  return /^(1|true|yes|editor)$/i.test(String(value || ""));
}

// Decide which view should open first for managers.
// Query params win, then QR behavior, then the last saved local preference.
export function readManagerModeDefault({ editParam, isQrVisit }) {
  if (isTruthyFlag(editParam)) return "editor";
  if (editParam !== null) return "viewer";
  if (isQrVisit) return "viewer";

  try {
    return localStorage.getItem("clarivoreManagerMode") === "editor"
      ? "editor"
      : "viewer";
  } catch {
    // If storage is blocked, stay on a safe default.
    return "viewer";
  }
}

// Keep one canonical URL shape when toggling between viewer/editor.
export function buildModeHref({ mode, slug, searchParams }) {
  const params = new URLSearchParams(searchParams?.toString() || "");
  const safeSlug = String(slug || "").trim();
  if (safeSlug) {
    params.set("slug", safeSlug);
  }

  if (mode === "editor") {
    params.set("edit", "1");
    params.delete("mode");
  } else {
    params.delete("edit");
    params.delete("mode");
  }

  const query = params.toString();
  return `/restaurant${query ? `?${query}` : ""}`;
}

// Only guard plain in-app links. Ignore hash, mail, tel, and javascript links.
export function isGuardableInternalHref(href) {
  const value = String(href || "").trim();
  if (!value) return false;
  if (value.startsWith("#")) return false;
  if (/^(mailto:|tel:|javascript:)/i.test(value)) return false;
  return true;
}
