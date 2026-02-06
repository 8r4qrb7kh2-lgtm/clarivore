export const managerDashboardMarkup = String.raw`

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

  <main class="page-main">
    <div class="dashboard-container">
      <div class="dashboard-header">
        <h1>Restaurant Manager Dashboard</h1>
        <p>View customer dietary analytics and accommodation requests</p>
      </div>

      <!-- Restaurant Selector -->
      <div class="restaurant-selector" id="restaurant-selector-container" style="display:none;">
        <label style="display:block;margin-bottom:8px;color:var(--muted);">Select Restaurant</label>
        <select id="restaurant-select">
          <option value="">Loading restaurants...</option>
        </select>
      </div>

      <!-- Auth Required Message -->
      <div id="auth-required" class="section" style="display:none;">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <h3>Sign in Required</h3>
          <p>Please sign in to access the manager dashboard.</p>
          <a href="/account" class="action-btn primary" style="display:inline-block;margin-top:16px;text-decoration:none;">Sign In</a>
        </div>
      </div>

      <!-- Not a Manager Message -->
      <div id="not-manager" class="section" style="display:none;">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <h3>Manager Access Required</h3>
          <p>You don't have manager access to any restaurants yet.</p>
        </div>
      </div>

      <!-- Loading State -->
      <div id="loading-state" class="section">
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Loading dashboard...</p>
        </div>
      </div>

      <!-- Dashboard Content -->
      <div id="dashboard-content" style="display:none;">
        <!-- Quick Actions Section -->
        <div class="section quick-actions-section">
          <div class="quick-actions-grid">
            <div class="quick-actions-panel">
              <div class="chat-header-row">
                <div class="chat-title-wrap">
                  <h3 class="quick-actions-title" style="margin:0;">Direct Messages</h3>
                  <span class="chat-badge" id="chat-unread-badge" style="display:none">0</span>
                </div>
                <button class="btn btnWarning" id="chat-ack-btn" style="display:none">Acknowledge message(s)</button>
              </div>
              <div id="chat-preview-list" class="chat-preview-list">
                <div class="loading-state" style="padding:20px;text-align:center;">
                  <div class="spinner" style="width:24px;height:24px;margin:0 auto 8px;"></div>
                  <p style="color:var(--muted);font-size:0.85rem;margin:0;">Loading...</p>
                </div>
              </div>
              <div class="chat-preview-compose">
                <input id="chat-message-input" class="chat-preview-input" type="text" placeholder="Message Clarivore">
                <button class="btn" id="chat-send-btn">Send</button>
              </div>
            </div>
            <!-- Confirmation Status -->
            <div class="quick-actions-panel">
              <h3 class="quick-actions-title">Menu Confirmation</h3>
              <div id="confirmation-status" class="confirmation-status">
                <div class="loading-state" style="padding:20px;text-align:center;">
                  <div class="spinner" style="width:24px;height:24px;margin:0 auto 8px;"></div>
                  <p style="color:var(--muted);font-size:0.85rem;margin:0;">Loading...</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="dashboard-split">
            <div class="dashboard-panel">
              <div class="section-header">
                <h2 class="section-title">Recent changes</h2>
                <p style="color:var(--muted);font-size:0.85rem;margin:0;">Review the latest edits to your menu.</p>
              </div>
              <div id="recent-changes-list" class="recent-changes-list">
                <div class="loading-state" style="padding:20px;text-align:center;">
                  <div class="spinner" style="width:24px;height:24px;margin:0 auto 8px;"></div>
                  <p style="color:var(--muted);font-size:0.85rem;margin:0;">Loading...</p>
                </div>
              </div>
              <button class="btn" id="viewFullLogBtn" style="width:100%;margin-top:16px;">View full change log</button>
            </div>
            <div class="dashboard-panel">
              <div class="section-header">
                <h2 class="section-title brand-items-title">Brand items in use</h2>
              </div>
              <div class="brand-items-search">
                <input id="brand-items-search" class="brand-search-input" type="search" placeholder="Search brand items...">
              </div>
              <div id="brand-items-list" class="brand-items-list">
                <div class="loading-state" style="padding:20px;text-align:center;">
                  <div class="spinner" style="width:24px;height:24px;margin:0 auto 8px;"></div>
                  <p style="color:var(--muted);font-size:0.85rem;margin:0;">Loading brand items...</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Menu Heatmap Section -->
        <div class="section">
          <div class="section-header">
            <h2 class="section-title">Menu Interest Heatmap</h2>
            <p style="color:var(--muted);font-size:0.85rem;margin:0;">Click on a dish to see detailed analytics</p>
          </div>
          <!-- Metric toggle at top -->
          <div class="heatmap-controls">
            <div class="heatmap-metric-toggle">
              <span class="heatmap-metric-label">Categorize interest by:</span>
              <div class="heatmap-metric-buttons">
                <button class="heatmap-metric-btn active" data-metric="views">Total views</button>
                <button class="heatmap-metric-btn" data-metric="loves">Total loves</button>
                <button class="heatmap-metric-btn" data-metric="orders">Total orders</button>
                <button class="heatmap-metric-btn" data-metric="requests">Total requests</button>
                <button class="heatmap-metric-btn" data-metric="accommodation">Proportion of views safe/accommodable</button>
              </div>
            </div>
            <div class="heatmap-legend">
              <div class="heatmap-legend-gradient">
                <span style="font-size:0.75rem;color:var(--muted);">Low</span>
                <div class="heatmap-gradient-bar"></div>
                <span style="font-size:0.75rem;color:var(--muted);">High</span>
              </div>
            </div>
          </div>
          <div class="menu-heatmap-container" id="menu-heatmap-container">
            <div id="menu-heatmap-loading" class="loading-state" style="padding:40px;">
              <div class="spinner"></div>
              <p>Loading menu...</p>
            </div>
            <div id="menu-heatmap-content" style="display:none;">
              <div class="menu-heatmap-inner" id="menu-heatmap-inner">
                <img id="menu-heatmap-img" class="menu-heatmap-img" src="" alt="Menu">
                <div class="menu-heatmap-overlays" id="menu-heatmap-overlays"></div>
              </div>
              <!-- Page navigation at bottom -->
              <div class="heatmap-page-nav" id="heatmap-page-nav" style="display:none;">
                <button class="heatmap-page-btn" id="heatmap-prev-btn" disabled>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M15 18l-6-6 6-6"/>
                  </svg>
                </button>
                <span class="heatmap-page-indicator" id="heatmap-page-indicator">Page 1 of 1</span>
                <button class="heatmap-page-btn" id="heatmap-next-btn" disabled>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 18l6-6-6-6"/>
                  </svg>
                </button>
              </div>
            </div>
            <div id="menu-heatmap-empty" class="no-menu-image" style="display:none;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              <p>No menu image available for this restaurant</p>
            </div>
          </div>
          <!-- Menu Accommodation Breakdown -->
          <div class="menu-accommodation-breakdown" id="menu-accommodation-breakdown" style="display:none;">
            <h3 style="font-size:1rem;font-weight:600;color:var(--ink);margin:16px 0 8px 0;">Menu Accommodation Breakdown</h3>
            <div class="menu-accommodation-legend">
              <span class="legend-item"><span class="legend-color" style="background:#22c55e;"></span> Safe</span>
              <span class="legend-item"><span class="legend-color" style="background:#facc15;"></span> Needs accommodation</span>
              <span class="legend-item"><span class="legend-color" style="background:#ef4444;"></span> Cannot accommodate</span>
            </div>
            <div id="menu-allergen-breakdown" style="margin-bottom:16px;"></div>
            <div id="menu-diet-breakdown"></div>
          </div>
        </div>

        <!-- User Dietary Profile Breakdown (Pie Charts) -->
        <div class="section" id="user-dietary-profile-section" style="display:none;">
          <div class="section-header">
            <h2 class="section-title">User Dietary Profile Breakdown</h2>
          </div>
          <p style="font-size:0.85rem;color:var(--muted);margin-bottom:16px;">Distribution of allergens and diets among users who viewed this menu</p>
          <div style="display:flex;gap:32px;flex-wrap:wrap;justify-content:center;">
            <div id="user-allergen-pie" style="flex:1;min-width:280px;max-width:400px;"></div>
            <div id="user-diet-pie" style="flex:1;min-width:280px;max-width:400px;"></div>
          </div>
        </div>
      </div>
    </div>
  </main>

  <!-- Response Modal -->
  <div class="response-modal" id="response-modal">
    <div class="response-modal-content">
      <h3 id="modal-title">Respond to Request</h3>
      <p id="modal-dish" style="color:var(--muted);margin-bottom:16px;"></p>
      <textarea id="response-text" placeholder="Add a response message (optional)..."></textarea>
      <div class="modal-actions">
        <button class="action-btn" id="modal-cancel">Cancel</button>
        <button class="action-btn decline" id="modal-decline">Decline</button>
        <button class="action-btn success" id="modal-implement">Mark Implemented</button>
      </div>
    </div>
  </div>

  <!-- Dish Analytics Modal -->
  <div class="dish-analytics-modal" id="dish-analytics-modal">
    <div class="dish-analytics-content">
      <div class="dish-analytics-header">
        <h3 id="dish-analytics-title">Dish Analytics</h3>
        <button class="dish-analytics-close" id="dish-analytics-close">&times;</button>
      </div>

      <!-- Cannot be accommodated row -->
      <div id="cannot-accommodate-row" class="accommodation-row cannot" style="display:none;">
        <span class="accommodation-label">Cannot be accommodated:</span>
        <div id="cannot-accommodate-tags" class="accommodation-tags"></div>
      </div>

      <!-- Can be accommodated row -->
      <div id="can-accommodate-row" class="accommodation-row can" style="display:none;">
        <span class="accommodation-label">Can be accommodated:</span>
        <div id="can-accommodate-tags" class="accommodation-tags"></div>
      </div>

      <!-- Stacked bar chart for status breakdown -->
      <div class="analytics-section" style="margin-top:16px;">
        <div class="analytics-section-title">Dish Interest Summary</div>
        <div class="stacked-bar-chart" id="analytics-stacked-chart">
          <!-- Populated by JS -->
        </div>
      </div>

      <!-- Conflict breakdown by allergen/diet -->
      <div class="analytics-section" style="margin-top:16px;" id="conflict-breakdown-section">
        <div class="analytics-section-title">Views by Conflicting Restriction</div>
        <div class="conflict-charts-container">
          <div class="conflict-chart">
            <div class="conflict-chart-title">Allergens</div>
            <div class="conflict-bars" id="conflict-allergen-bars">
              <!-- Populated by JS -->
            </div>
          </div>
          <div class="conflict-chart">
            <div class="conflict-chart-title">Diets</div>
            <div class="conflict-bars" id="conflict-diet-bars">
              <!-- Populated by JS -->
            </div>
          </div>
        </div>
        <div class="stacked-bar-legend" style="margin-top:12px;">
          <span class="legend-item"><span class="legend-color" style="background:#22c55e;"></span> Safe</span>
          <span class="legend-item"><span class="legend-color" style="background:#facc15;"></span> Can be accommodated</span>
          <span class="legend-item"><span class="legend-color" style="background:#ef4444;"></span> Cannot be accommodated</span>
        </div>
      </div>

      <!-- Accommodation requests count for this dish -->
      <div class="analytics-section" style="margin-top:16px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:0.9rem;color:var(--muted);">Accommodation Requests:</span>
          <span id="analytics-requests" style="font-weight:600;color:var(--ink);">0</span>
        </div>
      </div>

    </div>
  </div>

`;
