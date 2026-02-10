import HelpContactClient from "./HelpContactClient";
import RouteSuspense from "../components/RouteSuspense";

export default function HelpContactPage() {
  return (
    <RouteSuspense label="help page">
      <HelpContactClient />
    </RouteSuspense>
  );
}
