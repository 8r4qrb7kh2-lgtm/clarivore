import AccountClient from "./AccountClient";
import RouteSuspense from "../components/RouteSuspense";

export default function AccountPage() {
  return (
    <RouteSuspense label="account">
      <AccountClient />
    </RouteSuspense>
  );
}
