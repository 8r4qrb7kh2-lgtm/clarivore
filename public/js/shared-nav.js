/**
 * Shared navigation module for consistent navigation across all pages
 * Usage: call setupTopbar(currentPage, user, options) to render the shared topbar,
 * or setupNav(currentPage, user) if a page owns its nav container.
 * 'restaurants', 'favorites', 'dish-search', 'account', 'report-issue', 'help-contact'
 * Updated: 2025-01-22 - Added dish-search to navigation
 */

import { initHelpAssistantDrawer, setHelpAssistantMode } from './help-assistant-drawer.js';

initHelpAssistantDrawer();

const OWNER_EMAIL = 'matt.29.ds@gmail.com';
const IS_EMBEDDED = (() => {
  try {
    return window.self !== window.top;
  } catch (_) {
    return false;
  }
})();
const IS_NATIVE = (() => {
  const protocol = window.location.protocol;
  if (protocol === 'capacitor:' || protocol === 'ionic:' || protocol === 'file:') {
    return true;
  }
  if (window.Capacitor?.isNativePlatform) {
    return window.Capacitor.isNativePlatform();
  }
  if (window.Capacitor?.getPlatform) {
    return window.Capacitor.getPlatform() !== 'web';
  }
  if (window.navigator?.userAgent?.includes('Capacitor')) {
    return true;
  }
  return false;
})();
const preferNextRoutes = !IS_NATIVE;
const route = (nextPath, legacyPath) => (preferNextRoutes ? nextPath : legacyPath);
const routeWithQuery = (nextPath, legacyPath) =>
  preferNextRoutes ? nextPath : legacyPath;

const ROUTES = {
  index: route('/', 'index.html'),
  home: route('/home', 'home.html'),
  account: route('/account', 'account.html'),
  restaurants: route('/restaurants', 'restaurants.html'),
  favorites: route('/favorites', 'favorites.html'),
  dishSearch: route('/dish-search', 'dish-search.html'),
  myDishes: route('/my-dishes', 'my-dishes.html'),
  help: route('/help-contact', 'help-contact.html'),
  reportIssue: route('/report-issue', 'report-issue.html'),
  restaurantEditor: (slug) =>
    routeWithQuery(
      `/restaurant?slug=${encodeURIComponent(slug)}&edit=1`,
      `restaurant.html?slug=${encodeURIComponent(slug)}&edit=1`,
    ),
  managerDashboard: route('/manager-dashboard', 'manager-dashboard.html'),
  serverTablet: route('/server-tablet', 'server-tablet.html'),
  kitchenTablet: route('/kitchen-tablet', 'kitchen-tablet.html'),
  adminDashboard: route('/admin-dashboard', 'admin-dashboard.html'),
};

function getUserFlags(user) {
  const role = user?.user_metadata?.role || user?.role || null;
  const isOwner = user?.email === OWNER_EMAIL;
  const isManager = role === 'manager';
  return { isOwner, isManager, isManagerOrOwner: isOwner || isManager };
}

function getManagerMode(user) {
  const { isManagerOrOwner } = getUserFlags(user);
  if (!isManagerOrOwner) return null;
  let currentMode = localStorage.getItem('clarivoreManagerMode');
  if (!currentMode) {
    currentMode = 'editor';
    localStorage.setItem('clarivoreManagerMode', 'editor');
  }
  return currentMode;
}

/**
 * Universal auth redirect - automatically redirects to landing page if not logged in
 * Exceptions: index.html (landing page), account.html (login page), QR users
 */
export async function checkAuthRedirect(supabaseClient) {
  // Get current page
  const currentPath = window.location.pathname;
  const currentPage = currentPath.split('/').filter(Boolean).pop() || '';
  const urlParams = new URLSearchParams(window.location.search);
  const isQRUser = urlParams.get('qr') === '1';
  const isLanding =
    currentPage === '' ||
    currentPage === '/' ||
    currentPage === 'index.html' ||
    currentPage === 'index';
  const isAccount =
    currentPage === 'account.html' ||
    currentPage === 'account';

  // Skip redirect for landing page, account page, and QR users
  if (isLanding || isAccount || isQRUser) {
    return;
  }

  // Check if user is logged in
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();

    // If not logged in, redirect to landing page
    if (!user) {
      window.location.replace(ROUTES.index);
      return;
    }
  } catch (error) {
    console.error('Auth check error:', error);
    // On error, redirect to landing page to be safe
    window.location.replace(ROUTES.index);
  }
}

function syncNavLayout(navContainer) {
  if (!navContainer) return;
  navContainer.classList.remove('nav-compact', 'nav-ultra');
  const available = Math.floor(navContainer.clientWidth);
  if (!available) return;
  if (navContainer.scrollWidth > available + 1) {
    navContainer.classList.add('nav-compact');
    if (navContainer.scrollWidth > available + 1) {
      navContainer.classList.add('nav-ultra');
    }
  }
  const delta = navContainer.scrollWidth - navContainer.clientWidth;
  const fits = delta <= 1;
  navContainer.classList.toggle('nav-centered', fits);
}

function resetNavScroll(navContainer) {
  if (!navContainer) return;
  if (typeof navContainer.scrollTo === 'function') {
    navContainer.scrollTo({ left: 0, behavior: 'auto' });
  } else {
    navContainer.scrollLeft = 0;
  }
}

function bindNavLayout(navContainer) {
  if (!navContainer || navContainer.__navLayoutBound) return;
  navContainer.__navLayoutBound = true;
  const handleResize = () => syncNavLayout(navContainer);
  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', handleResize);
}

function positionDropdown(trigger, dropdown) {
  const triggerRect = trigger.getBoundingClientRect();
  const prevDisplay = dropdown.style.display;
  const prevVisibility = dropdown.style.visibility;
  const wasHidden = getComputedStyle(dropdown).display === 'none';
  if (wasHidden) {
    dropdown.style.visibility = 'hidden';
    dropdown.style.display = 'block';
  }
  const dropdownRect = dropdown.getBoundingClientRect();
  const fallbackWidth = dropdownRect.width || 200;
  const visualViewport = window.visualViewport;
  const viewportWidth = visualViewport?.width || window.innerWidth;
  const viewportHeight = visualViewport?.height || window.innerHeight;
  const viewportOffsetLeft = visualViewport?.offsetLeft || 0;
  const viewportOffsetTop = visualViewport?.offsetTop || 0;
  const width = Math.min(viewportWidth - 16, Math.max(fallbackWidth, triggerRect.width, 200));
  let left = triggerRect.left + viewportOffsetLeft;
  const maxLeft = viewportOffsetLeft + viewportWidth - width - 8;
  if (left > maxLeft) left = Math.max(viewportOffsetLeft + 8, maxLeft);
  const top = Math.max(
    viewportOffsetTop + 8,
    triggerRect.bottom + viewportOffsetTop + 6,
  );
  const maxHeight = Math.max(140, viewportOffsetTop + viewportHeight - top - 12);
  dropdown.style.setProperty('--dropdown-left', `${Math.round(left)}px`);
  dropdown.style.setProperty('--dropdown-top', `${Math.round(top)}px`);
  dropdown.style.setProperty('--dropdown-width', `${Math.round(width)}px`);
  dropdown.style.maxHeight = `${Math.round(maxHeight)}px`;
  dropdown.style.overflowY = 'auto';
  if (wasHidden) {
    dropdown.style.display = prevDisplay;
    dropdown.style.visibility = prevVisibility;
  }
}

function bindDropdownPositioning(navContainer) {
  if (!navContainer) return;
  const groups = Array.from(navContainer.querySelectorAll('.nav-group'));
  navContainer.__navDropdownGroups = groups;
  if (!groups.length) return;

  const updateAll = () => {
    (navContainer.__navDropdownGroups || []).forEach((group) => {
      const trigger = group.querySelector('.nav-dropdown-trigger');
      const dropdown = group.querySelector('.nav-dropdown-content');
      if (trigger && dropdown) positionDropdown(trigger, dropdown);
    });
  };
  navContainer.__navDropdownUpdateAll = updateAll;

  groups.forEach((group) => {
    const trigger = group.querySelector('.nav-dropdown-trigger');
    const dropdown = group.querySelector('.nav-dropdown-content');
    if (!trigger || !dropdown) return;
    if (!dropdown.__portalized) {
      dropdown.__portalized = true;
      dropdown.style.display = 'none';
      dropdown.style.position = 'fixed';
      document.body.appendChild(dropdown);
    }

    const show = () => {
      clearTimeout(dropdown.__closeTimer);
      if (navContainer.__activeDropdown && navContainer.__activeDropdown !== dropdown) {
        navContainer.__activeDropdown.style.display = 'none';
      }
      positionDropdown(trigger, dropdown);
      dropdown.style.display = 'block';
      navContainer.__activeDropdown = dropdown;
      navContainer.__activeDropdownTrigger = trigger;
    };

    const hide = (immediate = false) => {
      const closeNow = () => {
        dropdown.style.display = 'none';
        if (navContainer.__activeDropdown === dropdown) {
          navContainer.__activeDropdown = null;
          navContainer.__activeDropdownTrigger = null;
        }
      };
      clearTimeout(dropdown.__closeTimer);
      if (immediate) {
        closeNow();
      } else {
        dropdown.__closeTimer = setTimeout(closeNow, 120);
      }
    };

    trigger.addEventListener('mouseenter', show);
    trigger.addEventListener('focus', show);
    trigger.addEventListener('mouseleave', () => hide());
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (dropdown.style.display === 'block') {
        hide(true);
      } else {
        show();
      }
    });

    dropdown.addEventListener('mouseenter', show);
    dropdown.addEventListener('mouseleave', () => hide());
  });

  if (!navContainer.__navDropdownBound) {
    navContainer.__navDropdownBound = true;
    const handle = () => navContainer.__navDropdownUpdateAll?.();
    navContainer.__navDropdownHandle = handle;
    window.addEventListener('resize', handle);
    navContainer.addEventListener('scroll', handle, { passive: true });
    document.addEventListener('click', (event) => {
      const dropdown = navContainer.__activeDropdown;
      const trigger = navContainer.__activeDropdownTrigger;
      if (!dropdown || !trigger) return;
      if (dropdown.contains(event.target) || trigger.contains(event.target)) return;
      dropdown.style.display = 'none';
      navContainer.__activeDropdown = null;
      navContainer.__activeDropdownTrigger = null;
    });
  }
}

export function setupNav(currentPage, user = null, options = {}) {
  const navContainer = options.navContainer || document.querySelector('.simple-nav');
  if (!navContainer) {
    console.warn('Navigation container not found');
    return;
  }

  const navigateTo = (href) => {
    if (!href) return;
    if (IS_EMBEDDED && window.top) {
      window.top.location.href = href;
    } else {
      window.location.href = href;
    }
  };

  // Clear existing nav
  navContainer.innerHTML = '';
  resetNavScroll(navContainer);

  const { isOwner, isManager, isManagerOrOwner } = getUserFlags(user);
  const managerRestaurants = Array.isArray(options.managerRestaurants) ? options.managerRestaurants : [];

  // Check mode for managers - default to 'editor' if not set
  let currentMode = localStorage.getItem('clarivoreManagerMode');
  if (isManagerOrOwner && !currentMode) {
    currentMode = 'editor';
    localStorage.setItem('clarivoreManagerMode', 'editor');
  }
  const isEditorMode = currentMode === 'editor';
  setHelpAssistantMode(isManagerOrOwner && isEditorMode ? 'manager' : 'customer');
  const navMode = isManagerOrOwner ? (isEditorMode ? 'editor' : 'customer') : 'customer';
  navContainer.classList.toggle('nav-mode-customer', navMode === 'customer');
  navContainer.classList.toggle('nav-mode-editor', navMode === 'editor');

  // Update brand link based on editor mode
  const brandLink = document.querySelector('.simple-brand');
  if (brandLink) {
    if (isManagerOrOwner) {
      brandLink.href = isEditorMode
        ? ROUTES.managerDashboard
        : ROUTES.home;
    } else {
      brandLink.href = ROUTES.home;
    }
    if (IS_EMBEDDED) {
      brandLink.target = '_top';
    }
  }

  let navStructure = [];
  const helpContactLink = {
    type: 'link',
    id: 'help-contact',
    label: 'Help',
    href: ROUTES.help,
    requiresAuth: true
  };

  if (isOwner && isEditorMode) {
    // Owner in editor mode - admin tools without the admin entry
    navStructure = [
      { type: 'link', id: 'home', label: 'Dashboard', href: ROUTES.managerDashboard, requiresAuth: true },
      // Webpage editor buttons for each restaurant
      ...(managerRestaurants.length === 1 ? [
        { type: 'link', id: `restaurant-${managerRestaurants[0].slug}-editor`, label: 'Webpage editor', href: ROUTES.restaurantEditor(managerRestaurants[0].slug), requiresAuth: true }
      ] : managerRestaurants.length > 1 ? [{
        type: 'group',
        label: 'Webpage editor',
        items: managerRestaurants.map(restaurant => ({
          id: `restaurant-${restaurant.slug}-editor`,
          label: restaurant.name,
          href: ROUTES.restaurantEditor(restaurant.slug),
          requiresAuth: true
        }))
      }] : []),
      {
        type: 'group',
        label: 'Tablet pages',
        items: [
          { id: 'server-tablet', label: 'Server tablet', href: ROUTES.serverTablet, requiresAuth: true },
          { id: 'kitchen-tablet', label: 'Kitchen tablet', href: ROUTES.kitchenTablet, requiresAuth: true }
        ]
      },
      helpContactLink,
      { type: 'link', id: 'account', label: 'Account settings', href: ROUTES.account }
    ];
  } else if (isOwner && !isEditorMode) {
    // Owner in customer mode - sees customer navigation
    navStructure = [
      { type: 'link', id: 'home', label: 'Home', href: ROUTES.home },
      {
        type: 'group',
        label: 'By restaurant',
        items: [
          { id: 'restaurants', label: 'All restaurants', href: ROUTES.restaurants, requiresAuth: true },
          { id: 'favorites', label: 'My restaurants', href: ROUTES.favorites, requiresAuth: true }
        ]
      },
      {
        type: 'group',
        label: 'By dish',
        items: [
          { id: 'dish-search', label: 'Dish search', href: ROUTES.dishSearch, requiresAuth: true },
          { id: 'my-dishes', label: 'My dishes', href: ROUTES.myDishes, requiresAuth: true }
        ]
      },
      helpContactLink,
      { type: 'link', id: 'account', label: 'Account settings', href: ROUTES.account }
    ];
  } else if (isManager && isEditorMode) {
    // Manager in EDITOR mode - show manager navigation
    navStructure = [];

    // Dashboard (manager dashboard with statistics)
    navStructure.push({ type: 'link', id: 'home', label: 'Dashboard', href: ROUTES.managerDashboard, requiresAuth: true });

    // Webpage editor buttons for each restaurant
    if (managerRestaurants.length === 1) {
      // Single restaurant - just one button
      const restaurant = managerRestaurants[0];
      navStructure.push({ type: 'link', id: `restaurant-${restaurant.slug}-editor`, label: 'Webpage editor', href: ROUTES.restaurantEditor(restaurant.slug), requiresAuth: true });
    } else if (managerRestaurants.length > 1) {
      // Multiple restaurants - dropdown with restaurant names
      navStructure.push({
        type: 'group',
        label: 'Webpage editor',
        items: managerRestaurants.map(restaurant => ({
          id: `restaurant-${restaurant.slug}-editor`,
          label: restaurant.name,
          href: ROUTES.restaurantEditor(restaurant.slug),
          requiresAuth: true
        }))
      });
    }

    // Tablet pages dropdown
    navStructure.push({
      type: 'group',
      label: 'Tablet pages',
      items: [
        { id: 'server-tablet', label: 'Server tablet', href: ROUTES.serverTablet, requiresAuth: true },
        { id: 'kitchen-tablet', label: 'Kitchen tablet', href: ROUTES.kitchenTablet, requiresAuth: true }
      ]
    });

    // Account settings
    navStructure.push(helpContactLink);
    navStructure.push({ type: 'link', id: 'account', label: 'Account settings', href: ROUTES.account, requiresAuth: true });
  } else if (isManager && !isEditorMode) {
    // Manager in CUSTOMER mode - show customer navigation
    navStructure = [
      { type: 'link', id: 'home', label: 'Home', href: ROUTES.home },
      {
        type: 'group',
        label: 'By restaurant',
        items: [
          { id: 'restaurants', label: 'All restaurants', href: ROUTES.restaurants, requiresAuth: true },
          { id: 'favorites', label: 'My restaurants', href: ROUTES.favorites, requiresAuth: true }
        ]
      },
      {
        type: 'group',
        label: 'By dish',
        items: [
          { id: 'dish-search', label: 'Dish search', href: ROUTES.dishSearch, requiresAuth: true },
          { id: 'my-dishes', label: 'My dishes', href: ROUTES.myDishes, requiresAuth: true }
        ]
      },
      helpContactLink,
      { type: 'link', id: 'account', label: 'Account settings', href: ROUTES.account }
    ];
  } else {
    // Regular user view (not logged in or regular customer)
    navStructure = [
      { type: 'link', id: 'home', label: 'Home', href: ROUTES.home },
      {
        type: 'group',
        label: 'By restaurant',
        items: [
          { id: 'restaurants', label: 'All restaurants', href: ROUTES.restaurants, requiresAuth: true },
          { id: 'favorites', label: 'My restaurants', href: ROUTES.favorites, requiresAuth: true }
        ]
      },
      {
        type: 'group',
        label: 'By dish',
        items: [
          { id: 'dish-search', label: 'Dish search', href: ROUTES.dishSearch, requiresAuth: true },
          { id: 'my-dishes', label: 'My dishes', href: ROUTES.myDishes, requiresAuth: true }
        ]
      },
      helpContactLink,
      { type: 'link', id: 'account', label: 'Account settings', href: ROUTES.account }
    ];
  }

  navStructure.forEach(item => {
    // Handle groups
    if (item.type === 'group') {

      // Filter items within group
      const visibleItems = item.items.filter(subItem => {
        if (subItem.requiresAuth && !user) return false;
        return true;
      });

      if (visibleItems.length === 0) return;

      const groupContainer = document.createElement('div');
      groupContainer.className = 'nav-group';

      const trigger = document.createElement('button');
      trigger.className = 'nav-dropdown-trigger';
      const labelSpan = document.createElement('span');
      labelSpan.className = 'nav-dropdown-label';
      labelSpan.textContent = item.label;
      const caret = document.createElement('span');
      caret.className = 'nav-dropdown-caret';
      caret.setAttribute('aria-hidden', 'true');
      trigger.appendChild(labelSpan);
      trigger.appendChild(caret);

      // Check if any child is active
      const isChildActive = visibleItems.some(subItem => subItem.id === currentPage);
      if (isChildActive) {
        trigger.classList.add('current-page');
      }

      const dropdown = document.createElement('div');
      dropdown.className = 'nav-dropdown-content';

      visibleItems.forEach(subItem => {
        const link = document.createElement('a');
        link.href = subItem.href;
        link.textContent = subItem.label;
        if (currentPage === subItem.id) {
          link.classList.add('current-page');
        }
        if (IS_EMBEDDED) {
          link.target = '_top';
          link.addEventListener('click', (event) => {
            event.preventDefault();
            navigateTo(subItem.href);
          });
        }
        dropdown.appendChild(link);
      });

      groupContainer.appendChild(trigger);
      groupContainer.appendChild(dropdown);
      navContainer.appendChild(groupContainer);
      return;
    }

    // Handle single links
    if (!user && item.id === 'account') {
      const btn = document.createElement('button');
      btn.textContent = 'Sign in';
      btn.type = 'button';
      btn.dataset.href = ROUTES.account;
      btn.onclick = () => navigateTo(ROUTES.account);
      if (currentPage === 'account') {
        btn.classList.add('current-page');
      }
      navContainer.appendChild(btn);
      return;
    }
    if (item.requiresAuth && !user) {
      return;
    }

    const btn = document.createElement('button');
    btn.textContent = item.label;
    btn.type = 'button';
    btn.dataset.href = item.href;
    if (currentPage === item.id) {
      btn.classList.add('current-page');
    }
    btn.onclick = () => navigateTo(item.href);
    navContainer.appendChild(btn);
  });

  requestAnimationFrame(() => syncNavLayout(navContainer));
  requestAnimationFrame(() => resetNavScroll(navContainer));
  setTimeout(() => syncNavLayout(navContainer), 200);
  setTimeout(() => resetNavScroll(navContainer), 200);
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => syncNavLayout(navContainer)).catch(() => {});
    document.fonts.ready.then(() => resetNavScroll(navContainer)).catch(() => {});
  }
  bindNavLayout(navContainer);
  bindDropdownPositioning(navContainer);
  console.log('Navigation setup complete');
}

export function setupTopbar(currentPage, user = null, options = {}) {
  const {
    managerRestaurants = [],
    container = document.querySelector('.simple-topbar-inner'),
    brandHref = ROUTES.home,
    onNavReady,
    modeToggle = {}
  } = options;

  if (!container) {
    console.warn('Topbar container not found');
    return null;
  }

  container.innerHTML = '';

  const modeToggleContainer = document.createElement('div');
  modeToggleContainer.className = 'mode-toggle-container';
  container.appendChild(modeToggleContainer);

  const brand = document.createElement('a');
  brand.className = 'simple-brand';
  brand.href = brandHref;
  if (IS_EMBEDDED) {
    brand.target = '_top';
  }
  brand.innerHTML = '<img src="https://static.wixstatic.com/media/945e9d_2b97098295d341d493e4a07d80d6b57c~mv2.png" alt="Clarivore logo"><span>Clarivore</span>';
  container.appendChild(brand);

  const navContainer = document.createElement('div');
  navContainer.className = 'simple-nav';
  container.appendChild(navContainer);

  setupNav(currentPage, user, { managerRestaurants, navContainer });

  if (typeof onNavReady === 'function') {
    onNavReady(navContainer);
  }

  const {
    enabled = true,
    resolveTarget,
    navigate,
    editorTarget = ROUTES.managerDashboard,
    customerTarget = ROUTES.home
  } = modeToggle;

  const { isManagerOrOwner } = getUserFlags(user);
  if (!enabled || !isManagerOrOwner) {
    modeToggleContainer.style.display = 'none';
    modeToggleContainer.innerHTML = '';
    return { navContainer, modeToggleContainer, brand };
  }

  const currentMode = getManagerMode(user) || 'customer';
  const isEditorMode = currentMode === 'editor';
  modeToggleContainer.style.display = 'flex';
  modeToggleContainer.innerHTML = `
    <span class="mode-toggle-label">${isEditorMode ? 'Editor mode' : 'Customer mode'}</span>
    <div class="mode-toggle ${isEditorMode ? 'active' : ''}" id="modeToggle" title="Toggle between Editor and Customer mode"></div>
  `;

  const toggle = modeToggleContainer.querySelector('#modeToggle');
  if (toggle) {
    toggle.onclick = () => {
      const nextMode = isEditorMode ? 'customer' : 'editor';
      const fallbackTarget = nextMode === 'editor' ? editorTarget : customerTarget;
      const target =
        typeof resolveTarget === 'function'
          ? resolveTarget(nextMode, { currentMode, user })
          : fallbackTarget;

      const go =
        typeof navigate === 'function'
          ? navigate
          : (mode, href) => {
              localStorage.setItem('clarivoreManagerMode', mode);
              if (IS_EMBEDDED && window.top) {
                window.top.location.href = href;
              } else {
                window.location.href = href;
              }
            };

      if (target) {
        go(nextMode, target);
      }
    };
  }

  return { navContainer, modeToggleContainer, brand };
}

// Deprecated: Sign out handler moved to account page
export function attachSignOutHandler(supabaseClient) {
  // No-op: kept for backward compatibility
}
