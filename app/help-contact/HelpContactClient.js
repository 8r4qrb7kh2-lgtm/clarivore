"use client";

import { useMemo } from "react";
import { useLegacyRuntime } from "../legacy-runtime/useLegacyRuntime";
import HelpContactDom from "./components/HelpContactDom";

export default function HelpContactClient() {
  const scripts = useMemo(
    () => [
      { src: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2" },
      { src: "/js/auth-redirect.js", defer: true },
      { src: "/js/help-contact-page.js", type: "module" },
    ],
    [],
  );

  const { error } = useLegacyRuntime({ scripts });

  return (
    <>
      <HelpContactDom />
      {error ? (
        <p
          className="status-text error"
          style={{ margin: "12px auto 0", maxWidth: 1100, padding: "0 20px" }}
        >
          {error}
        </p>
      ) : null}
    </>
  );
}
