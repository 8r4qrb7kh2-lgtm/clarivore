"use client";

import { useEffect } from "react";
import { initializeRestaurantRuntimeEnvironment } from "../runtime/runtimeEnvironment";

export function useRestaurantRuntimeEnvironment() {
  useEffect(() => {
    initializeRestaurantRuntimeEnvironment();
  }, []);
}
