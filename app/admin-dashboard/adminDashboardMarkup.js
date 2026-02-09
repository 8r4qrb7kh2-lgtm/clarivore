export const adminDashboardMarkup = String.raw`
  <header class="simple-topbar">
    <div class="simple-topbar-inner">
      <a class="simple-brand" href="/home">
        <img src="https://static.wixstatic.com/media/945e9d_2b97098295d341d493e4a07d80d6b57c~mv2.png" alt="Clarivore logo">
        <span>Clarivore</span>
      </a>
      <div class="simple-nav">
        <!-- Navigation populated by shared-nav.js -->
      </div>
      <div class="mode-toggle-container" id="modeToggleContainer" style="display:none"></div>
    </div>
  </header>

  <main class="admin-container">
    <div id="access-denied" class="access-denied" style="display:none;">
      <h1>🔒 Access Denied</h1>
      <p>You must be logged in as an administrator to access this page.</p>
      <button class="btn-primary" onclick="window.location.href='/account'">Go to Account</button>
    </div>

    <div id="admin-content" style="display:none;">
      <div class="admin-header">
        <h1>🛡️ Admin Dashboard</h1>
        <p>Manage restaurants and review appeals</p>
      </div>

      <div class="tab-buttons">
        <button class="tab-btn active" data-tab="restaurants">Restaurants</button>
        <button class="tab-btn" data-tab="managers">Managers</button>
        <button class="tab-btn" data-tab="appeals">Appeals Review</button>
        <button class="tab-btn" data-tab="feedback">Anonymous Feedback</button>
        <button class="tab-btn" data-tab="product-reports">📋 Issue Reports</button>
      </div>

      <div class="tab-toolbar">
        <div class="restaurant-selector">
          <label for="admin-restaurant-select">Restaurant</label>
          <select id="admin-restaurant-select">
            <option value="all">All restaurants</option>
          </select>
        </div>
      </div>

      <!-- Restaurants Tab -->
      <div id="tab-restaurants" class="tab-content active">
        <div class="admin-grid">
          <div class="admin-card">
            <h2>Add New Restaurant</h2>
            <form id="add-restaurant-form">
              <div class="form-group">
                <label for="restaurant-name">Restaurant Name *</label>
                <input type="text" id="restaurant-name" required placeholder="e.g., Falafel Café">
              </div>

              <div class="form-group">
                <label for="restaurant-website">Website</label>
                <input type="url" id="restaurant-website" placeholder="https://example.com">
              </div>

              <div class="form-group">
                <label for="restaurant-description">Description</label>
                <textarea id="restaurant-description" placeholder="Brief description of the restaurant"></textarea>
              </div>

              <div class="form-group">
                <label for="menu-image">Menu Image *</label>
                <input type="file" id="menu-image" accept="image/*" required>
                <img id="image-preview" class="image-preview" alt="Menu preview">
              </div>

              <button type="submit" class="btn-primary" id="submit-btn">Add Restaurant</button>
              <div id="status-message" class="status-message"></div>
            </form>
          </div>

          <div class="admin-card">
            <h2>Existing Restaurants</h2>
            <div id="restaurants-list" class="restaurants-list">
              <p style="color: #718096;">Loading restaurants...</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Managers Tab -->
      <div id="tab-managers" class="tab-content">
        <div class="admin-card admin-card-full">
          <h2>👥 Restaurant Managers</h2>
          <p style="color: #718096; margin-bottom: 20px;">View current manager access for the selected restaurant, revoke access, and generate invite links.</p>
          <div id="manager-access-list" class="manager-access-list">
            <p style="color: #718096;">Loading manager access...</p>
          </div>
        </div>
      </div>

      <!-- Appeals Tab -->
      <div id="tab-appeals" class="tab-content">
        <div class="admin-card admin-card-full">
          <h2>📷 Ingredient Scan Appeals</h2>
          <p style="color: #718096; margin-bottom: 24px;">Review and approve or deny manager appeals for ingredient scanning requirements</p>

          <div class="appeals-filters">
            <button class="filter-btn active" data-filter="all">All Appeals</button>
            <button class="filter-btn" data-filter="pending">Pending</button>
            <button class="filter-btn" data-filter="approved">Approved</button>
            <button class="filter-btn" data-filter="rejected">Rejected</button>
          </div>

          <div id="loading-appeals" class="loading">
            <p>Loading appeals...</p>
          </div>

          <div id="no-appeals" class="no-appeals" style="display:none;">
            <h3>No appeals found</h3>
            <p>There are no appeals matching your current filter.</p>
          </div>

          <div id="appeals-list" class="appeals-list"></div>
        </div>
      </div>

      <!-- Anonymous Feedback Tab -->
      <div id="tab-feedback" class="tab-content">
        <div class="admin-card admin-card-full">
          <h2>🗣️ Anonymous Feedback</h2>
          <p style="color: #718096; margin-bottom: 24px;">Feedback submitted without an email address.</p>
          <div id="feedback-list" class="feedback-list">
            <p style="color: #718096;">Loading feedback...</p>
          </div>
        </div>
      </div>

      <!-- Issue Reports Tab -->
      <div id="tab-product-reports" class="tab-content">
        <div class="admin-card admin-card-full">
          <h2>📋 Issue Reports</h2>
          <p style="color: #718096; margin-bottom: 24px;">Review user-reported issues with menu issues, brand verification, and product analysis</p>

          <div class="appeals-filters">
            <button class="filter-btn-reports active" data-filter-reports="all">All Reports</button>
            <button class="filter-btn-reports" data-filter-reports="pending">Pending</button>
            <button class="filter-btn-reports" data-filter-reports="resolved">Resolved</button>
            <button class="filter-btn-reports" data-filter-reports="dismissed">Dismissed</button>
          </div>

          <div id="loading-reports" class="loading">
            <p>Loading reports...</p>
          </div>

          <div id="no-reports" class="no-appeals" style="display:none;">
            <h3>No reports found</h3>
            <p>There are no product issue reports matching your current filter.</p>
          </div>

          <div id="reports-list" class="appeals-list"></div>
        </div>
      </div>
    </div>
  </main>

  <!-- Photo Modal -->
  <div id="photo-modal" class="photo-modal" onclick="closePhotoModal()">
    <img id="modal-photo" src="" alt="Appeal photo">
  </div>


`;
