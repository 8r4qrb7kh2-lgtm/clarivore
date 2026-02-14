import "./page.css";
import OrderFeedbackClient from "./OrderFeedbackClient";
import RouteSuspense from "../components/RouteSuspense";

export const metadata = {
  title: "Share Your Feedback",
};

export default function OrderFeedbackPage() {
  return (
    <RouteSuspense label="feedback page">
      <OrderFeedbackClient />
    </RouteSuspense>
  );
}
