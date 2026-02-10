import AdminDashboardClient from "./AdminDashboardClient";
import RouteSuspense from "../components/RouteSuspense";

export default function AdminDashboardPage() {
  return (
    <RouteSuspense label="admin dashboard">
      <AdminDashboardClient />
    </RouteSuspense>
  );
}
