import "./page.css";
import ReportIssueClient from "./ReportIssueClient";
import RouteSuspense from "../components/RouteSuspense";

export const metadata = {
  title: "Report an issue",
};

export default function ReportIssuePage() {
  return (
    <RouteSuspense label="issue reporting">
      <ReportIssueClient />
    </RouteSuspense>
  );
}
