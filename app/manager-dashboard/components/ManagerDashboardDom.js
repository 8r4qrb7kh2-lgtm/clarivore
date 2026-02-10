import SimpleTopbar, { ManagerModeSwitch } from "../../components/SimpleTopbar";

export default function ManagerDashboardDom({
  user,
  isManagerOrOwner = false,
  managerRestaurants = [],
  managerMode = "editor",
  onModeChange,
  onSignOut,
}) {
  const firstRestaurantSlug = managerRestaurants[0]?.slug || "";
  const webpageEditorHref = firstRestaurantSlug
    ? `/restaurant?slug=${encodeURIComponent(firstRestaurantSlug)}&edit=1`
    : "";

  return (
    <div className="page-shell">
      <SimpleTopbar
        brandHref="/manager-dashboard"
        links={[
          { href: "/manager-dashboard", label: "Dashboard" },
          { href: webpageEditorHref || "/manager-dashboard", label: "Webpage editor", visible: Boolean(webpageEditorHref) },
          { href: "/server-tablet", label: "Server monitor" },
          { href: "/kitchen-tablet", label: "Kitchen monitor" },
          { href: "/help-contact", label: "Help" },
        ]}
        showAuthAction
        signedIn={Boolean(user)}
        onSignOut={onSignOut}
        rightContent={
          isManagerOrOwner ? (
            <ManagerModeSwitch mode={managerMode} onChange={onModeChange} />
          ) : null
        }
      />

      <main className="page-main">
        <div className="dashboard-container">
          <div className="dashboard-header">
            <h1>Restaurant Manager Dashboard</h1>
            <p>View customer dietary analytics and accommodation requests</p>
          </div>

          <div
            className="restaurant-selector"
            id="restaurant-selector-container"
            style={{ display: "none" }}
          >
            <label style={{ display: "block", marginBottom: 8, color: "var(--muted)" }}>
              Select Restaurant
            </label>
            <select id="restaurant-select">
              <option value="">Loading restaurants...</option>
            </select>
          </div>

          <div id="auth-required" className="section" style={{ display: "none" }}>
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

          <div id="not-manager" className="section" style={{ display: "none" }}>
            <div className="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <h3>Manager Access Required</h3>
              <p>You don't have manager access to any restaurants yet.</p>
            </div>
          </div>

          <div id="loading-state" className="section">
            <div className="loading-state">
              <div className="spinner" />
              <p>Loading dashboard...</p>
            </div>
          </div>

          <div id="dashboard-content" style={{ display: "none" }}>
            <div className="section quick-actions-section">
              <div className="quick-actions-grid">
                <div className="quick-actions-panel">
                  <div className="chat-header-row">
                    <div className="chat-title-wrap">
                      <h3 className="quick-actions-title" style={{ margin: 0 }}>
                        Direct Messages
                      </h3>
                      <span
                        className="chat-badge"
                        id="chat-unread-badge"
                        style={{ display: "none" }}
                      >
                        0
                      </span>
                    </div>
                    <button
                      className="btn btnWarning"
                      id="chat-ack-btn"
                      style={{ display: "none" }}
                    >
                      Acknowledge message(s)
                    </button>
                  </div>
                  <div id="chat-preview-list" className="chat-preview-list">
                    <div
                      className="loading-state"
                      style={{ padding: 20, textAlign: "center" }}
                    >
                      <div
                        className="spinner"
                        style={{ width: 24, height: 24, margin: "0 auto 8px" }}
                      />
                      <p
                        style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}
                      >
                        Loading...
                      </p>
                    </div>
                  </div>
                  <div className="chat-preview-compose">
                    <input
                      id="chat-message-input"
                      className="chat-preview-input"
                      type="text"
                      placeholder="Message Clarivore"
                    />
                    <button className="btn" id="chat-send-btn">
                      Send
                    </button>
                  </div>
                </div>
                <div className="quick-actions-panel">
                  <h3 className="quick-actions-title">Menu Confirmation</h3>
                  <div id="confirmation-status" className="confirmation-status">
                    <div
                      className="loading-state"
                      style={{ padding: 20, textAlign: "center" }}
                    >
                      <div
                        className="spinner"
                        style={{ width: 24, height: 24, margin: "0 auto 8px" }}
                      />
                      <p
                        style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}
                      >
                        Loading...
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="section">
              <div className="dashboard-split">
                <div className="dashboard-panel">
                  <div className="section-header">
                    <h2 className="section-title">Recent changes</h2>
                    <p
                      style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}
                    >
                      Review the latest edits to your menu.
                    </p>
                  </div>
                  <div id="recent-changes-list" className="recent-changes-list">
                    <div
                      className="loading-state"
                      style={{ padding: 20, textAlign: "center" }}
                    >
                      <div
                        className="spinner"
                        style={{ width: 24, height: 24, margin: "0 auto 8px" }}
                      />
                      <p
                        style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}
                      >
                        Loading...
                      </p>
                    </div>
                  </div>
                  <button
                    className="btn"
                    id="viewFullLogBtn"
                    style={{ width: "100%", marginTop: 16 }}
                  >
                    View full change log
                  </button>
                </div>
                <div className="dashboard-panel">
                  <div className="section-header">
                    <h2 className="section-title brand-items-title">Brand items in use</h2>
                  </div>
                  <div className="brand-items-search">
                    <input
                      id="brand-items-search"
                      className="brand-search-input"
                      type="search"
                      placeholder="Search brand items..."
                    />
                  </div>
                  <div id="brand-items-list" className="brand-items-list">
                    <div
                      className="loading-state"
                      style={{ padding: 20, textAlign: "center" }}
                    >
                      <div
                        className="spinner"
                        style={{ width: 24, height: 24, margin: "0 auto 8px" }}
                      />
                      <p
                        style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}
                      >
                        Loading brand items...
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

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
                    <button className="heatmap-metric-btn active" data-metric="views">
                      Total views
                    </button>
                    <button className="heatmap-metric-btn" data-metric="loves">
                      Total loves
                    </button>
                    <button className="heatmap-metric-btn" data-metric="orders">
                      Total orders
                    </button>
                    <button className="heatmap-metric-btn" data-metric="requests">
                      Total requests
                    </button>
                    <button
                      className="heatmap-metric-btn"
                      data-metric="accommodation"
                    >
                      Proportion of views safe/accommodable
                    </button>
                  </div>
                </div>
                <div className="heatmap-legend">
                  <div className="heatmap-legend-gradient">
                    <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                      Low
                    </span>
                    <div className="heatmap-gradient-bar" />
                    <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                      High
                    </span>
                  </div>
                </div>
              </div>
              <div className="menu-heatmap-container" id="menu-heatmap-container">
                <div
                  id="menu-heatmap-loading"
                  className="loading-state"
                  style={{ padding: 40 }}
                >
                  <div className="spinner" />
                  <p>Loading menu...</p>
                </div>
                <div id="menu-heatmap-content" style={{ display: "none" }}>
                  <div className="menu-heatmap-inner" id="menu-heatmap-inner">
                    <img
                      id="menu-heatmap-img"
                      className="menu-heatmap-img"
                      src=""
                      alt="Menu"
                    />
                    <div className="menu-heatmap-overlays" id="menu-heatmap-overlays" />
                  </div>
                  <div
                    className="heatmap-page-nav"
                    id="heatmap-page-nav"
                    style={{ display: "none" }}
                  >
                    <button className="heatmap-page-btn" id="heatmap-prev-btn" disabled>
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M15 18l-6-6 6-6" />
                      </svg>
                    </button>
                    <span className="heatmap-page-indicator" id="heatmap-page-indicator">
                      Page 1 of 1
                    </span>
                    <button className="heatmap-page-btn" id="heatmap-next-btn" disabled>
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div
                  id="menu-heatmap-empty"
                  className="no-menu-image"
                  style={{ display: "none" }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <p>No menu image available for this restaurant</p>
                </div>
              </div>
              <div
                className="menu-accommodation-breakdown"
                id="menu-accommodation-breakdown"
                style={{ display: "none" }}
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
                    <span className="legend-color" style={{ background: "#22c55e" }} />
                    {" "}
                    Safe
                  </span>
                  <span className="legend-item">
                    <span className="legend-color" style={{ background: "#facc15" }} />
                    {" "}
                    Needs accommodation
                  </span>
                  <span className="legend-item">
                    <span className="legend-color" style={{ background: "#ef4444" }} />
                    {" "}
                    Cannot accommodate
                  </span>
                </div>
                <div id="menu-allergen-breakdown" style={{ marginBottom: 16 }} />
                <div id="menu-diet-breakdown" />
              </div>
            </div>

            <div
              className="section"
              id="user-dietary-profile-section"
              style={{ display: "none" }}
            >
              <div className="section-header">
                <h2 className="section-title">User Dietary Profile Breakdown</h2>
              </div>
              <p
                style={{
                  fontSize: "0.85rem",
                  color: "var(--muted)",
                  marginBottom: 16,
                }}
              >
                Distribution of allergens and diets among users who viewed this menu
              </p>
              <div
                style={{
                  display: "flex",
                  gap: 32,
                  flexWrap: "wrap",
                  justifyContent: "center",
                }}
              >
                <div
                  id="user-allergen-pie"
                  style={{ flex: 1, minWidth: 280, maxWidth: 400 }}
                />
                <div id="user-diet-pie" style={{ flex: 1, minWidth: 280, maxWidth: 400 }} />
              </div>
            </div>
          </div>
        </div>
      </main>

      <div className="response-modal" id="response-modal">
        <div className="response-modal-content">
          <h3 id="modal-title">Respond to Request</h3>
          <p id="modal-dish" style={{ color: "var(--muted)", marginBottom: 16 }} />
          <textarea
            id="response-text"
            placeholder="Add a response message (optional)..."
          />
          <div className="modal-actions">
            <button className="action-btn" id="modal-cancel">
              Cancel
            </button>
            <button className="action-btn decline" id="modal-decline">
              Decline
            </button>
            <button className="action-btn success" id="modal-implement">
              Mark Implemented
            </button>
          </div>
        </div>
      </div>

      <div className="dish-analytics-modal" id="dish-analytics-modal">
        <div className="dish-analytics-content">
          <div className="dish-analytics-header">
            <h3 id="dish-analytics-title">Dish Analytics</h3>
            <button className="dish-analytics-close" id="dish-analytics-close">
              &times;
            </button>
          </div>

          <div
            id="cannot-accommodate-row"
            className="accommodation-row cannot"
            style={{ display: "none" }}
          >
            <span className="accommodation-label">Cannot be accommodated:</span>
            <div id="cannot-accommodate-tags" className="accommodation-tags" />
          </div>

          <div
            id="can-accommodate-row"
            className="accommodation-row can"
            style={{ display: "none" }}
          >
            <span className="accommodation-label">Can be accommodated:</span>
            <div id="can-accommodate-tags" className="accommodation-tags" />
          </div>

          <div className="analytics-section" style={{ marginTop: 16 }}>
            <div className="analytics-section-title">Dish Interest Summary</div>
            <div className="stacked-bar-chart" id="analytics-stacked-chart" />
          </div>

          <div
            className="analytics-section"
            style={{ marginTop: 16 }}
            id="conflict-breakdown-section"
          >
            <div className="analytics-section-title">
              Views by Conflicting Restriction
            </div>
            <div className="conflict-charts-container">
              <div className="conflict-chart">
                <div className="conflict-chart-title">Allergens</div>
                <div className="conflict-bars" id="conflict-allergen-bars" />
              </div>
              <div className="conflict-chart">
                <div className="conflict-chart-title">Diets</div>
                <div className="conflict-bars" id="conflict-diet-bars" />
              </div>
            </div>
            <div className="stacked-bar-legend" style={{ marginTop: 12 }}>
              <span className="legend-item">
                <span className="legend-color" style={{ background: "#22c55e" }} />
                {" "}
                Safe
              </span>
              <span className="legend-item">
                <span className="legend-color" style={{ background: "#facc15" }} />
                {" "}
                Can be accommodated
              </span>
              <span className="legend-item">
                <span className="legend-color" style={{ background: "#ef4444" }} />
                {" "}
                Cannot be accommodated
              </span>
            </div>
          </div>

          <div className="analytics-section" style={{ marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
                Accommodation Requests:
              </span>
              <span id="analytics-requests" style={{ fontWeight: 600, color: "var(--ink)" }}>
                0
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
