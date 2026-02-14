import "./page.css";
import AccountClient from "./AccountClient";
import RouteSuspense from "../components/RouteSuspense";

export const metadata = {
  title: "Account settings",
};

export default function AccountPage() {
  return (
    <RouteSuspense label="account">
      <AccountClient />
    </RouteSuspense>
  );
}
