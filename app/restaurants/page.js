import RestaurantsClient from "./RestaurantsClient";
import RouteSuspense from "../components/RouteSuspense";

export const metadata = {
  title: "All Restaurants",
};

export default function RestaurantsPage() {
  const googleMapsApiKey =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    "";

  return (
    <RouteSuspense label="restaurants">
      <RestaurantsClient googleMapsApiKey={googleMapsApiKey} />
    </RouteSuspense>
  );
}
