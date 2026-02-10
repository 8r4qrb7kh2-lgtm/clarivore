function includeLink(links, shouldInclude, href, label, visible = true) {
  if (!shouldInclude) return;
  const link = { href, label };
  if (visible === false) link.visible = false;
  links.push(link);
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
