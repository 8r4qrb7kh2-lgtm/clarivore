import RestaurantClient from "./RestaurantClient";
import RouteSuspense from "../components/RouteSuspense";

export default function RestaurantPage() {
  return (
    <RouteSuspense label="restaurant">
      <RestaurantClient />
    </RouteSuspense>
  );
}
