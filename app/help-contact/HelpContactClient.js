"use client";

import { useMemo } from "react";
import { useModuleRuntime } from "../runtime/useModuleRuntime";
import HelpContactDom from "./components/HelpContactDom";

export default function HelpContactClient() {
  const externalScripts = useMemo(
    () => [
      { src: "/js/auth-redirect.js", defer: true },
    ],
    [],
  );
  const moduleScripts = useMemo(() => ["/js/help-contact-page.js"], []);

  const { error } = useModuleRuntime({ externalScripts, moduleScripts });

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
