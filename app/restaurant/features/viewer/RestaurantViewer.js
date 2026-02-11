"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button, Modal } from "../../../components/ui";
import RestaurantStatusPill from "../shared/RestaurantStatusPill";

function parseLastConfirmed(value) {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not available";
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

function statusBorderColor(status) {
  if (status === "safe") return "#22c55e";
  if (status === "removable") return "#facc15";
  if (status === "unsafe") return "#ef4444";
  return "rgba(255,255,255,0.45)";
}

function overlayKey(overlay, index) {
  return `${String(overlay?.id || "dish").replace(/[^a-zA-Z0-9_-]/g, "-")}-${
    overlay?.pageIndex || 0
  }-${index}`;
}

function dishSummaryLines(dish) {
  if (!dish) return [];
  const lines = [];
  if (dish.description) {
    lines.push(dish.description);
  }
  if (dish.details && typeof dish.details === "object") {
    Object.entries(dish.details).forEach(([key, value]) => {
      if (!value || String(key).startsWith("__")) return;
      lines.push(`${key}: ${value}`);
    });
  }
  return lines.slice(0, 4);
}

export function RestaurantViewer({
  restaurant,
  viewer,
  orderFlow,
  lovedDishes,
  favoriteBusyDish,
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const selectedDish = viewer.selectedDish;

  const lastConfirmedLabel = useMemo(
    () => parseLastConfirmed(restaurant?.last_confirmed),
    [restaurant?.last_confirmed],
  );

  const openDishDetails = (overlay) => {
    if (!overlay) return;
    viewer.selectDish(overlay.id, overlay.pageIndex);
    setDetailsOpen(true);
  };

  const actionButtons = [
    {
      key: "website",
      label: "Restaurant website",
      href: restaurant?.website || "",
      disabled: !restaurant?.website,
      tone: "primary",
      external: true,
    },
    {
      key: "call",
      label: "Call restaurant",
      href: restaurant?.phone ? `tel:${restaurant.phone}` : "",
      disabled: !restaurant?.phone,
      tone: "primary",
      external: true,
    },
    {
      key: "feedback",
      label: "Send feedback",
      href: "/help-contact",
      disabled: false,
      tone: "primary",
      external: false,
    },
    {
      key: "report",
      label: "Report issue",
      href: "/report-issue",
      disabled: false,
      tone: "danger",
      external: false,
    },
  ];

  return (
    <section className="restaurant-legacy-viewer">
      <h1 className="restaurant-legacy-title">{restaurant?.name || "Restaurant"}</h1>

      <div className="restaurant-legacy-meta-row">
        <div className="restaurant-legacy-page-card">
          <button
            type="button"
            className="restaurant-legacy-page-thumb"
            onClick={() => {
              if (viewer.pageCount > 1) viewer.nextPage();
            }}
            title={viewer.pageCount > 1 ? "Next page" : "Menu page"}
          >
            {viewer.currentPageImage ? (
              <img src={viewer.currentPageImage} alt="Current menu page" />
            ) : (
              <span>No page</span>
            )}
          </button>
          <div className="restaurant-legacy-page-footer">
            Page {viewer.currentPageIndex + 1} of {viewer.pageCount}
          </div>
          {viewer.pageCount > 1 ? (
            <div className="restaurant-legacy-page-controls">
              <button type="button" onClick={viewer.previousPage}>
                Prev
              </button>
              <button type="button" onClick={viewer.nextPage}>
                Next
              </button>
            </div>
          ) : null}
        </div>

        <div className="restaurant-legacy-preference-wrap">
          <div className="preference-row">
            <div className="preference-panel pill">
              <div className="preference-header">
                <div className="preference-title">Saved allergens</div>
                <Link href="/account" className="btnLink preference-edit">
                  Edit
                </Link>
              </div>
              <div className="preference-chips chips">
                {viewer.savedAllergens.length ? (
                  viewer.savedAllergens.map((item) => (
                    <span key={item.key} className="chip active preference-chip">
                      {item.emoji || "⚠"} {item.label}
                    </span>
                  ))
                ) : (
                  <span className="note">No saved allergens</span>
                )}
              </div>
            </div>

            <div className="preference-panel pill">
              <div className="preference-header">
                <div className="preference-title">Saved diets</div>
                <Link href="/account" className="btnLink preference-edit">
                  Edit
                </Link>
              </div>
              <div className="preference-chips chips">
                {viewer.savedDiets.length ? (
                  viewer.savedDiets.map((item) => (
                    <span key={item.key} className="chip active preference-chip">
                      {item.emoji || "✓"} {item.label}
                    </span>
                  ))
                ) : (
                  <span className="note">No saved diets</span>
                )}
              </div>
            </div>
          </div>

          <div className="restaurant-legacy-actions-row">
            {actionButtons.map((action) =>
              action.disabled ? (
                <button
                  key={action.key}
                  type="button"
                  className={`restaurant-legacy-action-btn ${action.tone === "danger" ? "danger" : ""}`}
                  disabled
                >
                  {action.label}
                </button>
              ) : action.external ? (
                <a
                  key={action.key}
                  href={action.href}
                  className={`restaurant-legacy-action-btn ${action.tone === "danger" ? "danger" : ""}`}
                  target={action.href.startsWith("http") ? "_blank" : undefined}
                  rel={action.href.startsWith("http") ? "noopener noreferrer" : undefined}
                >
                  {action.label}
                </a>
              ) : (
                <Link
                  key={action.key}
                  href={action.href}
                  className={`restaurant-legacy-action-btn ${action.tone === "danger" ? "danger" : ""}`}
                >
                  {action.label}
                </Link>
              ),
            )}
          </div>

          <p className="restaurant-legacy-confirmed-text">
            Last confirmed by restaurant staff: {lastConfirmedLabel}
          </p>
        </div>
      </div>

      <div className="restaurant-legacy-legend">
        <p>
          <span className="legend-box safe" /> Complies ·{" "}
          <span className="legend-box removable" /> Can be modified to comply ·{" "}
          <span className="legend-box unsafe" /> Cannot be modified to comply
        </p>
        <p>⚠ Cross-contamination risk · Tap dishes for details · Pinch menu to zoom in/out</p>
      </div>

      <div className="restaurant-legacy-menu-stage">
        {viewer.currentPageImage ? (
          <img
            src={viewer.currentPageImage}
            alt={`${restaurant?.name || "Restaurant"} menu page ${viewer.currentPageIndex + 1}`}
            className="restaurant-legacy-menu-image"
          />
        ) : (
          <div className="restaurant-legacy-no-image">No menu image available.</div>
        )}

        {viewer.currentPageOverlays.map((overlay, index) => (
          <button
            key={overlayKey(overlay, index)}
            type="button"
            onClick={() => openDishDetails(overlay)}
            className="restaurant-legacy-overlay"
            style={{
              left: `${overlay.x}%`,
              top: `${overlay.y}%`,
              width: `${overlay.w}%`,
              height: `${overlay.h}%`,
              borderColor: statusBorderColor(overlay.compatibilityStatus),
              boxShadow:
                selectedDish?.id === overlay.id
                  ? "0 0 0 2px rgba(76,101,255,0.85)"
                  : "none",
            }}
          >
            <span className="restaurant-legacy-overlay-warning">
              {overlay.hasCrossContamination ? "⚠" : ""}
            </span>
            <span className="restaurant-legacy-overlay-info">i</span>
          </button>
        ))}
      </div>

      <Modal
        open={detailsOpen && Boolean(selectedDish)}
        onOpenChange={setDetailsOpen}
        title={selectedDish?.name || "Dish details"}
      >
        {selectedDish ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="m-0 text-sm text-[#b7c4e8]">Dish compatibility</p>
              <RestaurantStatusPill status={selectedDish.compatibilityStatus} />
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-[rgba(124,156,255,0.18)] bg-[rgba(3,6,19,0.7)] p-2 text-[#b8c5eb]">
                Allergens
                <div className="mt-1 text-[#eef3ff]">
                  {Array.isArray(selectedDish.allergens) && selectedDish.allergens.length
                    ? selectedDish.allergens.join(", ")
                    : "None listed"}
                </div>
              </div>
              <div className="rounded-lg border border-[rgba(124,156,255,0.18)] bg-[rgba(3,6,19,0.7)] p-2 text-[#b8c5eb]">
                Diets
                <div className="mt-1 text-[#eef3ff]">
                  {Array.isArray(selectedDish.diets) && selectedDish.diets.length
                    ? selectedDish.diets.join(", ")
                    : "None listed"}
                </div>
              </div>
            </div>

            {selectedDish.hasCrossContamination ? (
              <p className="m-0 rounded-lg border border-[rgba(250,204,21,0.45)] bg-[rgba(250,204,21,0.13)] p-2 text-xs text-[#fff1a3]">
                Cross-contamination risk is flagged for this dish.
              </p>
            ) : null}

            {dishSummaryLines(selectedDish).length ? (
              <ul className="m-0 list-disc space-y-1 pl-5 text-sm text-[#dce5ff]">
                {dishSummaryLines(selectedDish).map((line, index) => (
                  <li key={`${line}-${index}`}>{line}</li>
                ))}
              </ul>
            ) : null}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="compact"
                tone="primary"
                onClick={() => {
                  viewer.addDishToOrder(selectedDish);
                  orderFlow.addDish(selectedDish);
                }}
              >
                Add to order
              </Button>
              <Button
                size="compact"
                variant="outline"
                loading={favoriteBusyDish === selectedDish.id}
                onClick={() => viewer.toggleFavoriteDish(selectedDish)}
              >
                {lovedDishes.has(selectedDish.id) ? "Loved" : "Love dish"}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <footer className="restaurant-legacy-help-fab">
        <Link href="/help-contact">Help</Link>
      </footer>
    </section>
  );
}

export default RestaurantViewer;
