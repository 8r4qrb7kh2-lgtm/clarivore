import ManagerDashboardClient from "./ManagerDashboardClient";
import RouteSuspense from "../components/RouteSuspense";

export default function ManagerDashboardLegacyPage() {
  return (
    <RouteSuspense label="manager dashboard">
      <ManagerDashboardClient />
    </RouteSuspense>
  );
}
