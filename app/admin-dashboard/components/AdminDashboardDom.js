import SimpleTopbar from "../../components/SimpleTopbar";

export default function AdminDashboardDom({ user, onSignOut }) {
  return (
    <div className="page-shell">
      <SimpleTopbar
        brandHref="/home"
        links={[
          { href: "/manager-dashboard", label: "Dashboard" },
          { href: "/restaurants", label: "Restaurants" },
          { href: "/help-contact", label: "Help" },
        ]}
        showAuthAction
        signedIn={Boolean(user)}
        onSignOut={onSignOut}
      />

      <main className="admin-container">
        <div id="access-denied" className="access-denied" style={{ display: "none" }}>
          <h1>🔒 Access Denied</h1>
          <p>You must be logged in as an administrator to access this page.</p>
          <button
            className="btn-primary"
            onClick={() => {
              window.location.href = "/account";
            }}
          >
            Go to Account
          </button>
        </div>

        <div id="admin-content" style={{ display: "none" }}>
          <div className="admin-header">
            <h1>🛡️ Admin Dashboard</h1>
            <p>Manage restaurants and review appeals</p>
          </div>

          <div className="tab-buttons">
            <button className="tab-btn active" data-tab="restaurants">
              Restaurants
            </button>
            <button className="tab-btn" data-tab="managers">
              Managers
            </button>
            <button className="tab-btn" data-tab="appeals">
              Appeals Review
            </button>
            <button className="tab-btn" data-tab="feedback">
              Anonymous Feedback
            </button>
            <button className="tab-btn" data-tab="product-reports">
              📋 Issue Reports
            </button>
          </div>

          <div className="tab-toolbar">
            <div className="restaurant-selector">
              <label htmlFor="admin-restaurant-select">Restaurant</label>
              <select id="admin-restaurant-select">
                <option value="all">All restaurants</option>
              </select>
            </div>
          </div>

          <div id="tab-restaurants" className="tab-content active">
            <div className="admin-grid">
              <div className="admin-card">
                <h2>Add New Restaurant</h2>
                <form id="add-restaurant-form">
                  <div className="form-group">
                    <label htmlFor="restaurant-name">Restaurant Name *</label>
                    <input
                      type="text"
                      id="restaurant-name"
                      required
                      placeholder="e.g., Falafel Café"
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="restaurant-website">Website</label>
                    <input
                      type="url"
                      id="restaurant-website"
                      placeholder="https://example.com"
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="restaurant-description">Description</label>
                    <textarea
                      id="restaurant-description"
                      placeholder="Brief description of the restaurant"
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="menu-image">Menu Image *</label>
                    <input type="file" id="menu-image" accept="image/*" required />
                    <img id="image-preview" className="image-preview" alt="Menu preview" />
                  </div>

                  <button type="submit" className="btn-primary" id="submit-btn">
                    Add Restaurant
                  </button>
                  <div id="status-message" className="status-message" />
                </form>
              </div>

              <div className="admin-card">
                <h2>Existing Restaurants</h2>
                <div id="restaurants-list" className="restaurants-list">
                  <p style={{ color: "#718096" }}>Loading restaurants...</p>
                </div>
              </div>
            </div>
          </div>

          <div id="tab-managers" className="tab-content">
            <div className="admin-card admin-card-full">
              <h2>👥 Restaurant Managers</h2>
              <p style={{ color: "#718096", marginBottom: 20 }}>
                View current manager access for the selected restaurant, revoke
                access, and generate invite links.
              </p>
              <div id="manager-access-list" className="manager-access-list">
                <p style={{ color: "#718096" }}>Loading manager access...</p>
              </div>
            </div>
          </div>

          <div id="tab-appeals" className="tab-content">
            <div className="admin-card admin-card-full">
              <h2>📷 Ingredient Scan Appeals</h2>
              <p style={{ color: "#718096", marginBottom: 24 }}>
                Review and approve or deny manager appeals for ingredient scanning
                requirements
              </p>

              <div className="appeals-filters">
                <button className="filter-btn active" data-filter="all">
                  All Appeals
                </button>
                <button className="filter-btn" data-filter="pending">
                  Pending
                </button>
                <button className="filter-btn" data-filter="approved">
                  Approved
                </button>
                <button className="filter-btn" data-filter="rejected">
                  Rejected
                </button>
              </div>

              <div id="loading-appeals" className="loading">
                <p>Loading appeals...</p>
              </div>

              <div id="no-appeals" className="no-appeals" style={{ display: "none" }}>
                <h3>No appeals found</h3>
                <p>There are no appeals matching your current filter.</p>
              </div>

              <div id="appeals-list" className="appeals-list" />
            </div>
          </div>

          <div id="tab-feedback" className="tab-content">
            <div className="admin-card admin-card-full">
              <h2>🗣️ Anonymous Feedback</h2>
              <p style={{ color: "#718096", marginBottom: 24 }}>
                Feedback submitted without an email address.
              </p>
              <div id="feedback-list" className="feedback-list">
                <p style={{ color: "#718096" }}>Loading feedback...</p>
              </div>
            </div>
          </div>

          <div id="tab-product-reports" className="tab-content">
            <div className="admin-card admin-card-full">
              <h2>📋 Issue Reports</h2>
              <p style={{ color: "#718096", marginBottom: 24 }}>
                Review user-reported issues with menu issues, brand verification,
                and product analysis
              </p>

              <div className="appeals-filters">
                <button className="filter-btn-reports active" data-filter-reports="all">
                  All Reports
                </button>
                <button className="filter-btn-reports" data-filter-reports="pending">
                  Pending
                </button>
                <button className="filter-btn-reports" data-filter-reports="resolved">
                  Resolved
                </button>
                <button className="filter-btn-reports" data-filter-reports="dismissed">
                  Dismissed
                </button>
              </div>

              <div id="loading-reports" className="loading">
                <p>Loading reports...</p>
              </div>

              <div id="no-reports" className="no-appeals" style={{ display: "none" }}>
                <h3>No reports found</h3>
                <p>There are no product issue reports matching your current filter.</p>
              </div>

              <div id="reports-list" className="appeals-list" />
            </div>
          </div>
        </div>
      </main>

      <div
        id="photo-modal"
        className="photo-modal"
        onClick={() => {
          if (typeof window.closePhotoModal === "function") {
            window.closePhotoModal();
          }
        }}
      >
        <img id="modal-photo" src="" alt="Appeal photo" />
      </div>
    </div>
  );
}
