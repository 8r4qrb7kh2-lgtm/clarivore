import RestaurantEditorShellTemplate from "./RestaurantEditorShellTemplate";
import RestaurantShellTemplate from "./RestaurantShellTemplate";
import RestaurantReportShellTemplate from "./RestaurantReportShellTemplate";
import SimpleTopbar from "../../components/SimpleTopbar";

export default function RestaurantCoreDom({ managerDashboardHref }) {
  return (
    <>
      <div className="wrap">
        <SimpleTopbar
          headerId="topbarOuter"
          innerId="topbar"
          showBrand={false}
          showNav={false}
          rightContent={
            <div
              className="mode-toggle-container"
              id="modeToggleContainer"
              style={{ display: "none" }}
            />
          }
        />
        <div className="content" id="root" />
      </div>

      <div className="tip" id="tip" />

      <div className="orderSidebar" id="orderSidebar">
        <div className="orderSidebarHeader">
          <div className="orderSidebarDragHandle" id="orderSidebarDragHandle">
            <span className="orderSidebarDragBar" />
            <span className="orderSidebarDragLabel">Drag</span>
          </div>
          <div className="orderSidebarHeaderRow">
            <div className="orderSidebarTitleWrap">
              <h3 className="orderSidebarTitle">My order dashboard</h3>
              <span className="orderSidebarBadge" id="orderSidebarBadge" hidden>
                0
              </span>
            </div>
            <button
              type="button"
              className="orderSidebarRefreshBtn"
              id="orderSidebarRefreshBtn"
              title="Refresh order status"
              style={{
                background: "rgba(76,90,212,0.3)",
                border: "1px solid rgba(76,90,212,0.5)",
                borderRadius: 6,
                padding: "6px 10px",
                color: "#a5b4fc",
                cursor: "pointer",
                fontSize: "0.85rem",
                fontWeight: 600,
                transition: "all 0.2s",
              }}
            >
              ↻
            </button>
          </div>
        </div>
        <div className="orderSidebarContent" id="orderSidebarContent">
          <div
            className="orderSidebarStatus"
            id="orderSidebarStatus"
            hidden
            style={{ display: "none" }}
          >
            <div className="orderSidebarStatusHeader">
              <span className="orderSidebarStatusTitle">Allergy notice status</span>
              <span
                className="orderSidebarStatusBadge orderConfirmStatusBadge"
                id="orderSidebarStatusBadge"
                data-tone="idle"
              >
                Waiting for server code
              </span>
            </div>
          </div>
          <div className="orderSidebarItems" id="orderSidebarItems" />
          <div className="orderSidebarActions" id="orderSidebarActions">
            <button type="button" className="confirmOrderBtn" id="confirmOrderBtn">
              Proceed to confirmation
            </button>
            <div className="confirmOrderHint" id="confirmOrderHint" hidden>
              <span>(check the box next to any dishes you would like to proceed with)</span>
            </div>
          </div>
        </div>
      </div>

      <div className="orderConfirmDrawer" id="orderConfirmDrawer" aria-hidden="true">
        <div
          className="orderConfirmPanel"
          role="dialog"
          aria-labelledby="orderConfirmHeading"
          aria-modal="true"
        >
          <header className="orderConfirmHeader">
            <h2 id="orderConfirmHeading">Send allergy &amp; diet notice</h2>
            <button
              className="orderConfirmClose"
              id="orderConfirmClose"
              type="button"
              aria-label="Close confirmation window"
            >
              ×
            </button>
          </header>
          <div className="orderConfirmLayout">
            <section className="orderConfirmPrimary">
              <div className="orderConfirmSection" id="orderConfirmSummarySection">
                <div>
                  <h3>Review your order</h3>
                  <ul className="orderConfirmSummaryList" id="orderConfirmSummaryList" />
                  <p className="orderConfirmEmpty" id="orderConfirmEmptySummary" hidden>
                    No dishes selected yet.
                  </p>
                </div>
              </div>

              <form className="orderConfirmSection orderConfirmForm" id="orderConfirmForm" autoComplete="off">
                <h3>Diner details</h3>
                <label>
                  <span>Your name</span>
                  <input
                    id="orderConfirmName"
                    name="orderConfirmName"
                    type="text"
                    placeholder="e.g. John Doe"
                    required
                  />
                </label>
                <div className="orderConfirmRadioGroup" role="group" aria-label="Dining mode">
                  <label>
                    <input type="radio" name="orderConfirmMode" value="dine-in" defaultChecked />
                    <span>Dine-in</span>
                  </label>
                  <label>
                    <input type="radio" name="orderConfirmMode" value="delivery" />
                    <span>Delivery / pickup</span>
                  </label>
                </div>
                <div className="orderConfirmConditional">
                  <div data-mode="delivery" id="deliveryButtonContainer" hidden>
                    <a
                      id="deliveryLinkButton"
                      className="btn btnPrimary"
                      target="_blank"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        textDecoration: "none",
                        width: "100%",
                        justifyContent: "center",
                      }}
                    >
                      <span>🚗 Order Delivery / Pickup</span>
                    </a>
                  </div>
                </div>
                <div>
                  <span>Allergies</span>
                  <div className="orderConfirmChips" id="orderConfirmAllergyChips" />
                </div>
                <div>
                  <span>Diets</span>
                  <div className="orderConfirmChips" id="orderConfirmDietChips" />
                </div>
                <label>
                  <span>Additional notes for the kitchen</span>
                  <textarea id="orderConfirmNotes" name="orderConfirmNotes" rows={3} placeholder="Optional" />
                </label>
                <div className="orderConfirmCodeBlock" id="orderConfirmCodeBlock">
                  <div id="dineInCodeSection">
                    <p>
                      When your server is ready, they will share a code that combines their four-digit server ID with your table number.
                      Enter it below to confirm your notice to the server tablet.
                    </p>
                    <label>
                      <span>Enter the code from your server</span>
                      <input
                        id="orderConfirmCodeInput"
                        name="orderConfirmCodeInput"
                        type="text"
                        inputMode="numeric"
                        maxLength={8}
                        placeholder="#### + table"
                      />
                    </label>
                  </div>
                  <div
                    id="deliveryMessageSection"
                    style={{
                      display: "none",
                      padding: 16,
                      background: "rgba(220, 82, 82, 0.1)",
                      border: "1px solid rgba(220, 82, 82, 0.3)",
                      borderRadius: 8,
                      marginBottom: 16,
                    }}
                  >
                    <p style={{ color: "#dc5252", margin: 0, fontWeight: 600, lineHeight: 1.5 }}>
                      ⚠️ Please make sure you placed your order with the delivery service before submitting the notice.
                    </p>
                  </div>
                  <div className="orderConfirmAuthPrompt" id="orderConfirmAuthPrompt" style={{ display: "none" }}>
                    <p className="orderConfirmAuthText">
                      You need to sign in or create a free account to submit your notice.
                    </p>
                    <div className="orderConfirmAuthButtons">
                      <button type="button" className="orderConfirmAuthBtn orderConfirmSignInBtn" id="orderConfirmSignInBtn">
                        Sign in
                      </button>
                      <button type="button" className="orderConfirmAuthBtn orderConfirmSignUpBtn" id="orderConfirmSignUpBtn">
                        Create account
                      </button>
                    </div>
                  </div>
                  <div className="orderConfirmActions">
                    <button type="button" className="orderConfirmPrimaryBtn" id="orderConfirmSubmitBtn" disabled>
                      Submit notice
                    </button>
                    <div className="orderConfirmStatusText" id="orderConfirmSubmitStatus" role="status" aria-live="polite" />
                  </div>
                </div>
              </form>

              <div className="orderConfirmActions">
                <button
                  type="button"
                  className="orderConfirmSecondaryBtn orderConfirmReset"
                  id="orderConfirmResetBtn"
                  hidden
                >
                  Start another notice
                </button>
              </div>
            </section>

            <aside className="orderConfirmAside" hidden />
          </div>
        </div>
      </div>

      <div className="modalBack" id="modalBack">
        <div className="modal">
          <button className="modalCloseBtn" id="modalCloseBtn" type="button">
            ×
          </button>
          <div className="head">
            <div id="modalTitle">Edit item</div>
          </div>
          <div className="body" id="modalBody" />
        </div>
      </div>

      <div className="photoModal" id="photoModal">
        <div className="photoModalClose" id="photoModalClose">
          ×
        </div>
        <img id="photoModalImage" src="" alt="Confirmation" />
      </div>

      <div className="qrPromoBackdrop" id="qrPromoBackdrop" aria-hidden="true">
        <div className="qrPromo" role="dialog" aria-labelledby="qrPromoTitle" aria-modal="true">
          <button className="qrPromoClose" id="qrPromoClose" type="button" aria-label="Close promotion">
            ×
          </button>
          <h2 id="qrPromoTitle">Check out all restaurants part of Clarivore</h2>
          <p>Save your allergens and diets once and unlock curated menus at restaurants across the city.</p>
          <p>Creating an account takes less than a minute and is completely free.</p>
          <button className="btn btnPrimary" id="qrPromoSignup" type="button">
            Create free account
          </button>
        </div>
      </div>

      <div className="managerInviteBanner" id="managerInviteBanner" style={{ display: "none" }}>
        <div className="managerInviteBanner-content">
          <div className="managerInviteBanner-icon">🔑</div>
          <div className="managerInviteBanner-text">
            <strong>You have been invited as a manager</strong>
            <span>Sign up to activate manager access to this restaurant</span>
          </div>
        </div>
        <button className="btn btnPrimary" id="managerInviteSignupBtn" type="button">
          Sign up to activate access
        </button>
      </div>

      <div className="editorLockBackdrop" id="editorLockBackdrop" style={{ display: "none" }}>
        <div className="editorLockModal" role="dialog" aria-modal="true" aria-labelledby="editorLockTitle">
          <div className="editorLockIcon">🔒</div>
          <h2 id="editorLockTitle">Editor Currently in Use</h2>
          <p className="editorLockMessage">
            <span id="editorLockUser">Another user</span> is currently editing this restaurant menu.
          </p>
          <p className="editorLockSince">
            Editing since: <span id="editorLockSince">--</span>
          </p>
          <p className="editorLockInfo">
            To avoid conflicts, only one person can edit at a time. The editor becomes available when they finish or after 2 minutes of inactivity.
          </p>
          <div className="editorLockActions">
            <button className="btn btnPrimary" id="editorLockRefresh" type="button">
              Check again
            </button>
          </div>
          <div style={{ marginTop: 16 }}>
            <a href={managerDashboardHref} className="btn btnSecondary" style={{ textDecoration: "none", display: "inline-block" }}>
              Go to dashboard
            </a>
          </div>
        </div>
      </div>

      <div className="zoomTopOverlay" id="zoomTopOverlay" />

      <div className="zoomedDishInfo" id="zoomedDishInfo">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <button className="zoomBackButton" id="zoomBackButton" type="button">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h3 id="zoomedDishName" style={{ margin: 0 }}>
            Dish Name
          </h3>
        </div>
        <div className="allergenChips" id="zoomedAllergenChips" />
        <div className="zoomedDishActions" id="zoomedDishActions" />
      </div>

      <RestaurantShellTemplate />
      <RestaurantEditorShellTemplate />
      <RestaurantReportShellTemplate />
    </>
  );
}
