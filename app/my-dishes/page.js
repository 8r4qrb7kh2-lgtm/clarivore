import "./page.css";
import MyDishesClient from "./MyDishesClient";
import RouteSuspense from "../components/RouteSuspense";

export const metadata = {
  title: "My Dishes",
};

export default function MyDishesPage() {
  return (
    <RouteSuspense label="my dishes">
      <MyDishesClient />
    </RouteSuspense>
  );
}
