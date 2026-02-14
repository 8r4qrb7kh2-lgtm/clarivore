import KitchenTabletClient from "./KitchenTabletClient";
import RouteSuspense from "../components/RouteSuspense";

export const metadata = {
  title: "Kitchen Monitor",
};

export default function KitchenTabletPage() {
  return (
    <RouteSuspense label="kitchen tablet">
      <KitchenTabletClient />
    </RouteSuspense>
  );
}
