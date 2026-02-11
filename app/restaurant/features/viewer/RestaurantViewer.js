"use client";

import { useMemo } from "react";
import { Badge, Button, Input } from "../../../components/ui";
import RestaurantStatusPill from "../shared/RestaurantStatusPill";

function parseLastConfirmed(value) {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not available";
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statusBorderColor(status) {
  if (status === "safe") return "#2ccf6d";
  if (status === "removable") return "#f4b740";
  if (status === "unsafe") return "#eb5757";
  return "rgba(255,255,255,0.45)";
}

function uniqueId(value, index) {
  return `${String(value || "overlay").replace(/[^a-zA-Z0-9_-]/g, "-")}-${index}`;
}

export function RestaurantViewer({
  restaurant,
  viewer,
  orderFlow,
  lovedDishes,
  favoriteBusyDish,
}) {
  const selectedDish = viewer.selectedDish;

  const lastConfirmedLabel = useMemo(
    () => parseLastConfirmed(restaurant?.last_confirmed),
    [restaurant?.last_confirmed],
  );

  return (
    <section className="space-y-4">
      <header className="rounded-2xl border border-[rgba(124,156,255,0.25)] bg-[rgba(17,22,48,0.72)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="m-0 text-[1.5rem] font-semibold text-[#eef3ff]">
              {restaurant?.name || "Restaurant"}
            </h1>
            <p className="m-0 mt-1 text-sm text-[#a7b2d1]">
              Last confirmed {lastConfirmedLabel}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="neutral">{viewer.statusCounts.all} dishes</Badge>
            <Badge tone="success">{viewer.statusCounts.safe} safe</Badge>
            <Badge tone="warn">{viewer.statusCounts.removable} adjustable</Badge>
            <Badge tone="danger">{viewer.statusCounts.unsafe} unsafe</Badge>
          </div>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <div className="rounded-2xl border border-[rgba(124,156,255,0.2)] bg-[rgba(11,14,34,0.82)] p-3">
          <div className="mb-3 flex items-center gap-2">
            <Input
              value={viewer.query}
              onChange={(event) => viewer.setQuery(event.target.value)}
              placeholder="Search dish"
              size="standard"
            />
            <select
              value={viewer.statusFilter}
              onChange={(event) => viewer.setStatusFilter(event.target.value)}
              className="h-[44px] rounded-xl border border-[#2a3261] bg-[rgba(17,22,48,0.95)] px-3 text-[#dce5ff]"
            >
              <option value="all">All</option>
              <option value="safe">Safe</option>
              <option value="removable">Can be adjusted</option>
              <option value="unsafe">Unsafe</option>
              <option value="neutral">Unknown</option>
            </select>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-[rgba(124,156,255,0.24)] bg-[#02040f]">
            {restaurant?.menu_image ? (
              <img
                src={restaurant.menu_image}
                alt={`${restaurant.name || "Restaurant"} menu`}
                className="block max-h-[70vh] w-full object-contain"
              />
            ) : (
              <div className="flex min-h-[280px] items-center justify-center text-[#98a6cf]">
                No menu image available
              </div>
            )}

            {viewer.filteredOverlays.map((overlay, index) => (
              <button
                key={uniqueId(overlay.id, index)}
                type="button"
                onClick={() => viewer.selectDish(overlay.id)}
                title={overlay.name}
                className="absolute rounded-sm transition-all duration-150"
                style={{
                  left: `${overlay.x}%`,
                  top: `${overlay.y}%`,
                  width: `${overlay.w}%`,
                  height: `${overlay.h}%`,
                  border: `2px solid ${statusBorderColor(overlay.compatibilityStatus)}`,
                  background:
                    selectedDish?.id === overlay.id
                      ? "rgba(124,156,255,0.24)"
                      : "rgba(255,255,255,0.02)",
                  boxShadow:
                    selectedDish?.id === overlay.id
                      ? "0 0 0 2px rgba(255,255,255,0.35)"
                      : "none",
                }}
              />
            ))}
          </div>
        </div>

        <aside className="space-y-3 rounded-2xl border border-[rgba(124,156,255,0.2)] bg-[rgba(11,14,34,0.82)] p-3">
          <h2 className="m-0 text-lg font-semibold text-[#eef3ff]">Dish details</h2>

          {selectedDish ? (
            <div className="space-y-3 rounded-xl border border-[rgba(124,156,255,0.2)] bg-[rgba(17,22,48,0.95)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="m-0 text-[1.06rem] text-[#f7f9ff]">{selectedDish.name}</h3>
                  {selectedDish.description ? (
                    <p className="m-0 mt-1 text-sm text-[#a7b2d1]">
                      {selectedDish.description}
                    </p>
                  ) : null}
                </div>
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

              <div className="flex flex-wrap gap-2">
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
          ) : (
            <p className="m-0 rounded-xl border border-[rgba(124,156,255,0.2)] bg-[rgba(17,22,48,0.95)] p-3 text-sm text-[#a7b2d1]">
              Select a dish overlay to review details.
            </p>
          )}

          <div className="max-h-[42vh] space-y-2 overflow-auto pr-1">
            {viewer.filteredOverlays.map((overlay, index) => {
              const selected = selectedDish?.id === overlay.id;
              const inOrder = orderFlow.selectedDishNames.includes(overlay.id);

              return (
                <button
                  key={uniqueId(overlay.id, index)}
                  type="button"
                  onClick={() => viewer.selectDish(overlay.id)}
                  className="w-full rounded-xl border p-2 text-left transition-colors"
                  style={{
                    borderColor: selected
                      ? "rgba(124,156,255,0.66)"
                      : "rgba(124,156,255,0.18)",
                    background: selected
                      ? "rgba(76,90,212,0.22)"
                      : "rgba(17,22,48,0.7)",
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-[#eff3ff]">
                      {overlay.name}
                    </span>
                    <RestaurantStatusPill status={overlay.compatibilityStatus} />
                  </div>
                  <p className="m-0 mt-1 text-xs text-[#a7b2d1]">
                    {overlay.description || "No description"}
                  </p>
                  {inOrder ? (
                    <p className="m-0 mt-1 text-[11px] text-[#7ce0a2]">Added to order</p>
                  ) : null}
                </button>
              );
            })}
            {!viewer.filteredOverlays.length ? (
              <p className="m-0 rounded-xl border border-[rgba(124,156,255,0.2)] bg-[rgba(17,22,48,0.65)] p-3 text-xs text-[#9ca9cf]">
                No dishes match the current filter.
              </p>
            ) : null}
          </div>
        </aside>
      </div>
    </section>
  );
}

export default RestaurantViewer;
