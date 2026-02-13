"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import IngredientScanModal from "./IngredientScanModal";

function asText(value) {
  return String(value ?? "").trim();
}

export function useIngredientScanController() {
  const resolverRef = useRef(null);
  const [scanRequest, setScanRequest] = useState(null);

  const settle = useCallback((result) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setScanRequest(null);
    if (typeof resolve === "function") {
      resolve(result ?? null);
    }
  }, []);

  const openScan = useCallback(async ({ ingredientName, supportedDiets = [] }) => {
    const label = asText(ingredientName);
    if (!label) {
      throw new Error("Ingredient name is required before scanning.");
    }

    if (resolverRef.current) {
      settle(null);
    }

    return await new Promise((resolve) => {
      resolverRef.current = resolve;
      setScanRequest({
        ingredientName: label,
        supportedDiets: Array.isArray(supportedDiets) ? supportedDiets : [],
      });
    });
  }, [settle]);

  const modalNode = useMemo(() => {
    if (!scanRequest) return null;

    return (
      <IngredientScanModal
        open={true}
        ingredientName={scanRequest.ingredientName}
        supportedDiets={scanRequest.supportedDiets}
        onCancel={() => settle(null)}
        onApply={async (payload) => {
          settle(payload || null);
        }}
      />
    );
  }, [scanRequest, settle]);

  return {
    openScan,
    modalNode,
    isOpen: Boolean(scanRequest),
  };
}

export default useIngredientScanController;
