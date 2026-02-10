import FavoritesClient from "./FavoritesClient";
import RouteSuspense from "../components/RouteSuspense";

export default function FavoritesPage() {
  return (
    <RouteSuspense label="favorites">
      <FavoritesClient />
    </RouteSuspense>
  );
}
