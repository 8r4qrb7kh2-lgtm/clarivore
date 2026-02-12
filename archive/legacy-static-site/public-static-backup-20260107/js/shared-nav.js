/**
 * Shared navigation module for consistent navigation across all pages
 * Usage: call setupNav(currentPage, user) where currentPage is one of:
 * 'restaurants', 'favorites', 'dish-search', 'how-it-works', 'account', 'report-issue'
 * Updated: 2025-01-22 - Added dish-search to navigation
 */

export function setupNav(currentPage, user = null) {
  const navContainer = document.querySelector('.simple-nav');
  if (!navContainer) {
    console.warn('Navigation container not found');
    return;
  }

  // Clear existing nav
  navContainer.innerHTML = '';

  // Define all nav items in consistent order
  const navItems = [
    { id: 'dish-search', label: 'Dish search', href: 'dish-search.html', requiresAuth: true },
    { id: 'restaurants', label: 'All restaurants', href: 'restaurants.html', requiresAuth: true },
    { id: 'favorites', label: 'Favorite restaurants', href: 'favorites.html', requiresAuth: true },
    // { id: 'how-it-works', label: 'How it works', href: 'how-it-works.html' }, // Hidden for now
    { id: 'account', label: 'Account settings', href: 'account.html' }
  ];

  navItems.forEach(item => {
    // Skip items that require auth if user is not logged in
    if (item.requiresAuth && !user) {
      console.log('Skipping nav item (requires auth):', item.label);
      return;
    }

    // For sign-in button when not logged in
    if (item.id === 'account' && !user) {
      const btn = document.createElement('button');
      btn.textContent = 'Sign in';
      btn.type = 'button';
      btn.onclick = () => window.location.href = 'account.html';
      if (currentPage === 'account') {
        btn.classList.add('current-page');
      }
      navContainer.appendChild(btn);
      return;
    }

    const btn = document.createElement('button');
    btn.textContent = item.label;
    btn.type = 'button';

    // Add current page indicator
    if (currentPage === item.id) {
      btn.classList.add('current-page');
    }

    // Set up click handler
    btn.onclick = () => window.location.href = item.href;

    navContainer.appendChild(btn);
    console.log('Added nav item:', item.label);
  });
  
  console.log('Navigation setup complete. Total items:', navContainer.children.length);
}

// Deprecated: Sign out handler moved to account page
export function attachSignOutHandler(supabaseClient) {
  // No-op: kept for backward compatibility
}
