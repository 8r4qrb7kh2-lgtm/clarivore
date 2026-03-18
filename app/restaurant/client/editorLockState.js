const DEFAULT_BLOCKED_MESSAGE = "Someone is currently in web page editor.";
const DEFAULT_SAME_USER_MESSAGE =
  "Another editor session from your account is holding web page editor.";
const DEFAULT_ERROR_MESSAGE = "Unable to verify editor availability.";

function asText(value) {
  return String(value || "").trim();
}

export function canTakeOverEditorLock({ status = "", reason = "" } = {}) {
  return asText(status) === "blocked" && asText(reason) === "same_user_other_instance";
}

export function resolveEditorLockMessage({
  status = "",
  reason = "",
  message = "",
} = {}) {
  const safeStatus = asText(status);
  const safeReason = asText(reason);
  const safeMessage = asText(message);

  if (safeStatus === "error") {
    return safeMessage || DEFAULT_ERROR_MESSAGE;
  }

  if (safeReason === "same_user_other_instance") {
    return safeMessage || DEFAULT_SAME_USER_MESSAGE;
  }

  if (safeReason === "another_editor_active") {
    return safeMessage || DEFAULT_BLOCKED_MESSAGE;
  }

  return safeMessage || DEFAULT_BLOCKED_MESSAGE;
}
