"use client";

export default function RestaurantGridState({
  status = "",
  statusTone = "",
  statusId,
  statusAlign = "center",
  statusMarginBottom,
  betweenContent = null,
  loading = false,
  loadingText = "Loading restaurants...",
  restaurants = [],
  renderRestaurant = () => null,
  emptyText = "No restaurants yet.",
  gridClassName = "restaurant-grid",
}) {
  const statusClassName = ["status-text", statusTone].filter(Boolean).join(" ");
  const statusStyle = { textAlign: statusAlign };
  if (typeof statusMarginBottom !== "undefined") {
    statusStyle.marginBottom = statusMarginBottom;
  }

  return (
    <>
      <p id={statusId || undefined} className={statusClassName} style={statusStyle}>
        {status}
      </p>
      {betweenContent}
      <div className={gridClassName}>
        {loading ? (
          <p className="restaurant-grid-message">{loadingText}</p>
        ) : restaurants.length ? (
          restaurants.map((restaurant, index) => renderRestaurant(restaurant, index))
        ) : (
          <div className="empty-state restaurant-grid-empty">{emptyText}</div>
        )}
      </div>
    </>
  );
}
