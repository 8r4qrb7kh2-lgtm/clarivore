import "./page.css";
import RouteSuspense from "../components/RouteSuspense";
import GuestLandingClient from "./GuestLandingClient";

export const metadata = {
  title: "Choose your restaurant | Clarivore",
};

export default function GuestPage() {
  return (
    <RouteSuspense label="guest landing">
      <GuestLandingClient />
    </RouteSuspense>
  );
}
