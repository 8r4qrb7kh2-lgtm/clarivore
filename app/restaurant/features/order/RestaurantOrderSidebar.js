"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Input, Textarea } from "../../../components/ui";

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeToken(value) {
  return trim(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sameDishName(a, b) {
  const aToken = normalizeToken(a);
  const bToken = normalizeToken(b);
  return Boolean(aToken && bToken && aToken === bToken);
}

function formatNoticeTimestamp(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isDineInMode(value) {
  return trim(value).toLowerCase() === "dine-in";
}

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
  const [confirmDishNames, setConfirmDishNames] = useState([]);

  useEffect(() => {
    if (!isOpen) {
      setConfirmOpen(false);
      setConfirmDishNames([]);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!confirmOpen) return;
    setConfirmDishNames((current) =>
      current.filter((dishName) =>
        orderFlow.selectedDishNames.some((pendingDish) => sameDishName(dishName, pendingDish)),
      ),
    );
  }, [confirmOpen, orderFlow.selectedDishNames]);

  const canProceed = orderFlow.checkedDishNames.length > 0;
  const activeNotices = Array.isArray(orderFlow.activeNotices)
    ? orderFlow.activeNotices
    : [];
  const confirmRows = useMemo(
    () =>
      confirmDishNames.map((dishName) => ({
        dishName,
        ...orderFlow.getDishNoticeRows(dishName),
      })),
    [confirmDishNames, orderFlow],
  );
  const serverCodeRequired = isDineInMode(orderFlow.formState.diningMode);

  const removeDish = useCallback(
    (dishName) => {
      orderFlow.removeDish(dishName);
      setConfirmDishNames((current) =>
        current.filter((entry) => !sameDishName(entry, dishName)),
      );
    },
    [orderFlow],
  );

  const openConfirm = useCallback(() => {
    if (!canProceed) return;
    setSubmitError("");
    setConfirmDishNames([...orderFlow.checkedDishNames]);
    setConfirmOpen(true);
  }, [canProceed, orderFlow.checkedDishNames]);

  const closeConfirm = useCallback(() => {
    setConfirmOpen(false);
    setSubmitError("");
    setConfirmDishNames([]);
  }, []);

  const onReset = useCallback(() => {
    orderFlow.reset();
    setSubmitError("");
    setConfirmDishNames([]);
  }, [orderFlow]);

  const onSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      setSubmitError("");
      const dishesToSubmit = confirmDishNames.filter((dishName) =>
        orderFlow.selectedDishNames.some((pendingDish) => sameDishName(dishName, pendingDish)),
      );

      if (!dishesToSubmit.length) {
        setSubmitError("Select at least one dish before submitting.");
        return;
      }

      if (serverCodeRequired && !trim(orderFlow.formState.serverCode)) {
        setSubmitError("Server code is required for dine-in notices.");
        return;
      }

      try {
        await orderFlow.submitNotice(dishesToSubmit);
        setConfirmOpen(false);
        setConfirmDishNames([]);
      } catch (error) {
        setSubmitError(error?.message || "Unable to submit notice right now.");
      }
    },
    [confirmDishNames, orderFlow, serverCodeRequired],
  );

  return (
    <>
      <aside className={`restaurant-order-sidebar ${isOpen ? "open" : "minimized"}`}>
        <div className="restaurant-order-sidebar-header">
          <button type="button" className="restaurant-order-sidebar-toggle" onClick={onToggleOpen}>
            <span className="restaurant-order-sidebar-toggle-label">
              {isOpen ? "Hide notice dashboard" : "My notice dashboard"}
            </span>
            <span className="restaurant-order-sidebar-badge">{badgeCount}</span>
          </button>
        </div>

        {isOpen ? (
          <div className="restaurant-order-sidebar-content">
            <section className="restaurant-order-sidebar-section">
              <div className="restaurant-order-sidebar-section-head">
                <h3 className="restaurant-order-sidebar-section-title">Active notices</h3>
                <Button size="compact" variant="outline" onClick={() => orderFlow.refreshStatus()}>
                  Refresh status
                </Button>
              </div>
              {activeNotices.length ? (
                <div className="restaurant-order-active-notices">
                  {activeNotices.map((notice) => (
                    <article
                      key={notice.id || `${notice.status}-${notice.updatedAt}`}
                      className="restaurant-order-active-notice"
                    >
                      <div className="restaurant-order-active-notice-head">
                        <div className="restaurant-order-active-notice-meta">
                          <span>{notice.diningModeLabel}</span>
                          {notice.updatedAt ? (
                            <span>Updated {formatNoticeTimestamp(notice.updatedAt)}</span>
                          ) : null}
                        </div>
                        <Badge tone={statusTone(notice.status)}>{notice.statusLabel}</Badge>
                      </div>
                      <ul className="restaurant-order-active-notice-dishes">
                        {notice.selectedDishes.map((dishName) => (
                          <li key={`${notice.id}-${dishName}`}>{dishName}</li>
                        ))}
                      </ul>
                      {notice.customNotes ? (
                        <p className="restaurant-order-active-notice-notes">
                          Note: {notice.customNotes}
                        </p>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="restaurant-order-sidebar-empty">
                  No active notices submitted yet.
                </p>
              )}
            </section>

            <section className="restaurant-order-sidebar-section">
              <h3 className="restaurant-order-sidebar-section-title">Pending dishes</h3>
              <div className="restaurant-order-sidebar-items">
                {orderFlow.selectedDishNames.length ? (
                  orderFlow.selectedDishNames.map((dishName) => (
                    <div key={dishName} className="restaurant-order-sidebar-item">
                      <label className="restaurant-order-sidebar-item-select">
                        <input
                          type="checkbox"
                          checked={orderFlow.isDishSelectedForNotice(dishName)}
                          onChange={() => orderFlow.toggleDishSelection(dishName)}
                        />
                        <span>{dishName}</span>
                      </label>
                      <button type="button" onClick={() => removeDish(dishName)}>
                        Remove
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="restaurant-order-sidebar-empty">No dishes added yet.</p>
                )}
              </div>
            </section>

            <div className="restaurant-order-sidebar-actions">
              <Button tone="primary" onClick={openConfirm} disabled={!canProceed}>
                {canProceed
                  ? `Proceed to confirmation (${orderFlow.checkedDishNames.length})`
                  : "Proceed to confirmation"}
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
              <h3>Dishes in this notice</h3>
              {confirmRows.length ? (
                <div className="restaurant-order-confirm-dishes">
                  {confirmRows.map((dish) => (
                    <article key={dish.dishName} className="restaurant-order-confirm-dish">
                      <div className="restaurant-order-confirm-dish-head">
                        <h4>{dish.dishName}</h4>
                        <button type="button" onClick={() => removeDish(dish.dishName)}>
                          Remove
                        </button>
                      </div>
                      {dish.rows.length ? (
                        <ul className="restaurant-order-confirm-dish-rows">
                          {dish.rows.map((row) => (
                            <li
                              key={`${dish.dishName}-${row.key}`}
                              className={`restaurant-order-confirm-dish-row ${row.tone}`}
                            >
                              <span>{row.title}</span>
                              {row.reasonBullet ? <small>{row.reasonBullet}</small> : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="restaurant-order-confirm-section-note">
                          No saved allergens or diets selected.
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <p>No dishes selected for this notice.</p>
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

              {serverCodeRequired ? (
                <label>
                  Server code (required for dine-in)
                  <Input
                    required
                    value={orderFlow.formState.serverCode}
                    placeholder="#### + table"
                    onChange={(event) =>
                      orderFlow.updateFormField("serverCode", event.target.value)
                    }
                  />
                </label>
              ) : null}

              <label>
                Additional notes for the kitchen
                <Textarea
                  rows={3}
                  value={orderFlow.formState.notes}
                  onChange={(event) => orderFlow.updateFormField("notes", event.target.value)}
                />
              </label>

              <div className="restaurant-order-confirm-actions">
                <Button
                  type="submit"
                  tone="primary"
                  loading={orderFlow.isSubmitting}
                  disabled={!confirmDishNames.length}
                >
                  Submit notice
                </Button>
                <Button type="button" variant="outline" onClick={() => orderFlow.refreshStatus()}>
                  Refresh status
                </Button>
                <Button type="button" variant="outline" onClick={onReset}>
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
