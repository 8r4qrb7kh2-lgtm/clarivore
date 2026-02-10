import OrderFeedbackClient from "./OrderFeedbackClient";
import RouteSuspense from "../components/RouteSuspense";

export default function OrderFeedbackLegacyPage() {
  return (
    <RouteSuspense label="feedback page">
      <OrderFeedbackClient />
    </RouteSuspense>
  );
}
