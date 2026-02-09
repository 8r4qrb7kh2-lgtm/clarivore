"use client";

import { useMemo } from "react";
import { useModuleRuntime } from "../runtime/useModuleRuntime";
import ServerTabletDom from "./components/ServerTabletDom";

export default function ServerTabletClient() {
  const externalScripts = useMemo(
    () => [
      { src: "/js/auth-redirect.js", defer: true },
    ],
    [],
  );
  const moduleScripts = useMemo(() => ["/js/server-tablet.js"], []);

  const { error } = useModuleRuntime({
    externalScripts,
    moduleScripts,
  });

  return (
    <>
      <ServerTabletDom />
      {error ? (
        <p
          className="status-text error"
          style={{ margin: "12px auto 0", maxWidth: 800, padding: "0 20px" }}
        >
          {error}
        </p>
      ) : null}
    </>
  );
}
