"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./SimpleTopbar.module.css";
import { CLARIVORE_LOGO_SRC } from "./clarivoreBrand";

function normalizeItems({ links = [], navItems = [] }) {
  if (Array.isArray(navItems) && navItems.length) {
    return navItems;
  }
  return (Array.isArray(links) ? links : []).map((item, index) => ({
    type: "link",
    id: item?.id || item?.key || `${item?.href || "link"}-${index}`,
    href: item?.href || "/",
    label: item?.label || "",
    visible: item?.visible !== false,
    current: Boolean(item?.current),
  }));
}

function isVisible(item) {
  return Boolean(item && item.label && item.visible !== false);
}

function itemKey(item, fallback) {
  return String(item?.id || item?.key || fallback);
}

function computeMobilePillFlex(item) {
  const text = String(item?.label || "").trim();
  if (!text) return 1;

  const length = text.length;
  let flex = 1 + Math.min(length, 20) / 10;

  if (item?.type === "group") {
    // Group pills include a caret and need a bit more room on mobile.
    flex += 0.35;
  }

  if (length <= 4) {
    flex -= 0.15;
  }

  return Math.min(Math.max(flex, 1), 2.7);
}

function isAccountNavItem(item) {
  if (!item || item.visible === false) return false;
  const id = String(item.id || item.key || "").toLowerCase();
  const href = String(item.href || "").toLowerCase();
  const label = String(item.label || "").toLowerCase();
  if (id === "account") return true;
  if (href.startsWith("/account")) return true;
  if (label.includes("account")) return true;
  if (item.type === "group" && Array.isArray(item.items)) {
    return item.items.some((child) => isAccountNavItem(child));
  }
  return false;
}

function NavLinkItem({ item, onNavigate, className, style }) {
  const href = String(item?.href || "").trim();
  if (!href) return null;

  if (typeof onNavigate === "function") {
    return (
      <button
        type="button"
        className={className}
        style={style}
        onClick={(event) => {
          event.preventDefault();
          onNavigate(href, item);
        }}
      >
        {item.label}
      </button>
    );
  }

  return (
    <Link href={href} className={className} style={style}>
      {item.label}
    </Link>
  );
}

export function ManagerModeSwitch({
  mode = "editor",
  onChange,
  customerLabel = "Customer",
  editorLabel = "Editor",
}) {
  return (
    <div className={styles.managerModeSwitch}>
      <button
        type="button"
        className={`${styles.managerModeLink} ${mode === "customer" ? styles.activeMode : ""}`}
        onClick={() => onChange?.("customer")}
      >
        {customerLabel}
      </button>
      <button
        type="button"
        className={`${styles.managerModeLink} ${mode === "editor" ? styles.activeMode : ""}`}
        onClick={() => onChange?.("editor")}
      >
        {editorLabel}
      </button>
    </div>
  );
}

export default function SimpleTopbar({
  brandHref = "/home",
  links = [],
  navItems = [],
  showBrand = true,
  showNav = true,
  showAuthAction = false,
  signedIn = false,
  onSignOut,
  signInHref = "/account?mode=signin",
  signInLabel = "Sign in",
  signOutLabel = "Sign out",
  modeToggle = null,
  onNavigate,
  rightContent = null,
  headerId,
  innerId,
  headerClassName = "",
  innerClassName = "",
}) {
  const [openGroupId, setOpenGroupId] = useState("");
  const containerRef = useRef(null);
  const items = useMemo(() => normalizeItems({ links, navItems }), [links, navItems]);

  useEffect(() => {
    const onDocumentPointerDown = (event) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target)) return;
      setOpenGroupId("");
    };
    document.addEventListener("pointerdown", onDocumentPointerDown);
    return () => document.removeEventListener("pointerdown", onDocumentPointerDown);
  }, []);

  const authAction = showAuthAction
    ? signedIn
      ? {
          type: "action",
          id: "sign-out",
          label: signOutLabel,
          onClick: onSignOut,
        }
      : {
          type: "link",
          id: "sign-in",
          label: signInLabel,
          href: signInHref,
        }
    : null;

  const visibleItems = items.filter(isVisible);
  const isEditorNavigation = visibleItems.some((item) => {
    const itemId = String(item?.id || item?.key || "").toLowerCase();
    return itemId === "dashboard" || itemId === "webpage-editor" || itemId === "tablet-pages";
  });
  const hasAccountNavItem = visibleItems.some((item) => isAccountNavItem(item));
  const shouldShowAuthAction = Boolean(
    authAction && !(authAction.type === "action" && hasAccountNavItem),
  );

  return (
    <div
      ref={containerRef}
      className={`${styles.topbar} ${headerClassName}`.trim()}
      role="banner"
      id={headerId}
    >
      <div className={`${styles.inner} ${innerClassName}`.trim()} id={innerId}>
        {modeToggle ? (
          <div className={styles.modeToggleContainer}>
            <button
              type="button"
              className={`${styles.modeToggle} ${modeToggle.active ? styles.modeToggleActive : ""}`}
              aria-label={modeToggle.ariaLabel || "Toggle mode"}
              onClick={modeToggle.onToggle}
            />
            <span className={styles.modeToggleLabel}>{modeToggle.label}</span>
          </div>
        ) : null}

        {showBrand ? (
          <Link className={styles.brand} href={brandHref}>
            <img src={CLARIVORE_LOGO_SRC} alt="Clarivore logo" />
            <span>Clarivore</span>
          </Link>
        ) : null}

        {showNav ? (
          <nav className={`${styles.nav} ${isEditorNavigation ? styles.editorNav : ""}`.trim()}>
            {visibleItems.map((item, index) => {
              const key = itemKey(item, `item-${index}`);
              const pillStyle = {
                "--pill-flex-grow": computeMobilePillFlex(item),
              };
              if (item.type === "group") {
                const groupItems = Array.isArray(item.items) ? item.items.filter(isVisible) : [];
                if (!groupItems.length) return null;
                const isOpen = openGroupId === key;
                const isCurrent =
                  Boolean(item.current) || groupItems.some((subItem) => Boolean(subItem.current));

                return (
                  <div key={key} className={styles.navGroup} style={pillStyle}>
                    <button
                      type="button"
                      className={`${styles.pill} ${styles.groupTrigger} ${isCurrent ? styles.currentPage : ""}`}
                      onClick={() =>
                        setOpenGroupId((current) => (current === key ? "" : key))
                      }
                    >
                      <span>{item.label}</span>
                      <span className={styles.caret} aria-hidden="true" />
                    </button>
                    <div
                      className={`${styles.dropdown} ${isOpen ? styles.dropdownOpen : ""}`.trim()}
                    >
                      {groupItems.map((subItem, subIndex) => (
                        <NavLinkItem
                          key={itemKey(subItem, `${key}-sub-${subIndex}`)}
                          item={subItem}
                          onNavigate={
                            typeof onNavigate === "function"
                              ? (href, value) => {
                                  setOpenGroupId("");
                                  onNavigate(href, value);
                                }
                              : undefined
                          }
                          className={`${styles.dropdownItem} ${subItem.current ? styles.currentPage : ""}`.trim()}
                        />
                      ))}
                    </div>
                  </div>
                );
              }

              return (
                <NavLinkItem
                  key={key}
                  item={item}
                  onNavigate={onNavigate}
                  style={pillStyle}
                  className={`${styles.pill} ${item.current ? styles.currentPage : ""}`.trim()}
                />
              );
            })}

            {shouldShowAuthAction ? (
              authAction.type === "action" ? (
                <button type="button" className={styles.authLink} onClick={authAction.onClick}>
                  {authAction.label}
                </button>
              ) : (
                <NavLinkItem item={authAction} onNavigate={onNavigate} className={styles.authLink} />
              )
            ) : null}
          </nav>
        ) : null}

        {rightContent ? <div className={styles.rightSlot}>{rightContent}</div> : null}
      </div>
    </div>
  );
}
