function normalizeNamePart(value) {
  return String(value || "").trim();
}

function getEmailLocalFallback(user) {
  const email = String(user?.email || "").trim();
  if (!email) return "";
  const local = email.split("@")[0] || "";
  return local.replace(/[._]+/g, " ").trim();
}

export function resolveAccountName(user, fallbackName = "") {
  if (!user) return normalizeNamePart(fallbackName) || null;

  const firstName = normalizeNamePart(user.user_metadata?.first_name);
  const lastName = normalizeNamePart(user.user_metadata?.last_name);
  let fullName = `${firstName} ${lastName}`.trim();

  if (!fullName) {
    const rawFirstName = normalizeNamePart(user.raw_user_meta_data?.first_name);
    const rawLastName = normalizeNamePart(user.raw_user_meta_data?.last_name);
    fullName = `${rawFirstName} ${rawLastName}`.trim();
  }
  if (!fullName) fullName = normalizeNamePart(user.user_metadata?.full_name);
  if (!fullName) fullName = normalizeNamePart(user.raw_user_meta_data?.full_name);
  if (!fullName) fullName = normalizeNamePart(user.user_metadata?.name);
  if (!fullName) fullName = normalizeNamePart(user.user_metadata?.display_name);
  if (!fullName) fullName = normalizeNamePart(user.name);
  if (!fullName && fallbackName) fullName = normalizeNamePart(fallbackName);

  return fullName || null;
}

export function resolveManagerDisplayName(user, fallbackName = "Manager") {
  const meta = user?.user_metadata || {};
  const rawMeta = user?.raw_user_meta_data || {};

  const first = normalizeNamePart(meta.first_name || rawMeta.first_name);
  const last = normalizeNamePart(meta.last_name || rawMeta.last_name);
  const combined = `${first} ${last}`.trim();

  return (
    combined ||
    normalizeNamePart(meta.full_name || rawMeta.full_name) ||
    normalizeNamePart(meta.name || rawMeta.name) ||
    normalizeNamePart(meta.display_name || rawMeta.display_name) ||
    getEmailLocalFallback(user) ||
    normalizeNamePart(fallbackName) ||
    "Manager"
  );
}

export function resolveGreetingFirstName(user, fallbackName = "there") {
  if (!user) return String(fallbackName || "there");

  const meta = user.user_metadata || {};
  const rawMeta = user.raw_user_meta_data || {};
  const name =
    meta.first_name ||
    rawMeta.first_name ||
    meta.full_name ||
    rawMeta.full_name ||
    meta.name ||
    rawMeta.name ||
    user.email ||
    fallbackName;

  return String(name || fallbackName || "there").split(" ")[0];
}
