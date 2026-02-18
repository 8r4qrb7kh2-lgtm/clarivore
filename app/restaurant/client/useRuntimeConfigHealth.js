import { useEffect, useMemo, useState } from "react";

// Runtime config health is checked once on page load.
// The editor uses this to disable AI actions when required env vars are missing.
export function useRuntimeConfigHealth() {
  const [runtimeConfigHealth, setRuntimeConfigHealth] = useState({
    ok: true,
    missing: [],
    required: [],
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

        setRuntimeConfigHealth({ ok, missing, required });
      } catch {
        if (!active) return;
        setRuntimeConfigHealth({
          ok: false,
          missing: ["RUNTIME_CONFIG_HEALTH_CHECK_FAILED"],
          required: [],
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

    return {
      runtimeConfigHealth,
      runtimeConfigChecked,
      runtimeMissingKeys,
      runtimeConfigBlocked,
      runtimeConfigErrorMessage,
    };
  }, [runtimeConfigChecked, runtimeConfigHealth]);
}
