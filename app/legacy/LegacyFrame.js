"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";

function LegacyFrameInner({ title, path }) {
  const searchParams = useSearchParams();

  const src = useMemo(() => {
    if (!path) return "/";
    const [base, existingQuery] = path.split("?");
    const merged = new URLSearchParams(existingQuery || "");
    const incoming = new URLSearchParams(searchParams?.toString() || "");
    incoming.forEach((value, key) => merged.set(key, value));
    const query = merged.toString();
    return query ? `${base}?${query}` : base;
  }, [path, searchParams]);

  return (
    <div style={{ width: "100%", minHeight: "100vh" }}>
      <iframe
        title={title}
        src={src}
        style={{
          width: "100%",
          height: "100vh",
          border: "none",
          display: "block",
          background: "#0b1020",
        }}
      />
    </div>
  );
}

export default function LegacyFrame(props) {
  return (
    <Suspense
      fallback={
        <div
          className="page-shell"
          style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}
        >
          <p style={{ color: "var(--muted)" }}>Loading…</p>
        </div>
      }
    >
      <LegacyFrameInner {...props} />
    </Suspense>
  );
}
