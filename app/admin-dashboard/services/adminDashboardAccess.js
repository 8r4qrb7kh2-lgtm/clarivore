const DEV_BYPASS_FLAG = "1";

export function isAdminDashboardDevBypassEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_ADMIN_DASHBOARD_DEV_BYPASS === DEV_BYPASS_FLAG
  );
}

export function createAdminDashboardBypassUser() {
  return {
    id: "dev-admin-bypass",
    email: "dev-admin@clarivore.local",
    app_metadata: { provider: "local" },
    user_metadata: { name: "Dev Admin" },
  };
}
