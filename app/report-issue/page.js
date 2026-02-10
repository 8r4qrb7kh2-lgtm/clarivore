import ReportIssueClient from "./ReportIssueClient";
import RouteSuspense from "../components/RouteSuspense";

export default function ReportIssuePage() {
  return (
    <RouteSuspense label="issue reporting">
      <ReportIssueClient />
    </RouteSuspense>
  );
}
