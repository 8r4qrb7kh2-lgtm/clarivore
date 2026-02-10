import ServerTabletClient from "./ServerTabletClient";
import RouteSuspense from "../components/RouteSuspense";

export default function ServerTabletPage() {
  return (
    <RouteSuspense label="server tablet">
      <ServerTabletClient />
    </RouteSuspense>
  );
}
