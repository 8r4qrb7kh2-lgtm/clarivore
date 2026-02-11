import OrderFeedbackClient from "./OrderFeedbackClient";
import RouteSuspense from "../components/RouteSuspense";

export default function OrderFeedbackPage() {
  return (
    <RouteSuspense label="feedback page">
      <OrderFeedbackClient />
    </RouteSuspense>
  );
}
