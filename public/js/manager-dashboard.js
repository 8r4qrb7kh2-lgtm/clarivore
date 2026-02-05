    import supabaseClient from './supabase-client.js';
    import { setupTopbar } from './shared-nav.js';
    import { fetchManagerRestaurants } from './manager-context.js';
    import { initManagerNotifications } from './manager-notifications.js';
    import { notifyManagerChat } from './chat-notifications.js';

    const allergenConfig = window.loadAllergenDietConfig
      ? await window.loadAllergenDietConfig({ supabaseClient })
      : (window.ALLERGEN_DIET_CONFIG || {});

    // State
    let currentUser = null;
    let managedRestaurants = [];
    let selectedRestaurantId = null;
    let dishAnalytics = [];
    let accommodationRequests = [];
    let currentRequestId = null;
    let currentRestaurantData = null; // For menu image and overlays
    let recentChangeLogs = []; // Recent change log entries
    let recentChatMessages = []; // Direct chat preview messages
    let chatReadState = { admin: null, restaurant: null };
    let chatUnreadCount = 0;
    let currentHeatmapPage = 0; // Current page index for menu heatmap
    let currentHeatmapMetric = 'views'; // views, loves, or orders
    let dishLoves = {}; // Dish name -> love count
    let dishOrders = {}; // Dish name -> order count
    let rawInteractions = []; // Raw dish_interactions for full profile data
    let rawLoves = []; // Raw user_loved_dishes for filtering
    let userLovedSet = new Set(); // Set of user_ids who loved dishes
    let userOrderCounts = {}; // Map user_id -> number of order visits
    let brandItemsCache = [];
    let activeBrandReplaceItem = null;
    let brandItemsSearchQuery = '';

    // DOM Elements
    const loadingState = document.getElementById('loading-state');
    const authRequired = document.getElementById('auth-required');
    const notManager = document.getElementById('not-manager');
    const dashboardContent = document.getElementById('dashboard-content');
    const restaurantSelect = document.getElementById('restaurant-select');
    const restaurantSelectorContainer = document.getElementById('restaurant-selector-container');
    const brandItemsSearchInput = document.getElementById('brand-items-search');

    const OWNER_EMAIL = 'matt.29.ds@gmail.com';
    const ADMIN_DISPLAY_NAME = 'Matt D (clarivore administrator)';
    const AUTO_ALERT_SENDER = 'Automated alert system';
    const CONFIRM_REMINDER_DAYS = new Set([7, 3, 2, 1]);
    const sentReminderKeys = new Set();
    const ALLERGENS = Array.isArray(allergenConfig.ALLERGENS) ? allergenConfig.ALLERGENS : [];
    const DIETS = Array.isArray(allergenConfig.DIETS) ? allergenConfig.DIETS : [];
    const ALLERGEN_EMOJI =
      allergenConfig.ALLERGEN_EMOJI && typeof allergenConfig.ALLERGEN_EMOJI === 'object'
        ? allergenConfig.ALLERGEN_EMOJI
        : {};
    const DIET_EMOJI =
      allergenConfig.DIET_EMOJI && typeof allergenConfig.DIET_EMOJI === 'object'
        ? allergenConfig.DIET_EMOJI
        : {};
    const normalizeAllergen = typeof allergenConfig.normalizeAllergen === 'function'
      ? allergenConfig.normalizeAllergen
      : (value) => {
          const raw = String(value ?? '').trim();
          if (!raw) return '';
          if (!ALLERGENS.length) return raw;
          return ALLERGENS.includes(raw) ? raw : '';
        };
    const normalizeDietLabel = typeof allergenConfig.normalizeDietLabel === 'function'
      ? allergenConfig.normalizeDietLabel
      : (value) => {
          const raw = String(value ?? '').trim();
          if (!raw) return '';
          if (!DIETS.length) return raw;
          return DIETS.includes(raw) ? raw : '';
        };
    const formatAllergenLabel = typeof allergenConfig.formatAllergenLabel === 'function'
      ? allergenConfig.formatAllergenLabel
      : (value) => String(value || '');
    let allergenMetricKeys = {};
    const resolveAllergenMetricKeys = (row) => {
      if (Object.keys(allergenMetricKeys).length > 0) return allergenMetricKeys;
      if (!row || typeof row !== 'object') return allergenMetricKeys;
      const prefix = 'users_with_';
      const suffix = '_allergy';
      Object.keys(row).forEach((key) => {
        if (!key.startsWith(prefix) || !key.endsWith(suffix)) return;
        const raw = key.slice(prefix.length, -suffix.length).replace(/_/g, ' ');
        const normalized = normalizeAllergen(raw);
        if (normalized && !allergenMetricKeys[normalized]) {
          allergenMetricKeys[normalized] = key;
        }
      });
      return allergenMetricKeys;
    };

    // Initialize
    async function init() {
      try {
        const { data: { user } } = await supabaseClient.auth.getUser();

        if (!user) {
          showAuthRequired();
          return;
        }

        currentUser = user;
        const isOwner = user.email === OWNER_EMAIL;
        const isManager = user.user_metadata?.role === 'manager';

        // Fetch manager restaurants for navigation
        let navRestaurants = [];
        if (isManager || isOwner) {
          navRestaurants = await fetchManagerRestaurants(supabaseClient, user.id);
        }

        const currentMode = localStorage.getItem('clarivoreManagerMode') || 'editor';
        if ((isManager || isOwner) && currentMode !== 'editor') {
          if (window.top && window.self !== window.top) {
            window.top.location.href = '/home';
          } else {
            window.location.href = '/home';
          }
          return;
        }

        setupTopbar('home', user, { managerRestaurants: navRestaurants });
        if (isManager || isOwner) {
          initManagerNotifications({ user: currentUser, client: supabaseClient });
        }

        await loadManagedRestaurants();

        restaurantSelectorContainer.style.display = isOwner ? 'block' : 'none';
      } catch (err) {
        console.error('Init error:', err);
        showAuthRequired();
      }
    }

    function showAuthRequired() {
      loadingState.style.display = 'none';
      authRequired.style.display = 'block';
      restaurantSelectorContainer.style.display = 'none';
    }

    function showNotManager() {
      loadingState.style.display = 'none';
      notManager.style.display = 'block';
      restaurantSelectorContainer.style.display = 'none';
    }

    async function loadManagedRestaurants() {
      try {
        const isOwner = currentUser.email === OWNER_EMAIL;

        let restaurants = [];

        if (isOwner) {
          // Owner can see all restaurants
          const { data, error } = await supabaseClient
            .from('restaurants')
            .select('id, name, slug')
            .order('name');

          if (error) throw error;
          restaurants = data || [];
        } else {
          // Regular managers - check restaurant_managers table
          const { data, error } = await supabaseClient
            .from('restaurant_managers')
            .select('restaurant_id, restaurants(id, name, slug)')
            .eq('user_id', currentUser.id);

          if (error) throw error;
          restaurants = (data || []).map(d => d.restaurants).filter(r => r);
        }

        if (restaurants.length === 0) {
          showNotManager();
          return;
        }

        managedRestaurants = restaurants;

        // Populate restaurant selector
        restaurantSelect.innerHTML = managedRestaurants.map(r =>
          `<option value="${r.id}">${r.name}</option>`
        ).join('');

        // Select first restaurant
        if (managedRestaurants.length > 0) {
          selectedRestaurantId = managedRestaurants[0].id;
          await loadDashboardData();
        }
      } catch (err) {
        console.error('Failed to load managed restaurants:', err);
        showNotManager();
      }
    }

    async function loadDashboardData() {
      if (!selectedRestaurantId) return;

      loadingState.style.display = 'block';
      dashboardContent.style.display = 'none';

      try {
        // Load restaurant data (for menu image, overlays, and last_confirmed)
        const { data: restaurantData, error: restaurantError } = await supabaseClient
          .from('restaurants')
          .select('id, name, slug, menu_images, menu_image, overlays, last_confirmed')
          .eq('id', selectedRestaurantId)
          .single();

        if (restaurantError) throw restaurantError;
        currentRestaurantData = restaurantData;

        // Load recent change log entries (last 3)
        const { data: changeLogData, error: changeLogError } = await supabaseClient
          .from('change_logs')
          .select('*')
          .eq('restaurant_id', selectedRestaurantId)
          .order('timestamp', { ascending: false })
          .limit(3);

        recentChangeLogs = changeLogError ? [] : (changeLogData || []);

        await loadChatMessages();

        // Load dish analytics
        const { data: analyticsData, error: analyticsError } = await supabaseClient
          .from('dish_analytics')
          .select('*')
          .eq('restaurant_id', selectedRestaurantId);

        if (analyticsError) throw analyticsError;
        dishAnalytics = analyticsData || [];
        allergenMetricKeys = {};

        // Load accommodation requests
        const { data: requestsData, error: requestsError } = await supabaseClient
          .from('accommodation_requests')
          .select('*')
          .eq('restaurant_id', selectedRestaurantId)
          .order('created_at', { ascending: false });

        if (requestsError) throw requestsError;
        accommodationRequests = requestsData || [];

        // Load raw dish_interactions for full user profile data (include dish_name for heatmap filtering)
        const { data: interactionsData, error: interactionsError } = await supabaseClient
          .from('dish_interactions')
          .select('user_id, user_allergens, user_diets, dish_name')
          .eq('restaurant_id', selectedRestaurantId);

        rawInteractions = interactionsError ? [] : (interactionsData || []);

        // Load loved dishes with user_id for filtering
        const { data: lovesData, error: lovesError } = await supabaseClient
          .from('user_loved_dishes')
          .select('user_id, dish_name')
          .eq('restaurant_id', selectedRestaurantId);

        dishLoves = {};
        userLovedSet = new Set();
        rawLoves = lovesError ? [] : (lovesData || []); // Store raw loves for filtering
        if (!lovesError && lovesData) {
          lovesData.forEach(love => {
            dishLoves[love.dish_name] = (dishLoves[love.dish_name] || 0) + 1;
            if (love.user_id) userLovedSet.add(love.user_id);
          });
        }

        // Load tablet orders with user info for filtering
        const { data: ordersData, error: ordersError } = await supabaseClient
          .from('tablet_orders')
          .select('payload')
          .eq('restaurant_id', selectedRestaurantId);

        dishOrders = {};
        userOrderCounts = {}; // Map user_id -> number of orders (visits with orders)
        if (!ordersError && ordersData) {
          ordersData.forEach(order => {
            // Extract dish names from payload
            const payload = order.payload || {};
            const dishes = payload.dishes || payload.items || [];
            if (Array.isArray(dishes)) {
              dishes.forEach(dish => {
                const dishName = typeof dish === 'string' ? dish : (dish.name || dish.dish_name || dish.id);
                if (dishName) {
                  dishOrders[dishName] = (dishOrders[dishName] || 0) + 1;
                }
              });
            }
            // Also check for single dish property
            if (payload.dish_name) {
              dishOrders[payload.dish_name] = (dishOrders[payload.dish_name] || 0) + 1;
            }
            // Track user order counts for weighting
            const userId = payload.user_id;
            if (userId) {
              userOrderCounts[userId] = (userOrderCounts[userId] || 0) + 1;
            }
          });
        }

        // Render dashboard
        renderDashboard();
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
        // Show empty state
        dishAnalytics = [];
        allergenMetricKeys = {};
        accommodationRequests = [];
        currentRestaurantData = null;
        dishLoves = {};
        dishOrders = {};
        rawInteractions = [];
        rawLoves = [];
        userLovedSet = new Set();
        userOrderCounts = {};
        recentChatMessages = [];
        chatReadState = { admin: null, restaurant: null };
        chatUnreadCount = 0;
        renderDashboard();
      }

      loadingState.style.display = 'none';
      dashboardContent.style.display = 'block';
      requestAnimationFrame(syncDashboardPanelHeights);
    }

    async function loadChatMessages() {
      if (!selectedRestaurantId) {
        recentChatMessages = [];
        chatReadState = { admin: null, restaurant: null };
        chatUnreadCount = 0;
        return;
      }

      try {
        const { data, error } = await supabaseClient
          .from('restaurant_direct_messages')
          .select('id, message, sender_role, sender_name, created_at')
          .eq('restaurant_id', selectedRestaurantId)
          .order('created_at', { ascending: false })
          .limit(6);

        if (error) throw error;
        recentChatMessages = data || [];
        await loadChatReadState();
        chatUnreadCount = await getUnreadCountForManager(chatReadState?.restaurant?.last_read_at || null);
      } catch (err) {
        console.error('Failed to load chat messages:', err);
        recentChatMessages = [];
        chatReadState = { admin: null, restaurant: null };
        chatUnreadCount = 0;
      }
    }

    async function loadChatReadState() {
      try {
        const { data, error } = await supabaseClient
          .from('restaurant_direct_message_reads')
          .select('restaurant_id, reader_role, last_read_at, acknowledged_at')
          .eq('restaurant_id', selectedRestaurantId)
          .in('reader_role', ['admin', 'restaurant']);

        if (error) throw error;
        chatReadState = { admin: null, restaurant: null };
        (data || []).forEach(row => {
          if (row.reader_role === 'admin') chatReadState.admin = row;
          if (row.reader_role === 'restaurant') chatReadState.restaurant = row;
        });
      } catch (err) {
        console.error('Failed to load chat read state:', err);
        chatReadState = { admin: null, restaurant: null };
      }
    }

    async function getUnreadCountForManager(lastReadAt) {
      try {
        let query = supabaseClient
          .from('restaurant_direct_messages')
          .select('id', { count: 'exact', head: true })
          .eq('restaurant_id', selectedRestaurantId)
          .eq('sender_role', 'admin');

        if (lastReadAt) {
          query = query.gt('created_at', lastReadAt);
        }

        const { count, error } = await query;
        if (error) throw error;
        return count || 0;
      } catch (err) {
        console.error('Failed to count unread messages:', err);
        return 0;
      }
    }

    async function maybeSendConfirmReminder({ restaurantId, restaurantSlug, daysUntilDue, nextDueDate }) {
      if (!restaurantId || !restaurantSlug || !nextDueDate) return;
      if (!CONFIRM_REMINDER_DAYS.has(daysUntilDue)) return;
      if (daysUntilDue <= 0) return;

      const dueLabel = nextDueDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
      const reminderTag = `Reminder: you have ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`;
      const reminderKey = `${restaurantId}|${dueLabel}|${daysUntilDue}`;
      if (sentReminderKeys.has(reminderKey)) return;

      try {
        const { data, error } = await supabaseClient
          .from('restaurant_direct_messages')
          .select('id')
          .eq('restaurant_id', restaurantId)
          .eq('sender_name', AUTO_ALERT_SENDER)
          .ilike('message', `%${reminderTag}%`)
          .limit(1);

        if (error) throw error;
        if (data && data.length) {
          sentReminderKeys.add(reminderKey);
          return;
        }

        const message = `${reminderTag} to confirm that your information is up-to-date or your restaurant will be temporarily suspended from Clarivore.`;

        const { data: insertedMessage, error: insertError } = await supabaseClient
          .from('restaurant_direct_messages')
          .insert({
            restaurant_id: restaurantId,
            message,
            sender_role: 'admin',
            sender_name: AUTO_ALERT_SENDER,
            sender_id: null
          })
          .select('id')
          .single();

        if (insertError) throw insertError;
        sentReminderKeys.add(reminderKey);
        if (insertedMessage?.id) {
          notifyManagerChat({ messageId: insertedMessage.id, client: supabaseClient });
        }
        await loadChatMessages();
        renderChatPreview();
      } catch (err) {
        console.error('Failed to send confirmation reminder:', err);
      }
    }

    function renderDashboard() {
      renderQuickActions();
      renderBrandItemsSection();
      renderHeatmap();
      renderMenuAccommodationBreakdown();
      renderUserDietaryProfilePieCharts();
      requestAnimationFrame(syncDashboardPanelHeights);
    }

    function syncDashboardPanelHeights() {
      const referenceBtn = document.getElementById('viewFullLogBtn');
      const referencePanel = referenceBtn ? referenceBtn.closest('.dashboard-panel') : null;
      if (!referencePanel) return;
      const height = Math.round(referencePanel.getBoundingClientRect().height);
      if (!height) return;
      document.documentElement.style.setProperty('--dashboard-panel-height', `${height}px`);
    }

    function renderQuickActions() {
      const getChangeText = (change) => {
        if (typeof change === 'string') return change;
        if (change && typeof change === 'object') {
          if (typeof change.text === 'string') return change.text;
          if (change.text && typeof change.text.text === 'string') return change.text.text;
          if (typeof change.label === 'string') return change.label;
          if (typeof change.message === 'string') return change.message;
          if (change.details && typeof change.details.ingredient === 'string') {
            return `Ingredient update: ${change.details.ingredient}`;
          }
        }
        return '';
      };

      // Render recent changes
      const changesList = document.getElementById('recent-changes-list');
      if (changesList) {
        if (recentChangeLogs.length === 0) {
          changesList.innerHTML = '<div class="no-changes-message">No changes recorded yet</div>';
        } else {
          let html = '';
          recentChangeLogs.forEach(log => {
            const timestamp = log.timestamp ? new Date(log.timestamp).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
            }) : '';

            // Parse changes to get full details
            let author = 'Unknown';
            let detailsHtml = '';
            if (log.changes) {
              const parsed = typeof log.changes === 'string' ?
                (() => { try { return JSON.parse(log.changes); } catch(e) { return null; } })() : log.changes;
              if (parsed && parsed.author) author = parsed.author;

              // Build detailed view from items
              if (parsed?.items && Object.keys(parsed.items).length > 0) {
                for (const [dishName, changes] of Object.entries(parsed.items)) {
                  detailsHtml += `<div class="recent-change-dish">${escapeHtml(dishName)}</div>`;
                  if (Array.isArray(changes) && changes.length > 0) {
                    detailsHtml += '<ul class="recent-change-list">';
                    changes.forEach(change => {
                      const changeText = getChangeText(change);
                      if (changeText) {
                        detailsHtml += `<li>${escapeHtml(changeText)}</li>`;
                      }
                    });
                    detailsHtml += '</ul>';
                  }
                }
              }

              // Add general changes if any
              if (parsed?.general && parsed.general.length > 0) {
                if (detailsHtml) {
                  detailsHtml += '<div class="recent-change-general">';
                }
                detailsHtml += '<ul class="recent-change-list">';
                parsed.general.forEach(change => {
                  const changeText = getChangeText(change);
                  if (changeText) {
                    detailsHtml += `<li>${escapeHtml(changeText)}</li>`;
                  }
                });
                detailsHtml += '</ul>';
                if (parsed?.items && Object.keys(parsed.items).length > 0) {
                  detailsHtml += '</div>';
                }
              }

              if (!detailsHtml) {
                detailsHtml = '<span style="color:var(--muted)">Menu updated</span>';
              }
            }

            html += `
              <div class="recent-change-item">
                <div class="recent-change-header">
                  <span class="recent-change-author">${escapeHtml(author)}</span>
                  <span class="recent-change-time">${escapeHtml(timestamp)}</span>
                </div>
                <div class="recent-change-details">${detailsHtml}</div>
              </div>
            `;
          });
          changesList.innerHTML = html;
        }
      }

      // Render confirmation status
      const confirmStatus = document.getElementById('confirmation-status');
      if (confirmStatus && currentRestaurantData) {
        const lastConfirmed = currentRestaurantData.last_confirmed ? new Date(currentRestaurantData.last_confirmed) : null;
        const now = new Date();

        let dueDateClass, dueText;
        let nextDue = null;
        let daysUntilDue = null;
        if (!lastConfirmed) {
          dueText = 'Never confirmed';
          dueDateClass = 'overdue';
        } else {
          // Calculate next due date as 1 month from last confirmed
          nextDue = new Date(lastConfirmed);
          nextDue.setMonth(nextDue.getMonth() + 1);
          daysUntilDue = Math.ceil((nextDue - now) / (24 * 60 * 60 * 1000));

          if (daysUntilDue < 0) {
            dueText = `${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) > 1 ? 's' : ''} overdue`;
            dueDateClass = 'overdue';
          } else if (daysUntilDue <= 7) {
            dueText = daysUntilDue === 0 ? 'Due today' : `Due in ${daysUntilDue} day${daysUntilDue > 1 ? 's' : ''}`;
            dueDateClass = 'soon';
          } else {
            dueText = `Due in ${daysUntilDue} days`;
            dueDateClass = 'ok';
          }
        }

        const lastConfirmedText = lastConfirmed ?
          `Last confirmed: ${lastConfirmed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` :
          'Never confirmed';

        confirmStatus.innerHTML = `
          <div class="confirmation-info">
            <div class="confirmation-due-label">Next confirmation due</div>
            <div class="confirmation-due-date ${dueDateClass}">${dueText}</div>
            <div class="confirmation-last">${lastConfirmedText}</div>
            <button class="btn btnPrimary" id="confirmNowBtn">Confirm information is up-to-date</button>
          </div>
        `;

        if (nextDue && typeof daysUntilDue === 'number') {
          maybeSendConfirmReminder({
            restaurantId: selectedRestaurantId,
            restaurantSlug: currentRestaurantData.slug,
            daysUntilDue,
            nextDueDate: nextDue
          });
        }

        // Add click handler for confirm button
        const confirmBtn = document.getElementById('confirmNowBtn');
        if (confirmBtn) {
          confirmBtn.onclick = async () => {
            const slug = currentRestaurantData?.slug;
            if (!slug) return;
            const params = new URLSearchParams({
              slug: slug,
              edit: '1',
              openConfirm: '1'
            });
            window.location.href = `restaurant.html?${params.toString()}`;
          };
        }
      }

      renderChatPreview();

      // View full log button
      const viewLogBtn = document.getElementById('viewFullLogBtn');
      if (viewLogBtn && currentRestaurantData) {
        viewLogBtn.onclick = () => {
          const slug = currentRestaurantData.slug;
          if (slug) {
            window.location.href = `restaurant.html?slug=${encodeURIComponent(slug)}&edit=1&openLog=1`;
          }
        };
      }
    }

    function formatChatTimestamp(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    }

    function renderChatPreview() {
      const chatList = document.getElementById('chat-preview-list');
      if (!chatList) return;

      if (recentChatMessages.length === 0) {
        chatList.innerHTML = '<div class="chat-preview-empty">No messages yet</div>';
      } else {
        const messages = recentChatMessages.slice().reverse();
        const lastIndexByRole = { admin: -1, restaurant: -1 };
        messages.forEach((message, index) => {
          if (message.sender_role === 'admin') lastIndexByRole.admin = index;
          if (message.sender_role === 'restaurant') lastIndexByRole.restaurant = index;
        });

        const findAckIndex = (targetRole, acknowledgedAt) => {
          const ackTime = new Date(acknowledgedAt).getTime();
          if (Number.isNaN(ackTime)) return -1;
          let idx = -1;
          messages.forEach((message, index) => {
            if (message.sender_role !== targetRole) return;
            const msgTime = new Date(message.created_at).getTime();
            if (!Number.isNaN(msgTime) && msgTime <= ackTime) {
              idx = index;
            }
          });
          return idx;
        };

        const ackEntries = [];
        if (chatReadState?.admin?.acknowledged_at) {
          const ackIndex = findAckIndex('restaurant', chatReadState.admin.acknowledged_at);
          if (ackIndex >= 0) {
            ackEntries.push({
              index: ackIndex,
              name: ADMIN_DISPLAY_NAME,
              acknowledgedAt: chatReadState.admin.acknowledged_at
            });
          }
        }
        if (chatReadState?.restaurant?.acknowledged_at) {
          const ackIndex = findAckIndex('admin', chatReadState.restaurant.acknowledged_at);
          if (ackIndex >= 0) {
            const restaurantAckName = getManagerDisplayName();
            ackEntries.push({
              index: ackIndex,
              name: restaurantAckName,
              acknowledgedAt: chatReadState.restaurant.acknowledged_at
            });
          }
        }

        const messageHtml = messages.map((message, index) => {
          const isOutgoing = message.sender_role === 'restaurant';
          const rawSenderName = (message.sender_name || '').trim();
          const senderLabel = isOutgoing
            ? (rawSenderName && rawSenderName.toLowerCase() !== 'you' ? rawSenderName : getManagerDisplayName())
            : (rawSenderName || ADMIN_DISPLAY_NAME);
          const timestamp = formatChatTimestamp(message.created_at);
          const appendAck = ackEntries
            .filter(entry => entry.index === index)
            .map(entry => {
              const ackTimestamp = formatChatTimestamp(entry.acknowledgedAt);
              if (!ackTimestamp) return '';
              return `<div class="chat-ack">${escapeHtml(entry.name)} acknowledged · ${escapeHtml(ackTimestamp)}</div>`;
            })
            .join('');
          return `
            <div class="chat-preview-item ${isOutgoing ? 'outgoing' : 'incoming'}">
              <div>${formatChatMessage(message.message)}</div>
              <div class="chat-preview-meta">${escapeHtml(senderLabel)}${timestamp ? ` · ${escapeHtml(timestamp)}` : ''}</div>
            </div>
            ${appendAck}
          `;
        }).join('');

        chatList.innerHTML = messageHtml;
      }

      const badge = document.getElementById('chat-unread-badge');
      if (badge) {
        if (chatUnreadCount > 0) {
          badge.textContent = chatUnreadCount;
          badge.style.display = 'inline-flex';
        } else {
          badge.style.display = 'none';
        }
      }

      const ackBtn = document.getElementById('chat-ack-btn');
      if (ackBtn) {
        ackBtn.style.display = chatUnreadCount > 0 ? 'inline-flex' : 'none';
        ackBtn.onclick = () => acknowledgeChat();
      }

      const sendBtn = document.getElementById('chat-send-btn');
      if (sendBtn) {
        sendBtn.onclick = () => sendChatMessage();
      }

      const input = document.getElementById('chat-message-input');
      if (input) {
        input.onkeydown = (event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendChatMessage();
          }
        };
      }

      requestAnimationFrame(() => {
        chatList.scrollTop = chatList.scrollHeight;
      });
    }

    async function sendChatMessage() {
      const input = document.getElementById('chat-message-input');
      if (!input || !selectedRestaurantId) return;
      const message = input.value.trim();
      if (!message) return;

      const sendBtn = document.getElementById('chat-send-btn');
      input.disabled = true;
      if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending...';
      }

      try {
        const senderName = getManagerDisplayName();
        const { error } = await supabaseClient
          .from('restaurant_direct_messages')
          .insert({
            restaurant_id: selectedRestaurantId,
            message,
            sender_role: 'restaurant',
            sender_name: senderName,
            sender_id: currentUser?.id || null
          });

        if (error) throw error;

        input.value = '';
        await loadChatMessages();
        renderChatPreview();
      } catch (err) {
        console.error('Failed to send chat message:', err);
        alert('Failed to send message. Please try again.');
      } finally {
        input.disabled = false;
        if (sendBtn) {
          sendBtn.disabled = false;
          sendBtn.textContent = 'Send';
        }
        input.focus();
      }
    }

    function getManagerDisplayName() {
      const user = currentUser || {};
      const meta = user.user_metadata || {};
      const rawMeta = user.raw_user_meta_data || {};
      const first = (meta.first_name || rawMeta.first_name || '').trim();
      const last = (meta.last_name || rawMeta.last_name || '').trim();
      const combined = `${first} ${last}`.trim();
      const fallbackEmail = user.email
        ? user.email.split('@')[0].replace(/[._]+/g, ' ').trim()
        : '';
      return (
        combined ||
        (meta.full_name || rawMeta.full_name || '').trim() ||
        (meta.name || rawMeta.name || '').trim() ||
        (meta.display_name || rawMeta.display_name || '').trim() ||
        fallbackEmail ||
        'Manager'
      );
    }

    async function acknowledgeChat() {
      if (!selectedRestaurantId) return;
      const now = new Date().toISOString();
      try {
        const { error } = await supabaseClient
          .from('restaurant_direct_message_reads')
          .upsert({
            restaurant_id: selectedRestaurantId,
            reader_role: 'restaurant',
            last_read_at: now,
            acknowledged_at: now
          }, { onConflict: 'restaurant_id,reader_role' });

        if (error) throw error;

        chatReadState = {
          ...(chatReadState || { admin: null, restaurant: null }),
          restaurant: {
            restaurant_id: selectedRestaurantId,
            reader_role: 'restaurant',
            last_read_at: now,
            acknowledged_at: now
          }
        };
        chatUnreadCount = 0;
        renderChatPreview();
      } catch (err) {
        console.error('Failed to acknowledge chat:', err);
        alert('Failed to acknowledge messages. Please try again.');
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text || '';
      return div.innerHTML;
    }

    function formatChatMessage(text) {
      const raw = (text || '').toString();
      const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
      const buildLink = (url, label) => {
        let href = url;
        let target = ' target="_blank" rel="noopener noreferrer"';
        try {
          const parsed = new URL(url, window.location.origin);
          const isSameOrigin = parsed.origin === window.location.origin;
          const isClarivore = parsed.hostname.endsWith('clarivore.org');
          if (isSameOrigin || isClarivore) {
            href = `${parsed.pathname}${parsed.search}${parsed.hash}`;
            target = '';
          }
        } catch (_) {
          // fallback to raw url
        }
        return `<a href="${escapeHtml(href)}"${target}>${label}</a>`;
      };
      const linkify = (value) =>
        value.replace(/((?:https?:|capacitor):\/\/[^\s<]+)/g, (match) =>
          buildLink(match, escapeHtml(match))
        );
      let html = '';
      let lastIndex = 0;
      let match;
      while ((match = linkRegex.exec(raw)) !== null) {
        const before = raw.slice(lastIndex, match.index);
        html += linkify(escapeHtml(before));
        const label = escapeHtml(match[1]);
        html += buildLink(match[2], label);
        lastIndex = match.index + match[0].length;
      }
      html += linkify(escapeHtml(raw.slice(lastIndex)));
      return html;
    }

    function normalizeBrandKey(value) {
      return (value || '').toString().trim().toLowerCase();
    }

    function collectBrandItemsFromOverlays(overlays) {
      const items = new Map();
      (overlays || []).forEach((overlay, overlayIdx) => {
        const dishName = overlay?.id || overlay?.name || overlay?.dish_name || 'Unnamed dish';
        let ingredients = [];

        if (overlay?.aiIngredients) {
          try {
            ingredients = JSON.parse(overlay.aiIngredients);
          } catch (err) {
            console.error('Failed to parse aiIngredients in dashboard:', err);
          }
        }

        if (!ingredients.length && Array.isArray(overlay?.ingredients)) {
          ingredients = overlay.ingredients;
        }

        ingredients.forEach((ingredient) => {
          if (!ingredient?.name || !Array.isArray(ingredient.brands)) return;
          ingredient.brands.forEach((brand) => {
            if (!brand?.name) return;

            const barcodeKey = normalizeBrandKey(brand.barcode);
            const nameKey = normalizeBrandKey(brand.name);
            const key = barcodeKey ? `barcode:${barcodeKey}` : `name:${nameKey}`;
            if (!key) return;

            if (!items.has(key)) {
              items.set(key, {
                key,
                brandName: brand.name,
                barcode: brand.barcode || '',
                brandImage: brand.brandImage || brand.image || '',
                ingredientsList: Array.isArray(brand.ingredientsList)
                  ? brand.ingredientsList
                  : (brand.ingredientList ? [brand.ingredientList] : []),
                allergens: new Set(Array.isArray(brand.allergens) ? brand.allergens : []),
                diets: new Set(Array.isArray(brand.diets) ? brand.diets : []),
                ingredientNames: new Set(),
                dishIngredients: new Map(),
                dishes: new Set(),
                overlayIndices: new Set()
              });
            }

            const item = items.get(key);
            if (ingredient.name) item.ingredientNames.add(ingredient.name);
            if (dishName) item.dishes.add(dishName);
            if (dishName && ingredient.name) {
              if (!item.dishIngredients.has(dishName)) {
                item.dishIngredients.set(dishName, new Set());
              }
              item.dishIngredients.get(dishName).add(ingredient.name);
            }
            if (typeof overlayIdx === 'number') item.overlayIndices.add(overlayIdx);
            if (!item.brandImage && (brand.brandImage || brand.image)) {
              item.brandImage = brand.brandImage || brand.image;
            }
            if (Array.isArray(brand.allergens)) {
              brand.allergens.forEach(a => item.allergens.add(a));
            }
            if (Array.isArray(brand.diets)) {
              brand.diets.forEach(d => item.diets.add(d));
            }
            if (Array.isArray(brand.ingredientsList)) {
              brand.ingredientsList.forEach(entry => {
                if (entry && !item.ingredientsList.includes(entry)) {
                  item.ingredientsList.push(entry);
                }
              });
            } else if (brand.ingredientList && !item.ingredientsList.includes(brand.ingredientList)) {
              item.ingredientsList.push(brand.ingredientList);
            }
          });
        });
      });

      return Array.from(items.values())
        .map(item => ({
          ...item,
          allergens: Array.from(item.allergens),
          diets: Array.from(item.diets),
          ingredientNames: Array.from(item.ingredientNames),
          dishIngredients: Array.from(item.dishIngredients.entries()).reduce((acc, [dish, ingredients]) => {
            acc[dish] = Array.from(ingredients);
            return acc;
          }, {}),
          dishes: Array.from(item.dishes),
          overlayIndices: Array.from(item.overlayIndices)
        }))
        .sort((a, b) => a.brandName.localeCompare(b.brandName));
    }

    function renderBrandItemsSection() {
      const list = document.getElementById('brand-items-list');
      if (!list) return;

      if (!currentRestaurantData || !Array.isArray(currentRestaurantData.overlays)) {
        list.innerHTML = '<div class="chat-preview-empty">Select a restaurant to view brand items.</div>';
        return;
      }

      brandItemsCache = collectBrandItemsFromOverlays(currentRestaurantData.overlays);

      if (!brandItemsCache.length) {
        list.innerHTML = '<div class="chat-preview-empty">No brand items found yet.</div>';
        return;
      }

      const query = (brandItemsSearchQuery || '').trim().toLowerCase();
      const filteredItems = query
        ? brandItemsCache.filter(item => {
          const haystack = [
            item.brandName,
            ...(item.ingredientNames || []),
            ...(item.dishes || [])
          ].join(' ').toLowerCase();
          return haystack.includes(query);
        })
        : brandItemsCache;

      if (!filteredItems.length) {
        list.innerHTML = '<div class="chat-preview-empty">No brand items match your search.</div>';
        return;
      }

      const renderTags = (items, emptyLabel) => {
        if (!items.length) {
          return `<span class="brand-tag" style="opacity:0.7">${escapeHtml(emptyLabel)}</span>`;
        }
        return items.map(item => `<span class="brand-tag">${escapeHtml(item)}</span>`).join('');
      };

      const renderDishList = (dishes, dishIngredients) => {
        if (!dishes.length) {
          return `<div class="brand-item-empty">No dishes listed</div>`;
        }
        return dishes.map(dishName => {
          const ingredientsForDish = dishIngredients && dishIngredients[dishName]
            ? dishIngredients[dishName]
            : [];
          const ingredientName = ingredientsForDish.length ? ingredientsForDish[0] : '';
          return `
            <div class="brand-item-dish-entry">
              <span class="brand-tag brand-item-dish-name">${escapeHtml(dishName)}</span>
              <button class="btn brand-item-dish-link" type="button" data-action="open-dish-editor" data-dish-name="${escapeHtml(dishName)}" data-ingredient-name="${escapeHtml(ingredientName)}">Open &#x2197;</button>
            </div>
          `;
        }).join('');
      };

      list.innerHTML = filteredItems.map((item, index) => {
        const ingredientLabel = item.ingredientNames.length
          ? `Ingredients: ${item.ingredientNames.join(', ')}`
          : 'Ingredient details unavailable';
        const dishCount = item.dishes.length;
        return `
          <div class="brand-item-card" data-expanded="false">
            <div class="brand-item-summary">
              <img class="brand-item-thumb" src="${escapeHtml(item.brandImage || 'https://static.wixstatic.com/media/945e9d_2b97098295d341d493e4a07d80d6b57c~mv2.png')}" alt="${escapeHtml(item.brandName)}">
              <div class="brand-item-meta">
                <p class="brand-item-name">${escapeHtml(item.brandName)}</p>
                <div class="brand-item-subtitle">${escapeHtml(ingredientLabel)}</div>
                <div class="brand-item-subtitle">${dishCount} dish${dishCount === 1 ? '' : 'es'}</div>
              </div>
            </div>
            <div class="brand-item-details">
              <div class="brand-item-details-row">
                <div>
                  <div class="brand-item-subtitle" style="margin-bottom:6px;">Allergens</div>
                  <div class="brand-item-tags">${renderTags(item.allergens, 'No allergens listed')}</div>
                </div>
                <div>
                  <div class="brand-item-subtitle" style="margin-bottom:6px;">Diets</div>
                  <div class="brand-item-tags">${renderTags(item.diets, 'No diets listed')}</div>
                </div>
              </div>
              <div>
                <div class="brand-item-subtitle" style="margin-bottom:6px;">Dishes using this item</div>
                <div class="brand-item-dish-list">${renderDishList(item.dishes, item.dishIngredients || {})}</div>
              </div>
              <div class="brand-item-actions">
                <button class="btn btnPrimary" data-action="replace-brand" data-index="${index}">Replace item</button>
              </div>
            </div>
            <button class="btn brand-item-more" type="button" data-action="toggle-brand" data-index="${index}">More options</button>
          </div>
        `;
      }).join('');

      list.querySelectorAll('[data-action="replace-brand"]').forEach(btn => {
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const idx = Number(btn.dataset.index);
          const item = filteredItems[idx];
          if (item) {
            openBrandReplaceModal(item);
          }
        });
      });
      list.querySelectorAll('[data-action="toggle-brand"]').forEach(btn => {
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const idx = Number(btn.dataset.index);
          const cards = list.querySelectorAll('.brand-item-card');
          const card = Number.isNaN(idx) ? null : cards[idx];
          if (!card) return;
          const isExpanded = card.dataset.expanded === 'true';
          card.dataset.expanded = isExpanded ? 'false' : 'true';
          btn.textContent = isExpanded ? 'More options' : 'Minimize';
          if (!isExpanded) {
            card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        });
      });

      list.querySelectorAll('[data-action="open-dish-editor"]').forEach(btn => {
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const slug = currentRestaurantData?.slug || '';
          const dishName = btn.dataset.dishName || '';
          const ingredientName = btn.dataset.ingredientName || '';
          if (!slug || !dishName) return;
          const params = new URLSearchParams({
            slug: slug,
            edit: '1',
            openAI: 'true',
            dishName: dishName
          });
          if (ingredientName) params.set('ingredientName', ingredientName);
          window.location.href = `restaurant.html?${params.toString()}`;
        });
      });
    }

    async function applyBrandReplacementFromCapture(result) {
      if (!activeBrandReplaceItem || !selectedRestaurantId) return;
      const ingredientText = (result?.ingredientText || '').trim();
      const newBrandName = (result?.productName || '').trim() || activeBrandReplaceItem.brandName || 'New brand item';

      const newBrand = {
        name: newBrandName,
        barcode: '',
        brandImage: result?.brandImage || '',
        image: '',
        ingredientsImage: result?.ingredientsImage || '',
        ingredientsList: ingredientText ? [ingredientText] : [],
        ingredientList: ingredientText,
        allergens: Array.isArray(result?.allergens) ? result.allergens : [],
        crossContamination: Array.isArray(result?.crossContamination) ? result.crossContamination : [],
        diets: Array.isArray(result?.diets) ? result.diets : [],
        crossContaminationDiets: Array.isArray(result?.crossContaminationDiets) ? result.crossContaminationDiets : []
      };

      try {
        const updatedOverlays = replaceBrandInOverlays(currentRestaurantData?.overlays || [], activeBrandReplaceItem, newBrand);
        const { error } = await supabaseClient
          .from('restaurants')
          .update({ overlays: updatedOverlays })
          .eq('id', selectedRestaurantId);

        if (error) throw error;
        if (currentRestaurantData) {
          currentRestaurantData.overlays = updatedOverlays;
        }
        renderBrandItemsSection();
        activeBrandReplaceItem = null;
      } catch (err) {
        console.error('Failed to replace brand item:', err);
        alert('Failed to replace the brand item. Please try again.');
      }
    }

    function openBrandReplaceModal(item) {
      activeBrandReplaceItem = item;
      if (!activeBrandReplaceItem) return;
      if (typeof window.showIngredientPhotoUploadModal !== 'function') {
        alert('Ingredient capture is still loading. Please try again in a moment.');
        return;
      }
      const ingredientLabel = (activeBrandReplaceItem.ingredientNames || []).filter(Boolean)[0]
        || activeBrandReplaceItem.brandName
        || 'Brand item';
      window.showIngredientPhotoUploadModal(ingredientLabel, {
        inlineResults: true,
        skipRowUpdates: true,
        onApplyResults: applyBrandReplacementFromCapture
      });
    }

    function normalizeTagList(list, normalizer) {
      const seen = new Set();
      return (Array.isArray(list) ? list : [])
        .map(value => String(value ?? '').trim())
        .map(value => normalizer ? normalizer(value) : value)
        .filter(Boolean)
        .filter((value) => {
          if (seen.has(value)) return false;
          seen.add(value);
          return true;
        });
    }

    function applyBrandDetections(ingredient, newBrand) {
      const brandAllergens = normalizeTagList(newBrand?.allergens, normalizeAllergen);
      const brandDiets = normalizeTagList(newBrand?.diets, normalizeDietLabel);
      const brandCrossContamination = normalizeTagList(
        newBrand?.crossContamination,
        normalizeAllergen,
      );
      const brandCrossContaminationDiets = normalizeTagList(
        newBrand?.crossContaminationDiets,
        normalizeDietLabel,
      );
      ingredient.allergens = brandAllergens.slice();
      ingredient.diets = brandDiets.slice();
      ingredient.crossContamination = brandCrossContamination.slice();
      ingredient.crossContaminationDiets = brandCrossContaminationDiets.slice();
      ingredient.aiDetectedAllergens = brandAllergens.slice();
      ingredient.aiDetectedDiets = brandDiets.slice();
      ingredient.aiDetectedCrossContamination = brandCrossContamination.slice();
      ingredient.aiDetectedCrossContaminationDiets = brandCrossContaminationDiets.slice();
    }

    function replaceBrandInOverlays(overlays, oldItem, newBrand) {
      const updatedOverlays = JSON.parse(JSON.stringify(overlays || []));
      const oldBarcode = normalizeBrandKey(oldItem?.barcode);
      const oldName = normalizeBrandKey(oldItem?.brandName);

      updatedOverlays.forEach((overlay) => {
        let ingredients = [];
        let hasAiIngredients = false;
        if (overlay?.aiIngredients) {
          try {
            ingredients = JSON.parse(overlay.aiIngredients);
            hasAiIngredients = true;
          } catch (err) {
            console.error('Failed to parse aiIngredients in replacement:', err);
          }
        }

        if (!ingredients.length && Array.isArray(overlay?.ingredients)) {
          ingredients = overlay.ingredients;
        }

        if (!ingredients.length) return;

        let updated = false;
        ingredients.forEach((ingredient) => {
          if (!Array.isArray(ingredient.brands)) return;
          let replacedInIngredient = false;
          ingredient.brands = ingredient.brands.map((brand) => {
            const brandBarcode = normalizeBrandKey(brand?.barcode);
            const brandName = normalizeBrandKey(brand?.name);
            const matches = oldBarcode
              ? brandBarcode === oldBarcode
              : brandName && brandName === oldName;
            if (matches) {
              updated = true;
              replacedInIngredient = true;
              return { ...newBrand };
            }
            return brand;
          });
          if (replacedInIngredient) {
            applyBrandDetections(ingredient, newBrand);
          }
        });

        if (updated) {
          if (hasAiIngredients || overlay?.aiIngredients) {
            overlay.aiIngredients = JSON.stringify(ingredients);
          }
          if (Array.isArray(overlay?.ingredients)) {
            overlay.ingredients = ingredients;
          }
        }
      });

      return updatedOverlays;
    }

    function renderMenuAccommodationBreakdown() {
      const container = document.getElementById('menu-accommodation-breakdown');
      const allergenContainer = document.getElementById('menu-allergen-breakdown');
      const dietContainer = document.getElementById('menu-diet-breakdown');

      const overlays = currentRestaurantData?.overlays || [];

      if (overlays.length === 0) {
        container.style.display = 'none';
        return;
      }

      container.style.display = 'block';

      // Define all allergens and diets to track
      const allAllergens = ALLERGENS;
      const allDiets = DIETS;

      // Build a map of dish name -> overlay data for quick lookup
      const dishOverlayMap = {};
      overlays.forEach(overlay => {
        const name = (overlay.name || overlay.id || '').toLowerCase();
        if (name) dishOverlayMap[name] = overlay;
      });

      // DISH STATS: Count dishes for each allergen/diet
      const allergenDishStats = {};
      allAllergens.forEach(allergen => {
        allergenDishStats[allergen] = { safe: 0, accommodated: 0, cannot: 0 };
      });

      const dietDishStats = {};
      allDiets.forEach(diet => {
        dietDishStats[diet] = { safe: 0, cannot: 0 };
      });

      const totalDishes = overlays.length;

      overlays.forEach(overlay => {
        const dishAllergens = (overlay.allergens || [])
          .map(normalizeAllergen)
          .filter(Boolean);
        const removableList = overlay.removable || [];
        const removableAllergens = removableList
          .map(r => normalizeAllergen(r.allergen || ''))
          .filter(Boolean);
        const dishDiets = new Set(
          (overlay.diets || []).map(normalizeDietLabel).filter(Boolean)
        );

        // Tally allergen stats for each allergen
        allAllergens.forEach(allergen => {
          if (!dishAllergens.includes(allergen)) {
            allergenDishStats[allergen].safe++;
          } else if (removableAllergens.includes(allergen)) {
            allergenDishStats[allergen].accommodated++;
          } else {
            allergenDishStats[allergen].cannot++;
          }
        });

        // Tally diet stats
        allDiets.forEach(diet => {
          if (dishDiets.has(diet)) {
            dietDishStats[diet].safe++;
          } else {
            dietDishStats[diet].cannot++;
          }
        });
      });

      // VIEW STATS: Count views based on user restrictions
      const allergenViewStats = {};
      allAllergens.forEach(allergen => {
        allergenViewStats[allergen] = { noConflict: 0, accommodated: 0, cannot: 0 };
      });

      const dietViewStats = {};
      allDiets.forEach(diet => {
        dietViewStats[diet] = { noConflict: 0, cannot: 0 };
      });

      // Process each interaction to calculate view stats
      let categorizedViewCount = 0;
      rawInteractions.forEach(interaction => {
        const dishName = (interaction.dish_name || '').toLowerCase();
        const overlay = dishOverlayMap[dishName];
        if (!overlay) return;
        categorizedViewCount++;

        const userAllergens = (interaction.user_allergens || [])
          .map(normalizeAllergen)
          .filter(Boolean);
        const userDiets = (interaction.user_diets || [])
          .map(normalizeDietLabel)
          .filter(Boolean);
        const dishAllergens = (overlay.allergens || [])
          .map(normalizeAllergen)
          .filter(Boolean);
        const removableAllergens = (overlay.removable || [])
          .map(r => normalizeAllergen(r.allergen || ''))
          .filter(Boolean);
        const dishDietsSet = new Set(
          (overlay.diets || []).map(normalizeDietLabel).filter(Boolean)
        );

        // For each allergen, categorize this view
        allAllergens.forEach(allergen => {
          const dishHasAllergen = dishAllergens.includes(allergen);
          const userHasAllergen = userAllergens.includes(allergen);

          if (!userHasAllergen) {
            allergenViewStats[allergen].noConflict++;
          } else if (dishHasAllergen && removableAllergens.includes(allergen)) {
            allergenViewStats[allergen].accommodated++;
          } else if (dishHasAllergen) {
            allergenViewStats[allergen].cannot++;
          } else {
            allergenViewStats[allergen].noConflict++;
          }
        });

        // For each diet, categorize this view
        allDiets.forEach(diet => {
          const userHasDiet = userDiets.includes(diet);
          const dishMeetsDiet = dishDietsSet.has(diet);

          if (!userHasDiet) {
            dietViewStats[diet].noConflict++;
          } else if (dishMeetsDiet) {
            dietViewStats[diet].noConflict++;
          } else {
            dietViewStats[diet].cannot++;
          }
        });
      });

      // Helper to render a single horizontal bar
      function renderBar(safe, accommodated, cannot, total) {
        const safePercent = total > 0 ? (safe / total) * 100 : 0;
        const accommodatedPercent = total > 0 ? (accommodated / total) * 100 : 0;
        const cannotPercent = total > 0 ? (cannot / total) * 100 : 0;
        const safeRounded = Math.round(safePercent);
        const accommodatedRounded = Math.round(accommodatedPercent);
        const cannotRounded = Math.round(cannotPercent);
        const summaryLabel = total === 0
          ? 'No data available'
          : `Safe: ${safe} (${safeRounded}%). Needs accommodation: ${accommodated} (${accommodatedRounded}%). Cannot accommodate: ${cannot} (${cannotRounded}%).`;

        if (total === 0) {
          return `<div style="flex:1;height:18px;display:flex;border-radius:4px;overflow:hidden;background:#e5e7eb;" role="img" aria-label='${summaryLabel}' title='${summaryLabel}'></div>`;
        }

        return `
          <div style="flex:1;height:18px;display:flex;border-radius:4px;overflow:hidden;background:#e5e7eb;" role="img" aria-label='${summaryLabel}' title='${summaryLabel}'>
            ${safePercent > 0 ? `<div style="width:${safePercent}%;background:#22c55e;display:flex;align-items:center;justify-content:center;font-size:0.6rem;color:#fff;font-weight:600;">${safePercent >= 5 ? Math.round(safePercent) + '%' : ''}</div>` : ''}
            ${accommodatedPercent > 0 ? `<div style="width:${accommodatedPercent}%;background:#facc15;display:flex;align-items:center;justify-content:center;font-size:0.6rem;color:#000;font-weight:600;">${accommodatedPercent >= 5 ? Math.round(accommodatedPercent) + '%' : ''}</div>` : ''}
            ${cannotPercent > 0 ? `<div style="width:${cannotPercent}%;background:#ef4444;display:flex;align-items:center;justify-content:center;font-size:0.6rem;color:#fff;font-weight:600;">${cannotPercent >= 5 ? Math.round(cannotPercent) + '%' : ''}</div>` : ''}
          </div>
        `;
      }

      // Helper to render a row with two bars (Dishes and Views)
      function renderDualBarRow(label, emoji, dishStats, viewStats, totalDishes, totalViews) {
        return `
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
            <span style="font-size:0.75rem;width:90px;min-width:90px;text-align:right;white-space:nowrap;">${emoji} ${label}</span>
            <div style="flex:1;display:flex;gap:8px;">
              ${renderBar(dishStats.safe, dishStats.accommodated || 0, dishStats.cannot, totalDishes)}
            </div>
            <div style="flex:1;display:flex;gap:8px;">
              ${renderBar(viewStats.noConflict, viewStats.accommodated || 0, viewStats.cannot, totalViews)}
            </div>
          </div>
        `;
      }

      const totalViews = categorizedViewCount;

      // Filter to only show allergens/diets that are relevant
      const relevantAllergens = allAllergens.filter(a =>
        allergenDishStats[a].accommodated > 0 || allergenDishStats[a].cannot > 0
      );

      const relevantDiets = allDiets.filter(d =>
        dietDishStats[d].cannot > 0
      );

      // Render allergen section with column headers
      if (relevantAllergens.length > 0) {
        allergenContainer.innerHTML = `
          <div class="menu-accommodation-header">
            <span class="menu-accommodation-label">Allergens</span>
            <div class="menu-accommodation-header-col">
              <div class="info-tooltip-container" style="justify-content:center;">
                <span class="menu-accommodation-title">Menu Coverage</span>
                <button class="info-tooltip-btn" onclick="toggleInfoTooltip(event, 'menu-coverage-tooltip')">?</button>
                <div class="info-tooltip-popup" id="menu-coverage-tooltip">Proportion of dishes not containing the allergen 🟢, containing but can be accommodated 🟡, or containing and can't be accommodated 🔴</div>
              </div>
              <div class="menu-accommodation-subtitle">Share of dishes</div>
            </div>
            <div class="menu-accommodation-header-col">
              <div class="info-tooltip-container" style="justify-content:center;">
                <span class="menu-accommodation-title">Viewer Restrictions</span>
                <button class="info-tooltip-btn" onclick="toggleInfoTooltip(event, 'viewer-restrictions-tooltip')">?</button>
                <div class="info-tooltip-popup" id="viewer-restrictions-tooltip">Proportion of views where the allergen/diet is safe 🟢, conflicts but can be accommodated 🟡, or conflicts and cannot be accommodated 🔴 for that user</div>
              </div>
              <div class="menu-accommodation-subtitle">Share of views</div>
            </div>
          </div>
          <div class="menu-accommodation-divider"></div>
          ${relevantAllergens.map(allergen =>
            renderDualBarRow(
              formatAllergenLabel(allergen),
              ALLERGEN_EMOJI[allergen] || '⚠️',
              allergenDishStats[allergen],
              allergenViewStats[allergen],
              totalDishes,
              totalViews
            )
          ).join('')}
        `;
      } else {
        allergenContainer.innerHTML = '<p style="font-size:0.85rem;color:var(--muted);">No allergen data available</p>';
      }

      // Render diet section without repeating headers
      if (relevantDiets.length > 0) {
        dietContainer.innerHTML = `
          <div class="menu-accommodation-header spaced">
            <span class="menu-accommodation-label">Diets</span>
            <div class="menu-accommodation-header-col"></div>
            <div class="menu-accommodation-header-col"></div>
          </div>
          <div class="menu-accommodation-divider"></div>
          ${relevantDiets.map(diet =>
            renderDualBarRow(
              diet,
              DIET_EMOJI[diet] || '🍽️',
              dietDishStats[diet],
              dietViewStats[diet],
              totalDishes,
              totalViews
            )
          ).join('')}
        `;
      } else {
        dietContainer.innerHTML = '<p style="font-size:0.85rem;color:var(--muted);">No diet data available</p>';
      }
    }

    function renderUserDietaryProfilePieCharts() {
      const section = document.getElementById('user-dietary-profile-section');
      const allergenContainer = document.getElementById('user-allergen-pie');
      const dietContainer = document.getElementById('user-diet-pie');

      if (rawInteractions.length === 0) {
        section.style.display = 'none';
        return;
      }

      section.style.display = 'block';

      // Define all allergens and diets to track
      const allAllergens = ALLERGENS;
      const allDiets = DIETS;

      // Colors for pie chart segments - high contrast, distinguishable palette
      // Last color (gray) is reserved for "No allergies" / "No diets"
      const pieColors = [
        '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
        '#06b6d4', '#ec4899', '#f97316', '#14b8a6', '#6b7280'
      ];

      // Count unique users with each allergen
      const allergenUserCounts = {};
      allAllergens.forEach(a => allergenUserCounts[a] = new Set());

      // Count unique users with each diet
      const dietUserCounts = {};
      allDiets.forEach(d => dietUserCounts[d] = new Set());

      // Track users with no allergens and no diets
      const usersWithNoAllergens = new Set();
      const usersWithNoDiets = new Set();
      const allUniqueUsers = new Set();

      // Process interactions to count unique users
      rawInteractions.forEach(interaction => {
        const userId = interaction.user_id;
        allUniqueUsers.add(userId);

        const userAllergens = (interaction.user_allergens || [])
          .map(normalizeAllergen)
          .filter(Boolean);
        const userDiets = (interaction.user_diets || [])
          .map(normalizeDietLabel)
          .filter(Boolean);

        // Track users with no allergens
        if (userAllergens.length === 0) {
          usersWithNoAllergens.add(userId);
        }

        // Track users with no diets
        if (userDiets.length === 0) {
          usersWithNoDiets.add(userId);
        }

        userAllergens.forEach(allergen => {
          if (allergenUserCounts[allergen]) {
            allergenUserCounts[allergen].add(userId);
          }
        });

        userDiets.forEach(diet => {
          if (dietUserCounts[diet]) {
            dietUserCounts[diet].add(userId);
          }
        });
      });

      // Convert sets to counts and filter to non-zero
      const allergenData = allAllergens
        .map(a => ({
          name: a,
          label: formatAllergenLabel(a),
          count: allergenUserCounts[a].size,
          emoji: ALLERGEN_EMOJI[a]
        }))
        .filter(d => d.count > 0)
        .sort((a, b) => b.count - a.count);

      // Add "No allergies" segment if there are users without allergens
      if (usersWithNoAllergens.size > 0) {
        allergenData.push({
          name: 'No allergies',
          label: 'No allergies',
          count: usersWithNoAllergens.size,
          emoji: '✓'
        });
      }

      const dietData = allDiets
        .map(d => ({
          name: d,
          count: dietUserCounts[d].size,
          emoji: DIET_EMOJI[d]
        }))
        .filter(d => d.count > 0)
        .sort((a, b) => b.count - a.count);

      // Add "No diets" segment if there are users without diets
      if (usersWithNoDiets.size > 0) {
        dietData.push({ name: 'No diets', count: usersWithNoDiets.size, emoji: '✓' });
      }

      // Helper to render a pie chart with legend
      function renderPieChart(title, data, colors, uniqueUserCount) {
        if (data.length === 0) {
          return `<p style="font-size:0.85rem;color:var(--muted);text-align:center;">No ${title.toLowerCase()} data available</p>`;
        }

        const total = data.reduce((sum, d) => sum + d.count, 0);
        const displayUserCount = uniqueUserCount || total;
        const size = 200;
        const radius = size / 2 - 10;
        const centerX = size / 2;
        const centerY = size / 2;
        const labelRadius = radius * 0.65;

        let segments = '';
        let labels = '';
        let currentAngle = -90;

        data.forEach((item, i) => {
          const percentage = (item.count / total) * 100;
          const angle = (item.count / total) * 360;
          const color = colors[i % colors.length];

          if (angle > 0) {
            const startAngle = currentAngle;
            const endAngle = currentAngle + angle;
            const startRad = (startAngle * Math.PI) / 180;
            const endRad = (endAngle * Math.PI) / 180;
            const x1 = centerX + radius * Math.cos(startRad);
            const y1 = centerY + radius * Math.sin(startRad);
            const x2 = centerX + radius * Math.cos(endRad);
            const y2 = centerY + radius * Math.sin(endRad);
            const largeArc = angle > 180 ? 1 : 0;

            if (data.length === 1) {
              segments += `<circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="${color}" stroke="#1a1a2e" stroke-width="2" />`;
            } else {
              segments += `<path d="M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${color}" stroke="#1a1a2e" stroke-width="2" />`;
            }

            const midAngle = startAngle + angle / 2;
            const midRad = (midAngle * Math.PI) / 180;
            const labelX = centerX + labelRadius * Math.cos(midRad);
            const labelY = centerY + labelRadius * Math.sin(midRad);

            if (percentage >= 5) {
              labels += `<text x="${labelX}" y="${labelY}" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-size="11" font-weight="600" style="text-shadow: 0 1px 2px rgba(0,0,0,0.5);">${Math.round(percentage)}%</text>`;
            }

            currentAngle = endAngle;
          }
        });

        const legendItems = data.map((item, i) => {
          const percentage = ((item.count / total) * 100).toFixed(1);
          const color = colors[i % colors.length];
          const label = item.label || item.name.charAt(0).toUpperCase() + item.name.slice(1);
          return `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <span style="display:inline-block;width:12px;height:12px;background:${color};border-radius:2px;flex-shrink:0;border:1px solid rgba(255,255,255,0.2);"></span>
              <span style="font-size:0.75rem;color:var(--ink);">${item.emoji} ${label}</span>
              <span style="font-size:0.7rem;color:var(--muted);margin-left:auto;">${item.count} (${percentage}%)</span>
            </div>
          `;
        }).join('');

        return `
          <div style="text-align:center;">
            <h4 style="font-size:0.85rem;font-weight:600;color:var(--ink);margin-bottom:12px;">${title}</h4>
            <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="margin-bottom:8px;">
              ${segments}
              ${labels}
            </svg>
            <p style="font-size:0.75rem;color:var(--muted);margin-bottom:12px;">Total unique users: ${displayUserCount}</p>
            <div style="text-align:left;padding:0 8px;">
              ${legendItems}
            </div>
          </div>
        `;
      }

      allergenContainer.innerHTML = renderPieChart('User Allergens', allergenData, pieColors, allUniqueUsers.size);
      dietContainer.innerHTML = renderPieChart('User Diets', dietData, pieColors, allUniqueUsers.size);
    }

    function renderHeatmap() {
      const loadingEl = document.getElementById('menu-heatmap-loading');
      const contentEl = document.getElementById('menu-heatmap-content');
      const emptyEl = document.getElementById('menu-heatmap-empty');
      const imgEl = document.getElementById('menu-heatmap-img');
      const overlaysEl = document.getElementById('menu-heatmap-overlays');
      const pageNavEl = document.getElementById('heatmap-page-nav');
      const pageIndicatorEl = document.getElementById('heatmap-page-indicator');
      const prevBtnEl = document.getElementById('heatmap-prev-btn');
      const nextBtnEl = document.getElementById('heatmap-next-btn');

      // Check if restaurant has menu image
      const menuImages = currentRestaurantData?.menu_images || [];
      const overlays = currentRestaurantData?.overlays || [];

      // Also check for single menu_image field (legacy)
      if (menuImages.length === 0 && currentRestaurantData?.menu_image) {
        menuImages.push(currentRestaurantData.menu_image);
      }

      if (menuImages.length === 0 || overlays.length === 0) {
        loadingEl.style.display = 'none';
        contentEl.style.display = 'none';
        emptyEl.style.display = 'flex';
        return;
      }

      // Ensure current page is valid
      if (currentHeatmapPage >= menuImages.length) {
        currentHeatmapPage = 0;
      }

      // Show/hide page navigation
      if (menuImages.length > 1) {
        pageNavEl.style.display = 'flex';
        pageIndicatorEl.textContent = `Page ${currentHeatmapPage + 1} of ${menuImages.length}`;
        prevBtnEl.disabled = currentHeatmapPage === 0;
        nextBtnEl.disabled = currentHeatmapPage === menuImages.length - 1;
      } else {
        pageNavEl.style.display = 'none';
      }

      // Use current page's menu image
      const menuImage = menuImages[currentHeatmapPage];
      imgEl.src = menuImage;
      imgEl.onload = () => {
        loadingEl.style.display = 'none';
        contentEl.style.display = 'flex';
        emptyEl.style.display = 'none';
        // Render overlays after image loads to ensure proper sizing
        renderHeatmapOverlays();
      };
      imgEl.onerror = () => {
        loadingEl.style.display = 'none';
        contentEl.style.display = 'none';
        emptyEl.style.display = 'flex';
      };
    }

    function renderHeatmapOverlays() {
      const overlaysEl = document.getElementById('menu-heatmap-overlays');
      const overlays = currentRestaurantData?.overlays || [];

      // Filter overlays for current page (if they have pageIndex, otherwise show all on page 0)
      const pageOverlays = overlays.filter(overlay => {
        const overlayPage = overlay.pageIndex ?? overlay.page ?? 0;
        return overlayPage === currentHeatmapPage;
      });

      // Get metric values based on selected metric (no filtering - show all data)
      const metricByDish = {};
      let metricLabel = 'views';

      if (currentHeatmapMetric === 'views') {
        metricLabel = 'views';
        // Count all views
        rawInteractions.forEach(interaction => {
          const dishName = interaction.dish_name;
          metricByDish[dishName] = (metricByDish[dishName] || 0) + 1;
        });
      } else if (currentHeatmapMetric === 'loves') {
        metricLabel = 'loves';
        // Count all loves
        rawLoves.forEach(love => {
          metricByDish[love.dish_name] = (metricByDish[love.dish_name] || 0) + 1;
        });
      } else if (currentHeatmapMetric === 'orders') {
        metricLabel = 'orders';
        // Use all orders
        Object.assign(metricByDish, dishOrders);
      } else if (currentHeatmapMetric === 'requests') {
        metricLabel = 'requests';
        // Count all accommodation requests per dish
        accommodationRequests.forEach(request => {
          const dishName = request.dish_name;
          if (dishName) {
            metricByDish[dishName] = (metricByDish[dishName] || 0) + 1;
          }
        });
      } else if (currentHeatmapMetric === 'accommodation') {
        metricLabel = '% accommodated';
        // Build a map of dish name -> overlay for quick lookup
        const overlays = currentRestaurantData?.overlays || [];
        const dishOverlayMap = {};
        overlays.forEach(overlay => {
          const name = (overlay.name || overlay.id || '').toLowerCase();
          if (name) dishOverlayMap[name] = overlay;
        });

        // Calculate accommodation rate per dish
        const dishViewCounts = {};
        const dishAccommodatedCounts = {};

        rawInteractions.forEach(interaction => {
          const dishName = interaction.dish_name;
          const overlay = dishOverlayMap[(dishName || '').toLowerCase()];
          if (!overlay) return;

          dishViewCounts[dishName] = (dishViewCounts[dishName] || 0) + 1;

          // Check if dish is safe or can be accommodated for this user
          const userAllergens = (interaction.user_allergens || [])
            .map(normalizeAllergen)
            .filter(Boolean);
          const userDiets = (interaction.user_diets || [])
            .map(normalizeDietLabel)
            .filter(Boolean);
          const dishAllergens = (overlay.allergens || [])
            .map(normalizeAllergen)
            .filter(Boolean);
          const removableAllergens = (overlay.removable || [])
            .map(r => normalizeAllergen(r.allergen || ''))
            .filter(Boolean);
          const dishDietsSet = new Set(
            (overlay.diets || []).map(normalizeDietLabel).filter(Boolean)
          );

          // Check allergen conflicts
          const hasUnsafeAllergen = userAllergens.some(allergen =>
            dishAllergens.includes(allergen) && !removableAllergens.includes(allergen)
          );

          // Check diet compatibility
          let meetsDiet = true;
          if (userDiets && userDiets.length > 0) {
            for (const diet of userDiets) {
              if (!dishDietsSet.has(diet)) {
                meetsDiet = false;
                break;
              }
            }
          }

          // If no unsafe allergens and meets diet requirements, count as accommodated
          if (!hasUnsafeAllergen && meetsDiet) {
            dishAccommodatedCounts[dishName] = (dishAccommodatedCounts[dishName] || 0) + 1;
          }
        });

        // Calculate percentage for each dish
        Object.keys(dishViewCounts).forEach(dishName => {
          const total = dishViewCounts[dishName];
          const accommodated = dishAccommodatedCounts[dishName] || 0;
          metricByDish[dishName] = total > 0 ? Math.round((accommodated / total) * 100) : 0;
        });
      }

      // Find min/max for color scaling
      const metricValues = Object.values(metricByDish);
      const maxMetric = Math.max(...metricValues, 1);
      const minMetric = Math.min(...metricValues, 0);

      // Render overlays with frequency-based coloring
      // Use w/h properties (matching restaurant page) or fall back to width/height
      overlaysEl.innerHTML = pageOverlays.map((overlay, index) => {
        const dishName = overlay.id || overlay.dish_name || overlay.label || `Dish ${index + 1}`;
        const metricValue = metricByDish[dishName] || 0;

        // Calculate color - green (high) to red (low)
        const normalizedValue = maxMetric > minMetric
          ? (metricValue - minMetric) / (maxMetric - minMetric)
          : 0.5;

        const color = getHeatmapColor(normalizedValue);

        // Use w/h (restaurant page format) or width/height as fallback
        const width = overlay.w ?? overlay.width ?? 10;
        const height = overlay.h ?? overlay.height ?? 10;

        return `
          <div class="heatmap-overlay"
               style="left: ${overlay.x || 0}%; top: ${overlay.y || 0}%; width: ${width}%; height: ${height}%;
                      background: ${color}; border-color: ${color};"
               data-dish-name="${escapeHtml(dishName)}"
               data-metric="${metricValue}"
               onclick="showDishAnalytics('${escapeHtml(dishName).replace(/'/g, "\\'")}')">
            <span class="view-count">${metricValue} ${metricLabel}</span>
          </div>
        `;
      }).join('');
    }

    function goToHeatmapPage(direction) {
      const menuImages = currentRestaurantData?.menu_images || [];
      if (direction === 'prev' && currentHeatmapPage > 0) {
        currentHeatmapPage--;
        renderHeatmap();
      } else if (direction === 'next' && currentHeatmapPage < menuImages.length - 1) {
        currentHeatmapPage++;
        renderHeatmap();
      }
    }

    // Color interpolation for heatmap (red -> yellow -> green)
    function getHeatmapColor(value) {
      // value: 0 = red (low), 0.5 = yellow (medium), 1 = green (high)
      let r, g, b;

      if (value < 0.5) {
        // Red to Yellow
        const t = value * 2;
        r = 239; // #ef
        g = Math.round(68 + (204 - 68) * t); // 44 -> cc
        b = Math.round(68 + (21 - 68) * t); // 44 -> 15
      } else {
        // Yellow to Green
        const t = (value - 0.5) * 2;
        r = Math.round(250 + (34 - 250) * t); // fa -> 22
        g = Math.round(204 + (197 - 204) * t); // cc -> c5
        b = Math.round(21 + (94 - 21) * t); // 15 -> 5e
      }

      return `rgba(${r}, ${g}, ${b}, 0.5)`;
    }

    function showDishAnalytics(dishName) {
      const dish = dishAnalytics.find(d => d.dish_name === dishName);
      const dishRequests = accommodationRequests.filter(r => r.dish_name === dishName);

      // Find dish overlay data for allergens/diets
      const overlays = currentRestaurantData?.overlays || [];
      const dishOverlay = overlays.find(o => (o.id || o.dish_name || o.label) === dishName);

      // Update modal title
      document.getElementById('dish-analytics-title').textContent = dishName;

      // Get dish data
      const dishAllergens = (dishOverlay?.allergens || [])
        .map(normalizeAllergen)
        .filter(Boolean);
      const dishDiets = (dishOverlay?.diets || [])
        .map(normalizeDietLabel)
        .filter(Boolean);
      const removableList = dishOverlay?.removable || [];
      const removableAllergens = removableList
        .map(r => normalizeAllergen(r.allergen || ''))
        .filter(Boolean);

      // Separate allergens into can/cannot accommodate
      const cannotAccommodateAllergens = dishAllergens.filter(a => !removableAllergens.includes(a));
      const canAccommodateAllergens = dishAllergens.filter(a => removableAllergens.includes(a));

      // dishDiets contains diets the dish IS compatible with
      // We want to show diets the dish is NOT compatible with (cannot accommodate)
      const allDiets = DIETS;
      const cannotAccommodateDiets = allDiets.filter(d => !dishDiets.includes(d));

      // Populate "Cannot be accommodated" row (allergens + diets)
      const cannotRow = document.getElementById('cannot-accommodate-row');
      const cannotTags = document.getElementById('cannot-accommodate-tags');
      const hasCannotAccommodate = cannotAccommodateAllergens.length > 0 || cannotAccommodateDiets.length > 0;
      if (hasCannotAccommodate) {
        const allergenTagsHtml = cannotAccommodateAllergens.map(a => {
          const emoji = ALLERGEN_EMOJI[a] || '⚠️';
          return `<span class="accommodation-tag">${emoji} ${formatAllergenLabel(a)}</span>`;
        }).join('');
        const dietTagsHtml = cannotAccommodateDiets.map(d => {
          const emoji = DIET_EMOJI[d] || '🍽️';
          return `<span class="accommodation-tag">${emoji} ${d}</span>`;
        }).join('');
        cannotTags.innerHTML = allergenTagsHtml + dietTagsHtml;
        cannotRow.style.display = 'flex';
      } else {
        cannotRow.style.display = 'none';
      }

      // Populate "Can be accommodated" row (only allergens - diets cannot be accommodated by removal)
      const canRow = document.getElementById('can-accommodate-row');
      const canTags = document.getElementById('can-accommodate-tags');
      if (canAccommodateAllergens.length > 0) {
        canTags.innerHTML = canAccommodateAllergens.map(a => {
          const emoji = ALLERGEN_EMOJI[a] || '⚠️';
          return `<span class="accommodation-tag">${emoji} ${formatAllergenLabel(a)}</span>`;
        }).join('');
        canRow.style.display = 'flex';
      } else {
        canRow.style.display = 'none';
      }

      // Update accommodation requests count
      document.getElementById('analytics-requests').textContent = dishRequests.length;

      // Calculate status breakdowns for each metric
      // Build user profile map from rawInteractions
      const userProfileMap = {};
      rawInteractions.forEach(interaction => {
        if (interaction.user_id && !userProfileMap[interaction.user_id]) {
          userProfileMap[interaction.user_id] = {
            allergens: (interaction.user_allergens || [])
              .map(normalizeAllergen)
              .filter(Boolean),
            diets: (interaction.user_diets || [])
              .map(normalizeDietLabel)
              .filter(Boolean)
          };
        }
      });

      // Views - calculate live from rawInteractions (same logic as heatmap)
      let viewsSafe = 0, viewsRemovable = 0, viewsUnsafe = 0;
      rawInteractions.filter(i => i.dish_name === dishName).forEach(interaction => {
        const status = computeDishStatus(dishOverlay, interaction.user_allergens || [], interaction.user_diets || []);
        if (status === 'safe') viewsSafe++;
        else if (status === 'removable') viewsRemovable++;
        else viewsUnsafe++;
      });
      const viewsTotal = viewsSafe + viewsRemovable + viewsUnsafe;

      // Unique users - calculate from rawInteractions for this dish
      let uniqueSafe = 0, uniqueRemovable = 0, uniqueUnsafe = 0;
      const seenUsers = new Set();
      rawInteractions.filter(i => i.dish_name === dishName).forEach(interaction => {
        if (interaction.user_id && !seenUsers.has(interaction.user_id)) {
          seenUsers.add(interaction.user_id);
          const profile = userProfileMap[interaction.user_id];
          if (profile) {
            const status = computeDishStatus(dishOverlay, profile.allergens, profile.diets);
            if (status === 'safe') uniqueSafe++;
            else if (status === 'removable') uniqueRemovable++;
            else uniqueUnsafe++;
          }
        }
      });
      const uniqueTotal = uniqueSafe + uniqueRemovable + uniqueUnsafe;

      // Loves - calculate from rawLoves and user profiles
      let lovesSafe = 0, lovesRemovable = 0, lovesUnsafe = 0;
      rawLoves.filter(l => l.dish_name === dishName).forEach(love => {
        const profile = userProfileMap[love.user_id];
        if (profile) {
          const status = computeDishStatus(dishOverlay, profile.allergens, profile.diets);
          if (status === 'safe') lovesSafe++;
          else if (status === 'removable') lovesRemovable++;
          else lovesUnsafe++;
        }
      });
      const lovesTotal = lovesSafe + lovesRemovable + lovesUnsafe;

      // Orders - we don't have user profile data for orders, so show total only
      const ordersTotal = dishOrders[dishName] || 0;

      // Calculate average views and status breakdown across all dishes
      const allDishNames = [...new Set(rawInteractions.map(i => i.dish_name))];
      const numDishes = allDishNames.length || 1;

      // Calculate total views and status breakdown across all dishes
      let totalAllViews = 0;
      let totalAllSafe = 0, totalAllRemovable = 0, totalAllUnsafe = 0;

      allDishNames.forEach(dn => {
        const dishOv = currentRestaurantData?.overlays?.find(o =>
          (o.id || o.dish_name || o.label) === dn
        );
        rawInteractions.filter(i => i.dish_name === dn).forEach(interaction => {
          totalAllViews++;
          const status = computeDishStatus(dishOv, interaction.user_allergens || [], interaction.user_diets || []);
          if (status === 'safe') totalAllSafe++;
          else if (status === 'removable') totalAllRemovable++;
          else totalAllUnsafe++;
        });
      });

      const avgViews = numDishes > 0 ? Math.round(totalAllViews / numDishes) : 0;
      const avgSafe = numDishes > 0 ? totalAllSafe / numDishes : 0;
      const avgRemovable = numDishes > 0 ? totalAllRemovable / numDishes : 0;
      const avgUnsafe = numDishes > 0 ? totalAllUnsafe / numDishes : 0;
      const avgTotal = avgSafe + avgRemovable + avgUnsafe;

      // Generate stacked bar chart - horizontal layout
      const stackedChart = document.getElementById('analytics-stacked-chart');

      // Render horizontal status distribution bar (normalized to 100% width)
      function renderStatusBar(label, safe, removable, unsafe, total, isAverage = false) {
        const safePercent = total > 0 ? Math.round((safe / total) * 100) : 0;
        const removablePercent = total > 0 ? Math.round((removable / total) * 100) : 0;
        const unsafePercent = total > 0 ? Math.round((unsafe / total) * 100) : 0;

        const opacity = isAverage ? 'opacity: 0.6;' : '';
        const hasData = total > 0;

        return `
          <div class="stacked-bar-row" style="${opacity}">
            <span class="stacked-bar-row-label">${label}</span>
            <div class="stacked-bar-wrapper">
              ${hasData ? `
                ${safePercent > 0 ? `<div class="stacked-bar-segment safe" style="width:${safePercent}%;" title="Safe: ${Math.round(safe)}"><span class="segment-percent">${safePercent}%</span></div>` : ''}
                ${removablePercent > 0 ? `<div class="stacked-bar-segment removable" style="width:${removablePercent}%;" title="Can be accommodated: ${Math.round(removable)}"><span class="segment-percent">${removablePercent}%</span></div>` : ''}
                ${unsafePercent > 0 ? `<div class="stacked-bar-segment unsafe" style="width:${unsafePercent}%;" title="Cannot be accommodated: ${Math.round(unsafe)}"><span class="segment-percent">${unsafePercent}%</span></div>` : ''}
              ` : `
                <div class="stacked-bar-segment neutral" style="width:100%;" title="No data"></div>
              `}
            </div>
          </div>
        `;
      }

      // Render horizontal views bar (scaled to max)
      function renderViewsBar(label, views, maxViews, isAverage = false) {
        const widthPercent = maxViews > 0 ? (views / maxViews) * 100 : 0;
        const opacity = isAverage ? 'opacity: 0.6;' : '';

        return `
          <div class="stacked-bar-row" style="${opacity}">
            <span class="stacked-bar-row-label">${label}</span>
            <div class="stacked-bar-wrapper">
              <div class="stacked-bar-segment views" style="width:${widthPercent}%;" title="${Math.round(views)} views"></div>
            </div>
            <span class="stacked-bar-value">${Math.round(views)}</span>
          </div>
        `;
      }

      // Max views for scaling
      const maxViewsForScale = Math.max(viewsTotal, avgViews, 1);

      stackedChart.innerHTML = `
        <div class="chart-comparison-group">
          <div class="chart-group-title">Total Views</div>
          <div class="chart-group-bars">
            ${renderViewsBar('This Dish', viewsTotal, maxViewsForScale, false)}
            ${renderViewsBar('Menu Avg', avgViews, maxViewsForScale, true)}
          </div>
        </div>
        <div class="chart-comparison-group">
          <div class="chart-group-title">Status Distribution</div>
          <div class="chart-group-bars">
            ${renderStatusBar('This Dish', viewsSafe, viewsRemovable, viewsUnsafe, viewsTotal, false)}
            ${renderStatusBar('Menu Avg', avgSafe, avgRemovable, avgUnsafe, avgTotal, true)}
          </div>
        </div>
      `;

      // Calculate conflict counts per allergen and diet
      const allergenConflictCounts = {};
      const dietConflictCounts = {};

      // Initialize counts for dish allergens
      dishAllergens.forEach(a => {
        allergenConflictCounts[a] = 0;
      });

      // Initialize counts for incompatible diets
      cannotAccommodateDiets.forEach(d => {
        dietConflictCounts[d] = 0;
      });

      // Count conflicts from raw interactions for this dish
      rawInteractions.filter(i => i.dish_name === dishName).forEach(interaction => {
        const userAllergens = (interaction.user_allergens || [])
          .map(normalizeAllergen)
          .filter(Boolean);
        const userDiets = (interaction.user_diets || [])
          .map(normalizeDietLabel)
          .filter(Boolean);

        // Count allergen conflicts
        userAllergens.forEach(userAllergen => {
          if (allergenConflictCounts.hasOwnProperty(userAllergen)) {
            allergenConflictCounts[userAllergen]++;
          }
        });

        // Count diet conflicts (user has diet that dish can't accommodate)
        userDiets.forEach(userDiet => {
          if (dietConflictCounts.hasOwnProperty(userDiet)) {
            dietConflictCounts[userDiet]++;
          }
        });
      });

      // Find shared max for scaling (so bars are proportional across both charts)
      const allergenValues = Object.values(allergenConflictCounts);
      const dietValues = Object.values(dietConflictCounts);
      const maxConflict = Math.max(...allergenValues, ...dietValues, 1);

      // Render allergen conflict bars
      const allergenBarsEl = document.getElementById('conflict-allergen-bars');
      // Get lowercase versions of accommodatable allergens for comparison
      const canAccommodateAllergensLower = canAccommodateAllergens
        .map(a => normalizeAllergen(a))
        .filter(Boolean);
      if (Object.keys(allergenConflictCounts).length > 0) {
        allergenBarsEl.innerHTML = Object.entries(allergenConflictCounts)
          .sort((a, b) => b[1] - a[1]) // Sort by count descending
          .map(([allergen, count]) => {
            const emoji = ALLERGEN_EMOJI[allergen] || '⚠️';
            const widthPercent = (count / maxConflict) * 100;
            // Yellow if can be accommodated, red if cannot
            const barColor = canAccommodateAllergensLower.includes(allergen) ? '#facc15' : '#ef4444';
            return `
              <div class="conflict-bar-row">
                <span class="conflict-bar-label">${emoji} ${formatAllergenLabel(allergen)}</span>
                <div class="conflict-bar-track">
                  <div class="conflict-bar-fill" style="width:${widthPercent}%; background:${barColor};"></div>
                </div>
                <span class="conflict-bar-value">${count}</span>
              </div>
            `;
          }).join('');
      } else {
        allergenBarsEl.innerHTML = '<div class="conflict-no-data">No allergen conflicts</div>';
      }

      // Render diet conflict bars
      const dietBarsEl = document.getElementById('conflict-diet-bars');
      if (Object.keys(dietConflictCounts).length > 0) {
        dietBarsEl.innerHTML = Object.entries(dietConflictCounts)
          .sort((a, b) => b[1] - a[1]) // Sort by count descending
          .map(([diet, count]) => {
            const emoji = DIET_EMOJI[diet] || '🍽️';
            const widthPercent = (count / maxConflict) * 100;
            return `
              <div class="conflict-bar-row">
                <span class="conflict-bar-label">${emoji} ${diet}</span>
                <div class="conflict-bar-track">
                  <div class="conflict-bar-fill" style="width:${widthPercent}%;"></div>
                </div>
                <span class="conflict-bar-value">${count}</span>
              </div>
            `;
          }).join('');
      } else {
        dietBarsEl.innerHTML = '<div class="conflict-no-data">No diet conflicts</div>';
      }

      // Show modal
      document.getElementById('dish-analytics-modal').classList.add('show');
    }

    // Compute dish status for a user based on their allergens/diets
    function computeDishStatus(dishOverlay, userAllergens, userDiets) {
      if (!dishOverlay) return 'neutral';

      const dishAllergens = (dishOverlay.allergens || [])
        .map(normalizeAllergen)
        .filter(Boolean);
      const removableAllergens = (dishOverlay.removable || [])
        .map(r => normalizeAllergen(r.allergen || ''))
        .filter(Boolean);
      const dishDiets = new Set(
        (dishOverlay.diets || []).map(normalizeDietLabel).filter(Boolean)
      );
      const normalizedUserAllergens = (userAllergens || [])
        .map(normalizeAllergen)
        .filter(Boolean);
      const normalizedUserDiets = (userDiets || [])
        .map(normalizeDietLabel)
        .filter(Boolean);

      // Check allergen conflicts
      const conflictingAllergens = normalizedUserAllergens.filter(a => dishAllergens.includes(a));
      const unsafeAllergens = conflictingAllergens.filter(a => !removableAllergens.includes(a));
      const removableConflicts = conflictingAllergens.filter(a => removableAllergens.includes(a));

      // Check diet conflicts
      const unmetDiets = normalizedUserDiets.filter(d => !dishDiets.has(d));

      if (unsafeAllergens.length > 0 || unmetDiets.length > 0) {
        return 'unsafe';
      } else if (removableConflicts.length > 0) {
        return 'removable';
      } else {
        return 'safe';
      }
    }

    function closeDishAnalyticsModal() {
      document.getElementById('dish-analytics-modal').classList.remove('show');
    }

    // Make showDishAnalytics available globally for onclick handlers
    window.showDishAnalytics = showDishAnalytics;

    // Get filtered user profiles based on current filter settings
    function getFilteredUserProfiles() {
      const filterViews = document.getElementById('filter-views')?.checked ?? true;
      const filterLoves = document.getElementById('filter-loves')?.checked ?? false;
      const filterOrders = document.getElementById('filter-orders')?.checked ?? false;
      const weightMode = document.querySelector('input[name="weight-mode"]:checked')?.value || 'unique';

      // Build set of user_ids from views (dish_interactions)
      const viewedUsers = new Set(rawInteractions.map(i => i.user_id).filter(Boolean));
      // Set of user_ids who loved dishes
      const lovedUsers = userLovedSet;
      // Set of user_ids who placed orders
      const orderedUsers = new Set(Object.keys(userOrderCounts));

      // Filter users based on selected criteria (OR logic - include if ANY criteria matches)
      const matchingUsers = new Set();
      if (filterViews) viewedUsers.forEach(u => matchingUsers.add(u));
      if (filterLoves) lovedUsers.forEach(u => matchingUsers.add(u));
      if (filterOrders) orderedUsers.forEach(u => matchingUsers.add(u));

      // If no filters selected, include all viewed users as default
      if (!filterViews && !filterLoves && !filterOrders) {
        viewedUsers.forEach(u => matchingUsers.add(u));
      }

      // Build user profile map from rawInteractions (use first interaction's profile per user)
      const userProfiles = {};
      rawInteractions.forEach(interaction => {
        const userId = interaction.user_id;
        if (!userId || !matchingUsers.has(userId)) return;
        // Only store first occurrence (profiles should be consistent)
        if (!userProfiles[userId]) {
          userProfiles[userId] = {
            allergens: (interaction.user_allergens || [])
              .map(normalizeAllergen)
              .filter(Boolean),
            diets: (interaction.user_diets || [])
              .map(normalizeDietLabel)
              .filter(Boolean)
          };
        }
      });

      // For users who loved/ordered but may not have viewed, we won't have profile data
      // (they need to have at least one dish_interaction to have profile data)

      // Apply weighting
      const result = [];
      Object.entries(userProfiles).forEach(([userId, profile]) => {
        let weight = 1;
        if (weightMode === 'weighted' && userOrderCounts[userId]) {
          weight = userOrderCounts[userId]; // Number of order visits
        }
        result.push({ ...profile, weight, userId });
      });

      return result;
    }

    function renderAllergenChart() {
      const container = document.getElementById('allergens-chart');
      const allergensList = ALLERGENS;

      const userProfiles = getFilteredUserProfiles();

      // Count allergens from full user profiles
      const totals = allergensList.map(allergen => {
        let count = 0;
        userProfiles.forEach(profile => {
          if (profile.allergens.includes(allergen)) {
            count += profile.weight;
          }
        });
        return { label: formatAllergenLabel(allergen), count };
      });

      const maxCount = Math.max(...totals.map(t => t.count), 1);

      if (userProfiles.length === 0) {
        container.innerHTML = '<div style="color:var(--muted);padding:20px;text-align:center;">No customer profile data available for the selected filters.</div>';
        return;
      }

      container.innerHTML = totals.map(t => `
        <div class="chart-bar" style="height: ${(t.count / maxCount) * 150 + 10}px;">
          <span class="chart-bar-value">${t.count}</span>
          <span class="chart-bar-label">${t.label}</span>
        </div>
      `).join('');
    }

    function renderDietChart() {
      const container = document.getElementById('diets-chart');
      const dietsList = DIETS;

      const userProfiles = getFilteredUserProfiles();

      // Count diets from full user profiles
      const totals = dietsList.map(diet => {
        let count = 0;
        userProfiles.forEach(profile => {
          if (profile.diets.includes(diet)) {
            count += profile.weight;
          }
        });
        return { label: diet, count };
      });

      const maxCount = Math.max(...totals.map(t => t.count), 1);

      if (userProfiles.length === 0) {
        container.innerHTML = '<div style="color:var(--muted);padding:20px;text-align:center;">No customer profile data available for the selected filters.</div>';
        return;
      }

      container.innerHTML = totals.map(t => `
        <div class="chart-bar" style="height: ${(t.count / maxCount) * 150 + 10}px; flex: 0 0 80px;">
          <span class="chart-bar-value">${t.count}</span>
          <span class="chart-bar-label">${t.label}</span>
        </div>
      `).join('');
    }

    function renderDishTable() {
      const tbody = document.getElementById('dish-analytics-body');

      if (dishAnalytics.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align:center;padding:40px;color:var(--muted);">
              No dish interaction data yet. Data will appear as users view dishes.
            </td>
          </tr>
        `;
        return;
      }

      const sortedDishes = [...dishAnalytics].sort((a, b) => b.total_interactions - a.total_interactions);

      tbody.innerHTML = sortedDishes.map(dish => {
        const topAllergens = [];
        const metricKeys = resolveAllergenMetricKeys(dish);
        const allergenKeys = ALLERGENS
          .map((name) => ({
            key: metricKeys[name],
            label: formatAllergenLabel(name)
          }))
          .filter(entry => entry.key);

        allergenKeys.forEach(a => {
          if (dish[a.key] > 0) {
            topAllergens.push({ label: a.label, count: dish[a.key] });
          }
        });

        topAllergens.sort((a, b) => b.count - a.count);
        const top3Allergens = topAllergens.slice(0, 3);

        return `
          <tr>
            <td><strong>${escapeHtml(dish.dish_name)}</strong></td>
            <td>${dish.total_interactions || 0}</td>
            <td style="color:#22c55e;">${dish.safe_interactions || 0}</td>
            <td style="color:#facc15;">${dish.removable_interactions || 0}</td>
            <td style="color:#ef4444;">${dish.unsafe_interactions || 0}</td>
            <td>
              ${top3Allergens.map(a => `<span class="allergen-badge">${a.label} (${a.count})</span>`).join('') || '<span style="color:var(--muted);">None</span>'}
            </td>
          </tr>
        `;
      }).join('');
    }

    function renderRequests(filter = 'pending') {
      const container = document.getElementById('requests-list');

      const filteredRequests = filter === 'pending'
        ? accommodationRequests.filter(r => r.status === 'pending')
        : accommodationRequests;

      if (filteredRequests.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 12l2 2 4-4"/>
              <circle cx="12" cy="12" r="10"/>
            </svg>
            <p>${filter === 'pending' ? 'No pending accommodation requests' : 'No accommodation requests yet'}</p>
          </div>
        `;
        return;
      }

      container.innerHTML = filteredRequests.map(req => {
        const allergenBadges = (req.requested_allergens || []).map(a =>
          `<span class="allergen-badge">${a}</span>`
        ).join('');

        const dietBadges = (req.requested_diets || []).map(d =>
          `<span class="diet-badge ${d.toLowerCase()}">${d}</span>`
        ).join('');

        const date = new Date(req.created_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });

        return `
          <div class="request-card" data-request-id="${req.id}">
            <div class="request-header">
              <div>
                <div class="request-dish">${escapeHtml(req.dish_name)}</div>
                <div class="request-date">${date}</div>
              </div>
              <span class="status-badge ${req.status}">${req.status}</span>
            </div>
            <div class="request-details">
              <div class="request-needs">
                ${allergenBadges ? `
                  <div class="request-needs-group">
                    <span class="request-needs-label">Allergen Accommodations Needed</span>
                    <div>${allergenBadges}</div>
                  </div>
                ` : ''}
                ${dietBadges ? `
                  <div class="request-needs-group">
                    <span class="request-needs-label">Dietary Accommodations Needed</span>
                    <div>${dietBadges}</div>
                  </div>
                ` : ''}
              </div>
            </div>
            ${req.manager_response ? `
              <div style="background:rgba(255,255,255,0.05);padding:12px;border-radius:8px;margin-bottom:12px;">
                <div style="color:var(--muted);font-size:0.8rem;margin-bottom:4px;">Manager Response</div>
                <div>${escapeHtml(req.manager_response)}</div>
              </div>
            ` : ''}
            ${req.status === 'pending' ? `
              <div class="request-actions">
                <button class="action-btn success" onclick="openResponseModal('${req.id}', '${escapeHtml(req.dish_name)}', 'implemented')">
                  Mark Implemented
                </button>
                <button class="action-btn" onclick="openResponseModal('${req.id}', '${escapeHtml(req.dish_name)}', 'reviewed')">
                  Mark Reviewed
                </button>
                <button class="action-btn decline" onclick="openResponseModal('${req.id}', '${escapeHtml(req.dish_name)}', 'declined')">
                  Decline
                </button>
              </div>
            ` : ''}
          </div>
        `;
      }).join('');
    }

    function renderSuggestions() {
      const container = document.getElementById('suggestions-list');
      const suggestions = generateSuggestions();

      if (suggestions.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 16v-4"/>
              <path d="M12 8h.01"/>
            </svg>
            <p>More data needed to generate suggestions. Keep tracking user interactions!</p>
          </div>
        `;
        return;
      }

      container.innerHTML = suggestions.map(s => `
        <div class="suggestion-card">
          <div class="suggestion-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/>
              <path d="M2 17l10 5 10-5"/>
              <path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div class="suggestion-title">${escapeHtml(s.title)}</div>
          <div class="suggestion-description">${escapeHtml(s.description)}</div>
          <div class="suggestion-impact">
            <div class="impact-item">
              <span class="positive">+${s.potentialUsers}</span>
              <span style="color:var(--muted);">potential users</span>
            </div>
            <div class="impact-item">
              <span style="color:var(--muted);">Priority:</span>
              <span style="color:${s.priority === 'high' ? '#ef4444' : s.priority === 'medium' ? '#facc15' : 'var(--muted)'};">${s.priority}</span>
            </div>
          </div>
        </div>
      `).join('');
    }

    function generateSuggestions() {
      const suggestions = [];

      // Analyze accommodation requests to find patterns
      const requestsByDish = {};
      accommodationRequests.forEach(req => {
        if (!requestsByDish[req.dish_name]) {
          requestsByDish[req.dish_name] = {
            count: 0,
            allergens: {},
            diets: {}
          };
        }
        requestsByDish[req.dish_name].count++;
        (req.requested_allergens || []).forEach(a => {
          const normalized = normalizeAllergen(a);
          if (!normalized) return;
          requestsByDish[req.dish_name].allergens[normalized] =
            (requestsByDish[req.dish_name].allergens[normalized] || 0) + 1;
        });
        (req.requested_diets || []).forEach(d => {
          const normalized = normalizeDietLabel(d);
          if (!normalized) return;
          requestsByDish[req.dish_name].diets[normalized] =
            (requestsByDish[req.dish_name].diets[normalized] || 0) + 1;
        });
      });

      // Generate suggestions based on request patterns
      Object.entries(requestsByDish).forEach(([dishName, data]) => {
        if (data.count >= 2) {
          // Top allergen request for this dish
          const topAllergen = Object.entries(data.allergens).sort((a, b) => b[1] - a[1])[0];
          const topDiet = Object.entries(data.diets).sort((a, b) => b[1] - a[1])[0];

          if (topAllergen && topAllergen[1] >= 2) {
            suggestions.push({
              title: `Add ${formatAllergenLabel(topAllergen[0])}-free option for "${dishName}"`,
              description: `${topAllergen[1]} users have requested a ${formatAllergenLabel(topAllergen[0])}-free version of this dish. Consider adding a substitution option.`,
              potentialUsers: topAllergen[1] * 5, // Estimated impact
              priority: topAllergen[1] >= 5 ? 'high' : topAllergen[1] >= 3 ? 'medium' : 'low'
            });
          }

          if (topDiet && topDiet[1] >= 2) {
            suggestions.push({
              title: `Make "${dishName}" available for ${topDiet[0]} diners`,
              description: `${topDiet[1]} ${topDiet[0]} users have requested this dish. Consider creating a ${topDiet[0]} version.`,
              potentialUsers: topDiet[1] * 5,
              priority: topDiet[1] >= 5 ? 'high' : topDiet[1] >= 3 ? 'medium' : 'low'
            });
          }
        }
      });

      // Analyze dish analytics for high unsafe rates
      dishAnalytics.forEach(dish => {
        const total = dish.total_interactions || 0;
        const unsafe = dish.unsafe_interactions || 0;
        if (total >= 10 && (unsafe / total) > 0.5) {
          // More than 50% unsafe - high opportunity
          const topAllergens = [];
          const metricKeys = resolveAllergenMetricKeys(dish);
          const allergenMetricList = ALLERGENS
            .map((name) => ({ key: metricKeys[name], name }))
            .filter(entry => entry.key);
          allergenMetricList.forEach((entry) => {
            const count = dish[entry.key];
            if (count > 0) topAllergens.push({ name: entry.name, count });
          });

          topAllergens.sort((a, b) => b.count - a.count);
          const topAllergen = topAllergens[0];

          if (topAllergen) {
            suggestions.push({
              title: `High demand for allergen-friendly "${dish.dish_name}"`,
              description: `${unsafe} users viewed this dish but it was unsafe for them. ${topAllergen.count} users with ${formatAllergenLabel(topAllergen.name)} allergies are interested.`,
              potentialUsers: unsafe,
              priority: unsafe >= 20 ? 'high' : unsafe >= 10 ? 'medium' : 'low'
            });
          }
        }
      });

      // Sort by priority and potential users
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      suggestions.sort((a, b) => {
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return b.potentialUsers - a.potentialUsers;
      });

      return suggestions.slice(0, 5); // Return top 5 suggestions
    }

    // Modal functions
    function openResponseModal(requestId, dishName, action) {
      currentRequestId = requestId;
      document.getElementById('modal-dish').textContent = `Dish: ${dishName}`;
      document.getElementById('response-text').value = '';
      document.getElementById('response-modal').classList.add('show');

      // Update modal title based on action
      const titles = {
        implemented: 'Mark as Implemented',
        reviewed: 'Mark as Reviewed',
        declined: 'Decline Request'
      };
      document.getElementById('modal-title').textContent = titles[action] || 'Respond to Request';

      // Store the action for submission
      document.getElementById('response-modal').dataset.action = action;
    }

    async function submitResponse(status) {
      if (!currentRequestId) return;

      const response = document.getElementById('response-text').value.trim();

      try {
        const { error } = await supabaseClient
          .from('accommodation_requests')
          .update({
            status: status,
            manager_response: response || null,
            manager_reviewed_at: new Date().toISOString(),
            manager_reviewed_by: currentUser.id,
            updated_at: new Date().toISOString()
          })
          .eq('id', currentRequestId);

        if (error) throw error;

        // Refresh data
        await loadDashboardData();
        closeModal();
      } catch (err) {
        console.error('Failed to update request:', err);
        alert('Failed to update request. Please try again.');
      }
    }

    function closeModal() {
      document.getElementById('response-modal').classList.remove('show');
      currentRequestId = null;
    }

    // Event Listeners
    restaurantSelect.addEventListener('change', async (e) => {
      selectedRestaurantId = e.target.value;
      currentHeatmapPage = 0; // Reset to first page when changing restaurant
      await loadDashboardData();
    });

    // Tab switching for charts
    document.querySelectorAll('.tabs .tab-btn[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tabs .tab-btn[data-tab]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        document.getElementById('allergens-chart').style.display = tab === 'allergens' ? 'flex' : 'none';
        document.getElementById('diets-chart').style.display = tab === 'diets' ? 'flex' : 'none';
      });
    });

    // Profile filter controls - re-render charts when filters change
    ['filter-views', 'filter-loves', 'filter-orders'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => {
          renderAllergenChart();
          renderDietChart();
        });
      }
    });

    // Weight mode toggle - re-render charts when mode changes
    document.querySelectorAll('input[name="weight-mode"]').forEach(radio => {
      radio.addEventListener('change', () => {
        renderAllergenChart();
        renderDietChart();
      });
    });

    // Tab switching for requests
    document.querySelectorAll('.tabs .tab-btn[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = btn.dataset.filter;
        document.querySelectorAll('.tabs .tab-btn[data-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderRequests(filter);
      });
    });

    // Modal buttons
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-implement').addEventListener('click', () => submitResponse('implemented'));
    document.getElementById('modal-decline').addEventListener('click', () => submitResponse('declined'));

    // Close modal on backdrop click
    document.getElementById('response-modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    if (brandItemsSearchInput) {
      brandItemsSearchInput.addEventListener('input', (event) => {
        brandItemsSearchQuery = event.target.value || '';
        renderBrandItemsSection();
      });
    }
    if (!window.__dashboardPanelResizeHandler) {
      window.__dashboardPanelResizeHandler = () => requestAnimationFrame(syncDashboardPanelHeights);
      window.addEventListener('resize', window.__dashboardPanelResizeHandler);
    }

    // Dish analytics modal buttons
    document.getElementById('dish-analytics-close').addEventListener('click', closeDishAnalyticsModal);
    document.getElementById('dish-analytics-modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeDishAnalyticsModal();
    });

    // Heatmap page navigation
    document.getElementById('heatmap-prev-btn').addEventListener('click', () => goToHeatmapPage('prev'));
    document.getElementById('heatmap-next-btn').addEventListener('click', () => goToHeatmapPage('next'));

    // Heatmap metric toggle
    document.querySelectorAll('.heatmap-metric-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const metric = btn.dataset.metric;
        if (metric !== currentHeatmapMetric) {
          currentHeatmapMetric = metric;
          document.querySelectorAll('.heatmap-metric-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          renderHeatmapOverlays();
        }
      });
    });

    // Info tooltip toggle function (global for onclick handlers)
    window.toggleInfoTooltip = function(event, tooltipId) {
      event.stopPropagation();
      const tooltip = document.getElementById(tooltipId);
      const wasActive = tooltip.classList.contains('active');

      // Close all other tooltips
      document.querySelectorAll('.info-tooltip-popup.active').forEach(t => {
        t.classList.remove('active');
      });

      // Toggle this tooltip
      if (!wasActive) {
        tooltip.classList.add('active');
      }
    };

    // Close tooltips when clicking outside
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.info-tooltip-container')) {
        document.querySelectorAll('.info-tooltip-popup.active').forEach(t => {
          t.classList.remove('active');
        });
      }
    });

    // Initialize
    init();
  
