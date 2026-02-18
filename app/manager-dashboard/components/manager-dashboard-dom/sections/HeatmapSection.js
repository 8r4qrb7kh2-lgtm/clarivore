import { AccommodationBreakdownPanel } from "./AccommodationBreakdownPanel";
import { getHeatmapColor } from "../utils/displayUtils";
import { getOverlayDishName, normalizeDishKey } from "../utils/menuUtils";

// Menu image overlay heatmap and the associated accommodation breakdown panel.
export function HeatmapSection({
  heatmapMetric,
  setHeatmapMetric,
  metricByDish,
  metricBounds,
  heatmapMetricLabel,
  menuImages,
  allOverlays,
  pageOverlays,
  heatmapPage,
  setHeatmapPage,
  setActiveDishName,
  accommodationBreakdown,
  activeTooltipId,
  setActiveTooltipId,
  ALLERGEN_EMOJI,
  DIET_EMOJI,
  formatAllergenLabel,
}) {
  return (
    <div className="section">
      <div className="section-header">
        <h2 className="section-title">Menu Interest Heatmap</h2>
        <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
          Click on a dish to see detailed analytics
        </p>
      </div>

      <div className="heatmap-controls">
        <div className="heatmap-metric-toggle">
          <span className="heatmap-metric-label">Categorize interest by:</span>
          <div className="heatmap-metric-buttons">
            {[
              { id: "views", label: "Total views" },
              { id: "loves", label: "Total loves" },
              { id: "orders", label: "Total orders" },
              { id: "requests", label: "Total requests" },
              {
                id: "accommodation",
                label: "Proportion of views safe/accommodable",
              },
            ].map((metric) => (
              <button
                key={metric.id}
                className={`heatmap-metric-btn${heatmapMetric === metric.id ? " active" : ""}`}
                type="button"
                onClick={() => setHeatmapMetric(metric.id)}
              >
                {metric.label}
              </button>
            ))}
          </div>
        </div>

        <div className="heatmap-legend">
          <div className="heatmap-legend-gradient">
            <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Low</span>
            <div className="heatmap-gradient-bar" />
            <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>High</span>
          </div>
        </div>
      </div>

      <div className="menu-heatmap-container" id="menu-heatmap-container">
        {!menuImages.length || !allOverlays.length ? (
          <div id="menu-heatmap-empty" className="no-menu-image">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <p>No menu image available for this restaurant</p>
          </div>
        ) : (
          <div id="menu-heatmap-content" style={{ display: "flex" }}>
            <div className="menu-heatmap-inner" id="menu-heatmap-inner">
              <img id="menu-heatmap-img" className="menu-heatmap-img" src={menuImages[heatmapPage]} alt="Menu" />
              <div className="menu-heatmap-overlays" id="menu-heatmap-overlays">
                {pageOverlays.map((overlay, index) => {
                  const dishName = getOverlayDishName(overlay, index);
                  const dishKey = normalizeDishKey(dishName);
                  const metricValue = metricByDish[dishKey] || 0;

                  const normalizedValue =
                    metricBounds.max > metricBounds.min
                      ? (metricValue - metricBounds.min) / (metricBounds.max - metricBounds.min)
                      : 0.5;

                  const color = getHeatmapColor(normalizedValue);
                  const width = overlay.w ?? overlay.width ?? 10;
                  const height = overlay.h ?? overlay.height ?? 10;

                  return (
                    <button
                      key={`${dishName}-${index}`}
                      type="button"
                      className="heatmap-overlay"
                      style={{
                        left: `${overlay.x || 0}%`,
                        top: `${overlay.y || 0}%`,
                        width: `${width}%`,
                        height: `${height}%`,
                        background: color,
                        borderColor: color,
                      }}
                      onClick={() => setActiveDishName(dishName)}
                    >
                      <span className="view-count">
                        {metricValue} {heatmapMetricLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              className="heatmap-page-nav"
              id="heatmap-page-nav"
              style={{ display: menuImages.length > 1 ? "flex" : "none" }}
            >
              <button
                className="heatmap-page-btn"
                id="heatmap-prev-btn"
                disabled={heatmapPage <= 0}
                type="button"
                onClick={() => setHeatmapPage((current) => Math.max(0, current - 1))}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <span className="heatmap-page-indicator" id="heatmap-page-indicator">
                Page {heatmapPage + 1} of {menuImages.length}
              </span>
              <button
                className="heatmap-page-btn"
                id="heatmap-next-btn"
                disabled={heatmapPage >= menuImages.length - 1}
                type="button"
                onClick={() =>
                  setHeatmapPage((current) => Math.min(menuImages.length - 1, current + 1))
                }
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      <AccommodationBreakdownPanel
        accommodationBreakdown={accommodationBreakdown}
        activeTooltipId={activeTooltipId}
        setActiveTooltipId={setActiveTooltipId}
        ALLERGEN_EMOJI={ALLERGEN_EMOJI}
        DIET_EMOJI={DIET_EMOJI}
        formatAllergenLabel={formatAllergenLabel}
      />
    </div>
  );
}
