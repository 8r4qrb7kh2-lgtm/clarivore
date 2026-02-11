const DEFAULT_SUPABASE_URL = "https://fgoiyycctnwnghrvsilt.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZnb2l5eWNjdG53bmdocnZzaWx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA0MzY1MjYsImV4cCI6MjA3NjAxMjUyNn0.xlSSXr0Gl7j-vsckrj-2anpPmp4BG2SUIdN-_dquSA8";

export async function requestAiExtraction(payload, options = {}) {
  const endpoint = options.endpoint || null;
  const proxyUrl = options.proxyUrl || "/api/ai-proxy/";
  const supabaseClient = options.supabaseClient || null;
  const supabaseUrl = options.supabaseUrl || DEFAULT_SUPABASE_URL;
  const supabaseAnonKey =
    options.supabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY;
  const log = options.log || console.log;
  const warn = options.warn || console.warn;
  const error = options.error || console.error;

  if (endpoint) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(text || "AI endpoint returned an error");
    }
    return await res.json();
  }

  try {
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        functionName: "dish-editor",
        payload: payload,
      }),
    });

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || contentType.includes("text/html")) {
      const errorText = await response.text().catch(() => "");
      if (
        contentType.includes("text/html") ||
        errorText.includes("<!DOCTYPE") ||
        response.status === 501 ||
        response.status === 405
      ) {
        throw new Error("PROXY_UNAVAILABLE");
      }
      throw new Error(errorText || `Proxy returned ${response.status}`);
    }

    return await response.json();
  } catch (proxyErr) {
    const isProxyUnavailable =
      proxyErr.message === "PROXY_UNAVAILABLE" ||
      proxyErr.message.includes("501") ||
      proxyErr.message.includes("405") ||
      proxyErr.message.includes("<!DOCTYPE");

    if (!isProxyUnavailable) {
      warn("AI extraction via proxy failed:", proxyErr);
    } else {
      log("Proxy unavailable, using direct Edge Function call");
    }

    try {
      if (supabaseClient) {
        try {
          const { data, error: invokeError } =
            await supabaseClient.functions.invoke("dish-editor", {
              body: payload,
            });

          if (invokeError) {
            if (
              invokeError.message &&
              (invokeError.message.includes("CORS") ||
                invokeError.message.includes("Failed to send") ||
                invokeError.message.includes("fetch"))
            ) {
              throw new Error("NETWORK_ERROR");
            }
            throw new Error(
              invokeError.message || "Edge Function returned an error",
            );
          }

          log(
            "✓ Successfully called Edge Function via Supabase client (proxy was unavailable)",
          );
          return data;
        } catch (supabaseErr) {
          if (
            supabaseErr.message === "NETWORK_ERROR" ||
            supabaseErr.message.includes("Failed to send") ||
            supabaseErr.message.includes("CORS")
          ) {
            log("Supabase client failed due to CORS/network issue");
            throw new Error(
              "CORS_ERROR: The recipe generation service cannot be accessed due to network restrictions. Please try again in a few moments or contact support if the issue persists.",
            );
          }
          throw supabaseErr;
        }
      }

      try {
        const directResponse = await fetch(
          `${supabaseUrl}/functions/v1/dish-editor`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseAnonKey}`,
              apikey: supabaseAnonKey,
            },
            body: JSON.stringify(payload),
          },
        );

        if (!directResponse.ok) {
          const text = await directResponse
            .text()
            .catch(() => directResponse.statusText);
          throw new Error(text || "Edge Function returned an error");
        }

        const data = await directResponse.json();
        log("✓ Successfully called Edge Function directly (proxy was unavailable)");
        return data;
      } catch (_) {
        throw new Error("SUPABASE_CLIENT_FAILED");
      }
    } catch (directErr) {
      error("All request methods failed:", { proxyErr, directErr });

      let errorMsg = "The recipe generation service is temporarily unavailable.";

      if (
        directErr.message === "SUPABASE_CLIENT_FAILED" ||
        directErr.message.includes("CORS")
      ) {
        errorMsg =
          "Network connection issue. The recipe generation service cannot be accessed right now. This is likely a temporary CORS configuration issue. Please try again in a few minutes.";
      } else if (proxyErr.message && proxyErr.message.includes("BOOT_ERROR")) {
        errorMsg =
          "The recipe generation service is starting up. Please wait a moment and try again.";
      } else if (directErr.message && directErr.message.includes("<!DOCTYPE")) {
        errorMsg = "Service unavailable. Please try again later.";
      }

      throw new Error(errorMsg);
    }
  }
}
