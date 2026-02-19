"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "../../../components/ui";
import {
  buildAllergenRows as buildDishAllergenRows,
  buildAllergenCrossRows as buildDishAllergenCrossRows,
  buildDietRows as buildDishDietRows,
  buildDietCrossRows as buildDishDietCrossRows,
  mergeSectionRows as mergeDishSectionRows,
} from "../shared/dishDetailRows";
import {
  buildMinimapViewport,
  computeMinimapJumpTarget,
} from "../shared/minimapGeometry";
import { useMinimapSync } from "../shared/useMinimapSync";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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

function statusPulseColor(status) {
  if (status === "safe") return "rgba(34, 197, 94, 0.55)";
  if (status === "removable") return "rgba(250, 204, 21, 0.55)";
  if (status === "unsafe") return "rgba(239, 68, 68, 0.58)";
  return "rgba(255, 255, 255, 0.46)";
}

function computeOverlapArea(a, b) {
  const xOverlap = Math.max(
    0,
    Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left),
  );
  const yOverlap = Math.max(
    0,
    Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top),
  );
  return xOverlap * yOverlap;
}

function pickBestPopupPosition({
  overlayRect,
  stageWidth,
  stageHeight,
  popupWidth,
  popupHeight,
}) {
  const clampLeft = (left) => clamp(left, 10, Math.max(stageWidth - popupWidth - 10, 10));
  const clampTop = (top) => clamp(top, 10, Math.max(stageHeight - popupHeight - 10, 10));
  const overlayBottom = overlayRect.top + overlayRect.height;
  const overlayCenterX = overlayRect.left + overlayRect.width / 2;

  const candidates = [
    { left: overlayRect.left + overlayRect.width + 16, top: overlayRect.top },
    { left: overlayRect.left - popupWidth - 16, top: overlayRect.top },
    { left: overlayCenterX - popupWidth / 2, top: overlayRect.top - popupHeight - 14 },
    { left: overlayCenterX - popupWidth / 2, top: overlayBottom + 14 },
    { left: overlayCenterX - popupWidth / 2, top: overlayRect.top },
  ].map((candidate) => ({
    left: clampLeft(candidate.left),
    top: clampTop(candidate.top),
  }));

  let best = candidates[0];
  let leastOverlap = Number.POSITIVE_INFINITY;

  candidates.forEach((candidate) => {
    const popupRect = {
      left: candidate.left,
      top: candidate.top,
      width: popupWidth,
      height: popupHeight,
    };
    const overlap = computeOverlapArea(popupRect, overlayRect);
    if (overlap < leastOverlap) {
      leastOverlap = overlap;
      best = candidate;
    }
  });

  return best;
}

function parseOverlayNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return clamp(numeric, 0, 100);
}

function toggleSelection(values, target) {
  const targetValue = String(target || "").trim();
  if (!targetValue) return Array.isArray(values) ? values : [];
  const list = Array.isArray(values) ? values : [];
  return list.includes(targetValue)
    ? list.filter((entry) => entry !== targetValue)
    : [...list, targetValue];
}

export function RestaurantViewer({
  restaurant,
  viewer,
  lovedDishes,
  favoriteBusyDish,
  preferenceTitlePrefix = "Saved",
  showPreferenceEdit = true,
  allowGuestPreferenceEditing = false,
  guestPreferenceOptions = { allergens: [], diets: [] },
  onSaveGuestPreferences,
  showGuestSignupPrompt = false,
  guestSignupHref = "/account?mode=signup",
}) {
  const [selectedOverlay, setSelectedOverlay] = useState(null);
  const [acknowledgedReferenceNote, setAcknowledgedReferenceNote] = useState(false);
  const [showGuestSignupBanner, setShowGuestSignupBanner] = useState(false);
  const [isEditingGuestAllergens, setIsEditingGuestAllergens] = useState(false);
  const [isEditingGuestDiets, setIsEditingGuestDiets] = useState(false);
  const [draftGuestAllergenKeys, setDraftGuestAllergenKeys] = useState([]);
  const [draftGuestDietKeys, setDraftGuestDietKeys] = useState([]);

  const menuScrollRef = useRef(null);
  const pageRefs = useRef([]);
  const pageImageRefs = useRef([]);
  const selectedDish = selectedOverlay;
  const selectedOverlaySignature = selectedDish ? overlaySignature(selectedDish) : "";
  const preferencePrefix = String(preferenceTitlePrefix || "Saved").trim() || "Saved";
  const preferencePrefixLower = preferencePrefix.toLowerCase();

  const dismissReferenceNote = useCallback(() => {
    setAcknowledgedReferenceNote(true);
  }, []);

  useEffect(() => {
    if (!showGuestSignupPrompt || !acknowledgedReferenceNote) {
      setShowGuestSignupBanner(false);
      return undefined;
    }

    setShowGuestSignupBanner(false);
    const timer = window.setTimeout(() => {
      setShowGuestSignupBanner(true);
    }, 10000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [acknowledgedReferenceNote, showGuestSignupPrompt]);

  const lastConfirmedLabel = useMemo(
    () => parseLastConfirmed(restaurant?.last_confirmed),
    [restaurant?.last_confirmed],
  );

  const {
    activePageIndex,
    scrollSnapshot,
  } = useMinimapSync({
    enabled: acknowledgedReferenceNote,
    menuScrollRef,
    pageRefs,
    pageImageRefs,
    pageCount: viewer.pageCount,
    pageVersionKey: viewer.menuPages.length,
  });

  const centerOverlayInView = useCallback(
    (overlay, behavior = "smooth") => {
      if (!overlay) return;
      const scrollNode = menuScrollRef.current;
      if (!scrollNode) return;

      const pageIndex = clamp(
        Number(overlay.pageIndex) || 0,
        0,
        Math.max(viewer.pageCount - 1, 0),
      );
      const pageNode = pageImageRefs.current[pageIndex] || pageRefs.current[pageIndex];
      if (!pageNode) return;

      const pageHeight = Math.max(pageNode.offsetHeight, 1);
      const overlayTop =
        pageNode.offsetTop +
        (parseOverlayNumber(overlay.y) / 100) * pageHeight;
      const overlayHeight =
        (parseOverlayNumber(overlay.h) / 100) * pageHeight;
      const overlayCenter = overlayTop + overlayHeight / 2;
      const targetTop = overlayCenter - scrollNode.clientHeight / 2;
      const maxScroll = Math.max(
        scrollNode.scrollHeight - scrollNode.clientHeight,
        0,
      );

      scrollNode.scrollTo({
        top: clamp(targetTop, 0, maxScroll),
        behavior,
      });
    },
    [viewer.pageCount],
  );

  const jumpFromMinimap = useCallback(
    (event) => {
      const scrollNode = menuScrollRef.current;
      const pageNode = pageRefs.current[activePageIndex] || pageImageRefs.current[activePageIndex];
      if (!scrollNode || !pageNode) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (!bounds.height) return;
      const ratio = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
      const target = computeMinimapJumpTarget(scrollNode, pageNode, ratio);
      scrollNode.scrollTo({
        top: target,
        behavior: "smooth",
      });
    },
    [activePageIndex],
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

  const minimapViewport = useMemo(() => {
    const scrollNode = menuScrollRef.current;
    const pageNode = pageRefs.current[activePageIndex] || pageImageRefs.current[activePageIndex];
    return buildMinimapViewport(scrollNode, pageNode);
  }, [
    acknowledgedReferenceNote,
    activePageIndex,
    scrollSnapshot.clientHeight,
    scrollSnapshot.scrollHeight,
    scrollSnapshot.scrollTop,
    viewer.menuPages.length,
  ]);

  const selectedDishAllergenRows = useMemo(
    () =>
      mergeDishSectionRows(
        buildDishAllergenRows(selectedDish, viewer.savedAllergens),
        buildDishAllergenCrossRows(selectedDish, viewer.savedAllergens),
      ),
    [selectedDish, viewer.savedAllergens],
  );
  const selectedDishDietRows = useMemo(
    () =>
      mergeDishSectionRows(
        buildDishDietRows(selectedDish, viewer.savedDiets),
        buildDishDietCrossRows(selectedDish, viewer.savedDiets),
      ),
    [selectedDish, viewer.savedDiets],
  );

  const selectedDishPageIndex = selectedDish
    ? clamp(Number(selectedDish.pageIndex) || 0, 0, Math.max(viewer.pageCount - 1, 0))
    : 0;
  const selectedDishPageNode =
    pageImageRefs.current[selectedDishPageIndex] ||
    pageRefs.current[selectedDishPageIndex];
  const selectedDishPopupStyle = useMemo(() => {
    const scrollNode = menuScrollRef.current;
    if (!selectedDish || !selectedDishPageNode || !scrollNode) {
      return {
        left: "14px",
        top: "14px",
      };
    }

    const stageRect = scrollNode.getBoundingClientRect();
    const pageRect = selectedDishPageNode.getBoundingClientRect();
    const pageHeight = Math.max(pageRect.height, 1);
    const pageWidth = Math.max(pageRect.width, 1);
    const popupWidth = 340;
    const popupHeight = 420;

    const overlayX = (parseOverlayNumber(selectedDish.x) / 100) * pageWidth;
    const overlayY = (parseOverlayNumber(selectedDish.y) / 100) * pageHeight;
    const overlayW = (parseOverlayNumber(selectedDish.w) / 100) * pageWidth;
    const overlayH = (parseOverlayNumber(selectedDish.h) / 100) * pageHeight;

    const overlayViewportTop = pageRect.top - stageRect.top + overlayY;
    const overlayViewportLeft = pageRect.left - stageRect.left + overlayX;

    const stageWidth = scrollNode.clientWidth || pageWidth;
    const stageHeight = scrollNode.clientHeight || pageHeight;
    if (stageWidth <= 720) {
      return {
        top: "10px",
        left: "10px",
      };
    }
    const overlayRect = {
      left: overlayViewportLeft,
      top: overlayViewportTop,
      width: overlayW,
      height: overlayH,
    };
    const position = pickBestPopupPosition({
      overlayRect,
      stageWidth,
      stageHeight,
      popupWidth,
      popupHeight,
    });

    const safeTop = position.top;
    const safeLeft = position.left;
    return {
      top: `${safeTop}px`,
      left: `${safeLeft}px`,
    };
  }, [
    scrollSnapshot.scrollTop,
    scrollSnapshot.clientHeight,
    selectedDish,
    selectedDishPageNode,
  ]);

  const savedAllergenKeys = useMemo(
    () => (Array.isArray(viewer.savedAllergens) ? viewer.savedAllergens.map((item) => item.key) : []),
    [viewer.savedAllergens],
  );
  const savedDietKeys = useMemo(
    () => (Array.isArray(viewer.savedDiets) ? viewer.savedDiets.map((item) => item.key) : []),
    [viewer.savedDiets],
  );
  const guestAllergenOptions = useMemo(
    () => (Array.isArray(guestPreferenceOptions?.allergens) ? guestPreferenceOptions.allergens : []),
    [guestPreferenceOptions?.allergens],
  );
  const guestDietOptions = useMemo(
    () => (Array.isArray(guestPreferenceOptions?.diets) ? guestPreferenceOptions.diets : []),
    [guestPreferenceOptions?.diets],
  );

  useEffect(() => {
    if (!allowGuestPreferenceEditing) {
      setIsEditingGuestAllergens(false);
      setIsEditingGuestDiets(false);
      setDraftGuestAllergenKeys([]);
      setDraftGuestDietKeys([]);
      return;
    }

    if (!isEditingGuestAllergens) {
      setDraftGuestAllergenKeys(savedAllergenKeys);
    }
  }, [allowGuestPreferenceEditing, isEditingGuestAllergens, savedAllergenKeys]);

  useEffect(() => {
    if (!allowGuestPreferenceEditing) return;
    if (!isEditingGuestDiets) {
      setDraftGuestDietKeys(savedDietKeys);
    }
  }, [allowGuestPreferenceEditing, isEditingGuestDiets, savedDietKeys]);

  const persistGuestSelections = useCallback(
    ({ allergens, diets }) => {
      if (typeof onSaveGuestPreferences !== "function") return;
      onSaveGuestPreferences({
        allergies: allergens,
        diets,
      });
    },
    [onSaveGuestPreferences],
  );

  const onGuestAllergenEditToggle = useCallback(() => {
    if (!allowGuestPreferenceEditing) return;
    if (!isEditingGuestAllergens) {
      setDraftGuestAllergenKeys(savedAllergenKeys);
      setIsEditingGuestAllergens(true);
      return;
    }

    persistGuestSelections({
      allergens: draftGuestAllergenKeys,
      diets: isEditingGuestDiets ? draftGuestDietKeys : savedDietKeys,
    });
    setIsEditingGuestAllergens(false);
  }, [
    allowGuestPreferenceEditing,
    draftGuestAllergenKeys,
    draftGuestDietKeys,
    isEditingGuestAllergens,
    isEditingGuestDiets,
    persistGuestSelections,
    savedAllergenKeys,
    savedDietKeys,
  ]);

  const onGuestDietEditToggle = useCallback(() => {
    if (!allowGuestPreferenceEditing) return;
    if (!isEditingGuestDiets) {
      setDraftGuestDietKeys(savedDietKeys);
      setIsEditingGuestDiets(true);
      return;
    }

    persistGuestSelections({
      allergens: isEditingGuestAllergens ? draftGuestAllergenKeys : savedAllergenKeys,
      diets: draftGuestDietKeys,
    });
    setIsEditingGuestDiets(false);
  }, [
    allowGuestPreferenceEditing,
    draftGuestAllergenKeys,
    draftGuestDietKeys,
    isEditingGuestAllergens,
    isEditingGuestDiets,
    persistGuestSelections,
    savedAllergenKeys,
    savedDietKeys,
  ]);

  const showingGuestAllergenEditor = allowGuestPreferenceEditing && isEditingGuestAllergens;
  const showingGuestDietEditor = allowGuestPreferenceEditing && isEditingGuestDiets;
  const visibleAllergenChips = showingGuestAllergenEditor
    ? guestAllergenOptions
    : viewer.savedAllergens;
  const visibleDietChips = showingGuestDietEditor ? guestDietOptions : viewer.savedDiets;

  return (
    <section className="restaurant-viewer">
      <div className="restaurant-header">
        <h1 className="restaurant-title">{restaurant?.name || "Restaurant"}</h1>

        <div className="restaurant-meta-row">
          <div className="restaurant-page-card">
            <button
              type="button"
              className="restaurant-page-thumb"
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
                className="restaurant-page-thumb-viewport"
                style={{
                  top: `${minimapViewport.topRatio * 100}%`,
                  height: `${minimapViewport.heightRatio * 100}%`,
                }}
              />
            </button>
            <div className="restaurant-page-footer">
              Page {activePageIndex + 1} of {viewer.pageCount}
            </div>
          </div>

          <div className="restaurant-preference-wrap">
            <div className="preference-row">
              <div className="preference-panel pill">
                <div className="preference-header">
                  <div className="preference-title">{preferencePrefix} allergens</div>
                  {allowGuestPreferenceEditing ? (
                    <button
                      type="button"
                      className="btnLink preference-edit"
                      onClick={onGuestAllergenEditToggle}
                    >
                      {showingGuestAllergenEditor ? "Save" : "Edit"}
                    </button>
                  ) : showPreferenceEdit ? (
                    <Link href="/account" className="btnLink preference-edit">
                      Edit
                    </Link>
                  ) : null}
                </div>
                <div
                  className={`preference-chips chips ${
                    showingGuestAllergenEditor ? "is-editing" : ""
                  }`}
                >
                  {visibleAllergenChips.length ? (
                    visibleAllergenChips.map((item) =>
                      showingGuestAllergenEditor ? (
                        <button
                          key={item.key}
                          type="button"
                          className={`chip preference-chip ${
                            draftGuestAllergenKeys.includes(item.key) ? "active" : ""
                          }`}
                          onClick={() =>
                            setDraftGuestAllergenKeys((current) =>
                              toggleSelection(current, item.key),
                            )
                          }
                        >
                          {item.emoji || "⚠"} {item.label}
                        </button>
                      ) : (
                        <span key={item.key} className="chip active preference-chip">
                          {item.emoji || "⚠"} {item.label}
                        </span>
                      ),
                    )
                  ) : (
                    <span className="note">{`No ${preferencePrefixLower} allergens`}</span>
                  )}
                </div>
              </div>

              <div className="preference-panel pill">
                <div className="preference-header">
                  <div className="preference-title">{preferencePrefix} diets</div>
                  {allowGuestPreferenceEditing ? (
                    <button
                      type="button"
                      className="btnLink preference-edit"
                      onClick={onGuestDietEditToggle}
                    >
                      {showingGuestDietEditor ? "Save" : "Edit"}
                    </button>
                  ) : showPreferenceEdit ? (
                    <Link href="/account" className="btnLink preference-edit">
                      Edit
                    </Link>
                  ) : null}
                </div>
                <div
                  className={`preference-chips chips ${
                    showingGuestDietEditor ? "is-editing" : ""
                  }`}
                >
                  {visibleDietChips.length ? (
                    visibleDietChips.map((item) =>
                      showingGuestDietEditor ? (
                        <button
                          key={item.key}
                          type="button"
                          className={`chip preference-chip ${
                            draftGuestDietKeys.includes(item.key) ? "active" : ""
                          }`}
                          onClick={() =>
                            setDraftGuestDietKeys((current) =>
                              toggleSelection(current, item.key),
                            )
                          }
                        >
                          {item.emoji || "✓"} {item.label}
                        </button>
                      ) : (
                        <span key={item.key} className="chip active preference-chip">
                          {item.emoji || "✓"} {item.label}
                        </span>
                      ),
                    )
                  ) : (
                    <span className="note">{`No ${preferencePrefixLower} diets`}</span>
                  )}
                </div>
              </div>
            </div>

            <div className="restaurant-actions-row">
              {actionButtons.map((action) =>
                action.disabled ? (
                  <button
                    key={action.key}
                    type="button"
                    className={`restaurant-action-btn ${action.tone === "danger" ? "danger" : ""}`}
                    disabled
                  >
                    {action.label}
                  </button>
                ) : action.external ? (
                  <a
                    key={action.key}
                    href={action.href}
                    className={`restaurant-action-btn ${action.tone === "danger" ? "danger" : ""}`}
                    target={action.href.startsWith("http") ? "_blank" : undefined}
                    rel={action.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  >
                    {action.label}
                  </a>
                ) : (
                  <Link
                    key={action.key}
                    href={action.href}
                    className={`restaurant-action-btn ${action.tone === "danger" ? "danger" : ""}`}
                  >
                    {action.label}
                  </Link>
                ),
              )}
            </div>

            <p className="restaurant-confirmed-text">
              Last confirmed by restaurant staff: {lastConfirmedLabel}
            </p>
          </div>
        </div>

        <div className="restaurant-legend">
          <p>
            <span className="legend-box safe" /> Complies ·{" "}
            <span className="legend-box removable" /> Can be modified to comply ·{" "}
            <span className="legend-box unsafe" /> Cannot be modified to comply
          </p>
          <p>⚠ Cross-contamination risk · Tap dishes for details · Pinch menu to zoom in/out</p>
        </div>

        {!acknowledgedReferenceNote ? (
          <div className="restaurant-reference-banner">
            <span>Reference only. Always inform staff about your allergens.</span>
            <button type="button" onClick={dismissReferenceNote}>
              I understand
            </button>
          </div>
        ) : null}
      </div>

      <div
        className={`restaurant-menu-stage ${
          acknowledgedReferenceNote ? "" : "is-locked"
        }`}
      >
        <div
          ref={menuScrollRef}
          className={`restaurant-menu-scroll ${
            acknowledgedReferenceNote ? "" : "is-blurred"
          }`}
        >
          {viewer.menuPages.map((page) => (
            <div
              key={`page-${page.pageIndex}`}
              className="restaurant-menu-page"
              ref={(node) => {
                pageRefs.current[page.pageIndex] = node;
              }}
            >
              {page.image ? (
                <img
                  src={page.image}
                  alt={`${restaurant?.name || "Restaurant"} menu page ${page.pageIndex + 1}`}
                  className="restaurant-menu-image"
                  ref={(node) => {
                    pageImageRefs.current[page.pageIndex] = node;
                  }}
                />
              ) : (
                <div className="restaurant-no-image">No menu image available.</div>
              )}

              {page.overlays.map((overlay, index) => (
                <button
                  key={overlayKey(overlay, index)}
                  type="button"
                  title={overlay.name || overlay.id || "Dish"}
                  aria-label={overlay.name || overlay.id || "Dish"}
                  onClick={() => {
                    if (!acknowledgedReferenceNote) return;
                    viewer.selectDish(overlay.id);
                    setSelectedOverlay(overlay);
                    centerOverlayInView(overlay, "smooth");
                    window.requestAnimationFrame(() => {
                      centerOverlayInView(overlay, "auto");
                    });
                  }}
                  className={`restaurant-overlay ${
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
                    "--overlay-pulse-color": statusPulseColor(overlay.compatibilityStatus),
                  }}
                >
                  <span className="restaurant-overlay-warning">
                    {overlay.hasCrossContamination ? "⚠" : ""}
                  </span>
                  <span className="restaurant-overlay-info">i</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        {acknowledgedReferenceNote && selectedDish ? (
          <aside className="restaurant-dish-popover" style={selectedDishPopupStyle}>
            <header className="restaurant-dish-popover-header">
              <h2>{selectedDish.name || "Dish details"}</h2>
              <div className="restaurant-dish-popover-actions">
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

            <div className="restaurant-dish-popover-body">
              <section className="restaurant-dish-popover-section">
                <h3>Allergens:</h3>
                {selectedDishAllergenRows.length ? (
                  selectedDishAllergenRows.map((row) => (
                    <div key={row.key} className={`dish-row ${row.tone}`}>
                      <div className="dish-row-title">{row.title}</div>
                      {row.reasonBullet ? (
                        <ul className="dish-row-reasons">
                          <li>{row.reasonBullet}</li>
                        </ul>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="dish-row-empty">{`No ${preferencePrefixLower} allergens.`}</p>
                )}
              </section>

              <section className="restaurant-dish-popover-section">
                <h3>Diets:</h3>
                {selectedDishDietRows.length ? (
                  selectedDishDietRows.map((row) => (
                    <div key={row.key} className={`dish-row ${row.tone}`}>
                      <div className="dish-row-title">{row.title}</div>
                      {row.reasonBullet ? (
                        <ul className="dish-row-reasons">
                          <li>{row.reasonBullet}</li>
                        </ul>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="dish-row-empty">{`No ${preferencePrefixLower} diets.`}</p>
                )}
              </section>
            </div>

            <Button
              size="compact"
              tone="primary"
              className="restaurant-dish-order-btn"
              onClick={() => {
                viewer.addDishToOrder(selectedDish);
              }}
            >
              Add to order
            </Button>
          </aside>
        ) : null}

      </div>

      {showGuestSignupBanner ? (
        <div className="restaurant-guest-signup-banner">
          <span>Create a free account to save your preferences and favorites.</span>
          <Link href={guestSignupHref}>Create a free account</Link>
        </div>
      ) : null}

      <footer className="restaurant-help-fab">
        <Link href="/help-contact">Help</Link>
      </footer>
    </section>
  );
}

export default RestaurantViewer;
