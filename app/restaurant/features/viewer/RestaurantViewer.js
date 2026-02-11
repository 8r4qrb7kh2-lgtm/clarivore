"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "../../../components/ui";

const REFERENCE_NOTE_ACK_KEY = "clarivoreReferenceNoteAcked";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseLastConfirmed(value) {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not available";
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

function overlayKey(overlay, index) {
  return `${String(overlay?.id || "dish").replace(/[^a-zA-Z0-9_-]/g, "-")}-${
    overlay?.pageIndex || 0
  }-${index}`;
}

function overlaySignature(overlay) {
  return [
    String(overlay?.id || "").trim(),
    String(Number(overlay?.pageIndex) || 0),
    String(parseOverlayNumber(overlay?.x)),
    String(parseOverlayNumber(overlay?.y)),
    String(parseOverlayNumber(overlay?.w)),
    String(parseOverlayNumber(overlay?.h)),
  ].join("::");
}

function statusBorderColor(status) {
  if (status === "safe") return "#22c55e";
  if (status === "removable") return "#facc15";
  if (status === "unsafe") return "#ef4444";
  return "rgba(255,255,255,0.45)";
}

function includesPreference(values, preference) {
  const target = normalizeToken(preference);
  if (!target) return false;
  return (Array.isArray(values) ? values : []).some(
    (value) => normalizeToken(value) === target,
  );
}

function lookupDetailByKey(dish, key) {
  if (!dish?.details || typeof dish.details !== "object") return "";
  const target = normalizeToken(key);
  if (!target) return "";
  for (const [detailKey, detailValue] of Object.entries(dish.details)) {
    if (String(detailKey || "").startsWith("__")) continue;
    if (normalizeToken(detailKey) === target) {
      return String(detailValue || "").trim();
    }
  }
  return "";
}

function buildAllergenRows(dish, savedAllergens) {
  if (!savedAllergens.length) {
    const dishAllergens = Array.isArray(dish?.allergens) ? dish.allergens : [];
    if (!dishAllergens.length) return [];
    return dishAllergens.map((label) => ({
      key: normalizeToken(label),
      tone: "bad",
      title: `Contains ${label}`,
      detail: lookupDetailByKey(dish, label),
    }));
  }

  return savedAllergens.map((item) => {
    const contains =
      includesPreference(dish?.allergens, item.key) ||
      includesPreference(dish?.allergens, item.label);
    const detail = contains
      ? lookupDetailByKey(dish, item.key) || lookupDetailByKey(dish, item.label)
      : "";
    return {
      key: item.key,
      tone: contains ? "bad" : "good",
      title: contains
        ? `${item.emoji || "⚠"} Contains ${item.label}`
        : `${item.emoji || "✓"} This dish is free of ${item.label}`,
      detail,
    };
  });
}

function buildDietRows(dish, savedDiets) {
  if (!savedDiets.length) {
    const dishDiets = Array.isArray(dish?.diets) ? dish.diets : [];
    if (!dishDiets.length) return [];
    return dishDiets.map((label) => ({
      key: normalizeToken(label),
      tone: "good",
      title: `This dish is ${label}`,
      detail: lookupDetailByKey(dish, label),
    }));
  }

  return savedDiets.map((item) => {
    const compatible =
      includesPreference(dish?.diets, item.key) ||
      includesPreference(dish?.diets, item.label);
    const detail = !compatible
      ? lookupDetailByKey(dish, item.key) || lookupDetailByKey(dish, item.label)
      : "";
    return {
      key: item.key,
      tone: compatible ? "good" : "bad",
      title: compatible
        ? `${item.emoji || "✓"} This dish is ${item.label}`
        : `${item.emoji || "⚠"} This dish is not ${item.label}`,
      detail,
    };
  });
}

function parseOverlayNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return clamp(numeric, 0, 100);
}

export function RestaurantViewer({
  restaurant,
  viewer,
  orderFlow,
  lovedDishes,
  favoriteBusyDish,
}) {
  const [selectedOverlay, setSelectedOverlay] = useState(null);
  const [acknowledgedReferenceNote, setAcknowledgedReferenceNote] = useState(false);
  const [scrollSnapshot, setScrollSnapshot] = useState({
    scrollTop: 0,
    scrollHeight: 1,
    clientHeight: 1,
  });
  const [activePageIndex, setActivePageIndex] = useState(0);

  const menuScrollRef = useRef(null);
  const pageRefs = useRef([]);
  const selectedDish = selectedOverlay;
  const selectedOverlaySignature = selectedDish ? overlaySignature(selectedDish) : "";

  useEffect(() => {
    try {
      setAcknowledgedReferenceNote(
        localStorage.getItem(REFERENCE_NOTE_ACK_KEY) === "1",
      );
    } catch {
      setAcknowledgedReferenceNote(false);
    }
  }, []);

  const dismissReferenceNote = useCallback(() => {
    setAcknowledgedReferenceNote(true);
    try {
      localStorage.setItem(REFERENCE_NOTE_ACK_KEY, "1");
    } catch {
      // Ignore local storage failures.
    }
  }, []);

  const lastConfirmedLabel = useMemo(
    () => parseLastConfirmed(restaurant?.last_confirmed),
    [restaurant?.last_confirmed],
  );

  const refreshScrollSnapshot = useCallback(() => {
    const scrollNode = menuScrollRef.current;
    if (!scrollNode) return;

    const next = {
      scrollTop: scrollNode.scrollTop,
      scrollHeight: Math.max(scrollNode.scrollHeight, 1),
      clientHeight: Math.max(scrollNode.clientHeight, 1),
    };

    setScrollSnapshot((current) => {
      if (
        current.scrollTop === next.scrollTop &&
        current.scrollHeight === next.scrollHeight &&
        current.clientHeight === next.clientHeight
      ) {
        return current;
      }
      return next;
    });

    const marker = next.scrollTop + next.clientHeight * 0.45;
    let resolvedPage = 0;
    pageRefs.current.forEach((node, index) => {
      if (!node) return;
      const pageTop = node.offsetTop;
      const pageBottom = pageTop + node.offsetHeight;
      if (marker >= pageTop && marker < pageBottom) {
        resolvedPage = index;
      }
    });
    setActivePageIndex(resolvedPage);
  }, []);

  useEffect(() => {
    const scrollNode = menuScrollRef.current;
    if (!scrollNode) return;

    let animationFrame = 0;
    const scheduleRefresh = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        refreshScrollSnapshot();
      });
    };

    scheduleRefresh();
    scrollNode.addEventListener("scroll", scheduleRefresh, { passive: true });
    window.addEventListener("resize", scheduleRefresh);

    let resizeObserver = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleRefresh);
      resizeObserver.observe(scrollNode);
      pageRefs.current.forEach((node) => {
        if (node) resizeObserver.observe(node);
      });
    }

    return () => {
      scrollNode.removeEventListener("scroll", scheduleRefresh);
      window.removeEventListener("resize", scheduleRefresh);
      if (resizeObserver) resizeObserver.disconnect();
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [refreshScrollSnapshot, viewer.menuPages.length]);

  const scrollToPage = useCallback(
    (pageIndex, behavior = "smooth") => {
      const targetIndex = clamp(
        Number(pageIndex) || 0,
        0,
        Math.max(viewer.pageCount - 1, 0),
      );
      const scrollNode = menuScrollRef.current;
      const pageNode = pageRefs.current[targetIndex];
      if (!scrollNode || !pageNode) return;
      scrollNode.scrollTo({
        top: pageNode.offsetTop,
        behavior,
      });
    },
    [viewer.pageCount],
  );

  const jumpFromMinimap = useCallback(
    (event) => {
      const scrollNode = menuScrollRef.current;
      if (!scrollNode) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const ratio = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
      const maxScroll = Math.max(
        scrollSnapshot.scrollHeight - scrollSnapshot.clientHeight,
        0,
      );
      const target = ratio * scrollSnapshot.scrollHeight - scrollSnapshot.clientHeight / 2;
      scrollNode.scrollTo({
        top: clamp(target, 0, maxScroll),
        behavior: "smooth",
      });
    },
    [scrollSnapshot.clientHeight, scrollSnapshot.scrollHeight],
  );

  const actionButtons = [
    {
      key: "website",
      label: "Restaurant website",
      href: restaurant?.website || "",
      disabled: !restaurant?.website,
      tone: "primary",
      external: true,
    },
    {
      key: "call",
      label: "Call restaurant",
      href: restaurant?.phone ? `tel:${restaurant.phone}` : "",
      disabled: !restaurant?.phone,
      tone: "primary",
      external: true,
    },
    {
      key: "feedback",
      label: "Send feedback",
      href: "/help-contact",
      disabled: false,
      tone: "primary",
      external: false,
    },
    {
      key: "report",
      label: "Report issue",
      href: "/report-issue",
      disabled: false,
      tone: "danger",
      external: false,
    },
  ];

  const maxScrollable = Math.max(
    scrollSnapshot.scrollHeight - scrollSnapshot.clientHeight,
    0,
  );
  const viewportTopRatio = maxScrollable
    ? scrollSnapshot.scrollTop / maxScrollable
    : 0;
  const viewportHeightRatio = clamp(
    scrollSnapshot.clientHeight / scrollSnapshot.scrollHeight,
    0.08,
    1,
  );

  const selectedDishAllergenRows = useMemo(
    () => buildAllergenRows(selectedDish, viewer.savedAllergens),
    [selectedDish, viewer.savedAllergens],
  );
  const selectedDishDietRows = useMemo(
    () => buildDietRows(selectedDish, viewer.savedDiets),
    [selectedDish, viewer.savedDiets],
  );

  const selectedDishPageIndex = selectedDish
    ? clamp(Number(selectedDish.pageIndex) || 0, 0, Math.max(viewer.pageCount - 1, 0))
    : 0;
  const selectedDishPageNode = pageRefs.current[selectedDishPageIndex];
  const selectedDishPopupStyle = useMemo(() => {
    if (!selectedDish || !selectedDishPageNode) {
      return {
        left: "14px",
        top: "14px",
      };
    }

    const pageHeight = Math.max(selectedDishPageNode.offsetHeight, 1);
    const pageWidth = Math.max(selectedDishPageNode.offsetWidth, 1);
    const popupWidth = 330;
    const popupHeight = 350;

    const overlayX = (parseOverlayNumber(selectedDish.x) / 100) * pageWidth;
    const overlayY = (parseOverlayNumber(selectedDish.y) / 100) * pageHeight;
    const overlayH = (parseOverlayNumber(selectedDish.h) / 100) * pageHeight;

    const rawTop =
      selectedDishPageNode.offsetTop +
      overlayY -
      scrollSnapshot.scrollTop -
      popupHeight -
      14;
    const rawLeft =
      (selectedDishPageNode.offsetLeft || 0) +
      overlayX -
      12;

    const stageWidth = menuScrollRef.current?.clientWidth || pageWidth;
    const stageHeight = menuScrollRef.current?.clientHeight || pageHeight;

    const fallbackBelow =
      selectedDishPageNode.offsetTop +
      overlayY +
      overlayH -
      scrollSnapshot.scrollTop +
      12;

    return {
      top: `${clamp(rawTop < 12 ? fallbackBelow : rawTop, 10, Math.max(stageHeight - 24, 10))}px`,
      left: `${clamp(rawLeft, 10, Math.max(stageWidth - popupWidth - 12, 10))}px`,
    };
  }, [
    scrollSnapshot.scrollTop,
    selectedDish,
    selectedDishPageNode,
  ]);

  return (
    <section className="restaurant-legacy-viewer">
      <div className="restaurant-legacy-header">
        <h1 className="restaurant-legacy-title">{restaurant?.name || "Restaurant"}</h1>

        <div className="restaurant-legacy-meta-row">
          <div className="restaurant-legacy-page-card">
            <button
              type="button"
              className="restaurant-legacy-page-thumb"
              onClick={jumpFromMinimap}
              title="Jump to area on menu page"
            >
              {viewer.menuPages[activePageIndex]?.image ? (
                <img
                  src={viewer.menuPages[activePageIndex].image}
                  alt={`Menu thumbnail page ${activePageIndex + 1}`}
                />
              ) : (
                <span>No page</span>
              )}
              <span
                className="restaurant-legacy-page-thumb-viewport"
                style={{
                  top: `${viewportTopRatio * 100}%`,
                  height: `${viewportHeightRatio * 100}%`,
                }}
              />
            </button>
            <div className="restaurant-legacy-page-footer">
              Page {activePageIndex + 1} of {viewer.pageCount}
            </div>
            {viewer.pageCount > 1 ? (
              <div className="restaurant-legacy-page-controls">
                <button
                  type="button"
                  onClick={() =>
                    scrollToPage(clamp(activePageIndex - 1, 0, viewer.pageCount - 1))
                  }
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() =>
                    scrollToPage(clamp(activePageIndex + 1, 0, viewer.pageCount - 1))
                  }
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>

          <div className="restaurant-legacy-preference-wrap">
            <div className="preference-row">
              <div className="preference-panel pill">
                <div className="preference-header">
                  <div className="preference-title">Saved allergens</div>
                  <Link href="/account" className="btnLink preference-edit">
                    Edit
                  </Link>
                </div>
                <div className="preference-chips chips">
                  {viewer.savedAllergens.length ? (
                    viewer.savedAllergens.map((item) => (
                      <span key={item.key} className="chip active preference-chip">
                        {item.emoji || "⚠"} {item.label}
                      </span>
                    ))
                  ) : (
                    <span className="note">No saved allergens</span>
                  )}
                </div>
              </div>

              <div className="preference-panel pill">
                <div className="preference-header">
                  <div className="preference-title">Saved diets</div>
                  <Link href="/account" className="btnLink preference-edit">
                    Edit
                  </Link>
                </div>
                <div className="preference-chips chips">
                  {viewer.savedDiets.length ? (
                    viewer.savedDiets.map((item) => (
                      <span key={item.key} className="chip active preference-chip">
                        {item.emoji || "✓"} {item.label}
                      </span>
                    ))
                  ) : (
                    <span className="note">No saved diets</span>
                  )}
                </div>
              </div>
            </div>

            {!acknowledgedReferenceNote ? (
              <div className="restaurant-legacy-reference-note">
                <span>Reference only. Always inform staff about your allergens.</span>
                <button type="button" onClick={dismissReferenceNote}>
                  I understand
                </button>
              </div>
            ) : null}

            <div className="restaurant-legacy-actions-row">
              {actionButtons.map((action) =>
                action.disabled ? (
                  <button
                    key={action.key}
                    type="button"
                    className={`restaurant-legacy-action-btn ${action.tone === "danger" ? "danger" : ""}`}
                    disabled
                  >
                    {action.label}
                  </button>
                ) : action.external ? (
                  <a
                    key={action.key}
                    href={action.href}
                    className={`restaurant-legacy-action-btn ${action.tone === "danger" ? "danger" : ""}`}
                    target={action.href.startsWith("http") ? "_blank" : undefined}
                    rel={action.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  >
                    {action.label}
                  </a>
                ) : (
                  <Link
                    key={action.key}
                    href={action.href}
                    className={`restaurant-legacy-action-btn ${action.tone === "danger" ? "danger" : ""}`}
                  >
                    {action.label}
                  </Link>
                ),
              )}
            </div>

            <p className="restaurant-legacy-confirmed-text">
              Last confirmed by restaurant staff: {lastConfirmedLabel}
            </p>
          </div>
        </div>

        <div className="restaurant-legacy-legend">
          <p>
            <span className="legend-box safe" /> Complies ·{" "}
            <span className="legend-box removable" /> Can be modified to comply ·{" "}
            <span className="legend-box unsafe" /> Cannot be modified to comply
          </p>
          <p>⚠ Cross-contamination risk · Tap dishes for details · Pinch menu to zoom in/out</p>
        </div>
      </div>

      <div className="restaurant-legacy-menu-stage">
        <div ref={menuScrollRef} className="restaurant-legacy-menu-scroll">
          {viewer.menuPages.map((page) => (
            <div
              key={`page-${page.pageIndex}`}
              className="restaurant-legacy-menu-page"
              ref={(node) => {
                pageRefs.current[page.pageIndex] = node;
              }}
            >
              {page.image ? (
                <img
                  src={page.image}
                  alt={`${restaurant?.name || "Restaurant"} menu page ${page.pageIndex + 1}`}
                  className="restaurant-legacy-menu-image"
                />
              ) : (
                <div className="restaurant-legacy-no-image">No menu image available.</div>
              )}

              {page.overlays.map((overlay, index) => (
                <button
                  key={overlayKey(overlay, index)}
                  type="button"
                  onClick={() => {
                    viewer.selectDish(overlay.id);
                    setSelectedOverlay(overlay);
                    scrollToPage(overlay.pageIndex, "smooth");
                  }}
                  className={`restaurant-legacy-overlay ${
                    selectedOverlaySignature &&
                    overlaySignature(overlay) === selectedOverlaySignature
                      ? "is-selected"
                      : ""
                  }`}
                  style={{
                    left: `${parseOverlayNumber(overlay.x)}%`,
                    top: `${parseOverlayNumber(overlay.y)}%`,
                    width: `${parseOverlayNumber(overlay.w)}%`,
                    height: `${parseOverlayNumber(overlay.h)}%`,
                    borderColor: statusBorderColor(overlay.compatibilityStatus),
                  }}
                >
                  <span className="restaurant-legacy-overlay-warning">
                    {overlay.hasCrossContamination ? "⚠" : ""}
                  </span>
                  <span className="restaurant-legacy-overlay-info">i</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        {selectedDish ? (
          <aside className="restaurant-legacy-dish-popover" style={selectedDishPopupStyle}>
            <header className="restaurant-legacy-dish-popover-header">
              <h2>{selectedDish.name || "Dish details"}</h2>
              <div className="restaurant-legacy-dish-popover-actions">
                <button
                  type="button"
                  aria-label="Toggle favorite dish"
                  onClick={() => viewer.toggleFavoriteDish(selectedDish)}
                  disabled={favoriteBusyDish === selectedDish.id}
                >
                  {lovedDishes.has(selectedDish.id) ? "♥" : "♡"}
                </button>
                <button
                  type="button"
                  aria-label="Close dish details"
                  onClick={() => setSelectedOverlay(null)}
                >
                  ×
                </button>
              </div>
            </header>

            <section className="restaurant-legacy-dish-popover-section">
              <h3>Allergens:</h3>
              {selectedDishAllergenRows.length ? (
                selectedDishAllergenRows.map((row) => (
                  <div key={row.key} className={`dish-row ${row.tone}`}>
                    <div className="dish-row-title">{row.title}</div>
                    {row.detail ? <div className="dish-row-detail">{row.detail}</div> : null}
                  </div>
                ))
              ) : (
                <p className="dish-row-empty">No allergen data listed.</p>
              )}
            </section>

            <section className="restaurant-legacy-dish-popover-section">
              <h3>Diets:</h3>
              {selectedDishDietRows.length ? (
                selectedDishDietRows.map((row) => (
                  <div key={row.key} className={`dish-row ${row.tone}`}>
                    <div className="dish-row-title">{row.title}</div>
                    {row.detail ? <div className="dish-row-detail">{row.detail}</div> : null}
                  </div>
                ))
              ) : (
                <p className="dish-row-empty">No diet data listed.</p>
              )}
            </section>

            {selectedDish.hasCrossContamination ? (
              <p className="restaurant-legacy-dish-cross-warning">
                ⚠ Cross-contamination risk is flagged for this dish.
              </p>
            ) : null}

            <Button
              size="compact"
              tone="primary"
              className="restaurant-legacy-dish-order-btn"
              onClick={() => {
                viewer.addDishToOrder(selectedDish);
                orderFlow.addDish(selectedDish);
              }}
            >
              Add to order
            </Button>
          </aside>
        ) : null}
      </div>

      <footer className="restaurant-legacy-help-fab">
        <Link href="/help-contact">Help</Link>
      </footer>
    </section>
  );
}

export default RestaurantViewer;
