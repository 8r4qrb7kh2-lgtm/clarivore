import HomeClient from "./HomeClient";
import RouteSuspense from "../components/RouteSuspense";

export default function HomePage() {
  return (
    <RouteSuspense label="home">
      <HomeClient />
    </RouteSuspense>
  );
}
