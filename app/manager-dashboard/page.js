import ManagerDashboardClient from "./ManagerDashboardClient";
import RouteSuspense from "../components/RouteSuspense";

export default function ManagerDashboardPage() {
  return (
    <RouteSuspense label="manager dashboard">
      <ManagerDashboardClient />
    </RouteSuspense>
  );
}
