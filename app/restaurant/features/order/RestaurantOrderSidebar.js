"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Input, Textarea } from "../../../components/ui";

function statusTone(status) {
  const normalized = String(status || "");
  if (normalized === "acknowledged" || normalized === "question_answered") {
    return "success";
  }
  if (normalized === "rejected_by_server" || normalized === "rejected_by_kitchen") {
    return "danger";
  }
  if (
    normalized === "awaiting_server_approval" ||
    normalized === "queued_for_kitchen" ||
    normalized === "with_kitchen" ||
    normalized === "awaiting_user_response"
  ) {
    return "warn";
  }
  return "neutral";
}

export function RestaurantOrderSidebar({
  orderFlow,
  user,
  isOpen,
  onToggleOpen,
  badgeCount = 0,
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    if (!isOpen) setConfirmOpen(false);
  }, [isOpen]);

  const canProceed = orderFlow.selectedDishNames.length > 0;
  const statusBadgeTone = useMemo(
    () => statusTone(orderFlow.activeOrder?.status),
    [orderFlow.activeOrder?.status],
  );

  const openConfirm = useCallback(() => {
    if (!canProceed) return;
    setSubmitError("");
    setConfirmOpen(true);
  }, [canProceed]);

  const closeConfirm = useCallback(() => {
    setConfirmOpen(false);
    setSubmitError("");
  }, []);

  const onSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      setSubmitError("");
      try {
        await orderFlow.submitNotice();
        setConfirmOpen(false);
      } catch (error) {
        setSubmitError(error?.message || "Unable to submit notice right now.");
      }
    },
    [orderFlow],
  );

  return (
    <>
      <aside className={`restaurant-order-sidebar ${isOpen ? "open" : "minimized"}`}>
        <div className="restaurant-order-sidebar-header">
          <button type="button" className="restaurant-order-sidebar-toggle" onClick={onToggleOpen}>
            <span className="restaurant-order-sidebar-toggle-label">
              {isOpen ? "Hide order dashboard" : "My order dashboard"}
            </span>
            <span className="restaurant-order-sidebar-badge">{badgeCount}</span>
          </button>
        </div>

        {isOpen ? (
          <div className="restaurant-order-sidebar-content">
            <div className="restaurant-order-sidebar-status">
              <div className="restaurant-order-sidebar-status-title">Allergy notice status</div>
              <Badge tone={statusBadgeTone}>{orderFlow.statusLabel}</Badge>
            </div>

            <div className="restaurant-order-sidebar-items">
              {orderFlow.selectedDishNames.length ? (
                orderFlow.selectedDishNames.map((dishName) => (
                  <div key={dishName} className="restaurant-order-sidebar-item">
                    <span>{dishName}</span>
                    <button type="button" onClick={() => orderFlow.removeDish(dishName)}>
                      Remove
                    </button>
                  </div>
                ))
              ) : (
                <p className="restaurant-order-sidebar-empty">No items added yet.</p>
              )}
            </div>

            <div className="restaurant-order-sidebar-actions">
              <Button tone="primary" onClick={openConfirm} disabled={!canProceed}>
                Proceed to confirmation
              </Button>
              <Button variant="outline" onClick={() => orderFlow.refreshStatus()}>
                Refresh status
              </Button>
            </div>
          </div>
        ) : null}
      </aside>

      <div
        className={`restaurant-order-confirm-drawer ${confirmOpen ? "show" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Send allergy and diet notice"
      >
        <div className="restaurant-order-confirm-panel">
          <header className="restaurant-order-confirm-header">
            <h2>Send allergy and diet notice</h2>
            <button type="button" onClick={closeConfirm} aria-label="Close notice drawer">
              ×
            </button>
          </header>

          <div className="restaurant-order-confirm-body">
            <section className="restaurant-order-confirm-section">
              <h3>Review your order</h3>
              {orderFlow.selectedDishNames.length ? (
                <ul>
                  {orderFlow.selectedDishNames.map((dishName) => (
                    <li key={dishName}>
                      <span>{dishName}</span>
                      <button type="button" onClick={() => orderFlow.removeDish(dishName)}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No dishes selected yet.</p>
              )}
            </section>

            <form className="restaurant-order-confirm-form" onSubmit={onSubmit}>
              <label>
                Your name
                <Input
                  value={orderFlow.formState.customerName}
                  placeholder={user?.user_metadata?.first_name || "Your name"}
                  onChange={(event) =>
                    orderFlow.updateFormField("customerName", event.target.value)
                  }
                />
              </label>

              <label>
                Dining mode
                <select
                  value={orderFlow.formState.diningMode}
                  onChange={(event) =>
                    orderFlow.updateFormField("diningMode", event.target.value)
                  }
                >
                  <option value="dine-in">Dine-in</option>
                  <option value="delivery">Delivery / pickup</option>
                </select>
              </label>

              <label>
                Server code (optional)
                <Input
                  value={orderFlow.formState.serverCode}
                  placeholder="#### + table"
                  onChange={(event) =>
                    orderFlow.updateFormField("serverCode", event.target.value)
                  }
                />
              </label>

              <label>
                Additional notes for the kitchen
                <Textarea
                  rows={3}
                  value={orderFlow.formState.notes}
                  onChange={(event) => orderFlow.updateFormField("notes", event.target.value)}
                />
              </label>

              <div className="restaurant-order-confirm-actions">
                <Button type="submit" tone="primary" loading={orderFlow.isSubmitting} disabled={!canProceed}>
                  Submit notice
                </Button>
                <Button type="button" variant="outline" onClick={() => orderFlow.refreshStatus()}>
                  Refresh status
                </Button>
                <Button type="button" variant="outline" onClick={orderFlow.reset}>
                  Reset
                </Button>
              </div>

              {submitError ? (
                <p className="restaurant-order-confirm-error">{submitError}</p>
              ) : null}
              {orderFlow.submitError ? (
                <p className="restaurant-order-confirm-error">{orderFlow.submitError}</p>
              ) : null}
              {orderFlow.statusError ? (
                <p className="restaurant-order-confirm-error">{orderFlow.statusError}</p>
              ) : null}
            </form>
          </div>
        </div>
      </div>
    </>
  );
}

export default RestaurantOrderSidebar;
