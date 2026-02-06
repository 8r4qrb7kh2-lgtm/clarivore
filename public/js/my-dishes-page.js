    import supabaseClient from './supabase-client.js';
    import { setupTopbar } from './shared-nav.js';
    import { fetchManagerRestaurants } from './manager-context.js';

    let currentUser = null;
    const lovedDishesContainer = document.getElementById('loved-dishes-container');
    const orderedDishesContainer = document.getElementById('ordered-dishes-container');
    const statusMessage = document.getElementById('status-message');
    const lovedDishesSet = new Set();

    function setStatus(message, type = '') {
      statusMessage.textContent = message;
      statusMessage.className = type ? `status-text ${type}` : 'status-text';
      statusMessage.style.display = message ? 'block' : 'none';
      if (message) {
        setTimeout(() => {
          statusMessage.style.display = 'none';
        }, 3000);
      }
    }

    function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function getDishKey(restaurantId, dishName) {
      return `${String(restaurantId)}:${dishName}`;
    }

    function formatDate(dateStr) {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now - date;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays} days ago`;
      if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
      return date.toLocaleDateString();
    }

    function renderDishItem(dish, restaurantSlug, isLoved, showUnloveButton = false) {
      const dishKey = getDishKey(dish.restaurant_id, dish.dish_name).replace(/[^a-zA-Z0-9]/g, '-');
      const dishUrl = `/restaurant?slug=${encodeURIComponent(restaurantSlug || '')}&dishName=${encodeURIComponent(dish.dish_name)}`;
      const dateStr = dish.created_at ? formatDate(dish.created_at) : '';

      const unloveBtn = showUnloveButton ? `
        <button class="unlove-btn" data-restaurant-id="${dish.restaurant_id}" data-dish-name="${escapeHtml(dish.dish_name)}" title="Remove from favorites" onclick="event.stopPropagation()">
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>
          Remove
        </button>
      ` : '';

      return `
        <div class="dish-item" data-restaurant-slug="${restaurantSlug || ''}" data-dish-name="${escapeHtml(dish.dish_name)}" data-restaurant-id="${dish.restaurant_id}">
          <span class="dish-name">${escapeHtml(dish.dish_name)}</span>
          <span class="dish-actions">
            ${unloveBtn}
            ${dateStr ? `<span class="dish-date">${dateStr}</span>` : ''}
            <a href="${dishUrl}" class="dish-launch-link" title="View dish details" onclick="event.stopPropagation()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </a>
          </span>
        </div>
      `;
    }

    async function loadLovedDishes() {
      try {
        lovedDishesContainer.innerHTML = '<div class="loading">Loading your favorite dishes...</div>';

        // Fetch loved dishes for the current user
        const { data: lovedDishesData, error: lovedError } = await supabaseClient
          .from('user_loved_dishes')
          .select('restaurant_id, dish_name, created_at')
          .eq('user_id', currentUser.id)
          .order('created_at', { ascending: false });

        if (lovedError) throw lovedError;

        lovedDishesSet.clear();
        if (lovedDishesData) {
          lovedDishesData.forEach(d => {
            lovedDishesSet.add(getDishKey(d.restaurant_id, d.dish_name));
          });
        }

        if (!lovedDishesData || lovedDishesData.length === 0) {
          lovedDishesContainer.innerHTML = `
            <div class="empty-state">
              <p style="font-size:1.1rem;margin-bottom:8px;">No favorite dishes yet</p>
              <p style="margin-bottom:16px;">Click the heart icon on any dish to save it!</p>
              <a href="/dish-search" style="color:var(--accent);text-decoration:none;">Search for dishes →</a>
            </div>
          `;
          return;
        }

        // Get unique restaurant IDs
        const restaurantIds = [...new Set(lovedDishesData.map(d => d.restaurant_id))];

        // Fetch restaurant details
        const { data: restaurantsData, error: restaurantsError } = await supabaseClient
          .from('restaurants')
          .select('id, name, slug')
          .in('id', restaurantIds);

        if (restaurantsError) throw restaurantsError;

        // Create a map of restaurant data
        const restaurantsMap = new Map();
        (restaurantsData || []).forEach(r => {
          restaurantsMap.set(r.id, r);
        });

        // Group dishes by restaurant
        const dishesByRestaurant = {};
        lovedDishesData.forEach(dish => {
          if (!dishesByRestaurant[dish.restaurant_id]) {
            dishesByRestaurant[dish.restaurant_id] = [];
          }
          dishesByRestaurant[dish.restaurant_id].push(dish);
        });

        // Sort restaurants by number of loved dishes (most first)
        const restaurantEntries = Object.entries(dishesByRestaurant).sort((a, b) => {
          return b[1].length - a[1].length;
        });

        // Render dishes grouped by restaurant
        let html = '';
        restaurantEntries.forEach(([restaurantId, dishes]) => {
          const restaurant = restaurantsMap.get(restaurantId);
          const restaurantName = restaurant?.name || 'Unknown Restaurant';
          const restaurantSlug = restaurant?.slug || '';
          const count = dishes.length;

          html += `
            <div class="restaurant-section">
              <div class="restaurant-section-header">
                <h3 class="restaurant-section-name">
                  ${restaurantSlug ? `<a href="/restaurant?slug=${encodeURIComponent(restaurantSlug)}">${escapeHtml(restaurantName)}</a>` : escapeHtml(restaurantName)}
                </h3>
                <span class="restaurant-dish-count">${count} dish${count !== 1 ? 'es' : ''}</span>
              </div>
              ${dishes.map(dish => renderDishItem(dish, restaurantSlug, true, true)).join('')}
            </div>
          `;
        });

        lovedDishesContainer.innerHTML = html;
        attachHandlers();
        attachUnloveHandlers();

      } catch (err) {
        console.error('Failed to load loved dishes', err);
        lovedDishesContainer.innerHTML = '<div class="status-text error">Failed to load favorite dishes.</div>';
      }
    }

    async function loadPreviouslyOrderedDishes() {
      try {
        orderedDishesContainer.innerHTML = '<div class="loading">Loading your order history...</div>';

        // Fetch acknowledged orders for the current user
        const { data: orders, error } = await supabaseClient
          .from('tablet_orders')
          .select('restaurant_id, payload, created_at')
          .eq('status', 'acknowledged')
          .eq('payload->>userId', currentUser.id)
          .order('created_at', { ascending: false });

        if (error) throw error;

        if (!orders || orders.length === 0) {
          orderedDishesContainer.innerHTML = '<div class="empty-state">No order history found.</div>';
          return;
        }

        // Track dishes with their most recent order date
        const dishesMap = new Map();

        orders.forEach(order => {
          const payload = order.payload || {};
          const items = Array.isArray(payload.items) ? payload.items : [];

          items.forEach(dishName => {
            const key = getDishKey(order.restaurant_id, dishName);
            // Keep the most recent order date for each dish
            if (!dishesMap.has(key)) {
              dishesMap.set(key, {
                restaurant_id: order.restaurant_id,
                dish_name: dishName,
                created_at: order.created_at
              });
            }
          });
        });

        const uniqueDishes = Array.from(dishesMap.values());

        if (uniqueDishes.length === 0) {
          orderedDishesContainer.innerHTML = '<div class="empty-state">No dishes found in your order history.</div>';
          return;
        }

        const restaurantIds = [...new Set(uniqueDishes.map(d => d.restaurant_id))];

        const { data: restaurantsData, error: restaurantsError } = await supabaseClient
          .from('restaurants')
          .select('id, name, slug')
          .in('id', restaurantIds);

        if (restaurantsError) throw restaurantsError;

        const restaurantsMap = new Map();
        (restaurantsData || []).forEach(r => {
          restaurantsMap.set(r.id, r);
        });

        // Group dishes by restaurant, keeping track of most recent order per restaurant
        const dishesByRestaurant = {};
        const restaurantMostRecentOrder = {};

        uniqueDishes.forEach(dish => {
          if (!dishesByRestaurant[dish.restaurant_id]) {
            dishesByRestaurant[dish.restaurant_id] = [];
            restaurantMostRecentOrder[dish.restaurant_id] = dish.created_at;
          }
          dishesByRestaurant[dish.restaurant_id].push(dish);
          // Update most recent order for this restaurant
          if (new Date(dish.created_at) > new Date(restaurantMostRecentOrder[dish.restaurant_id])) {
            restaurantMostRecentOrder[dish.restaurant_id] = dish.created_at;
          }
        });

        // Sort restaurants by most recent order (most recent first)
        const restaurantEntries = Object.entries(dishesByRestaurant).sort((a, b) => {
          const dateA = new Date(restaurantMostRecentOrder[a[0]]);
          const dateB = new Date(restaurantMostRecentOrder[b[0]]);
          return dateB - dateA;
        });

        let html = '';
        restaurantEntries.forEach(([restaurantId, dishes]) => {
          const restaurant = restaurantsMap.get(restaurantId);
          const restaurantName = restaurant?.name || 'Unknown Restaurant';
          const restaurantSlug = restaurant?.slug || '';
          const count = dishes.length;

          // Sort dishes within restaurant by most recent first
          dishes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

          html += `
            <div class="restaurant-section">
              <div class="restaurant-section-header">
                <h3 class="restaurant-section-name">
                  ${restaurantSlug ? `<a href="/restaurant?slug=${encodeURIComponent(restaurantSlug)}">${escapeHtml(restaurantName)}</a>` : escapeHtml(restaurantName)}
                </h3>
                <span class="restaurant-dish-count">${count} dish${count !== 1 ? 'es' : ''}</span>
              </div>
              ${dishes.map(dish => {
                const key = getDishKey(restaurantId, dish.dish_name);
                const isLoved = lovedDishesSet.has(key);
                return renderDishItem(dish, restaurantSlug, isLoved);
              }).join('')}
            </div>
          `;
        });

        orderedDishesContainer.innerHTML = html;
        attachHandlers();

      } catch (err) {
        console.error('Failed to load ordered dishes', err);
        orderedDishesContainer.innerHTML = '<div class="status-text error">Failed to load order history.</div>';
      }
    }

    function attachHandlers() {
      // Dish item click handlers (navigate to restaurant page)
      document.querySelectorAll('.dish-item').forEach(item => {
        item.addEventListener('click', () => {
          const slug = item.dataset.restaurantSlug;
          const dishName = item.dataset.dishName;
          if (slug) {
            window.location.href = `/restaurant?slug=${encodeURIComponent(slug)}&dishName=${encodeURIComponent(dishName)}`;
          }
        });
      });
    }

    function attachUnloveHandlers() {
      document.querySelectorAll('.unlove-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const restaurantId = btn.dataset.restaurantId;
          const dishName = btn.dataset.dishName;

          if (!restaurantId || !dishName) return;

          btn.disabled = true;
          btn.textContent = 'Removing...';

          try {
            const { error } = await supabaseClient
              .from('user_loved_dishes')
              .delete()
              .eq('user_id', currentUser.id)
              .eq('restaurant_id', restaurantId)
              .eq('dish_name', dishName);

            if (error) throw error;

            // Remove from local set
            lovedDishesSet.delete(getDishKey(restaurantId, dishName));

            // Remove the dish item from DOM
            const dishItem = btn.closest('.dish-item');
            const restaurantSection = dishItem.closest('.restaurant-section');
            dishItem.remove();

            // Check if restaurant section is now empty
            const remainingDishes = restaurantSection.querySelectorAll('.dish-item');
            if (remainingDishes.length === 0) {
              restaurantSection.remove();
            } else {
              // Update the dish count
              const countEl = restaurantSection.querySelector('.restaurant-dish-count');
              if (countEl) {
                const count = remainingDishes.length;
                countEl.textContent = `${count} dish${count !== 1 ? 'es' : ''}`;
              }
            }

            // Check if no loved dishes remain
            if (lovedDishesContainer.querySelectorAll('.dish-item').length === 0) {
              lovedDishesContainer.innerHTML = `
                <div class="empty-state">
                  <p style="font-size:1.1rem;margin-bottom:8px;">No favorite dishes yet</p>
                  <p style="margin-bottom:16px;">Click the heart icon on any dish to save it!</p>
                  <a href="/dish-search" style="color:var(--accent);text-decoration:none;">Search for dishes →</a>
                </div>
              `;
            }

            setStatus('Dish removed from favorites', 'success');
          } catch (err) {
            console.error('Failed to unlove dish', err);
            setStatus('Failed to remove dish', 'error');
            btn.disabled = false;
            btn.innerHTML = `
              <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
              Remove
            `;
          }
        });
      });
    }

    async function checkAuth() {
      const { data: { user } } = await supabaseClient.auth.getUser();

      if (!user) {
        window.location.href = '/account';
        return;
      }

      const OWNER_EMAIL = 'matt.29.ds@gmail.com';
      const isOwner = user.email === OWNER_EMAIL;
      const isManager = user.user_metadata?.role === 'manager';

      let managerRestaurants = [];
      if (isManager || isOwner) {
        managerRestaurants = await fetchManagerRestaurants(supabaseClient, user.id);
      }

      if (isManager && !isOwner) {
        const targetRestaurant = managerRestaurants[0];
        window.location.href = targetRestaurant
          ? `/restaurant?slug=${encodeURIComponent(targetRestaurant.slug)}`
          : '/server-tablet';
        return;
      }

      currentUser = user;
      setupTopbar('my-dishes', user, { managerRestaurants });
      await Promise.all([
        loadLovedDishes(),
        loadPreviouslyOrderedDishes()
      ]);
    }

    // Initialize page
    checkAuth();
