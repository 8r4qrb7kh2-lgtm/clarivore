import { orderFeedbackMarkup } from "../orderFeedbackMarkup";

export default function OrderFeedbackDom() {
  return (
    <div
      className="page-shell"
      dangerouslySetInnerHTML={{ __html: orderFeedbackMarkup }}
    />
  );
}

