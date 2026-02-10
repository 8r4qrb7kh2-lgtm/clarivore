import RestaurantsClient from "./RestaurantsClient";
import RouteSuspense from "../components/RouteSuspense";

export default function RestaurantsPage() {
  return (
    <RouteSuspense label="restaurants">
      <RestaurantsClient />
    </RouteSuspense>
  );
}
