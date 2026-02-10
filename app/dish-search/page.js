import DishSearchClient from "./DishSearchClient";
import RouteSuspense from "../components/RouteSuspense";

export default function DishSearchPage() {
  return (
    <RouteSuspense label="dish search">
      <DishSearchClient />
    </RouteSuspense>
  );
}
