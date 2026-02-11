import MyDishesClient from "./MyDishesClient";
import RouteSuspense from "../components/RouteSuspense";

export default function MyDishesPage() {
  return (
    <RouteSuspense label="my dishes">
      <MyDishesClient />
    </RouteSuspense>
  );
}
