    import supabaseClient from './supabase-client.js';
    import { setupTopbar } from './shared-nav.js';
    import { fetchManagerRestaurants } from './manager-context.js';
    import { initHelpAssistantPanel, setHelpAssistantMode } from './help-assistant-drawer.js';
    import { initManagerNotifications } from './manager-notifications.js';

    const OWNER_EMAIL = 'matt.29.ds@gmail.com';
    let currentUser = null;
    let isOwner = false;
    let isManager = false;
    let isEditorMode = false;
    let managedRestaurants = [];
    let selectedRestaurantId = null;
    let selectedRestaurant = null;
    let chatReadState = { admin: null, restaurant: null };
    let chatUnreadCount = 0;
    let recentChatMessages = [];

    const helpStatus = document.getElementById('helpSearchStatus');
    const helpAskBtn = document.getElementById('helpAskBtn');
    const helpQuery = document.getElementById('helpQuery');
    const helpConversation = document.getElementById('helpConversation');
    const helpNewConversationBtn = document.getElementById('helpNewConversationBtn');

    const helpGrid = document.getElementById('helpGrid');

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text || '';
      return div.innerHTML;
    }

    function formatChatMessage(text) {
      const escaped = escapeHtml(text || '');
      return escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
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

    function resolveAccountName(user, fallbackName = '') {
      if (!user) return (fallbackName || '').trim() || null;
      const firstName = user.user_metadata?.first_name || '';
      const lastName = user.user_metadata?.last_name || '';
      let fullName = `${firstName} ${lastName}`.trim();
      if (!fullName) fullName = (user.user_metadata?.full_name || '').trim();
      if (!fullName) fullName = (user.raw_user_meta_data?.full_name || '').trim();
      if (!fullName) fullName = (user.user_metadata?.name || '').trim();
      if (!fullName) fullName = (user.user_metadata?.display_name || '').trim();
      if (!fullName) fullName = (user.name || '').trim();
      if (!fullName && fallbackName) fullName = fallbackName.trim();
      return fullName || null;
    }

    function autoGrowTextArea(textArea) {
      if (!textArea) return;
      textArea.style.height = '0px';
      textArea.style.height = `${textArea.scrollHeight}px`;
    }

    async function loadCustomerRestaurants() {
      try {
        const { data, error } = await supabaseClient
          .from('restaurants')
          .select('id, name, slug')
          .order('name');
        if (error) throw error;
        return data || [];
      } catch (err) {
        console.error('Failed to load restaurants for help:', err);
        return [];
      }
    }

    function setAutoRestaurant(restaurants, preferRecent = true) {
      if (!Array.isArray(restaurants)) return;
      let selection = null;
      const storedId = localStorage.getItem('helpSelectedRestaurantId');
      if (storedId) {
        selection = restaurants.find(r => String(r.id) === storedId) || null;
      }

      if (!selection && preferRecent) {
        try {
          const recent = JSON.parse(localStorage.getItem('recentlyViewedRestaurants') || '[]');
          const recentSlug = Array.isArray(recent) && recent.length ? recent[0] : null;
          if (recentSlug) {
            selection = restaurants.find(r => r.slug === recentSlug) || null;
          }
        } catch (_) {
          selection = null;
        }
      }

      if (!selection && restaurants.length) {
        selection = restaurants[0];
      }

      selectedRestaurantId = selection ? String(selection.id) : null;
      selectedRestaurant = selection || null;

      if (selection) {
        localStorage.setItem('helpSelectedRestaurantId', String(selection.id));
        if (selection.slug) {
          localStorage.setItem('helpAssistantRestaurantSlug', selection.slug);
        }
      }
    }

    async function handleAnonymousFeedback() {
      const textArea = document.getElementById('helpFeedbackText');
      const status = document.getElementById('helpFeedbackStatus');
      const sendBtn = document.getElementById('helpFeedbackSend');
      const text = (textArea?.value || '').trim();

      if (!text) {
        if (status) {
          status.textContent = 'Please enter your feedback.';
          status.style.color = '#ef4444';
        }
        textArea?.focus();
        return;
      }

      if (status) {
        status.textContent = 'Sending...';
        status.style.color = 'var(--muted)';
      }
      if (sendBtn) sendBtn.disabled = true;

      try {
        if (selectedRestaurantId) {
          const { error } = await supabaseClient
            .from('anonymous_feedback')
            .insert([{ restaurant_id: selectedRestaurantId, feedback_text: text }]);
          if (error) throw error;
        } else {
          await supabaseClient.functions.invoke('report-issue', {
            body: {
              context: 'help_feedback',
              message: text,
              pageUrl: window.location.href,
              restaurantName: 'Clarivore'
            }
          });
        }

        if (status) {
          status.textContent = '✓ Thanks for the feedback!';
          status.style.color = '#22c55e';
        }
        if (textArea) textArea.value = '';
      } catch (err) {
        console.error('Feedback send failed:', err);
        if (status) {
          status.textContent = 'Sorry, something went wrong. Please try again.';
          status.style.color = '#ef4444';
        }
      } finally {
        if (sendBtn) sendBtn.disabled = false;
      }
    }

    async function handleReportIssue() {
      const textArea = document.getElementById('helpIssueText');
      const status = document.getElementById('helpIssueStatus');
      const sendBtn = document.getElementById('helpIssueSend');
      const text = (textArea?.value || '').trim();

      if (!text) {
        if (status) {
          status.textContent = 'Please describe the issue.';
          status.style.color = '#ef4444';
        }
        textArea?.focus();
        return;
      }

      if (status) {
        status.textContent = 'Sending...';
        status.style.color = 'var(--muted)';
      }
      if (sendBtn) sendBtn.disabled = true;

      try {
        const accountName = resolveAccountName(currentUser);
        const payload = {
          restaurantId: selectedRestaurantId || null,
          restaurantName: selectedRestaurant?.name || 'Clarivore',
          context: isEditorMode ? 'help_editor_issue' : 'help_customer_issue',
          message: text,
          pageUrl: window.location.href,
          userEmail: currentUser?.email || null,
          reporterName: accountName,
          accountName,
          accountId: currentUser?.id || null
        };
        const { error } = await supabaseClient.functions.invoke('report-issue', { body: payload });
        if (error) throw error;

        if (status) {
          status.textContent = '✓ Report sent. Thank you!';
          status.style.color = '#22c55e';
        }
        if (textArea) textArea.value = '';
      } catch (err) {
        console.error('Issue report failed:', err);
        if (status) {
          status.textContent = 'Sorry, something went wrong. Please try again.';
          status.style.color = '#ef4444';
        }
      } finally {
        if (sendBtn) sendBtn.disabled = false;
      }
    }

    function renderCustomerHelp(restaurants) {
      helpGrid.innerHTML = `
        <div class="help-card">
          <h3>Anonymous feedback</h3>
          <p>Share your experience privately. This feedback is anonymous.</p>
          <textarea id="helpFeedbackText" placeholder="What should we know?"></textarea>
          <div class="help-status" id="helpFeedbackStatus"></div>
          <button class="btn btnPrimary" id="helpFeedbackSend">Send feedback</button>
        </div>
        <div class="help-card">
          <h3>Report an issue</h3>
          <p>Let us know about errors or problems you found.</p>
          <textarea id="helpIssueText" placeholder="Describe the issue..."></textarea>
          <div class="help-status" id="helpIssueStatus"></div>
          <button class="btn btnPrimary" id="helpIssueSend">Send report</button>
        </div>
      `;

      setAutoRestaurant(restaurants, true);

      document.getElementById('helpFeedbackSend')?.addEventListener('click', handleAnonymousFeedback);
      document.getElementById('helpIssueSend')?.addEventListener('click', handleReportIssue);
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
          .limit(10);

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
      if (!selectedRestaurantId) return;
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

      if (!selectedRestaurantId) {
        chatList.innerHTML = '<div class="chat-preview-empty">No restaurant linked yet.</div>';
        return;
      }

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
              name: 'Matt D (clarivore administrator)',
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
            : (rawSenderName || 'Matt D (clarivore administrator)');
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
      if (!input) return;
      if (!selectedRestaurantId) {
        alert('No restaurant is linked to this account yet.');
        return;
      }
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

    async function renderEditorHelp() {
      helpGrid.innerHTML = `
        <div class="help-card">
          <div class="chat-header-row">
            <div class="chat-title-wrap">
              <h3 style="margin:0;">Direct chat with Clarivore administrator</h3>
              <span class="chat-badge" id="chat-unread-badge" style="display:none">0</span>
            </div>
            <button class="btn btnWarning" id="chat-ack-btn" style="display:none">Acknowledge message(s)</button>
          </div>
          <div id="chat-preview-list" class="chat-preview-list">
            <div class="chat-preview-empty">Loading chat...</div>
          </div>
          <div class="chat-preview-compose">
            <input id="chat-message-input" class="chat-preview-input" type="text" placeholder="Message Clarivore">
            <button class="btn" id="chat-send-btn">Send</button>
          </div>
        </div>
        <div class="help-card">
          <h3>Report an issue</h3>
          <p>Share any problems you find while managing your restaurant.</p>
          <textarea id="helpIssueText" placeholder="Describe the issue..."></textarea>
          <div class="help-status" id="helpIssueStatus"></div>
          <button class="btn btnPrimary" id="helpIssueSend">Send report</button>
        </div>
      `;

      setAutoRestaurant(managedRestaurants, false);

      document.getElementById('helpIssueSend')?.addEventListener('click', handleReportIssue);

      await loadChatMessages();
      renderChatPreview();
    }

    async function init() {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) return;

      currentUser = user;
      isOwner = user.email === OWNER_EMAIL;
      isManager = user.user_metadata?.role === 'manager';
      const isManagerOrOwner = isOwner || isManager;
      if (isManagerOrOwner) {
        initManagerNotifications({ user: currentUser, client: supabaseClient });
      }

      if (isManagerOrOwner) {
        managedRestaurants = await fetchManagerRestaurants(supabaseClient, user.id);
      }

      setupTopbar('help-contact', user, {
        managerRestaurants: managedRestaurants,
        modeToggle: {
          resolveTarget: () => '/help-contact'
        }
      });

      const storedMode = localStorage.getItem('clarivoreManagerMode');
      isEditorMode = isManagerOrOwner && storedMode === 'editor';

      setHelpAssistantMode(isEditorMode ? 'manager' : 'customer');
      initHelpAssistantPanel({
        mode: isEditorMode ? 'manager' : 'customer',
        input: helpQuery,
        sendBtn: helpAskBtn,
        newBtn: helpNewConversationBtn,
        statusEl: helpStatus,
        conversationEl: helpConversation
      });

      if (helpQuery) {
        autoGrowTextArea(helpQuery);
        helpQuery.addEventListener('input', () => autoGrowTextArea(helpQuery));
      }

      if (isEditorMode && isManagerOrOwner) {
        await renderEditorHelp();
      } else {
        const restaurants = await loadCustomerRestaurants();
        managedRestaurants = restaurants;
        renderCustomerHelp(restaurants);
      }
    }

    init();
