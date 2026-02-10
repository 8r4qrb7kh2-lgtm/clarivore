"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import RestaurantCoreDom from "./components/RestaurantCoreDom";
import RestaurantLoaderOverlay from "./components/RestaurantLoaderOverlay";
import { useRestaurantRuntimeEnvironment } from "./hooks/useRestaurantRuntimeEnvironment";
import { useRestaurantRuntime } from "./hooks/useRestaurantRuntime";

export default function RestaurantClient() {
  const searchParams = useSearchParams();
  useRestaurantRuntimeEnvironment();

  const slug = searchParams?.get("slug") || "";
  const qrParam = searchParams?.get("qr");
  const inviteToken = searchParams?.get("invite") || "";
  const isQrVisit = qrParam ? /^(1|true|yes)$/i.test(qrParam) : false;

  const { status, error } = useRestaurantRuntime({
    slug,
    isQrVisit,
    inviteToken,
  });

  const managerDashboardHref = useMemo(() => "/manager-dashboard", []);

  return (
    <>
      <RestaurantLoaderOverlay status={status} error={error} />
      <RestaurantCoreDom managerDashboardHref={managerDashboardHref} />
    </>
  );
}
