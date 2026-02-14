import "./page.css";
import AdminDashboardClient from "./AdminDashboardClient";
import RouteSuspense from "../components/RouteSuspense";

export const metadata = {
  title: "Admin Dashboard",
};

export default function AdminDashboardPage() {
  return (
    <RouteSuspense label="admin dashboard">
      <AdminDashboardClient />
    </RouteSuspense>
  );
}
