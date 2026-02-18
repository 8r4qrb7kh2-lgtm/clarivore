import { PIE_COLORS } from "../constants/dashboardConstants";
import { describePieSegment, polarToCartesian } from "../utils/pieChartMath";

// Displays a compact three-part bar for safe/accommodated/cannot counts.
export function SegmentedBar({ safe, accommodated, cannot, total }) {
  const safePercent = total > 0 ? (safe / total) * 100 : 0;
  const accommodatedPercent = total > 0 ? (accommodated / total) * 100 : 0;
  const cannotPercent = total > 0 ? (cannot / total) * 100 : 0;

  if (total <= 0) {
    return (
      <div
        style={{
          flex: 1,
          height: 18,
          display: "flex",
          borderRadius: 4,
          overflow: "hidden",
          background: "#e5e7eb",
        }}
      />
    );
  }

  return (
    <div
      style={{
        flex: 1,
        height: 18,
        display: "flex",
        borderRadius: 4,
        overflow: "hidden",
        background: "#e5e7eb",
      }}
      title={`Safe: ${Math.round(safe)} | Needs accommodation: ${Math.round(
        accommodated,
      )} | Cannot accommodate: ${Math.round(cannot)}`}
    >
      {safePercent > 0 ? (
        <div
          style={{
            width: `${safePercent}%`,
            background: "#22c55e",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.6rem",
            color: "#fff",
            fontWeight: 600,
          }}
        >
          {safePercent >= 5 ? `${Math.round(safePercent)}%` : ""}
        </div>
      ) : null}
      {accommodatedPercent > 0 ? (
        <div
          style={{
            width: `${accommodatedPercent}%`,
            background: "#facc15",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.6rem",
            color: "#000",
            fontWeight: 600,
          }}
        >
          {accommodatedPercent >= 5 ? `${Math.round(accommodatedPercent)}%` : ""}
        </div>
      ) : null}
      {cannotPercent > 0 ? (
        <div
          style={{
            width: `${cannotPercent}%`,
            background: "#ef4444",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.6rem",
            color: "#fff",
            fontWeight: 600,
          }}
        >
          {cannotPercent >= 5 ? `${Math.round(cannotPercent)}%` : ""}
        </div>
      ) : null}
    </div>
  );
}

// Renders safe/removable/unsafe percentages as a stacked row in dish modal charts.
export function StatusDistributionRow({
  label,
  safe,
  removable,
  unsafe,
  total,
  isAverage = false,
}) {
  const safePercent = total > 0 ? Math.round((safe / total) * 100) : 0;
  const removablePercent = total > 0 ? Math.round((removable / total) * 100) : 0;
  const unsafePercent = total > 0 ? Math.round((unsafe / total) * 100) : 0;

  return (
    <div className="stacked-bar-row" style={isAverage ? { opacity: 0.6 } : undefined}>
      <span className="stacked-bar-row-label">{label}</span>
      <div className="stacked-bar-wrapper">
        {total > 0 ? (
          <>
            {safePercent > 0 ? (
              <div className="stacked-bar-segment safe" style={{ width: `${safePercent}%` }}>
                <span className="segment-percent">{safePercent}%</span>
              </div>
            ) : null}
            {removablePercent > 0 ? (
              <div className="stacked-bar-segment removable" style={{ width: `${removablePercent}%` }}>
                <span className="segment-percent">{removablePercent}%</span>
              </div>
            ) : null}
            {unsafePercent > 0 ? (
              <div className="stacked-bar-segment unsafe" style={{ width: `${unsafePercent}%` }}>
                <span className="segment-percent">{unsafePercent}%</span>
              </div>
            ) : null}
          </>
        ) : (
          <div className="stacked-bar-segment neutral" style={{ width: "100%" }} />
        )}
      </div>
    </div>
  );
}

// Renders single-value bars used by the "Total views" comparison rows.
export function ViewsDistributionRow({ label, value, maxValue, isAverage = false }) {
  const width = maxValue > 0 ? (value / maxValue) * 100 : 0;

  return (
    <div className="stacked-bar-row" style={isAverage ? { opacity: 0.6 } : undefined}>
      <span className="stacked-bar-row-label">{label}</span>
      <div className="stacked-bar-wrapper">
        <div className="stacked-bar-segment views" style={{ width: `${width}%` }} />
      </div>
      <span className="stacked-bar-value">{Math.round(value)}</span>
    </div>
  );
}

// Pie chart panel used in the user dietary breakdown section.
// It draws custom SVG wedges and inline legend rows.
export function PieChartPanel({ title, data, uniqueUserCount }) {
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", textAlign: "center" }}>
        No {title.toLowerCase()} data available
      </p>
    );
  }

  const total = data.reduce((sum, item) => sum + item.count, 0);
  const size = 200;
  const radius = size / 2 - 10;
  const center = size / 2;
  const labelRadius = radius * 0.65;

  let currentAngle = -90;

  const segments = data.map((item, index) => {
    const angle = total > 0 ? (item.count / total) * 360 : 0;
    const start = currentAngle;
    const end = currentAngle + angle;
    currentAngle = end;

    const color = PIE_COLORS[index % PIE_COLORS.length];

    // Single-category charts render as a full circle instead of a path wedge.
    if (data.length === 1) {
      return {
        key: `${item.name || item.label}-${index}`,
        type: "circle",
        color,
        percentage: 100,
        textPosition: { x: center, y: center },
      };
    }

    const midAngle = start + angle / 2;
    const textPoint = polarToCartesian(center, center, labelRadius, midAngle);

    return {
      key: `${item.name || item.label}-${index}`,
      type: "path",
      color,
      path: describePieSegment(center, center, radius, start, end),
      percentage: total > 0 ? (item.count / total) * 100 : 0,
      textPosition: textPoint,
    };
  });

  return (
    <div style={{ textAlign: "center" }}>
      <h4 style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--ink)", marginBottom: 12 }}>
        {title}
      </h4>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ marginBottom: 8 }}>
        {segments.map((segment) =>
          segment.type === "circle" ? (
            <circle
              key={segment.key}
              cx={center}
              cy={center}
              r={radius}
              fill={segment.color}
              stroke="#1a1a2e"
              strokeWidth="2"
            />
          ) : (
            <path
              key={segment.key}
              d={segment.path}
              fill={segment.color}
              stroke="#1a1a2e"
              strokeWidth="2"
            />
          ),
        )}
        {segments.map((segment) => {
          if (!segment.textPosition || segment.percentage < 5) return null;

          return (
            <text
              key={`${segment.key}-label`}
              x={segment.textPosition.x}
              y={segment.textPosition.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#fff"
              fontSize="11"
              fontWeight="600"
              style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
            >
              {Math.round(segment.percentage)}%
            </text>
          );
        })}
      </svg>
      <p style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: 12 }}>
        Total unique users: {uniqueUserCount || total}
      </p>
      <div style={{ textAlign: "left", padding: "0 8px" }}>
        {data.map((item, index) => {
          const percentage = total > 0 ? ((item.count / total) * 100).toFixed(1) : "0.0";
          const color = PIE_COLORS[index % PIE_COLORS.length];
          const label = item.label || item.name;

          return (
            <div
              key={`${item.name || item.label}-${index}`}
              style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 12,
                  background: color,
                  borderRadius: 2,
                  flexShrink: 0,
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
              />
              <span style={{ fontSize: "0.75rem", color: "var(--ink)" }}>
                {item.emoji || ""} {label}
              </span>
              <span style={{ fontSize: "0.7rem", color: "var(--muted)", marginLeft: "auto" }}>
                {item.count} ({percentage}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
