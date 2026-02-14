import "./page.css";
import ManagerDashboardClient from "./ManagerDashboardClient";
import RouteSuspense from "../components/RouteSuspense";

export const metadata = {
  title: "Manager Dashboard",
};

export default function ManagerDashboardPage() {
  return (
    <RouteSuspense label="manager dashboard">
      <ManagerDashboardClient />
    </RouteSuspense>
  );
}
