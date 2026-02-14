import "./page.css";
import HelpContactClient from "./HelpContactClient";
import RouteSuspense from "../components/RouteSuspense";

export const metadata = {
  title: "Help",
};

export default function HelpContactPage() {
  return (
    <RouteSuspense label="help page">
      <HelpContactClient />
    </RouteSuspense>
  );
}
