"use client";

import { useMemo } from "react";
import { useLegacyRuntime } from "../legacy-runtime/useLegacyRuntime";
import MyDishesDom from "./components/MyDishesDom";

export default function MyDishesClient() {
  const scripts = useMemo(
    () => [
      { src: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2" },
      { src: "/js/auth-redirect.js", defer: true },
      { src: "/js/my-dishes-page.js", type: "module" },
    ],
    [],
  );

  const { error } = useLegacyRuntime({ scripts });

  return (
    <>
      <MyDishesDom />
      {error ? (
        <p
          className="status-text error"
          style={{ margin: "12px auto 0", maxWidth: 1200, padding: "0 20px" }}
        >
          {error}
        </p>
      ) : null}
    </>
  );
}

