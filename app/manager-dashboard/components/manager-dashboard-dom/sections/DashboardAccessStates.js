// Small presentational blocks rendered above dashboard content.
// Splitting these keeps the main component focused on data orchestration.
export function RestaurantSelector({ showRestaurantSelector, selectedRestaurantId, setSelectedRestaurantId, managerRestaurants }) {
  if (!showRestaurantSelector) return null;

  return (
    <div className="restaurant-selector" id="restaurant-selector-container">
      <label style={{ display: "block", marginBottom: 8, color: "var(--muted)" }}>Select Restaurant</label>
      <select
        id="restaurant-select"
        value={selectedRestaurantId}
        onChange={(event) => setSelectedRestaurantId(event.target.value)}
      >
        {managerRestaurants.map((restaurant) => (
          <option key={restaurant.id} value={restaurant.id}>
            {restaurant.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function AuthRequiredState({ user }) {
  if (user) return null;

  return (
    <div id="auth-required" className="section">
      <div className="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <h3>Sign in Required</h3>
        <p>Please sign in to access the manager dashboard.</p>
        <a
          href="/account"
          className="action-btn primary"
          style={{ display: "inline-block", marginTop: 16, textDecoration: "none" }}
        >
          Sign In
        </a>
      </div>
    </div>
  );
}

export function AccessRequiredState({ user, hasManagerAccess, isBooting }) {
  if (!user || hasManagerAccess || isBooting) return null;

  return (
    <div id="not-manager" className="section">
      <div className="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <h3>Manager Access Required</h3>
        <p>You don&apos;t have manager access to any restaurants yet.</p>
      </div>
    </div>
  );
}

export function LoadingState({ isBooting, hasManagerAccess, isLoadingDashboard }) {
  if (!(isBooting || (hasManagerAccess && isLoadingDashboard))) return null;

  return (
    <div id="loading-state" className="section">
      <div className="loading-state">
        <div className="spinner" />
        <p>Loading dashboard...</p>
      </div>
    </div>
  );
}

export function DashboardMessages({ dashboardError, statusMessage }) {
  return (
    <>
      {dashboardError ? (
        <p className="status-text error" style={{ marginBottom: 16 }}>
          {dashboardError}
        </p>
      ) : null}

      {statusMessage.text ? (
        <p
          className={`status-text ${statusMessage.tone === "error" ? "error" : "success"}`}
          style={{ marginBottom: 16 }}
        >
          {statusMessage.text}
        </p>
      ) : null}
    </>
  );
}
