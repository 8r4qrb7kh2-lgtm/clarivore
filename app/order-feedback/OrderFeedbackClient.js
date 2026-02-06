"use client";

import { useMemo } from "react";
import { useLegacyRuntime } from "../legacy-runtime/useLegacyRuntime";
import OrderFeedbackDom from "./components/OrderFeedbackDom";

export default function OrderFeedbackClient() {
  const scripts = useMemo(
    () => [
      { src: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2" },
      { src: "/js/auth-redirect.js", defer: true },
      { src: "/js/allergen-diet-config.js" },
      { src: "/js/order-feedback-page.js", type: "module" },
    ],
    [],
  );

  const { error } = useLegacyRuntime({ scripts });

  return (
    <>
      <OrderFeedbackDom />
      {error ? (
        <p
          className="status-text error"
          style={{ margin: "12px auto 0", maxWidth: 900, padding: "0 20px" }}
        >
          {error}
        </p>
      ) : null}
    </>
  );
}

