import { useEffect, useMemo, useState } from "react";

// Runtime config health is checked once on page load.
// The restaurant page uses it both for AI feature gating and editor DB preflight.
export function useRuntimeConfigHealth() {
  const [runtimeConfigHealth, setRuntimeConfigHealth] = useState({
    ok: true,
    missing: [],
    required: [],
    editor: {
      ok: true,
      missing: [],
      required: [],
    },
  });
  const [runtimeConfigChecked, setRuntimeConfigChecked] = useState(false);

  useEffect(() => {
    let active = true;

    const loadRuntimeConfigHealth = async () => {
      try {
        const response = await fetch("/api/runtime-config-health", {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });

        const bodyText = await response.text();
        let payload = null;
        try {
          payload = bodyText ? JSON.parse(bodyText) : null;
        } catch {
          payload = null;
        }

        if (!active) return;
        if (!response.ok || !payload || typeof payload !== "object") {
          throw new Error("Runtime config health check failed.");
        }

        const missing = (Array.isArray(payload.missing) ? payload.missing : [])
          .map((key) => String(key || "").trim())
          .filter(Boolean);
        const required = (Array.isArray(payload.required) ? payload.required : [])
          .map((key) => String(key || "").trim())
          .filter(Boolean);
        const ok = payload.ok === true && missing.length === 0;
        const editorMissing = (Array.isArray(payload?.editor?.missing)
          ? payload.editor.missing
          : []
        )
          .map((key) => String(key || "").trim())
          .filter(Boolean);
        const editorRequired = (Array.isArray(payload?.editor?.required)
          ? payload.editor.required
          : []
        )
          .map((key) => String(key || "").trim())
          .filter(Boolean);
        const editorOk = payload?.editor?.ok === true && editorMissing.length === 0;

        setRuntimeConfigHealth({
          ok,
          missing,
          required,
          editor: {
            ok: editorOk,
            missing: editorMissing,
            required: editorRequired,
          },
        });
      } catch {
        if (!active) return;
        setRuntimeConfigHealth({
          ok: false,
          missing: ["RUNTIME_CONFIG_HEALTH_CHECK_FAILED"],
          required: [],
          editor: {
            ok: false,
            missing: ["RUNTIME_CONFIG_HEALTH_CHECK_FAILED"],
            required: [],
          },
        });
      } finally {
        if (active) {
          setRuntimeConfigChecked(true);
        }
      }
    };

    loadRuntimeConfigHealth();
    return () => {
      active = false;
    };
  }, []);

  // Derive the common UI flags once so callers stay simple.
  return useMemo(() => {
    const runtimeMissingKeys =
      runtimeConfigChecked && runtimeConfigHealth.ok === false
        ? runtimeConfigHealth.missing
        : [];
    const runtimeConfigBlocked =
      runtimeConfigChecked && runtimeConfigHealth.ok === false;
    const runtimeConfigErrorMessage = runtimeMissingKeys.length
      ? `Runtime configuration is missing: ${runtimeMissingKeys.join(", ")}.`
      : "Runtime configuration is missing.";
    const editorRuntimeMissingKeys =
      runtimeConfigChecked && runtimeConfigHealth.editor?.ok === false
        ? runtimeConfigHealth.editor.missing
        : [];
    const editorRuntimeBlocked =
      runtimeConfigChecked && runtimeConfigHealth.editor?.ok === false;
    const editorRuntimeErrorMessage = editorRuntimeMissingKeys.length
      ? `Editor is unavailable until these env vars are set: ${editorRuntimeMissingKeys.join(", ")}.`
      : "Editor is unavailable because server runtime configuration is missing.";

    return {
      runtimeConfigHealth,
      runtimeConfigChecked,
      runtimeMissingKeys,
      runtimeConfigBlocked,
      runtimeConfigErrorMessage,
      editorRuntimeMissingKeys,
      editorRuntimeBlocked,
      editorRuntimeErrorMessage,
    };
  }, [runtimeConfigChecked, runtimeConfigHealth]);
}
