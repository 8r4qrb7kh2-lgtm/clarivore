"use client";

import { useLegacyTabletRuntime } from "../tablet-runtime/useLegacyTabletRuntime";
import ServerTabletDom from "./components/ServerTabletDom";

export default function ServerTabletClient() {
  const { error } = useLegacyTabletRuntime({
    moduleSrc: "/js/server-tablet.js",
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

