import { PieChartPanel } from "../components/AnalyticsCharts";

// Pie-chart section for user allergen and diet distribution.
export function UserDietaryProfileSection({ userDietaryBreakdown }) {
  if (!userDietaryBreakdown) return null;

  return (
    <div className="section" id="user-dietary-profile-section" style={{ display: "block" }}>
      <div className="section-header">
        <h2 className="section-title">User Dietary Profile Breakdown</h2>
      </div>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: 16 }}>
        Distribution of allergens and diets among users who viewed this menu.
      </p>
      <div style={{ display: "flex", gap: 32, flexWrap: "wrap", justifyContent: "center" }}>
        <div id="user-allergen-pie" style={{ flex: 1, minWidth: 280, maxWidth: 400 }}>
          <PieChartPanel
            title="User Allergens"
            data={userDietaryBreakdown.allergenData}
            uniqueUserCount={userDietaryBreakdown.uniqueUserCount}
          />
        </div>

        <div id="user-diet-pie" style={{ flex: 1, minWidth: 280, maxWidth: 400 }}>
          <PieChartPanel
            title="User Diets"
            data={userDietaryBreakdown.dietData}
            uniqueUserCount={userDietaryBreakdown.uniqueUserCount}
          />
        </div>
      </div>
    </div>
  );
}
