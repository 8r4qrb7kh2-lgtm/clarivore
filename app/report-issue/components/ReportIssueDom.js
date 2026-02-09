import { reportIssueMarkup } from "../reportIssueMarkup";

export default function ReportIssueDom() {
  return (
    <div
      className="page-shell"
      dangerouslySetInnerHTML={{ __html: reportIssueMarkup }}
    />
  );
}
