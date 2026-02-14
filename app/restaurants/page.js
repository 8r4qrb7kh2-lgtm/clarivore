import RestaurantsClient from "./RestaurantsClient";
import RouteSuspense from "../components/RouteSuspense";

export const metadata = {
  title: "All Restaurants",
};

export default function RestaurantsPage() {
  return (
    <RouteSuspense label="restaurants">
      <RestaurantsClient />
    </RouteSuspense>
  );
}
