import { adminDashboardMarkup } from "../adminDashboardMarkup";

export default function AdminDashboardDom() {
  return (
    <div
      className="page-shell"
      dangerouslySetInnerHTML={{ __html: adminDashboardMarkup }}
    />
  );
}
