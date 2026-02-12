"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

function asText(value) {
  return String(value || "").trim();
}

function buildRestaurantEditorHref(slug) {
  const cleanSlug = asText(slug);
  if (!cleanSlug) return "/restaurant?edit=1";
  return `/restaurant?slug=${encodeURIComponent(cleanSlug)}&edit=1`;
}

function buildLegacyNavItems({
  isEditorMode,
  isOwner,
  isManager,
  managerRestaurants,
  currentRestaurantSlug,
  user,
}) {
  const isManagerOrOwner = isOwner || isManager;
  const loggedIn = Boolean(user?.id);
  const normalizedRestaurants = Array.isArray(managerRestaurants)
    ? managerRestaurants.filter((item) => asText(item?.slug))
    : [];

  const withAuthFilter = (items) =>
    items.filter((item) => {
      if (!item?.requiresAuth) return true;
      return loggedIn;
    });

  if (isManagerOrOwner && isEditorMode) {
    const editorLinks =
      normalizedRestaurants.length > 0
        ? normalizedRestaurants.map((restaurant) => ({
            id: `restaurant-${restaurant.slug}-editor`,
            label: asText(restaurant.name) || "Restaurant",
            href: buildRestaurantEditorHref(restaurant.slug),
            requiresAuth: true,
          }))
        : [
            {
              id: `restaurant-${asText(currentRestaurantSlug) || "current"}-editor`,
              label: "Webpage editor",
              href: buildRestaurantEditorHref(currentRestaurantSlug),
              requiresAuth: true,
            },
          ];

    const topItems = [
      {
        type: "link",
        id: "home",
        label: "Dashboard",
        href: "/manager-dashboard",
        requiresAuth: true,
      },
    ];

    if (editorLinks.length === 1) {
      topItems.push({ type: "link", ...editorLinks[0], label: "Webpage editor" });
    } else {
      topItems.push({
        type: "group",
        id: "webpage-editor",
        label: "Webpage editor",
        items: editorLinks,
      });
    }

    topItems.push(
      {
        type: "group",
        id: "tablet-pages",
        label: "Tablet pages",
        items: [
          {
            id: "server-tablet",
            label: "Server tablet",
            href: "/server-tablet",
            requiresAuth: true,
          },
          {
            id: "kitchen-tablet",
            label: "Kitchen tablet",
            href: "/kitchen-tablet",
            requiresAuth: true,
          },
        ],
      },
      {
        type: "link",
        id: "help-contact",
        label: "Help",
        href: "/help-contact",
        requiresAuth: true,
      },
      {
        type: "link",
        id: "account",
        label: "Account settings",
        href: "/account",
        requiresAuth: true,
      },
    );

    return withAuthFilter(topItems);
  }

  return withAuthFilter([
    { type: "link", id: "home", label: "Home", href: "/home" },
    {
      type: "group",
      id: "by-restaurant",
      label: "By restaurant",
      items: [
        {
          id: "restaurants",
          label: "All restaurants",
          href: "/restaurants",
          requiresAuth: true,
        },
        {
          id: "favorites",
          label: "My restaurants",
          href: "/favorites",
          requiresAuth: true,
        },
      ],
    },
    {
      type: "group",
      id: "by-dish",
      label: "By dish",
      items: [
        {
          id: "dish-search",
          label: "Dish search",
          href: "/dish-search",
          requiresAuth: true,
        },
        {
          id: "my-dishes",
          label: "My dishes",
          href: "/my-dishes",
          requiresAuth: true,
        },
      ],
    },
    {
      type: "link",
      id: "help-contact",
      label: "Help",
      href: "/help-contact",
      requiresAuth: true,
    },
    { type: "link", id: "account", label: "Account settings", href: "/account" },
  ]);
}

function useNavLayout(navRef, deps) {
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;

    let frame = 0;
    const syncLayout = () => {
      nav.classList.remove("nav-compact", "nav-ultra");
      const available = Math.floor(nav.clientWidth);
      if (available > 0 && nav.scrollWidth > available + 1) {
        nav.classList.add("nav-compact");
        if (nav.scrollWidth > available + 1) {
          nav.classList.add("nav-ultra");
        }
      }
      const delta = nav.scrollWidth - nav.clientWidth;
      nav.classList.toggle("nav-centered", delta <= 1);
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        syncLayout();
      });
    };

    schedule();
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);

    return () => {
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, deps);
}

export default function LegacyRestaurantTopbar({
  user,
  isOwner,
  isManager,
  managerRestaurants,
  currentRestaurantSlug,
  canEdit,
  activeView,
  onNavigate,
  onToggleMode,
  onSignOut,
}) {
  const navRef = useRef(null);
  const triggerRefs = useRef(new Map());
  const dropdownRefs = useRef(new Map());
  const closeTimers = useRef(new Map());

  const [openGroupId, setOpenGroupId] = useState("");
  const isManagerOrOwner = Boolean(isOwner || isManager);
  const isEditorMode = Boolean(activeView === "editor" && canEdit);

  const navItems = useMemo(
    () =>
      buildLegacyNavItems({
        isEditorMode,
        isOwner,
        isManager,
        managerRestaurants,
        currentRestaurantSlug,
        user,
      }),
    [
      currentRestaurantSlug,
      isEditorMode,
      isManager,
      isOwner,
      managerRestaurants,
      user,
    ],
  );

  useNavLayout(navRef, [navItems]);

  const currentPageId = useMemo(() => {
    if (isEditorMode) {
      const slug = asText(currentRestaurantSlug);
      if (slug) return `restaurant-${slug}-editor`;
      return "editor";
    }
    return "restaurants";
  }, [currentRestaurantSlug, isEditorMode]);

  const closeGroupSoon = useCallback((groupId) => {
    if (!groupId) return;
    const timer = closeTimers.current.get(groupId);
    if (timer) {
      window.clearTimeout(timer);
      closeTimers.current.delete(groupId);
    }
    const nextTimer = window.setTimeout(() => {
      setOpenGroupId((current) => (current === groupId ? "" : current));
      closeTimers.current.delete(groupId);
    }, 120);
    closeTimers.current.set(groupId, nextTimer);
  }, []);

  const clearCloseTimer = useCallback((groupId) => {
    const timer = closeTimers.current.get(groupId);
    if (timer) {
      window.clearTimeout(timer);
      closeTimers.current.delete(groupId);
    }
  }, []);

  const positionDropdown = useCallback((groupId) => {
    if (!groupId) return;
    const trigger = triggerRefs.current.get(groupId);
    const dropdown = dropdownRefs.current.get(groupId);
    if (!trigger || !dropdown) return;

    const triggerRect = trigger.getBoundingClientRect();
    const prevDisplay = dropdown.style.display;
    const prevVisibility = dropdown.style.visibility;
    const computedHidden = window.getComputedStyle(dropdown).display === "none";

    if (computedHidden) {
      dropdown.style.visibility = "hidden";
      dropdown.style.display = "block";
    }

    const dropdownRect = dropdown.getBoundingClientRect();
    const fallbackWidth = dropdownRect.width || 200;
    const visualViewport = window.visualViewport;
    const viewportWidth = visualViewport?.width || window.innerWidth;
    const viewportHeight = visualViewport?.height || window.innerHeight;
    const viewportOffsetLeft = visualViewport?.offsetLeft || 0;
    const viewportOffsetTop = visualViewport?.offsetTop || 0;

    const width = Math.min(
      viewportWidth - 16,
      Math.max(fallbackWidth, triggerRect.width, 200),
    );
    let left = triggerRect.left + viewportOffsetLeft;
    const maxLeft = viewportOffsetLeft + viewportWidth - width - 8;
    if (left > maxLeft) {
      left = Math.max(viewportOffsetLeft + 8, maxLeft);
    }

    const top = Math.max(
      viewportOffsetTop + 8,
      triggerRect.bottom + viewportOffsetTop + 6,
    );
    const maxHeight = Math.max(140, viewportOffsetTop + viewportHeight - top - 12);

    dropdown.style.setProperty("--dropdown-left", `${Math.round(left)}px`);
    dropdown.style.setProperty("--dropdown-top", `${Math.round(top)}px`);
    dropdown.style.setProperty("--dropdown-width", `${Math.round(width)}px`);
    dropdown.style.maxHeight = `${Math.round(maxHeight)}px`;
    dropdown.style.overflowY = "auto";

    if (computedHidden) {
      dropdown.style.display = prevDisplay;
      dropdown.style.visibility = prevVisibility;
    }
  }, []);

  useEffect(() => {
    if (!openGroupId) return undefined;
    positionDropdown(openGroupId);

    const onResize = () => positionDropdown(openGroupId);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [openGroupId, positionDropdown]);

  useEffect(() => {
    const onClickOutside = (event) => {
      if (!openGroupId) return;
      const trigger = triggerRefs.current.get(openGroupId);
      const dropdown = dropdownRefs.current.get(openGroupId);
      if (!trigger || !dropdown) {
        setOpenGroupId("");
        return;
      }
      if (trigger.contains(event.target) || dropdown.contains(event.target)) {
        return;
      }
      setOpenGroupId("");
    };

    document.addEventListener("click", onClickOutside);
    return () => document.removeEventListener("click", onClickOutside);
  }, [openGroupId]);

  useEffect(() => {
    return () => {
      Array.from(closeTimers.current.values()).forEach((timer) => {
        window.clearTimeout(timer);
      });
      closeTimers.current.clear();
    };
  }, []);

  const onNavClick = useCallback(
    (href) => {
      if (!href) return;
      if (typeof onNavigate === "function") {
        onNavigate(href);
      }
      setOpenGroupId("");
    },
    [onNavigate],
  );

  return (
    <header className="simple-topbar restaurant-parity-topbar">
      <div className="simple-topbar-inner" data-parity-mode="legacy">
        <div className="mode-toggle-container">
          {isManagerOrOwner ? (
            <>
              <span className="mode-toggle-label">
                {isEditorMode ? "Editor mode" : "Customer mode"}
              </span>
              <button
                type="button"
                className={`mode-toggle ${isEditorMode ? "active" : ""}`}
                aria-label={
                  isEditorMode
                    ? "Switch to customer mode"
                    : "Switch to editor mode"
                }
                title="Toggle between Editor and Customer mode"
                onClick={() => onToggleMode?.(isEditorMode ? "viewer" : "editor")}
              />
            </>
          ) : null}
        </div>

        <Link className="simple-brand" href={isEditorMode ? "/manager-dashboard" : "/home"}>
          <img
            src="https://static.wixstatic.com/media/945e9d_2b97098295d341d493e4a07d80d6b57c~mv2.png"
            alt="Clarivore logo"
          />
          <span>Clarivore</span>
        </Link>

        <nav ref={navRef} className="simple-nav">
          {navItems.map((item) => {
            if (item.type === "group") {
              const visibleItems = Array.isArray(item.items)
                ? item.items.filter((subItem) => {
                    if (!subItem?.requiresAuth) return true;
                    return Boolean(user?.id);
                  })
                : [];
              if (!visibleItems.length) return null;

              const isOpen = openGroupId === item.id;
              const isActive = visibleItems.some((subItem) => subItem.id === currentPageId);

              return (
                <div
                  key={item.id}
                  className="nav-group"
                  onMouseEnter={() => {
                    clearCloseTimer(item.id);
                    setOpenGroupId(item.id);
                  }}
                  onMouseLeave={() => closeGroupSoon(item.id)}
                >
                  <button
                    ref={(node) => {
                      if (node) triggerRefs.current.set(item.id, node);
                      else triggerRefs.current.delete(item.id);
                    }}
                    type="button"
                    className={`nav-dropdown-trigger ${isActive ? "current-page" : ""}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      clearCloseTimer(item.id);
                      setOpenGroupId((current) => {
                        const next = current === item.id ? "" : item.id;
                        if (next === item.id) {
                          queueMicrotask(() => positionDropdown(item.id));
                        }
                        return next;
                      });
                    }}
                    onFocus={() => {
                      clearCloseTimer(item.id);
                      setOpenGroupId(item.id);
                    }}
                  >
                    <span className="nav-dropdown-label">{item.label}</span>
                    <span className="nav-dropdown-caret" aria-hidden="true" />
                  </button>

                  <div
                    ref={(node) => {
                      if (node) dropdownRefs.current.set(item.id, node);
                      else dropdownRefs.current.delete(item.id);
                    }}
                    className="nav-dropdown-content"
                    style={{ display: isOpen ? "block" : "none" }}
                    onMouseEnter={() => {
                      clearCloseTimer(item.id);
                      setOpenGroupId(item.id);
                    }}
                    onMouseLeave={() => closeGroupSoon(item.id)}
                  >
                    {visibleItems.map((subItem) => (
                      <a
                        key={subItem.id}
                        href={subItem.href}
                        data-unsaved-nav="handled"
                        className={currentPageId === subItem.id ? "current-page" : ""}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onNavClick(subItem.href);
                        }}
                      >
                        {subItem.label}
                      </a>
                    ))}
                  </div>
                </div>
              );
            }

            if (item.requiresAuth && !user?.id) {
              return null;
            }

            return (
              <button
                key={item.id}
                type="button"
                className={currentPageId === item.id ? "current-page" : ""}
                data-href={item.href}
                onClick={() => onNavClick(item.href)}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="simple-topbar-auth" style={{ marginLeft: "auto", paddingLeft: 8 }}>
          {user?.id ? (
            <button type="button" className="btnLink" onClick={onSignOut}>
              Sign out
            </button>
          ) : (
            <Link href="/account?mode=signin" className="btnLink">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
