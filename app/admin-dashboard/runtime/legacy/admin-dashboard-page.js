    import supabase from './supabase-client.js';
    import { setupTopbar, attachSignOutHandler } from './shared-nav.js';
    import { fetchManagerRestaurants } from './manager-context.js';
    import { notifyManagerChat } from './chat-notifications.js';

    const ADMIN_EMAIL = 'matt.29.ds@gmail.com';
    const preloadedBoot = window.__adminDashboardBootPayload || null;
    const ADMIN_DISPLAY_NAME = 'Matt D (clarivore administrator)';
    let currentUser = null;
    let currentFilter = 'all';
    let allAppeals = [];
    let appealsLoadedAt = 0;
    let currentIssuesFilter = 'all';
    let allIssues = [];
    let currentReportsFilter = 'all';
    let allReports = [];
    let reportsLoaded = false;
    let allRestaurants = [];
    let allFeedback = [];
    let feedbackLoaded = false;
    let selectedRestaurantId = 'all';
    let managerAccessRestaurants = [];
    let managerAccessLoaded = false;
    const managerInviteLinks = {};
    const chatReadStates = {};
    const chatUnreadCounts = {};

    // Check authentication
    async function checkAuth() {
      let user = preloadedBoot?.user || null;
      if (!user) {
        const authResult = await supabase.auth.getUser();
        user = authResult?.data?.user || null;
      }

      let managerRestaurants = Array.isArray(preloadedBoot?.managerRestaurants)
        ? preloadedBoot.managerRestaurants
        : [];
      if (!managerRestaurants.length && user && user.email === ADMIN_EMAIL) {
        managerRestaurants = await fetchManagerRestaurants(supabase, user.id);
      }

      if (!preloadedBoot?.topbarSetupDone) {
        setupTopbar('admin', user, { managerRestaurants });
      }
      if (user && !preloadedBoot?.signOutHandlerBound) {
        attachSignOutHandler(supabase);
      }

      if (!user || user.email !== ADMIN_EMAIL) {
        document.getElementById('access-denied').style.display = 'block';
        return false;
      }

      currentUser = user;
      document.getElementById('admin-content').style.display = 'block';

      setupRestaurantSelector();
      loadRestaurants();
      return true;
    }

    let restaurantSelectorBound = false;

    function setupRestaurantSelector() {
      if (restaurantSelectorBound) return;
      restaurantSelectorBound = true;
      const select = document.getElementById('admin-restaurant-select');
      if (!select) return;
      select.addEventListener('change', () => {
        selectedRestaurantId = select.value;
        refreshTabData();
      });
    }

    function populateRestaurantSelector(restaurants) {
      const select = document.getElementById('admin-restaurant-select');
      if (!select) return;
      const options = [
        '<option value="all">All restaurants</option>',
        ...restaurants.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`)
      ];
      select.innerHTML = options.join('');
      select.disabled = restaurants.length === 0;
      const hasSelection = selectedRestaurantId && (selectedRestaurantId === 'all' || restaurants.some(r => r.id === selectedRestaurantId));
      if (!hasSelection) {
        selectedRestaurantId = 'all';
      }
      select.value = selectedRestaurantId;
    }

    function getSelectedRestaurant() {
      if (!selectedRestaurantId || selectedRestaurantId === 'all') return null;
      return allRestaurants.find(r => r.id === selectedRestaurantId) || null;
    }

    function refreshTabData() {
      renderRestaurants();
      renderManagerAccess();
      renderAppeals();
      renderFeedback();
      renderProductReports();
      renderAllergenIssues();
    }

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;
        
        // Update active tab button
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Update active tab content
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById(`tab-${tabName}`).classList.add('active');
        
        // Load data if switching to specific tabs
        if (tabName === 'appeals') {
          loadAppeals({ force: true });
        } else if (tabName === 'feedback') {
          loadAnonymousFeedback();
        } else if (tabName === 'allergen-issues') {
          loadAllergenIssues();
        } else if (tabName === 'product-reports') {
          loadProductReports();
        } else if (tabName === 'managers') {
          loadManagerAccess();
        }
      });
    });

    // Restaurant Management Functions
    function compressImage(dataUrl, maxWidth = 1200, quality = 0.8) {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = dataUrl;
      });
    }

    document.getElementById('menu-image').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        const compressed = await compressImage(event.target.result);
        const preview = document.getElementById('image-preview');
        preview.src = compressed;
        preview.classList.add('show');
      };
      reader.readAsDataURL(file);
    });

    async function loadRestaurants() {
      const { data: restaurants, error } = await supabase
        .from('restaurants')
        .select('id, name, slug')
        .order('name');

      const list = document.getElementById('restaurants-list');

      if (error) {
        if (list) {
          list.innerHTML = `<p style="color: #ef4444;">Error loading restaurants: ${error.message}</p>`;
        }
        return;
      }

      allRestaurants = restaurants || [];
      populateRestaurantSelector(allRestaurants);
      refreshTabData();
    }

    function renderRestaurants() {
      const list = document.getElementById('restaurants-list');
      if (!list) return;

      const selectedRestaurant = getSelectedRestaurant();
      const restaurants = selectedRestaurant
        ? allRestaurants.filter(r => r.id === selectedRestaurant.id)
        : allRestaurants;

      if (!restaurants || restaurants.length === 0) {
        list.innerHTML = '<p style="color: #718096;">No restaurants found for the selected filter.</p>';
        return;
      }

      list.innerHTML = restaurants.map(r => `
        <div class="restaurant-item">
          <div class="restaurant-item-header">
            <div>
              <div class="restaurant-title-row">
                <div class="restaurant-title-left">
                  <h3>${escapeHtml(r.name)} <span class="chat-badge" id="restaurant-unread-${r.id}" style="display:none">0</span></h3>
                  <button class="btn-warning acknowledge-btn" data-action="acknowledge" data-id="${r.id}" data-name="${escapeHtml(r.name)}" style="display:none">Acknowledge message(s)</button>
                </div>
              </div>
              <p>${r.slug || 'no-slug'}</p>
            </div>
            <div class="restaurant-actions">
              <button class="btn-secondary" data-action="chat" data-id="${r.id}" data-name="${escapeHtml(r.name)}">Direct chat</button>
              <button class="btn-danger" data-action="delete" data-id="${r.id}" data-name="${escapeHtml(r.name)}">Delete</button>
            </div>
          </div>
          <details class="restaurant-chat-preview" id="chat-details-${r.id}" style="display:none">
            <summary>Direct chat preview</summary>
            <div class="restaurant-chat-body">
              <div class="restaurant-chat-messages" id="chat-preview-${r.id}">
                <div class="restaurant-chat-empty">No messages yet.</div>
              </div>
              <div class="restaurant-chat-compose">
                <input
                  class="restaurant-chat-input"
                  type="text"
                  placeholder="Message ${escapeHtml(r.name)}"
                  data-chat-input="${r.id}"
                  data-chat-name="${escapeHtml(r.name)}"
                >
                <button class="btn-secondary" data-action="send-chat" data-id="${r.id}" data-name="${escapeHtml(r.name)}">Send</button>
              </div>
            </div>
          </details>
        </div>
      `).join('');

      list.onclick = (event) => {
        const btn = event.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const restaurantId = btn.dataset.id;
        const restaurantName = btn.dataset.name || 'this restaurant';
        if (!restaurantId) return;
        if (action === 'chat') {
          openRestaurantChat(restaurantId, restaurantName);
          return;
        }
        if (action === 'send-chat') {
          sendChatMessage(restaurantId, restaurantName);
          return;
        }
        if (action === 'acknowledge') {
          acknowledgeChat(restaurantId, restaurantName);
          return;
        }
        if (action === 'delete') {
          deleteRestaurant(restaurantId, restaurantName);
        }
      };

      list.onkeydown = (event) => {
        const target = event.target;
        if (!target || !target.matches('[data-chat-input]')) return;
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          const restaurantId = target.dataset.chatInput;
          const restaurantName = target.dataset.chatName || 'this restaurant';
          if (restaurantId) {
            sendChatMessage(restaurantId, restaurantName);
          }
        }
      };

      if (restaurants.length) {
        loadChatPreviews(restaurants);
      }
    }

    const CHAT_PREVIEW_LIMIT = 3;
    const CHAT_THREAD_LIMIT = 50;

    async function loadChatPreviews(restaurants) {
      const restaurantIds = (restaurants || []).map(r => r.id).filter(Boolean);
      if (restaurantIds.length === 0) return;

      try {
        const { data, error } = await supabase
          .from('restaurant_direct_messages')
          .select('id, restaurant_id, message, sender_role, sender_name, created_at')
          .in('restaurant_id', restaurantIds)
          .order('created_at', { ascending: false })
          .limit(200);

        if (error) throw error;

        const restaurantNameById = new Map((restaurants || []).map(r => [r.id, r.name || 'Restaurant']));
        await loadChatReadStates(restaurantIds);

        const grouped = {};
        (data || []).forEach(msg => {
          const id = msg.restaurant_id;
          if (!grouped[id]) grouped[id] = [];
          if (grouped[id].length < CHAT_PREVIEW_LIMIT) {
            grouped[id].push(msg);
          }
        });

        await Promise.all(restaurantIds.map(async (id) => {
          const messages = (grouped[id] || []).slice().reverse();
          const unreadCount = await getUnreadCount(id, chatReadStates[id]?.admin?.last_read_at);
          chatUnreadCounts[id] = unreadCount;
          renderChatMessages(id, messages, {
            viewerRole: 'admin',
            restaurantName: restaurantNameById.get(id) || 'Restaurant',
            acknowledgements: {
              admin: chatReadStates[id]?.admin || null,
              restaurant: chatReadStates[id]?.restaurant || null
            }
          });
          updateChatIndicators(id);
        }));
      } catch (error) {
        console.error('Error loading chat previews:', error);
        restaurantIds.forEach(id => {
          renderChatMessages(id, [], { viewerRole: 'admin' });
        });
      }
    }

    async function loadChatReadStates(restaurantIds) {
      try {
        const { data, error } = await supabase
          .from('restaurant_direct_message_reads')
          .select('restaurant_id, reader_role, last_read_at, acknowledged_at')
          .in('reader_role', ['admin', 'restaurant'])
          .in('restaurant_id', restaurantIds);

        if (error) throw error;

        restaurantIds.forEach(id => {
          chatReadStates[id] = { admin: null, restaurant: null };
        });
        (data || []).forEach(row => {
          if (!chatReadStates[row.restaurant_id]) {
            chatReadStates[row.restaurant_id] = { admin: null, restaurant: null };
          }
          if (row.reader_role === 'admin') chatReadStates[row.restaurant_id].admin = row;
          if (row.reader_role === 'restaurant') chatReadStates[row.restaurant_id].restaurant = row;
        });
      } catch (error) {
        console.error('Error loading chat read states:', error);
      }
    }

    async function getUnreadCount(restaurantId, lastReadAt) {
      try {
        let query = supabase
          .from('restaurant_direct_messages')
          .select('id', { count: 'exact', head: true })
          .eq('restaurant_id', restaurantId)
          .eq('sender_role', 'restaurant');

        if (lastReadAt) {
          query = query.gt('created_at', lastReadAt);
        }

        const { count, error } = await query;
        if (error) throw error;
        return count || 0;
      } catch (error) {
        console.error('Error counting unread messages:', error);
        return 0;
      }
    }

    function updateChatIndicators(restaurantId) {
      const unreadCount = chatUnreadCounts[restaurantId] || 0;
      const badge = document.getElementById(`restaurant-unread-${restaurantId}`);
      const ackBtn = document.querySelector(`[data-action="acknowledge"][data-id="${restaurantId}"]`);
      const details = document.getElementById(`chat-details-${restaurantId}`);
      const preview = document.getElementById(`chat-preview-${restaurantId}`);
      const hasMessages = preview && preview.querySelector('.restaurant-chat-message');

      if (badge) {
        if (unreadCount > 0) {
          badge.textContent = unreadCount;
          badge.style.display = 'inline-flex';
        } else {
          badge.style.display = 'none';
        }
      }

      if (ackBtn) {
        ackBtn.style.display = unreadCount > 0 ? 'inline-flex' : 'none';
      }

      if (details) {
        if (hasMessages || unreadCount > 0) {
          details.style.display = 'block';
        } else {
          details.style.display = 'none';
        }
      }
    }

    async function loadChatThread(restaurantId, restaurantName) {
      if (!restaurantId) return;
      const container = document.getElementById(`chat-preview-${restaurantId}`);
      if (container) {
        container.innerHTML = '<div class="restaurant-chat-empty">Loading chat...</div>';
      }

      try {
        const { data, error } = await supabase
          .from('restaurant_direct_messages')
          .select('id, restaurant_id, message, sender_role, sender_name, created_at')
          .eq('restaurant_id', restaurantId)
          .order('created_at', { ascending: false })
          .limit(CHAT_THREAD_LIMIT);

        if (error) throw error;
        const messages = (data || []).slice().reverse();
        await loadChatReadStates([restaurantId]);
        const unreadCount = await getUnreadCount(restaurantId, chatReadStates[restaurantId]?.admin?.last_read_at);
        chatUnreadCounts[restaurantId] = unreadCount;
        renderChatMessages(restaurantId, messages, {
          viewerRole: 'admin',
          restaurantName: restaurantName || 'Restaurant',
          acknowledgements: {
            admin: chatReadStates[restaurantId]?.admin || null,
            restaurant: chatReadStates[restaurantId]?.restaurant || null
          }
        });
        updateChatIndicators(restaurantId);
      } catch (error) {
        console.error('Error loading chat thread:', error);
        renderChatMessages(restaurantId, [], { viewerRole: 'admin', emptyMessage: 'Unable to load chat.' });
      }
    }

    function renderChatMessages(restaurantId, messages, options = {}) {
      const container = document.getElementById(`chat-preview-${restaurantId}`);
      if (!container) return;

      if (!messages || messages.length === 0) {
        const emptyMessage = options.emptyMessage || 'No messages yet.';
        container.innerHTML = `<div class="restaurant-chat-empty">${escapeHtml(emptyMessage)}</div>`;
        return;
      }

      const lastIndexByRole = { admin: -1, restaurant: -1 };
      messages.forEach((message, index) => {
        if (message.sender_role === 'admin') lastIndexByRole.admin = index;
        if (message.sender_role === 'restaurant') lastIndexByRole.restaurant = index;
      });

      const acknowledgements = options.acknowledgements || {};
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
      const getRestaurantAckName = () => {
        const lastRestaurantMessage = [...messages].reverse().find((msg) => (
          msg.sender_role === 'restaurant' && msg.sender_name
        ));
        return lastRestaurantMessage?.sender_name || options.restaurantName || 'Restaurant';
      };
      if (acknowledgements.admin?.acknowledged_at) {
        const ackIndex = findAckIndex('restaurant', acknowledgements.admin.acknowledged_at);
        if (ackIndex >= 0) {
          ackEntries.push({
            index: ackIndex,
            name: ADMIN_DISPLAY_NAME,
            acknowledgedAt: acknowledgements.admin.acknowledged_at
          });
        }
      }
      if (acknowledgements.restaurant?.acknowledged_at) {
        const ackIndex = findAckIndex('admin', acknowledgements.restaurant.acknowledged_at);
        if (ackIndex >= 0) {
          ackEntries.push({
            index: ackIndex,
            name: getRestaurantAckName(),
            acknowledgedAt: acknowledgements.restaurant.acknowledged_at
          });
        }
      }

      const messageHtml = messages.map((message, index) => {
        const isOutgoing = options.viewerRole === 'admin' ? message.sender_role === 'admin' : message.sender_role === 'restaurant';
        const senderLabel = message.sender_name || (message.sender_role === 'admin' ? ADMIN_DISPLAY_NAME : 'Restaurant');
        const timestamp = message.created_at
          ? new Date(message.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
          : '';
        const appendAck = ackEntries
          .filter(entry => entry.index === index)
          .map(entry => {
            const ackDate = new Date(entry.acknowledgedAt);
            if (Number.isNaN(ackDate.getTime())) return '';
            return `<div class="chat-ack">${escapeHtml(entry.name)} acknowledged · ${escapeHtml(ackDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))}</div>`;
          })
          .join('');
        return `
          <div class="restaurant-chat-message ${isOutgoing ? 'chat-outgoing' : 'chat-incoming'}">
            <div class="restaurant-chat-bubble">
              <div class="restaurant-chat-text">${formatChatMessage(message.message)}</div>
              <div class="restaurant-chat-meta">${escapeHtml(senderLabel)}${timestamp ? ` · ${escapeHtml(timestamp)}` : ''}</div>
            </div>
          </div>
          ${appendAck}
        `;
      }).join('');

      container.innerHTML = messageHtml;

      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }

    async function sendChatMessage(restaurantId, restaurantName) {
      const input = document.querySelector(`[data-chat-input="${restaurantId}"]`);
      if (!input) return;
      const message = input.value.trim();
      if (!message) return;

      input.disabled = true;
      try {
        const senderName = ADMIN_DISPLAY_NAME;
        const { data: insertedMessage, error } = await supabase
          .from('restaurant_direct_messages')
          .insert({
            restaurant_id: restaurantId,
            message,
            sender_role: 'admin',
            sender_name: senderName,
            sender_id: currentUser?.id || null
          })
          .select('id')
          .single();

        if (error) throw error;

        input.value = '';
        if (insertedMessage?.id) {
          notifyManagerChat({ messageId: insertedMessage.id, client: supabase });
        }
        await loadChatThread(restaurantId, restaurantName);
      } catch (error) {
        console.error('Error sending chat message:', error);
        alert(`Error sending message: ${error.message}`);
      } finally {
        input.disabled = false;
        input.focus();
      }
    }

    async function acknowledgeChat(restaurantId, restaurantName) {
      try {
        const now = new Date().toISOString();
        const { error } = await supabase
          .from('restaurant_direct_message_reads')
          .upsert({
            restaurant_id: restaurantId,
            reader_role: 'admin',
            last_read_at: now,
            acknowledged_at: now
          }, { onConflict: 'restaurant_id,reader_role' });

        if (error) throw error;

        if (!chatReadStates[restaurantId]) {
          chatReadStates[restaurantId] = { admin: null, restaurant: null };
        }
        chatReadStates[restaurantId].admin = {
          restaurant_id: restaurantId,
          reader_role: 'admin',
          last_read_at: now,
          acknowledged_at: now
        };
        chatUnreadCounts[restaurantId] = 0;
        updateChatIndicators(restaurantId);
        await loadChatThread(restaurantId, restaurantName);
      } catch (error) {
        console.error('Error acknowledging chat:', error);
        alert(`Error acknowledging chat: ${error.message}`);
      }
    }

    async function deleteRestaurant(restaurantId, restaurantName) {
      const confirmed = confirm(`Delete "${restaurantName}" from the website? This cannot be undone.`);
      if (!confirmed) return;

      try {
        const { data, error } = await supabase
          .from('restaurants')
          .delete()
          .eq('id', restaurantId)
          .select('id');

        if (error) throw error;

        if (!data || data.length === 0) {
          showStatus(`Unable to delete ${restaurantName}. Check permissions and try again.`, true);
          return;
        }

        showStatus(`Deleted ${restaurantName}.`);
        await loadRestaurants();
      } catch (error) {
        console.error('Error deleting restaurant:', error);
        showStatus(`Error deleting restaurant: ${error.message}`, true);
      }
    }

    function openRestaurantChat(restaurantId, restaurantName) {
      const preview = document.getElementById(`chat-preview-${restaurantId}`);
      const details = preview?.closest('details');
      if (details) {
        details.style.display = 'block';
        details.open = true;
        loadChatThread(restaurantId, restaurantName);
        details.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const input = details.querySelector(`[data-chat-input="${restaurantId}"]`);
        if (input) {
          input.focus();
        }
      }
    }

    async function loadAnonymousFeedback() {
      const list = document.getElementById('feedback-list');
      if (!list) return;
      list.innerHTML = '<p style="color: #718096;">Loading feedback...</p>';

      try {
        const { data: feedback, error } = await supabase
          .from('order_feedback')
          .select('id, restaurant_feedback, website_feedback, created_at, restaurant_id, restaurants(name)')
          .is('user_email', null)
          .order('created_at', { ascending: false });

        if (error) throw error;
        allFeedback = feedback || [];
        feedbackLoaded = true;
        renderFeedback();
      } catch (error) {
        console.error('Error loading feedback:', error);
        list.innerHTML = `<p style="color: #ef4444;">Error loading feedback: ${error.message}</p>`;
      }
    }

    function renderFeedback() {
      const list = document.getElementById('feedback-list');
      if (!list || !feedbackLoaded) return;

      const selectedRestaurant = getSelectedRestaurant();
      const filtered = selectedRestaurant
        ? allFeedback.filter(entry => entry.restaurant_id === selectedRestaurant.id)
        : allFeedback;

      if (!filtered.length) {
        const emptyMessage = selectedRestaurant
          ? 'No anonymous feedback for the selected restaurant.'
          : 'No anonymous feedback yet.';
        list.innerHTML = `<p style="color: #718096;">${emptyMessage}</p>`;
        return;
      }

      list.innerHTML = filtered.map(entry => {
        const restaurantName = entry.restaurants?.name || 'Unknown restaurant';
        const restaurantFeedback = entry.restaurant_feedback?.trim();
        const websiteFeedback = entry.website_feedback?.trim();
        const createdAt = entry.created_at ? new Date(entry.created_at).toLocaleString() : 'Unknown date';
        return `
          <div class="feedback-card">
            <div class="feedback-meta">
              <span>${escapeHtml(restaurantName)}</span>
              <span>${escapeHtml(createdAt)}</span>
            </div>
            ${restaurantFeedback ? `<div class="feedback-text"><strong>Restaurant:</strong> ${escapeHtml(restaurantFeedback)}</div>` : ''}
            ${websiteFeedback ? `<div class="feedback-text" style="margin-top:8px;"><strong>Clarivore:</strong> ${escapeHtml(websiteFeedback)}</div>` : ''}
            ${!restaurantFeedback && !websiteFeedback ? `<div class="feedback-text">No written feedback provided.</div>` : ''}
          </div>
        `;
      }).join('');
    }

    function generateToken(length = 32) {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let token = '';
      const randomValues = new Uint32Array(length);
      crypto.getRandomValues(randomValues);
      for (let i = 0; i < length; i++) {
        token += chars[randomValues[i] % chars.length];
      }
      return token;
    }

    // Generate the correct invite URL based on entry page
    function getInviteUrl(token, entryPage) {
      if (entryPage && entryPage.startsWith('restaurant:')) {
        const slug = entryPage.replace('restaurant:', '');
        return `${window.location.origin}/restaurant?slug=${encodeURIComponent(slug)}&qr=1&invite=${token}`;
      }
      // Homepage or default - go to account page
      return `${window.location.origin}/account?invite=${token}`;
    }

    async function createManagerInviteLink(restaurantId, button) {
      if (!restaurantId) return;
      if (!currentUser) {
        alert('You must be signed in as an administrator to generate invites.');
        return;
      }

      const originalText = button ? button.textContent : '';
      if (button) {
        button.disabled = true;
        button.textContent = 'Generating...';
      }

      try {
        const token = generateToken();
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
        const entryPage = 'dashboard';

        const { error } = await supabase
          .from('manager_invites')
          .insert({
            token,
            restaurant_ids: [restaurantId],
            entry_page: entryPage,
            expires_at: expiresAt.toISOString(),
            created_by: currentUser.id
          })
          .select()
          .single();

        if (error) throw error;

        const inviteUrl = getInviteUrl(token, entryPage);
        managerInviteLinks[restaurantId] = inviteUrl;
        renderManagerAccess();
      } catch (error) {
        console.error('Error generating invite link:', error);
        alert(`Error generating invite link: ${error.message || error}`);
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = originalText;
        }
      }
    }

    async function copyManagerInviteLink(restaurantId, button) {
      const link = managerInviteLinks[restaurantId];
      if (!link) return;

      let copied = false;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(link);
          copied = true;
        }
      } catch (_) {
        copied = false;
      }

      if (!copied) {
        const textarea = document.createElement('textarea');
        textarea.value = link;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
          copied = document.execCommand('copy');
        } catch (_) {
          copied = false;
        }
        document.body.removeChild(textarea);
      }

      if (button) {
        const originalText = button.textContent;
        button.textContent = copied ? 'Copied!' : 'Copy failed';
        setTimeout(() => {
          button.textContent = originalText;
        }, 2000);
      }
    }

    let managerAccessBound = false;

    async function loadManagerAccess() {
      const container = document.getElementById('manager-access-list');
      if (!container) return;
      container.innerHTML = '<p style="color: #718096;">Loading manager access...</p>';

      try {
        const { data, error } = await supabase.functions.invoke('admin-managers', {
          body: { action: 'list' }
        });
        if (error) throw error;
        managerAccessRestaurants = data?.restaurants || [];
        managerAccessLoaded = true;
        renderManagerAccess();
      } catch (error) {
        console.error('Error loading manager access:', error);
        container.innerHTML = `<p style="color: #ef4444;">Error loading manager access: ${error.message || error}</p>`;
      }

      if (!managerAccessBound) {
        managerAccessBound = true;
        container.addEventListener('click', (event) => {
          const btn = event.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.dataset.action;
          if (action === 'remove-manager') {
            const restaurantId = btn.dataset.restaurantId;
            const userId = btn.dataset.userId;
            const label = btn.dataset.label || 'this manager';
            if (!restaurantId || !userId) return;
            removeManagerAccess(restaurantId, userId, label);
            return;
          }
          if (action === 'create-invite') {
            const restaurantId = btn.dataset.restaurantId;
            if (!restaurantId) return;
            createManagerInviteLink(restaurantId, btn);
            return;
          }
          if (action === 'copy-invite') {
            const restaurantId = btn.dataset.restaurantId;
            if (!restaurantId) return;
            copyManagerInviteLink(restaurantId, btn);
          }
        });
      }
    }

    function renderManagerAccess() {
      const container = document.getElementById('manager-access-list');
      if (!container) return;

      if (!managerAccessLoaded) return;

      if (!managerAccessRestaurants.length) {
        container.innerHTML = '<p style="color: #718096;">No restaurants found.</p>';
        return;
      }

      const selectedRestaurant = getSelectedRestaurant();
      if (!selectedRestaurant) {
        container.innerHTML = '<p style="color: #718096;">Select a restaurant above to view managers.</p>';
        return;
      }

      const restaurant = managerAccessRestaurants.find(r => r.id === selectedRestaurant.id);
      if (!restaurant) {
        container.innerHTML = '<p style="color: #718096;">No manager data found for this restaurant.</p>';
        return;
      }

      const managers = Array.isArray(restaurant.managers) ? restaurant.managers : [];

      const managerRows = managers.map((manager) => {
        const name = manager.name || '';
        const email = manager.email || '';
        const userId = manager.user_id || '';
        const addedAt = manager.created_at ? new Date(manager.created_at).toLocaleString() : '';
        const label = name || email || userId || 'Manager';
        return `
          <tr>
            <td>${escapeHtml(name || '—')}</td>
            <td>${escapeHtml(email || '—')}</td>
            <td><span style="font-family: monospace;">${escapeHtml(userId || '—')}</span></td>
            <td>${escapeHtml(addedAt || '—')}</td>
            <td>
              <button
                class="btn-danger"
                data-action="remove-manager"
                data-restaurant-id="${escapeHtml(restaurant.id || '')}"
                data-user-id="${escapeHtml(userId)}"
                data-label="${escapeHtml(label)}"
              >Remove</button>
            </td>
          </tr>
        `;
      }).join('');

      const tableHtml = managers.length
        ? `
          <table class="manager-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>User ID</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${managerRows}
            </tbody>
          </table>
        `
        : `<div class="manager-empty">No managers assigned yet.</div>`;

      const inviteLink = managerInviteLinks[restaurant.id] || '';
      const inviteOutputClass = inviteLink ? 'manager-invite-output show' : 'manager-invite-output';

      container.innerHTML = `
        <div class="manager-access-card">
          <div class="manager-access-header">
            <h3>${escapeHtml(restaurant.name || 'Restaurant')}</h3>
            <span style="color:#64748b;font-size:0.85rem;">${escapeHtml(restaurant.slug || '')}</span>
          </div>
          ${tableHtml}
          <div class="manager-invite-actions">
            <button class="btn-primary" data-action="create-invite" data-restaurant-id="${escapeHtml(restaurant.id || '')}">
              + Create Manager Invite Link
            </button>
            <div class="manager-invite-note">Invite links expire after 48 hours and send users to the dashboard.</div>
            <div class="${inviteOutputClass}">
              <input type="text" readonly value="${escapeHtml(inviteLink)}">
              <button class="btn-secondary" data-action="copy-invite" data-restaurant-id="${escapeHtml(restaurant.id || '')}">Copy</button>
            </div>
          </div>
        </div>
      `;
    }

    async function removeManagerAccess(restaurantId, userId, label) {
      if (!confirm(`Remove manager access for ${label}?`)) return;

      try {
        const { data, error } = await supabase.functions.invoke('admin-managers', {
          body: { action: 'revoke', restaurantId, userId }
        });
        if (error) throw error;
        await loadManagerAccess();
      } catch (error) {
        console.error('Error removing manager access:', error);
        alert(`Error removing manager access: ${error.message || error}`);
      }
    }

    function showStatus(message, isError = false) {
      const statusEl = document.getElementById('status-message');
      statusEl.textContent = message;
      statusEl.className = `status-message show ${isError ? 'error' : 'success'}`;

      setTimeout(() => {
        statusEl.classList.remove('show');
      }, 5000);
    }

    // Generate and download QR code for a restaurant
    async function generateAndDownloadQRCode(slug, restaurantName) {
      const url = `https://clarivore.org/restaurant?slug=${encodeURIComponent(slug)}`;

      try {
        // Create a canvas element for the QR code
        const canvas = document.createElement('canvas');

        // Generate QR code on canvas
        await QRCode.toCanvas(canvas, url, {
          width: 512,
          margin: 2,
          color: {
            dark: '#1e3a5f',  // Dark blue color matching the site theme
            light: '#ffffff'
          }
        });

        // Convert canvas to blob and download
        canvas.toBlob((blob) => {
          const downloadUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = `${slug}-qr-code.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(downloadUrl);
        }, 'image/png');

      } catch (err) {
        console.error('Error generating QR code:', err);
        // Don't fail the whole operation if QR generation fails
      }
    }

    document.getElementById('add-restaurant-form').addEventListener('submit', async (e) => {
      e.preventDefault();

      const submitBtn = document.getElementById('submit-btn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Adding restaurant...';

      try {
        const name = document.getElementById('restaurant-name').value;
        const website = document.getElementById('restaurant-website').value;
        const description = document.getElementById('restaurant-description').value;

        const preview = document.getElementById('image-preview');
        const menuImage = preview.src;

        if (!menuImage || menuImage === window.location.href) {
          throw new Error('Please select a menu image');
        }

        const { data: restaurant, error } = await supabase
          .from('restaurants')
          .insert({
            name,
            slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
            menu_image: menuImage,
            overlays: [],
            last_confirmed: null
          })
          .select()
          .single();

        if (error) throw error;

        showStatus(`✓ Successfully added ${name}! Downloading QR code...`);

        // Generate and download QR code for the restaurant
        await generateAndDownloadQRCode(restaurant.slug, name);

        document.getElementById('add-restaurant-form').reset();
        preview.classList.remove('show');
        preview.src = '';

        loadRestaurants();

      } catch (error) {
        console.error('Error adding restaurant:', error);
        showStatus('Error: ' + error.message, true);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add Restaurant';
      }
    });

    // Appeals Management Functions
    async function loadAppeals({ force = false } = {}) {
      try {
        document.getElementById('loading-appeals').style.display = 'block';
        document.getElementById('appeals-list').innerHTML = '';
        document.getElementById('no-appeals').style.display = 'none';

        if (!force && allAppeals.length && (Date.now() - appealsLoadedAt) < 30000) {
          renderAppeals();
          return;
        }

        const { data: appeals, error } = await supabase
          .from('ingredient_scan_appeals')
          .select(`
            id,
            ingredient_name,
            restaurant_id,
            dish_name,
            submitted_at,
            review_status,
            reviewed_at,
            manager_message,
            photo_url,
            review_notes
          `)
          .order('submitted_at', { ascending: false })
          .limit(200);

        if (error) throw error;

        const restaurantIds = [...new Set((appeals || [])
          .map(appeal => appeal.restaurant_id)
          .filter(Boolean))];

        const restaurantLookup = {};
        if (restaurantIds.length) {
          const { data: restaurants, error: restaurantError } = await supabase
            .from('restaurants')
            .select('id, name, slug')
            .in('id', restaurantIds);

          if (restaurantError) {
            console.warn('Failed to load restaurant names for appeals:', restaurantError);
          } else {
            (restaurants || []).forEach(r => {
              restaurantLookup[r.id] = r;
            });
          }
        }

        allAppeals = (appeals || []).map(appeal => ({
          ...appeal,
          restaurants: restaurantLookup[appeal.restaurant_id] || null
        }));
        appealsLoadedAt = Date.now();
        renderAppeals();

      } catch (error) {
        console.error('Error loading appeals:', error);
        document.getElementById('loading-appeals').innerHTML = `<p style="color: #ef4444;">Error loading appeals: ${error.message}</p>`;
      } finally {
        document.getElementById('loading-appeals').style.display = 'none';
      }
    }

    function renderAppeals() {
      if (!allAppeals.length && !appealsLoadedAt) {
        return;
      }

      const selectedRestaurant = getSelectedRestaurant();
      const restaurantFiltered = selectedRestaurant
        ? allAppeals.filter(a => a.restaurant_id === selectedRestaurant.id)
        : allAppeals;

      const filtered = currentFilter === 'all' 
        ? restaurantFiltered 
        : restaurantFiltered.filter(a => a.review_status === currentFilter || (!a.review_status && currentFilter === 'pending'));

      if (filtered.length === 0) {
        document.getElementById('no-appeals').style.display = 'block';
        document.getElementById('appeals-list').innerHTML = '';
        return;
      }

      document.getElementById('no-appeals').style.display = 'none';
      
      const appealsHTML = filtered.map(appeal => {
        const restaurant = appeal.restaurants || {};
        const status = appeal.review_status || 'pending';
        const submittedDate = new Date(appeal.submitted_at).toLocaleString();
        
        return `
          <div class="appeal-card ${status}">
            <div class="appeal-header">
              <div class="appeal-info">
                <h3>${escapeHtml(appeal.ingredient_name)}</h3>
                <div class="appeal-meta">
                  <span><strong>Restaurant:</strong> ${escapeHtml(restaurant.name || 'Unknown')}</span>
                  ${appeal.dish_name ? `<span><strong>Dish:</strong> ${escapeHtml(appeal.dish_name)}</span>` : ''}
                  <span><strong>Submitted:</strong> ${submittedDate}</span>
                  ${appeal.reviewed_at ? `<span><strong>Reviewed:</strong> ${new Date(appeal.reviewed_at).toLocaleString()}</span>` : ''}
                </div>
              </div>
              <span class="appeal-status ${status}">${status}</span>
            </div>

            ${appeal.manager_message ? `
              <div class="appeal-message">
                <strong>Manager Message:</strong> ${escapeHtml(appeal.manager_message)}
              </div>
            ` : ''}
            ${appeal.photo_url ? `
              <div style="margin: 16px 0;">
                <strong style="color: #1e3a5f; display: block; margin-bottom: 8px;">Photo submitted:</strong>
                <img src="${appeal.photo_url}" alt="Appeal photo" class="appeal-photo" loading="lazy" decoding="async" onclick="openPhotoModal('${appeal.photo_url}')">
              </div>
            ` : ''}

            ${status === 'pending' ? `
              <div class="review-notes">
                <label style="color: #1e3a5f; display: block; margin-bottom: 8px; font-weight: 600;"><strong>Review Notes (optional):</strong></label>
                <textarea id="notes-${appeal.id}" placeholder="Add any notes about your decision..."></textarea>
              </div>
              <div class="appeal-actions">
                <button class="btn-approve" onclick="reviewAppeal('${appeal.id}', 'approved')">✓ Approve</button>
                <button class="btn-deny" onclick="reviewAppeal('${appeal.id}', 'rejected')">✗ Deny</button>
                ${restaurant.slug ? `<a href="/restaurant?slug=${restaurant.slug}" class="btn-view-restaurant" target="_blank">View Restaurant</a>` : ''}
              </div>
            ` : `
              <div class="appeal-actions">
                ${appeal.review_notes ? `<p style="color: #1e3a5f;"><strong style="color: #1e3a5f;">Review Notes:</strong> ${escapeHtml(appeal.review_notes)}</p>` : ''}
                ${restaurant.slug ? `<a href="/restaurant?slug=${restaurant.slug}" class="btn-view-restaurant" target="_blank">View Restaurant</a>` : ''}
              </div>
            `}
          </div>
        `;
      }).join('');

      document.getElementById('appeals-list').innerHTML = appealsHTML;
    }

    function buildAppealDetailsLink(appeal) {
      const restaurant = appeal?.restaurants || {};
      const slug = restaurant.slug || '';
      if (!slug) return '';
      try {
        const url = new URL('/restaurant', window.location.origin);
        url.searchParams.set('slug', slug);
        url.searchParams.set('edit', '1');
        const dishName = (appeal?.dish_name || '').trim();
        if (dishName) {
          url.searchParams.set('openAI', 'true');
          url.searchParams.set('dishName', dishName);
        }
        const ingredientName = (appeal?.ingredient_name || '').trim();
        if (ingredientName) {
          url.searchParams.set('ingredientName', ingredientName);
        }
        return url.toString();
      } catch (_) {
        const params = new URLSearchParams();
        params.set('slug', slug);
        params.set('edit', '1');
        const dishName = (appeal?.dish_name || '').trim();
        if (dishName) {
          params.set('openAI', 'true');
          params.set('dishName', dishName);
        }
        const ingredientName = (appeal?.ingredient_name || '').trim();
        if (ingredientName) {
          params.set('ingredientName', ingredientName);
        }
        return `/restaurant?${params.toString()}`;
      }
    }

    async function reviewAppeal(appealId, status) {
      const notesTextarea = document.getElementById(`notes-${appealId}`);
      const reviewNotes = notesTextarea ? notesTextarea.value.trim() : '';

      if (!confirm(`Are you sure you want to ${status === 'approved' ? 'approve' : 'deny'} this appeal?`)) {
        return;
      }

      try {
        const { error } = await supabase
          .from('ingredient_scan_appeals')
          .update({
            review_status: status,
            reviewed_at: new Date().toISOString(),
            review_notes: reviewNotes || null
          })
          .eq('id', appealId);

        if (error) throw error;

        try {
          const appeal = allAppeals.find(a => a.id === appealId);
          if (appeal && appeal.restaurant_id) {
            const dishLabel = appeal.dish_name || appeal.ingredient_name || 'this dish';
            const decisionLabel = status === 'approved' ? 'approved' : 'denied';
            const detailsLink = buildAppealDetailsLink(appeal);
            const linkText = detailsLink
              ? ` Click [here](${detailsLink}) to see details.`
              : ' Please check your dashboard for details.';
            const messageText = `Your ingredient list scanning appeal for ${dishLabel} has been ${decisionLabel}.${linkText}`;

            const { data: insertedMessage, error: messageError } = await supabase
              .from('restaurant_direct_messages')
              .insert({
                restaurant_id: appeal.restaurant_id,
                message: messageText,
                sender_role: 'admin',
                sender_name: 'Automated alert system',
                sender_id: currentUser?.id || null
              })
              .select('id')
              .single();

            if (messageError) {
              console.warn('Failed to send appeal decision message:', messageError);
            } else if (insertedMessage?.id) {
              notifyManagerChat({ messageId: insertedMessage.id, client: supabase });
            }
          }
        } catch (notifyError) {
          console.warn('Appeal decision chat notification failed:', notifyError);
        }

        await loadAppeals({ force: true });

        const message = document.createElement('div');
        message.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #4caf50; color: white; padding: 16px 24px; border-radius: 8px; z-index: 10001; box-shadow: 0 4px 12px rgba(0,0,0,0.2);';
        message.textContent = `Appeal ${status === 'approved' ? 'approved' : 'denied'} successfully!`;
        document.body.appendChild(message);
        setTimeout(() => message.remove(), 3000);

      } catch (error) {
        console.error('Error reviewing appeal:', error);
        alert(`Error ${status === 'approved' ? 'approving' : 'denying'} appeal: ${error.message}`);
      }
    }

    function openPhotoModal(photoUrl) {
      const modal = document.getElementById('photo-modal');
      const img = document.getElementById('modal-photo');
      img.src = photoUrl;
      modal.classList.add('show');
    }

    function closePhotoModal() {
      document.getElementById('photo-modal').classList.remove('show');
    }

    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('filter-btn')) {
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        currentFilter = e.target.dataset.filter;
        renderAppeals();
      }
      
      if (e.target.classList.contains('filter-btn-issues')) {
        document.querySelectorAll('.filter-btn-issues').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        currentIssuesFilter = e.target.dataset.filterIssues;
        renderAllergenIssues();
      }

      if (e.target.classList.contains('filter-btn-reports')) {
        document.querySelectorAll('.filter-btn-reports').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        currentReportsFilter = e.target.dataset.filterReports;
        renderProductReports();
      }
    });

    // Load allergen detection issues
    async function loadAllergenIssues() {
      const loadingEl = document.getElementById('loading-issues');
      const listEl = document.getElementById('issues-list');
      const emptyEl = document.getElementById('no-issues');
      if (!loadingEl || !listEl || !emptyEl) return;
      try {
        loadingEl.style.display = 'block';
        listEl.innerHTML = '';
        emptyEl.style.display = 'none';

        const { data: issues, error } = await supabase
          .from('allergen_detection_issues')
          .select('*')
          .order('submitted_at', { ascending: false });

        if (error) throw error;

        allIssues = issues || [];
        renderAllergenIssues();

      } catch (error) {
        console.error('Error loading allergen issues:', error);
        loadingEl.innerHTML = `<p style="color: #ef4444;">Error loading issues: ${error.message}</p>`;
      } finally {
        loadingEl.style.display = 'none';
      }
    }

    // Render allergen issues based on current filter
    function renderAllergenIssues() {
      const listEl = document.getElementById('issues-list');
      const emptyEl = document.getElementById('no-issues');
      if (!listEl || !emptyEl) return;
      const selectedRestaurant = getSelectedRestaurant();
      const restaurantFiltered = selectedRestaurant
        ? allIssues.filter(issue => {
            if (issue.restaurant_id && issue.restaurant_id === selectedRestaurant.id) return true;
            if (issue.restaurant_slug && selectedRestaurant.slug && issue.restaurant_slug === selectedRestaurant.slug) return true;
            if (issue.restaurant_name && selectedRestaurant.name && issue.restaurant_name.toLowerCase().trim() === selectedRestaurant.name.toLowerCase().trim()) return true;
            return false;
          })
        : allIssues;

      const filtered = currentIssuesFilter === 'all' 
        ? restaurantFiltered 
        : restaurantFiltered.filter(i => i.status === currentIssuesFilter);

      if (filtered.length === 0) {
        emptyEl.style.display = 'block';
        listEl.innerHTML = '';
        return;
      }

      emptyEl.style.display = 'none';
      
      const issuesHTML = filtered.map(issue => {
        const status = issue.status || 'pending';
        const submittedDate = new Date(issue.submitted_at).toLocaleString();
        const resolvedDate = issue.resolved_at ? new Date(issue.resolved_at).toLocaleString() : null;
        
        return `
          <div class="appeal-card ${status}" style="border-left-color: #dc2626;">
            <div class="appeal-header">
              <div class="appeal-info">
                <h3>${escapeHtml(issue.product_name)}</h3>
                <div class="appeal-meta">
                  <span><strong>Restaurant:</strong> ${escapeHtml(issue.restaurant_name || 'Unknown')}</span>
                  <span><strong>Submitted:</strong> ${submittedDate}</span>
                  ${resolvedDate ? `<span><strong>Resolved:</strong> ${resolvedDate}</span>` : ''}
                </div>
              </div>
              <span class="appeal-status ${status}">${status}</span>
            </div>

            <div style="margin: 16px 0;">
              <strong style="color: #1e3a5f; display: block; margin-bottom: 8px;">Manager Comment:</strong>
              <p style="background: #fff3cd; padding: 12px; border-radius: 8px; margin-top: 8px; color: #856404; white-space: pre-wrap; line-height: 1.5;">${escapeHtml(issue.manager_comment)}</p>
            </div>

            ${issue.ingredient_list ? `
              <div style="margin: 16px 0;">
                <strong style="color: #1e3a5f; display: block; margin-bottom: 8px;">Ingredient List:</strong>
                <div style="background: #f5f5f5; padding: 12px; border-radius: 8px; margin-top: 8px; font-family: monospace; font-size: 0.9rem; white-space: pre-wrap; color: #1e3a5f; line-height: 1.5;">${escapeHtml(issue.ingredient_list)}</div>
              </div>
            ` : ''}

            <div style="margin: 16px 0;">
              <strong style="color: #1e3a5f; display: block; margin-bottom: 4px;">Detected Allergens:</strong>
              <span style="color: #1e3a5f;">${issue.detected_allergens && issue.detected_allergens.length > 0 ? issue.detected_allergens.join(', ') : 'None'}</span>
            </div>

            <div style="margin: 16px 0;">
              <strong style="color: #1e3a5f; display: block; margin-bottom: 4px;">Detected Diets:</strong>
              <span style="color: #1e3a5f;">${issue.detected_diets && issue.detected_diets.length > 0 ? issue.detected_diets.join(', ') : 'None'}</span>
            </div>

            ${status === 'pending' ? `
              <div class="review-notes">
                <label style="color: #1e3a5f; display: block; margin-bottom: 8px; font-weight: 600;"><strong>Resolution Notes (optional):</strong></label>
                <textarea id="resolution-notes-${issue.id}" placeholder="Add notes about how you resolved this issue..."></textarea>
              </div>
              <div class="appeal-actions">
                <button class="btn-approve" onclick="resolveIssue('${issue.id}', 'resolved')">✓ Mark Resolved</button>
                <button class="btn-deny" onclick="resolveIssue('${issue.id}', 'dismissed')">✗ Dismiss</button>
                ${issue.restaurant_slug ? `<a href="/restaurant?slug=${issue.restaurant_slug}" class="btn-view-restaurant" target="_blank">View Restaurant</a>` : ''}
              </div>
            ` : `
              <div class="appeal-actions">
                ${issue.resolution_notes ? `<p style="color: #1e3a5f;"><strong style="color: #1e3a5f;">Resolution Notes:</strong> ${escapeHtml(issue.resolution_notes)}</p>` : ''}
                ${issue.restaurant_slug ? `<a href="/restaurant?slug=${issue.restaurant_slug}" class="btn-view-restaurant" target="_blank">View Restaurant</a>` : ''}
              </div>
            `}
          </div>
        `;
      }).join('');

      listEl.innerHTML = issuesHTML;
    }

    // Resolve an allergen issue
    async function resolveIssue(issueId, status) {
      const notesTextarea = document.getElementById(`resolution-notes-${issueId}`);
      const resolutionNotes = notesTextarea ? notesTextarea.value.trim() : '';

      if (!confirm(`Are you sure you want to mark this issue as ${status}?`)) {
        return;
      }

      try {
        const { error } = await supabase
          .from('allergen_detection_issues')
          .update({
            status: status,
            resolved_at: new Date().toISOString(),
            resolution_notes: resolutionNotes || null
          })
          .eq('id', issueId);

        if (error) throw error;

        // Reload issues to show updated status
        await loadAllergenIssues();

        // Show success message
        const message = document.createElement('div');
        message.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #4caf50; color: white; padding: 16px 24px; border-radius: 8px; z-index: 10001; box-shadow: 0 4px 12px rgba(0,0,0,0.2);';
        message.textContent = `Issue marked as ${status} successfully!`;
        document.body.appendChild(message);
        setTimeout(() => message.remove(), 3000);

      } catch (error) {
        console.error('Error resolving issue:', error);
        alert(`Error resolving issue: ${error.message}`);
      }
    }

    // Load product issue reports
    async function loadProductReports() {
      try {
        document.getElementById('loading-reports').style.display = 'block';
        document.getElementById('reports-list').innerHTML = '';
        document.getElementById('no-reports').style.display = 'none';

        const { data: reports, error } = await supabase
          .from('product_issue_reports')
          .select('*')
          .order('submitted_at', { ascending: false });

        if (error) throw error;

        allReports = reports || [];
        reportsLoaded = true;
        renderProductReports();

      } catch (error) {
        console.error('Error loading product reports:', error);
        document.getElementById('loading-reports').innerHTML = `<p style="color: #ef4444;">Error loading reports: ${error.message}</p>`;
      } finally {
        document.getElementById('loading-reports').style.display = 'none';
      }
    }

    // Render product reports based on current filter
    function renderProductReports() {
      if (!allReports.length && !reportsLoaded) {
        return;
      }

      const selectedRestaurant = getSelectedRestaurant();
      const restaurantFiltered = selectedRestaurant
        ? allReports.filter(report => {
            if (report.restaurant_id && report.restaurant_id === selectedRestaurant.id) return true;
            const reportSlug = report.restaurant_slug || report.restaurantSlug || report.slug || report.analysis_details?._report_meta?.restaurant_slug || report.analysis_details?._report_meta?.restaurantSlug;
            if (reportSlug && selectedRestaurant.slug && reportSlug === selectedRestaurant.slug) return true;
            const reportName = report.restaurant_name || report.analysis_details?._report_meta?.restaurant_name || report.analysis_details?._report_meta?.restaurantName;
            if (reportName && selectedRestaurant.name && reportName.toLowerCase().trim() === selectedRestaurant.name.toLowerCase().trim()) return true;
            return false;
          })
        : allReports;

      const filtered = currentReportsFilter === 'all'
        ? restaurantFiltered
        : restaurantFiltered.filter(r => r.status === currentReportsFilter);

      if (filtered.length === 0) {
        document.getElementById('no-reports').style.display = 'block';
        document.getElementById('reports-list').innerHTML = '';
        return;
      }

      document.getElementById('no-reports').style.display = 'none';

      const reportsHTML = filtered.map(report => {
        const status = report.status || 'pending';
        const submittedDate = new Date(report.submitted_at).toLocaleString();
        const resolvedDate = report.resolved_at ? new Date(report.resolved_at).toLocaleString() : null;
        const analysisDetails = report.analysis_details || {};
        const reportMeta = analysisDetails._report_meta || {};
        const pageUrl = report.page_url || reportMeta.page_url || reportMeta.pageUrl || null;
        const accountNameRaw = report.account_name || reportMeta.account_name || reportMeta.accountName || null;
        const reporterNameRaw = report.reporter_name || reportMeta.reporter_name || reportMeta.reporterName || null;
        const reporterEmail = report.user_email || report.reporter_email || reportMeta.reporter_email || reportMeta.reporterEmail || null;
        const accountName = accountNameRaw ? accountNameRaw.trim() : '';
        const reporterName = reporterNameRaw ? reporterNameRaw.trim() : '';
        const displayAccountName = accountName || reporterName || '';
        const showReporterName = reporterName && reporterName !== displayAccountName;
        let reportTypeLabel = report.report_type || '';
        if (reportTypeLabel.toLowerCase().includes('menu verification')) {
          reportTypeLabel = reportTypeLabel.replace(/Menu Verification/gi, 'Menu Issue');
        }

        return `
          <div class="appeal-card ${status}" style="border-left-color: #f59e0b;">
            <div class="appeal-header">
              <div class="appeal-info">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 4px;">
                  <h3 style="margin: 0;">${escapeHtml(report.product_name || report.restaurant_name || 'Unknown')}</h3>
                  ${reportTypeLabel ? `<span style="background: #e0e7ff; color: #3730a3; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">${escapeHtml(reportTypeLabel)}</span>` : ''}
                </div>
                <div class="appeal-meta">
                  ${report.restaurant_name ? `<span><strong>Restaurant:</strong> ${escapeHtml(report.restaurant_name)}</span>` : ''}
                  ${reporterEmail ? `<span><strong>Submitted by:</strong> ${escapeHtml(reporterEmail)}</span>` : ''}
                  ${displayAccountName ? `<span><strong>Account name:</strong> ${escapeHtml(displayAccountName)}</span>` : ''}
                  ${showReporterName ? `<span><strong>Reporter name:</strong> ${escapeHtml(reporterName)}</span>` : ''}
                  ${pageUrl ? `<span><strong>Page:</strong> <a href="${escapeHtml(pageUrl)}" target="_blank" style="color:#4c5ad4;">${escapeHtml(pageUrl)}</a></span>` : ''}
                  <span><strong>Submitted:</strong> ${submittedDate}</span>
                  ${resolvedDate ? `<span><strong>Resolved:</strong> ${resolvedDate}</span>` : ''}
                </div>
              </div>
              <span class="appeal-status ${status}">${status}</span>
            </div>

            <div style="margin: 16px 0;">
              <strong style="color: #1e3a5f; display: block; margin-bottom: 8px;">User Message:</strong>
              <p style="background: #fff3cd; padding: 12px; border-radius: 8px; margin-top: 8px; color: #856404; white-space: pre-wrap; line-height: 1.5;">${escapeHtml(report.message)}</p>
            </div>

            ${analysisDetails.ingredientList ? `
              <div style="margin: 16px 0;">
                <strong style="color: #1e3a5f; display: block; margin-bottom: 8px;">Ingredient List:</strong>
                <div style="background: #f5f5f5; padding: 12px; border-radius: 8px; margin-top: 8px; font-family: monospace; font-size: 0.9rem; white-space: pre-wrap; color: #1e3a5f; line-height: 1.5;">${escapeHtml(analysisDetails.ingredientList)}</div>
              </div>
            ` : ''}

            ${analysisDetails.allergens && analysisDetails.allergens.length > 0 ? `
              <div style="margin: 16px 0;">
                <strong style="color: #1e3a5f; display: block; margin-bottom: 4px;">Detected Allergens:</strong>
                <span style="color: #1e3a5f;">${analysisDetails.allergens.map(a => typeof a === 'object' ? a.name : a).join(', ')}</span>
              </div>
            ` : ''}

            ${analysisDetails.diets && analysisDetails.diets.length > 0 ? `
              <div style="margin: 16px 0;">
                <strong style="color: #1e3a5f; display: block; margin-bottom: 4px;">Detected Diets:</strong>
                <span style="color: #1e3a5f;">${analysisDetails.diets.join(', ')}</span>
              </div>
            ` : ''}

            ${analysisDetails.sources && analysisDetails.sources.length > 0 ? `
              <div style="margin: 16px 0;">
                <strong style="color: #1e3a5f; display: block; margin-bottom: 8px;">Sources Used:</strong>
                <div style="font-size: 0.9rem; color: #718096;">
                  ${analysisDetails.sources.map(s => `<div style="margin-bottom: 4px;">• <a href="${escapeHtml(s.url || s)}" target="_blank" style="color: #4c5ad4;">${escapeHtml(s.title || s.url || s)}</a></div>`).join('')}
                </div>
              </div>
            ` : ''}

            ${status === 'pending' ? `
              <div class="review-notes">
                <label style="color: #1e3a5f; display: block; margin-bottom: 8px; font-weight: 600;"><strong>Resolution Notes (optional):</strong></label>
                <textarea id="report-notes-${report.id}" placeholder="Add notes about how you resolved this report..."></textarea>
              </div>
              <div class="appeal-actions">
                <button class="btn-approve" onclick="resolveReport('${report.id}', 'resolved')">✓ Mark Resolved</button>
                <button class="btn-deny" onclick="resolveReport('${report.id}', 'dismissed')">✗ Dismiss</button>
              </div>
            ` : `
              <div class="appeal-actions">
                ${report.resolution_notes ? `<p style="color: #1e3a5f;"><strong style="color: #1e3a5f;">Resolution Notes:</strong> ${escapeHtml(report.resolution_notes)}</p>` : ''}
              </div>
            `}
          </div>
        `;
      }).join('');

      document.getElementById('reports-list').innerHTML = reportsHTML;
    }

    // Resolve a product issue report
    async function resolveReport(reportId, status) {
      const notesTextarea = document.getElementById(`report-notes-${reportId}`);
      const resolutionNotes = notesTextarea ? notesTextarea.value.trim() : '';

      if (!confirm(`Are you sure you want to mark this report as ${status}?`)) {
        return;
      }

      try {
        const { error } = await supabase
          .from('product_issue_reports')
          .update({
            status: status,
            resolved_at: new Date().toISOString(),
            resolution_notes: resolutionNotes || null,
            resolved_by: currentUser.id
          })
          .eq('id', reportId);

        if (error) throw error;

        // Reload reports to show updated status
        await loadProductReports();

        // Show success message
        const message = document.createElement('div');
        message.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #4caf50; color: white; padding: 16px 24px; border-radius: 8px; z-index: 10001; box-shadow: 0 4px 12px rgba(0,0,0,0.2);';
        message.textContent = `Report marked as ${status} successfully!`;
        document.body.appendChild(message);
        setTimeout(() => message.remove(), 3000);

      } catch (error) {
        console.error('Error resolving report:', error);
        alert(`Error resolving report: ${error.message}`);
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function formatChatMessage(text) {
      const raw = (text || '').toString();
      const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
      const linkify = (value) =>
        value.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
      let html = '';
      let lastIndex = 0;
      let match;
      while ((match = linkRegex.exec(raw)) !== null) {
        const before = raw.slice(lastIndex, match.index);
        html += linkify(escapeHtml(before));
        const label = escapeHtml(match[1]);
        const url = escapeHtml(match[2]);
        html += `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        lastIndex = match.index + match[0].length;
      }
      html += linkify(escapeHtml(raw.slice(lastIndex)));
      return html;
    }

    window.reviewAppeal = reviewAppeal;
    window.openPhotoModal = openPhotoModal;
    window.closePhotoModal = closePhotoModal;
    window.resolveIssue = resolveIssue;
    window.resolveReport = resolveReport;
    window.deleteRestaurant = deleteRestaurant;
    window.openRestaurantChat = openRestaurantChat;

    checkAuth();
