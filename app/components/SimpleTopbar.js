"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./SimpleTopbar.module.css";

const CLARIVORE_LOGO_SRC =
  "https://static.wixstatic.com/media/945e9d_2b97098295d341d493e4a07d80d6b57c~mv2.png";

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

function NavLinkItem({ item, onNavigate, className }) {
  const href = String(item?.href || "").trim();
  if (!href) return null;

  if (typeof onNavigate === "function") {
    return (
      <button
        type="button"
        className={className}
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
    <Link href={href} className={className}>
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
            <span className={styles.modeToggleLabel}>{modeToggle.label}</span>
            <button
              type="button"
              className={`${styles.modeToggle} ${modeToggle.active ? styles.modeToggleActive : ""}`}
              aria-label={modeToggle.ariaLabel || "Toggle mode"}
              onClick={modeToggle.onToggle}
            />
          </div>
        ) : null}

        {showBrand ? (
          <Link className={styles.brand} href={brandHref}>
            <img src={CLARIVORE_LOGO_SRC} alt="Clarivore logo" />
            <span>Clarivore</span>
          </Link>
        ) : null}

        {showNav ? (
          <nav className={styles.nav}>
            {visibleItems.map((item, index) => {
              const key = itemKey(item, `item-${index}`);
              if (item.type === "group") {
                const groupItems = Array.isArray(item.items) ? item.items.filter(isVisible) : [];
                if (!groupItems.length) return null;
                const isOpen = openGroupId === key;
                const isCurrent =
                  Boolean(item.current) || groupItems.some((subItem) => Boolean(subItem.current));

                return (
                  <div key={key} className={styles.navGroup}>
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
                  className={`${styles.pill} ${item.current ? styles.currentPage : ""}`.trim()}
                />
              );
            })}

            {authAction ? (
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
