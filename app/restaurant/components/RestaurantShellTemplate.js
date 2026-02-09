export default function RestaurantShellTemplate() {
  return (
    <template id="restaurantWorkspaceTemplate">
      <div id="stickyHeader" style={{ background: "var(--bg)", padding: "8px 16px 8px 16px", flexShrink: 0 }}>
        <h1 id="restaurantTitle" style={{ margin: "0 0 8px 0", fontSize: "1.3rem" }}>
          Restaurant
        </h1>

        <div id="allergenDietRow" style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "stretch" }}>
          <div
            id="headerMiniMap"
            style={{
              display: "none",
              width: 80,
              flexShrink: 0,
              background: "rgba(30,30,40,0.95)",
              borderRadius: 8,
              flexDirection: "column",
              alignItems: "stretch",
              justifyContent: "flex-start",
              gap: 2,
            }}
          >
            <div style={{ position: "relative", width: "100%", borderRadius: 8, overflow: "hidden" }}>
              <img
                id="headerMiniMapImg"
                style={{ width: "100%", height: "auto", cursor: "pointer", objectFit: "contain", display: "block" }}
                draggable="false"
                alt="Menu mini map"
              />
              <div
                id="headerMiniMapViewport"
                style={{
                  position: "absolute",
                  boxSizing: "border-box",
                  border: "2px solid #dc2626",
                  background: "rgba(220,38,38,0.15)",
                  pointerEvents: "none",
                  borderRadius: 2,
                }}
              />
            </div>
            <div id="headerMiniMapLabel" style={{ fontSize: 9, color: "#9ca3af", marginTop: 0, textAlign: "center" }}>
              Page 1
            </div>
          </div>

          <div id="rightContentArea" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <div className="pill" style={{ flex: 1, margin: 0, padding: 5, minWidth: 0, overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2, gap: 4 }}>
                  <div id="savedAllergensLabel" style={{ fontWeight: 600, fontSize: "0.65rem", whiteSpace: "nowrap" }}>
                    Saved allergens
                  </div>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <button
                      className="btnLink clickable"
                      id="editSavedBtn"
                      style={{ fontSize: "0.6rem", flexShrink: 0, display: "none" }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="filterToggleBtn"
                      id="guestFilterToggleAllergens"
                      data-guest-filter-toggle="1"
                      style={{ display: "none" }}
                    >
                      Edit
                    </button>
                  </div>
                </div>
                <div
                  id="savedChips"
                  className="saved-chip-row"
                  style={{
                    fontSize: "0.65rem",
                    display: "flex",
                    flexWrap: "nowrap",
                    overflowX: "auto",
                    gap: 3,
                    WebkitOverflowScrolling: "touch",
                    scrollbarWidth: "none",
                    alignItems: "center",
                  }}
                />
              </div>

              <div className="pill" style={{ flex: 1, margin: 0, padding: 5, minWidth: 0, overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2, gap: 4 }}>
                  <div id="savedDietsLabel" style={{ fontWeight: 600, fontSize: "0.65rem", whiteSpace: "nowrap" }}>
                    Saved diets
                  </div>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <button
                      className="btnLink clickable"
                      id="editSavedDietsBtn"
                      style={{ fontSize: "0.6rem", flexShrink: 0, display: "none" }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="filterToggleBtn"
                      id="guestFilterToggleDiets"
                      data-guest-filter-toggle="1"
                      style={{ display: "none" }}
                    >
                      Edit
                    </button>
                  </div>
                </div>
                <div
                  id="dietChips"
                  className="saved-chip-row"
                  style={{
                    fontSize: "0.65rem",
                    display: "flex",
                    flexWrap: "nowrap",
                    overflowX: "auto",
                    gap: 3,
                    WebkitOverflowScrolling: "touch",
                    scrollbarWidth: "none",
                    alignItems: "center",
                  }}
                />
              </div>
            </div>

            <div id="actionButtonsRow" style={{ display: "none", gap: 3 }}>
              <button className="btn btnPrimary" id="restaurantWebsiteBtn" style={{ flex: 1, padding: "4px 1px", fontSize: 8, whiteSpace: "nowrap" }}>
                Restaurant website
              </button>
              <button className="btn btnPrimary" id="restaurantCallBtn" style={{ flex: 1, padding: "4px 1px", fontSize: 8, whiteSpace: "nowrap" }}>
                Call restaurant
              </button>
              <button className="btn btnPrimary" id="restaurantFeedbackBtn" style={{ flex: 1, padding: "4px 1px", fontSize: 8, whiteSpace: "nowrap" }}>
                Send feedback
              </button>
              <button
                className="btn"
                id="reportIssueBtn"
                style={{
                  flex: 1,
                  padding: "4px 1px",
                  fontSize: 8,
                  whiteSpace: "nowrap",
                  background: "#dc2626",
                  borderColor: "#dc2626",
                  color: "#fff",
                }}
              >
                Report issue
              </button>
            </div>

            <div id="confirmedRow" style={{ display: "none", fontSize: "0.6rem", color: "#9ca3af", textAlign: "left" }}>
              Last confirmed by restaurant staff: <span id="restaurantLastConfirmedText">-</span>
            </div>
          </div>
        </div>

        <div className="banner" id="disclaimerBanner" style={{ marginBottom: 8 }}>
          <span style={{ fontSize: "0.85rem" }}>Reference only. Always inform staff about your allergens.</span>
          <button className="ackBtn off" id="ackBtn" style={{ fontSize: "0.8rem", padding: "4px 10px" }}>
            I understand
          </button>
        </div>

        <div
          id="legendRow"
          style={{
            display: "none",
            flexDirection: "column",
            color: "#a8b2d6",
            padding: "4px 0",
            textAlign: "center",
            lineHeight: 1.6,
            overflow: "hidden",
            width: "100%",
          }}
        >
          <div id="legendLine1" style={{ display: "flex", justifyContent: "center", alignItems: "center", width: "100%", overflow: "hidden" }}>
            <span className="legendText" style={{ whiteSpace: "nowrap", fontSize: 12, display: "inline-flex", alignItems: "center" }}>
              <span className="legendSwatch legendSwatchGreen" />Complies ·
              <span className="legendSwatch legendSwatchYellow" style={{ marginLeft: 8 }} />Can be modified to comply ·
              <span className="legendSwatch legendSwatchRed" style={{ marginLeft: 8 }} />Cannot be modified to comply
            </span>
          </div>
          <div id="legendLine2" style={{ display: "flex", justifyContent: "center", alignItems: "center", width: "100%", overflow: "hidden" }}>
            <span className="legendText" style={{ whiteSpace: "nowrap", fontSize: 12, display: "inline-flex", alignItems: "center" }}>
              ⚠️ Cross-contamination risk · 👆 Tap dishes for details · 🤏 Pinch menu to zoom in/out
            </span>
          </div>
        </div>
      </div>

      <div className="menuWrap" id="menu" />
    </template>
  );
}
