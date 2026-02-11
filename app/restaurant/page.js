import LegacyRestaurantDocumentClient from "./LegacyRestaurantDocumentClient";
import { getLegacyRestaurantHtml } from "./getLegacyRestaurantHtml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RestaurantPage() {
  const legacyHtml = await getLegacyRestaurantHtml();
  return <LegacyRestaurantDocumentClient html={legacyHtml} />;
}
