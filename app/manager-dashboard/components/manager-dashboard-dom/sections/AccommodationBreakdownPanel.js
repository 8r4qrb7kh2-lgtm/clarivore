import { SegmentedBar } from "../components/AnalyticsCharts";

// Renders menu-level accommodation coverage for allergens and diets.
export function AccommodationBreakdownPanel({
  accommodationBreakdown,
  activeTooltipId,
  setActiveTooltipId,
  ALLERGEN_EMOJI,
  DIET_EMOJI,
  formatAllergenLabel,
}) {
  if (!accommodationBreakdown) return null;

  return (
    <div
      className="menu-accommodation-breakdown"
      id="menu-accommodation-breakdown"
      style={{ display: "block" }}
    >
      <h3
        style={{
          fontSize: "1rem",
          fontWeight: 600,
          color: "var(--ink)",
          margin: "16px 0 8px 0",
        }}
      >
        Menu Accommodation Breakdown
      </h3>

      <div className="menu-accommodation-legend">
        <span className="legend-item">
          <span className="legend-color" style={{ background: "#22c55e" }} /> Safe
        </span>
        <span className="legend-item">
          <span className="legend-color" style={{ background: "#facc15" }} /> Needs accommodation
        </span>
        <span className="legend-item">
          <span className="legend-color" style={{ background: "#ef4444" }} /> Cannot accommodate
        </span>
      </div>

      <div id="menu-allergen-breakdown" style={{ marginBottom: 16 }}>
        {accommodationBreakdown.relevantAllergens.length ? (
          <>
            <div className="menu-accommodation-header">
              <span className="menu-accommodation-label">Allergens</span>

              <div className="menu-accommodation-header-col">
                <div className="info-tooltip-container" style={{ justifyContent: "center" }}>
                  <span className="menu-accommodation-title">Menu Coverage</span>
                  <button
                    className="info-tooltip-btn"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setActiveTooltipId((current) =>
                        current === "menu-coverage" ? "" : "menu-coverage",
                      );
                    }}
                  >
                    ?
                  </button>
                  <div
                    className={`info-tooltip-popup${activeTooltipId === "menu-coverage" ? " active" : ""}`}
                  >
                    Proportion of dishes not containing the allergen 🟢, containing but can be accommodated 🟡,
                    or containing and can&apos;t be accommodated 🔴.
                  </div>
                </div>
                <div className="menu-accommodation-subtitle">Share of dishes</div>
              </div>

              <div className="menu-accommodation-header-col">
                <div className="info-tooltip-container" style={{ justifyContent: "center" }}>
                  <span className="menu-accommodation-title">Viewer Restrictions</span>
                  <button
                    className="info-tooltip-btn"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setActiveTooltipId((current) =>
                        current === "viewer-restrictions" ? "" : "viewer-restrictions",
                      );
                    }}
                  >
                    ?
                  </button>
                  <div
                    className={`info-tooltip-popup${activeTooltipId === "viewer-restrictions" ? " active" : ""}`}
                  >
                    Proportion of views where the allergen/diet is safe 🟢, conflicts but can be accommodated 🟡,
                    or conflicts and cannot be accommodated 🔴 for that user.
                  </div>
                </div>
                <div className="menu-accommodation-subtitle">Share of views</div>
              </div>
            </div>

            <div className="menu-accommodation-divider" />

            {accommodationBreakdown.relevantAllergens.map((allergen) => (
              <div
                key={`allergen-${allergen}`}
                style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}
              >
                <span
                  style={{
                    fontSize: "0.75rem",
                    width: 90,
                    minWidth: 90,
                    textAlign: "right",
                    whiteSpace: "nowrap",
                  }}
                >
                  {ALLERGEN_EMOJI[allergen] || "⚠️"} {formatAllergenLabel(allergen)}
                </span>

                <div style={{ flex: 1, display: "flex", gap: 8 }}>
                  <SegmentedBar
                    safe={accommodationBreakdown.allergenDishStats[allergen].safe}
                    accommodated={accommodationBreakdown.allergenDishStats[allergen].accommodated}
                    cannot={accommodationBreakdown.allergenDishStats[allergen].cannot}
                    total={accommodationBreakdown.totalDishes}
                  />
                </div>

                <div style={{ flex: 1, display: "flex", gap: 8 }}>
                  <SegmentedBar
                    safe={accommodationBreakdown.allergenViewStats[allergen].noConflict}
                    accommodated={accommodationBreakdown.allergenViewStats[allergen].accommodated}
                    cannot={accommodationBreakdown.allergenViewStats[allergen].cannot}
                    total={accommodationBreakdown.totalViews}
                  />
                </div>
              </div>
            ))}
          </>
        ) : (
          <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>No allergen data available.</p>
        )}
      </div>

      <div id="menu-diet-breakdown">
        {accommodationBreakdown.relevantDiets.length ? (
          <>
            <div className="menu-accommodation-header spaced">
              <span className="menu-accommodation-label">Diets</span>
              <div className="menu-accommodation-header-col" />
              <div className="menu-accommodation-header-col" />
            </div>
            <div className="menu-accommodation-divider" />

            {accommodationBreakdown.relevantDiets.map((diet) => (
              <div key={`diet-${diet}`} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <span
                  style={{
                    fontSize: "0.75rem",
                    width: 90,
                    minWidth: 90,
                    textAlign: "right",
                    whiteSpace: "nowrap",
                  }}
                >
                  {DIET_EMOJI[diet] || "🍽️"} {diet}
                </span>

                <div style={{ flex: 1, display: "flex", gap: 8 }}>
                  <SegmentedBar
                    safe={accommodationBreakdown.dietDishStats[diet].safe}
                    accommodated={0}
                    cannot={accommodationBreakdown.dietDishStats[diet].cannot}
                    total={accommodationBreakdown.totalDishes}
                  />
                </div>

                <div style={{ flex: 1, display: "flex", gap: 8 }}>
                  <SegmentedBar
                    safe={accommodationBreakdown.dietViewStats[diet].noConflict}
                    accommodated={0}
                    cannot={accommodationBreakdown.dietViewStats[diet].cannot}
                    total={accommodationBreakdown.totalViews}
                  />
                </div>
              </div>
            ))}
          </>
        ) : (
          <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>No diet data available.</p>
        )}
      </div>
    </div>
  );
}
