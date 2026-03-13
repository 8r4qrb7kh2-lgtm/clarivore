const EDITOR_LOCK_SESSION_STORAGE_KEY = "clarivoreEditorLockSessionKey";

function asText(value) {
  return String(value || "").trim();
}

export function generateEditorLockSessionKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readStoredSessionKey(storage) {
  if (!storage || typeof storage.getItem !== "function") return "";
  try {
    return asText(storage.getItem(EDITOR_LOCK_SESSION_STORAGE_KEY));
  } catch {
    return "";
  }
}

function persistSessionKey(storage, sessionKey) {
  const safeSessionKey = asText(sessionKey);
  if (!safeSessionKey || !storage || typeof storage.setItem !== "function") {
    return safeSessionKey;
  }

  try {
    storage.setItem(EDITOR_LOCK_SESSION_STORAGE_KEY, safeSessionKey);
  } catch {
    // Storage failures should not block editor access; keep the in-memory key.
  }

  return safeSessionKey;
}

export function readOrCreateEditorLockSessionKey({
  currentKey = "",
  storage = null,
  generateKey = generateEditorLockSessionKey,
} = {}) {
  const safeCurrentKey = asText(currentKey);
  if (safeCurrentKey) {
    return persistSessionKey(storage, safeCurrentKey);
  }

  const storedSessionKey = readStoredSessionKey(storage);
  if (storedSessionKey) return storedSessionKey;

  return persistSessionKey(storage, generateKey());
}
