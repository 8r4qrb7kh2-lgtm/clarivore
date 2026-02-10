import Link from "next/link";
import { getWeeksAgoInfo } from "../lib/confirmationAge";

const FALLBACK_MENU_IMAGE = "https://via.placeholder.com/400x300";

export function getRestaurantMenuHref(slug = "") {
  return `/restaurant?slug=${encodeURIComponent(slug || "")}`;
}

export default function RestaurantCard({
  restaurant,
  mediaOverlay = null,
  showConfirmation = true,
  confirmationShowAll = true,
  confirmationUseMonthLabel = true,
  actionLabel = "View menu",
}) {
  if (!restaurant) return null;

  const confirmation = showConfirmation
    ? getWeeksAgoInfo(restaurant.last_confirmed, {
        showAll: confirmationShowAll,
        useMonthLabel: confirmationUseMonthLabel,
      })
    : null;
  const menuHref = getRestaurantMenuHref(restaurant.slug);

  return (
    <article className="restaurant-card">
      <div className="restaurant-card-media">
        {mediaOverlay}
        <img
          src={restaurant.menu_image || FALLBACK_MENU_IMAGE}
          alt={restaurant.name || "Restaurant"}
        />
      </div>
      <div className="restaurant-card-content">
        <h3>{restaurant.name}</h3>
        {showConfirmation && confirmation?.text ? (
          <p className="meta" style={{ color: confirmation.color }}>
            Last confirmed by staff: {confirmation.text}
          </p>
        ) : null}
        <Link className="cta-button" href={menuHref}>
          {actionLabel}
        </Link>
      </div>
    </article>
  );
}
