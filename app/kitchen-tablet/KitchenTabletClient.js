"use client";

import { useLegacyTabletRuntime } from "../tablet-runtime/useLegacyTabletRuntime";
import KitchenTabletDom from "./components/KitchenTabletDom";

export default function KitchenTabletClient() {
  const { error } = useLegacyTabletRuntime({
    moduleSrc: "/js/kitchen-tablet.js",
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

