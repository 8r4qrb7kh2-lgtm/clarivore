import {
  StatusDistributionRow,
  ViewsDistributionRow,
} from "../components/AnalyticsCharts";

// Detailed analytics modal opened when manager clicks a dish heatmap overlay.
export function DishAnalyticsModal({
  dishModalData,
  setActiveDishName,
  ALLERGEN_EMOJI,
  DIET_EMOJI,
  formatAllergenLabel,
}) {
  return (
    <div
      className={`dish-analytics-modal${dishModalData ? " show" : ""}`}
      id="dish-analytics-modal"
      onClick={(event) => {
        // Backdrop click closes modal.
        if (event.target === event.currentTarget) {
          setActiveDishName("");
        }
      }}
    >
      {dishModalData ? (
        <div className="dish-analytics-content">
          <div className="dish-analytics-header">
            <h3 id="dish-analytics-title">{dishModalData.dishName}</h3>
            <button
              className="dish-analytics-close"
              id="dish-analytics-close"
              type="button"
              onClick={() => setActiveDishName("")}
            >
              &times;
            </button>
          </div>

          {dishModalData.cannotAccommodateAllergens.length || dishModalData.cannotAccommodateDiets.length ? (
            <div id="cannot-accommodate-row" className="accommodation-row cannot">
              <span className="accommodation-label">Cannot be accommodated:</span>
              <div id="cannot-accommodate-tags" className="accommodation-tags">
                {dishModalData.cannotAccommodateAllergens.map((allergen) => (
                  <span className="accommodation-tag" key={`cannot-allergen-${allergen}`}>
                    {ALLERGEN_EMOJI[allergen] || "⚠️"} {formatAllergenLabel(allergen)}
                  </span>
                ))}
                {dishModalData.cannotAccommodateDiets.map((diet) => (
                  <span className="accommodation-tag" key={`cannot-diet-${diet}`}>
                    {DIET_EMOJI[diet] || "🍽️"} {diet}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {dishModalData.canAccommodateAllergens.length ? (
            <div id="can-accommodate-row" className="accommodation-row can">
              <span className="accommodation-label">Can be accommodated:</span>
              <div id="can-accommodate-tags" className="accommodation-tags">
                {dishModalData.canAccommodateAllergens.map((allergen) => (
                  <span className="accommodation-tag" key={`can-allergen-${allergen}`}>
                    {ALLERGEN_EMOJI[allergen] || "⚠️"} {formatAllergenLabel(allergen)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="analytics-section" style={{ marginTop: 16 }}>
            <div className="analytics-section-title">Dish Interest Summary</div>
            <div className="stacked-bar-chart" id="analytics-stacked-chart">
              <div className="chart-comparison-group">
                <div className="chart-group-title">Total Views</div>
                <div className="chart-group-bars">
                  <ViewsDistributionRow
                    label="This Dish"
                    value={dishModalData.views.total}
                    maxValue={Math.max(dishModalData.views.total, dishModalData.averages.views, 1)}
                  />
                  <ViewsDistributionRow
                    label="Menu Avg"
                    value={dishModalData.averages.views}
                    maxValue={Math.max(dishModalData.views.total, dishModalData.averages.views, 1)}
                    isAverage
                  />
                </div>
              </div>

              <div className="chart-comparison-group">
                <div className="chart-group-title">Status Distribution</div>
                <div className="chart-group-bars">
                  <StatusDistributionRow
                    label="This Dish"
                    safe={dishModalData.views.safe}
                    removable={dishModalData.views.removable}
                    unsafe={dishModalData.views.unsafe}
                    total={dishModalData.views.total}
                  />
                  <StatusDistributionRow
                    label="Menu Avg"
                    safe={dishModalData.averages.safe}
                    removable={dishModalData.averages.removable}
                    unsafe={dishModalData.averages.unsafe}
                    total={dishModalData.averages.total}
                    isAverage
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="analytics-section" style={{ marginTop: 16 }} id="conflict-breakdown-section">
            <div className="analytics-section-title">Views by Conflicting Restriction</div>
            <div className="conflict-charts-container">
              <div className="conflict-chart">
                <div className="conflict-chart-title">Allergens</div>
                <div className="conflict-bars" id="conflict-allergen-bars">
                  {Object.keys(dishModalData.allergenConflictCounts).length ? (
                    Object.entries(dishModalData.allergenConflictCounts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([allergen, count]) => {
                        const width = (count / dishModalData.maxConflict) * 100;
                        const fillColor = dishModalData.canAccommodateAllergens.includes(allergen)
                          ? "#facc15"
                          : "#ef4444";
                        return (
                          <div className="conflict-bar-row" key={`allergen-conflict-${allergen}`}>
                            <span className="conflict-bar-label">
                              {ALLERGEN_EMOJI[allergen] || "⚠️"} {formatAllergenLabel(allergen)}
                            </span>
                            <div className="conflict-bar-track">
                              <div
                                className="conflict-bar-fill"
                                style={{ width: `${width}%`, background: fillColor }}
                              />
                            </div>
                            <span className="conflict-bar-value">{count}</span>
                          </div>
                        );
                      })
                  ) : (
                    <div className="conflict-no-data">No allergen conflicts</div>
                  )}
                </div>
              </div>

              <div className="conflict-chart">
                <div className="conflict-chart-title">Diets</div>
                <div className="conflict-bars" id="conflict-diet-bars">
                  {Object.keys(dishModalData.dietConflictCounts).length ? (
                    Object.entries(dishModalData.dietConflictCounts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([diet, count]) => (
                        <div className="conflict-bar-row" key={`diet-conflict-${diet}`}>
                          <span className="conflict-bar-label">
                            {DIET_EMOJI[diet] || "🍽️"} {diet}
                          </span>
                          <div className="conflict-bar-track">
                            <div
                              className="conflict-bar-fill"
                              style={{ width: `${(count / dishModalData.maxConflict) * 100}%` }}
                            />
                          </div>
                          <span className="conflict-bar-value">{count}</span>
                        </div>
                      ))
                  ) : (
                    <div className="conflict-no-data">No diet conflicts</div>
                  )}
                </div>
              </div>
            </div>

            <div className="stacked-bar-legend" style={{ marginTop: 12 }}>
              <span className="legend-item">
                <span className="legend-color" style={{ background: "#22c55e" }} /> Safe
              </span>
              <span className="legend-item">
                <span className="legend-color" style={{ background: "#facc15" }} /> Can be accommodated
              </span>
              <span className="legend-item">
                <span className="legend-color" style={{ background: "#ef4444" }} /> Cannot be accommodated
              </span>
            </div>
          </div>

          <div className="analytics-section" style={{ marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Accommodation Requests:</span>
              <span id="analytics-requests" style={{ fontWeight: 600, color: "var(--ink)" }}>
                {dishModalData.requestsCount}
              </span>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}
