import { managerDashboardMarkup } from "../managerDashboardMarkup";

export default function ManagerDashboardDom() {
  return (
    <div
      className="page-shell"
      dangerouslySetInnerHTML={{ __html: managerDashboardMarkup }}
    />
  );
}

