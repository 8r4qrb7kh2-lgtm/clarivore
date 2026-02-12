import RestaurantClient from "./RestaurantClient";
import RouteSuspense from "../components/RouteSuspense";
import "./restaurant-editor-primitives.css";

export default function RestaurantPage() {
  return (
    <RouteSuspense label="restaurant">
      <RestaurantClient />
    </RouteSuspense>
  );
}
