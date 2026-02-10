import MyDishesClient from "./MyDishesClient";
import RouteSuspense from "../components/RouteSuspense";

export default function MyDishesLegacyPage() {
  return (
    <RouteSuspense label="my dishes">
      <MyDishesClient />
    </RouteSuspense>
  );
}
