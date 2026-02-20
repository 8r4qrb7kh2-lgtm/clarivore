function includeLink(links, shouldInclude, href, label, visible = true) {
  if (!shouldInclude) return;
  const link = { href, label };
  if (visible === false) link.visible = false;
  links.push(link);
}

function asText(value) {
  return String(value || "").trim();
}

function normalizePathname(value) {
  const raw = asText(value);
  if (!raw) return "/";
  const withoutQuery = raw.split("?")[0] || "/";
  const trimmed = withoutQuery.replace(/\/+$/, "");
  return trimmed || "/";
}

function pathMatches(pathname, candidates) {
  const normalized = normalizePathname(pathname);
  const list = Array.isArray(candidates) ? candidates : [candidates];
  return list.some((candidate) => normalizePathname(candidate) === normalized);
}

function buildRestaurantEditorHref(slug) {
  const cleanSlug = asText(slug);
  if (!cleanSlug) return "/manager-dashboard";
  return `/restaurant?slug=${encodeURIComponent(cleanSlug)}&edit=1`;
}

export function createCustomerTopbarItems({
  signedIn = false,
  currentPath = "",
} = {}) {
  const onHome = pathMatches(currentPath, ["/", "/home"]);
  const onRestaurantFlow = pathMatches(currentPath, [
    "/restaurant",
    "/restaurants",
    "/favorites",
  ]);
  const onDishFlow = pathMatches(currentPath, ["/dish-search", "/my-dishes"]);
  const onHelp = pathMatches(currentPath, [
    "/help-contact",
    "/order-feedback",
    "/report-issue",
  ]);
  const onAccount = pathMatches(currentPath, ["/account"]);

  return [
    {
      type: "link",
      id: "home",
      label: "Home",
      href: "/home",
      current: onHome,
    },
    {
      type: "group",
      id: "by-restaurant",
      label: "By restaurant",
      current: onRestaurantFlow,
      items: [
        {
          id: "restaurants",
          label: "All restaurants",
          href: "/restaurants",
          current: pathMatches(currentPath, ["/restaurants"]),
        },
        {
          id: "favorites",
          label: "My restaurants",
          href: "/favorites",
          current: pathMatches(currentPath, ["/favorites"]),
          visible: signedIn,
        },
      ],
    },
    {
      type: "group",
      id: "by-dish",
      label: "By dish",
      current: onDishFlow,
      items: [
        {
          id: "dish-search",
          label: "Dish search",
          href: "/dish-search",
          current: pathMatches(currentPath, ["/dish-search"]),
        },
        {
          id: "my-dishes",
          label: "My dishes",
          href: "/my-dishes",
          current: pathMatches(currentPath, ["/my-dishes"]),
          visible: signedIn,
        },
      ],
    },
    {
      type: "link",
      id: "help",
      label: "Help",
      href: "/help-contact",
      current: onHelp,
    },
    {
      type: "link",
      id: "account",
      label: "Account settings",
      href: "/account",
      current: onAccount,
    },
  ];
}

export function createEditorTopbarItems({
  managerRestaurants = [],
  currentRestaurantSlug = "",
  currentPath = "",
} = {}) {
  const normalizedRestaurants = Array.isArray(managerRestaurants)
    ? managerRestaurants.filter((item) => asText(item?.slug))
    : [];
  const restaurantPathCurrent = pathMatches(currentPath, ["/restaurant"]);

  const editorLinks =
    normalizedRestaurants.length > 0
      ? normalizedRestaurants.map((restaurant) => ({
          id: `restaurant-${restaurant.slug}-editor`,
          label: asText(restaurant.name) || "Restaurant",
          href: buildRestaurantEditorHref(restaurant.slug),
          current:
            restaurantPathCurrent &&
            asText(currentRestaurantSlug) === asText(restaurant.slug),
        }))
      : [
          {
            id: `restaurant-${asText(currentRestaurantSlug) || "current"}-editor`,
            label: "Webpage editor",
            href: buildRestaurantEditorHref(currentRestaurantSlug),
            current: restaurantPathCurrent,
          },
        ];

  const items = [
    {
      type: "link",
      id: "dashboard",
      label: "Dashboard",
      href: "/manager-dashboard",
      current: pathMatches(currentPath, ["/manager-dashboard"]),
    },
  ];

  if (editorLinks.length === 1) {
    items.push({
      type: "link",
      id: "webpage-editor",
      label: "Webpage editor",
      href: editorLinks[0].href,
      current: restaurantPathCurrent,
    });
  } else {
    items.push({
      type: "group",
      id: "webpage-editor",
      label: "Webpage editor",
      current: restaurantPathCurrent,
      items: editorLinks,
    });
  }

  items.push(
    {
      type: "group",
      id: "tablet-pages",
      label: "Tablet pages",
      current: pathMatches(currentPath, ["/server-tablet", "/kitchen-tablet"]),
      items: [
        {
          id: "server-tablet",
          label: "Server tablet",
          href: "/server-tablet",
          current: pathMatches(currentPath, ["/server-tablet"]),
        },
        {
          id: "kitchen-tablet",
          label: "Kitchen tablet",
          href: "/kitchen-tablet",
          current: pathMatches(currentPath, ["/kitchen-tablet"]),
        },
      ],
    },
    {
      type: "link",
      id: "help",
      label: "Help",
      href: "/help-contact",
      current: pathMatches(currentPath, [
        "/help-contact",
        "/order-feedback",
        "/report-issue",
      ]),
    },
    {
      type: "link",
      id: "account",
      label: "Account settings",
      href: "/account",
      current: pathMatches(currentPath, ["/account"]),
    },
  );

  return items;
}

export function createUnifiedTopbarItems({
  mode = "customer",
  signedIn = false,
  managerRestaurants = [],
  currentRestaurantSlug = "",
  currentPath = "",
} = {}) {
  if (mode === "editor") {
    return createEditorTopbarItems({
      managerRestaurants,
      currentRestaurantSlug,
      currentPath,
    });
  }

  return createCustomerTopbarItems({
    signedIn,
    currentPath,
  });
}

export function createDinerTopbarLinks(options = {}) {
  const {
    includeHome = true,
    includeRestaurants = true,
    includeFavorites = true,
    includeDishSearch = true,
    includeHelp = true,
    includeDashboard = false,
    dashboardVisible = true,
    includeBackToMenu = false,
    backToMenuHref = "/account",
    backToMenuVisible = true,
    includeAccount = true,
  } = options;

  const links = [];
  includeLink(links, includeHome, "/home", "Home");
  includeLink(links, includeRestaurants, "/restaurants", "Restaurants");
  includeLink(links, includeFavorites, "/favorites", "My restaurants");
  includeLink(links, includeDishSearch, "/dish-search", "Dish search");
  includeLink(links, includeHelp, "/help-contact", "Help");
  includeLink(
    links,
    includeDashboard,
    "/manager-dashboard",
    "Dashboard",
    dashboardVisible,
  );
  includeLink(
    links,
    includeBackToMenu,
    backToMenuHref || "/account",
    "Back to menu",
    backToMenuVisible,
  );
  includeLink(links, includeAccount, "/account", "Account");
  return links;
}

export function createTabletMonitorTopbarLinks(mode = "kitchen") {
  if (mode === "server") {
    return [
      { href: "/manager-dashboard", label: "Dashboard" },
      { href: "/kitchen-tablet", label: "Kitchen monitor" },
      { href: "/help-contact", label: "Help" },
    ];
  }
  return [
    { href: "/manager-dashboard", label: "Dashboard" },
    { href: "/server-tablet", label: "Server monitor" },
    { href: "/help-contact", label: "Help" },
  ];
}

export function createRestaurantTopbarItems({
  isEditorMode = false,
  isOwner = false,
  isManager = false,
  managerRestaurants = [],
  currentRestaurantSlug = "",
  signedIn = false,
  currentPath = "",
} = {}) {
  const isManagerOrOwner = Boolean(isOwner || isManager);
  const mode = isManagerOrOwner && isEditorMode ? "editor" : "customer";

  return createUnifiedTopbarItems({
    mode,
    signedIn,
    managerRestaurants,
    currentRestaurantSlug,
    currentPath,
  });
}
