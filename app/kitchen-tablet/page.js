import KitchenTabletClient from "./KitchenTabletClient";
import RouteSuspense from "../components/RouteSuspense";

export default function KitchenTabletPage() {
  return (
    <RouteSuspense label="kitchen tablet">
      <KitchenTabletClient />
    </RouteSuspense>
  );
}
