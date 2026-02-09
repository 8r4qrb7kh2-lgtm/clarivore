"use client";

import { useMemo } from "react";
import { useModuleRuntime } from "../runtime/useModuleRuntime";
import KitchenTabletDom from "./components/KitchenTabletDom";

export default function KitchenTabletClient() {
  const externalScripts = useMemo(
    () => [
      { src: "/js/auth-redirect.js", defer: true },
    ],
    [],
  );
  const moduleScripts = useMemo(() => ["/js/kitchen-tablet.js"], []);

  const { error } = useModuleRuntime({
    externalScripts,
    moduleScripts,
  });

  return (
    <>
      <KitchenTabletDom />
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
