import ServerTabletClient from "./ServerTabletClient";
import RouteSuspense from "../components/RouteSuspense";

export const metadata = {
  title: "Server Monitor",
};

export default function ServerTabletPage() {
  return (
    <RouteSuspense label="server tablet">
      <ServerTabletClient />
    </RouteSuspense>
  );
}
