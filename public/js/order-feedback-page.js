import supabaseClient from './supabase-client.js';

    let allergenConfig = {};
    let ALLERGENS = [];
    let DIETS = [];
    let normalizeAllergen = (value) => {
      const raw = String(value ?? '').trim();
      if (!raw) return '';
      if (!ALLERGENS.length) return raw;
      return ALLERGENS.includes(raw) ? raw : '';
    };
    let normalizeDietLabel = (value) => {
      const raw = String(value ?? '').trim();
      if (!raw) return '';
      if (!DIETS.length) return raw;
      return DIETS.includes(raw) ? raw : '';
    };
    let getDietAllergenConflicts = () => [];

    async function loadAllergenConfig() {
      allergenConfig = window.loadAllergenDietConfig
        ? await window.loadAllergenDietConfig({ supabaseClient })
        : (window.ALLERGEN_DIET_CONFIG || {});
      ALLERGENS = Array.isArray(allergenConfig.ALLERGENS) ? allergenConfig.ALLERGENS : [];
      DIETS = Array.isArray(allergenConfig.DIETS) ? allergenConfig.DIETS : [];
      normalizeAllergen = typeof allergenConfig.normalizeAllergen === 'function'
        ? allergenConfig.normalizeAllergen
        : (value) => {
            const raw = String(value ?? '').trim();
            if (!raw) return '';
            if (!ALLERGENS.length) return raw;
            return ALLERGENS.includes(raw) ? raw : '';
          };
      normalizeDietLabel = typeof allergenConfig.normalizeDietLabel === 'function'
        ? allergenConfig.normalizeDietLabel
        : (value) => {
            const raw = String(value ?? '').trim();
            if (!raw) return '';
            if (!DIETS.length) return raw;
            return DIETS.includes(raw) ? raw : '';
          };
      getDietAllergenConflicts = typeof allergenConfig.getDietAllergenConflicts === 'function'
        ? allergenConfig.getDietAllergenConflicts
        : () => [];
    }

    async function initTopbar() {
      const [{ setupTopbar }, { fetchManagerRestaurants }] = await Promise.all([
        import('./shared-nav.js'),
        import('./manager-context.js'),
      ]);
      const { data: { user } } = await supabaseClient.auth.getUser();
      let managerRestaurants = [];
      if (user) {
        const isOwner = user.email === 'matt.29.ds@gmail.com';
        const isManager = user.user_metadata?.role === 'manager';
        if (isOwner || isManager) {
          managerRestaurants = await fetchManagerRestaurants(supabaseClient, user.id);
        }
      }
      setupTopbar('order-feedback', user, { managerRestaurants });
    }
    initTopbar();

    // State
    let feedbackData = null;
    let restaurantData = null;
    let userAllergens = [];
    let userDiets = [];
    let selectedDishes = new Set();
    let currentPage = 0;

    // DOM elements
    const loadingState = document.getElementById('loading-state');
    const invalidToken = document.getElementById('invalid-token');
    const successMessage = document.getElementById('success-message');
    const feedbackForm = document.getElementById('feedback-form');
    const restaurantNameEl = document.getElementById('restaurant-name');
    const errorContainer = document.getElementById('error-container');
    const menuPagesContainer = document.getElementById('menu-pages-container');
    const selectedDishesSection = document.getElementById('selected-dishes');
    const selectedDishesList = document.getElementById('selected-dishes-list');
    const submitBtn = document.getElementById('submit-btn');

    function computeStatus(item, allergens, diets) {
      const hasAllergenReqs = allergens && allergens.length > 0;
      const hasDietReqs = diets && diets.length > 0;

      if (!hasAllergenReqs && !hasDietReqs) return 'neutral';

      const itemAllergens = (item.allergens || []).map(normalizeAllergen).filter(Boolean);
      const allergenHits = itemAllergens.filter(a => allergens.includes(a));
      const hasAllergenIssues = allergenHits.length > 0;
      const removableAllergenSet = new Set(
        (item.removable || [])
          .map(r => normalizeAllergen(r.allergen || ''))
          .filter(Boolean)
      );
      const allergenRemovableAll = hasAllergenIssues ? allergenHits.every(a => removableAllergenSet.has(a)) : true;

      const itemDiets = new Set((item.diets || []).map(normalizeDietLabel).filter(Boolean));
      const meetsDietReqs = !hasDietReqs || diets.every(diet => itemDiets.has(diet));

      let canBeMadeForDiets = false;
      if (hasDietReqs && !meetsDietReqs) {
        const unmetDiets = diets.filter(diet => !itemDiets.has(diet));
        if (unmetDiets.length) {
          canBeMadeForDiets = unmetDiets.every(userDiet => {
            const conflicts = getDietAllergenConflicts(userDiet);
            const conflictingAllergens = conflicts.filter(allergen => {
              return itemAllergens.includes(allergen);
            });
            const allConflictingAllergensRemovable = conflictingAllergens.length > 0 &&
              conflictingAllergens.every(allergen => removableAllergenSet.has(allergen));

            const blockingIngredients = item.ingredientsBlockingDiets?.[userDiet] || [];
            const allBlockingIngredientsRemovable = blockingIngredients.length > 0 &&
              blockingIngredients.every(ing => ing.removable);

            const hasBlocks = conflictingAllergens.length > 0 || blockingIngredients.length > 0;
            if (!hasBlocks) return false;
            if (conflictingAllergens.length > 0 && !allConflictingAllergensRemovable) return false;
            if (blockingIngredients.length > 0 && !allBlockingIngredientsRemovable) return false;
            return true;
          });
        }
      }

      if (!meetsDietReqs && !canBeMadeForDiets) return 'unsafe';
      if (hasAllergenIssues && !allergenRemovableAll) return 'unsafe';
      if (hasAllergenIssues || canBeMadeForDiets) return 'removable';
      return 'safe';
    }

    function toggleDishSelection(dishName) {
      if (selectedDishes.has(dishName)) {
        selectedDishes.delete(dishName);
      } else {
        selectedDishes.add(dishName);
      }
      updateSelectedDishesUI();
      renderOverlays();
    }

    function updateSelectedDishesUI() {
      if (selectedDishes.size === 0) {
        selectedDishesSection.style.display = 'none';
        return;
      }

      selectedDishesSection.style.display = 'block';
      selectedDishesList.innerHTML = Array.from(selectedDishes).map(dish => `
        <div class="selected-dish-item">
          <span class="selected-dish-name">${escapeHtml(dish)}</span>
          <button class="remove-dish-btn" onclick="toggleDishSelection('${escapeHtml(dish)}')">&times;</button>
        </div>
      `).join('');
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function renderOverlays() {
      const menuImages = document.querySelectorAll('.menu-image');
      menuImages.forEach((img, pageIndex) => {
        const layer = img.nextElementSibling;
        if (!layer || !layer.classList.contains('overlay-layer')) return;

        layer.innerHTML = '';

        if (!img.complete || !img.naturalWidth) return;

        const pageOverlays = (restaurantData?.overlays || []).filter(o => (o.pageIndex || 0) === pageIndex);

        pageOverlays.forEach(item => {
          const status = computeStatus(item, userAllergens, userDiets);
          const dishName = item.name || item.id || 'Unnamed dish';

          const overlay = document.createElement('div');
          overlay.className = `overlay ${status}`;
          overlay.style.left = (+item.x || 0) + '%';
          overlay.style.top = (+item.y || 0) + '%';
          overlay.style.width = (+item.w || 0) + '%';
          overlay.style.height = (+item.h || 0) + '%';

          // Add dish name tooltip
          const nameLabel = document.createElement('div');
          nameLabel.className = 'overlay-name';
          nameLabel.textContent = dishName;
          overlay.appendChild(nameLabel);

          // Only add checkbox for unsafe dishes
          if (status === 'unsafe') {
            const checkbox = document.createElement('div');
            checkbox.className = `overlay-checkbox ${selectedDishes.has(dishName) ? 'checked' : ''}`;
            checkbox.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>';
            checkbox.addEventListener('click', (e) => {
              e.stopPropagation();
              toggleDishSelection(dishName);
            });
            overlay.appendChild(checkbox);
          }

          layer.appendChild(overlay);
        });
      });
    }

    function renderMenuPages() {
      const menuImages = restaurantData?.menu_images || [];
      if (menuImages.length === 0) {
        menuPagesContainer.innerHTML = '<p style="color:var(--muted);text-align:center;">No menu images available.</p>';
        return;
      }

      let html = '';
      menuImages.forEach((imageUrl, index) => {
        html += `
          <div class="menu-page-container" data-page="${index}" style="${index !== currentPage ? 'display:none;' : ''}">
            <img src="${imageUrl}" class="menu-image" data-page="${index}" onload="renderOverlays()">
            <div class="overlay-layer"></div>
          </div>
        `;
      });

      if (menuImages.length > 1) {
        html += '<div class="page-nav">';
        menuImages.forEach((_, index) => {
          html += `<button class="${index === currentPage ? 'active' : ''}" onclick="switchPage(${index})">Page ${index + 1}</button>`;
        });
        html += '</div>';
      }

      menuPagesContainer.innerHTML = html;
    }

    function switchPage(pageIndex) {
      currentPage = pageIndex;
      document.querySelectorAll('.menu-page-container').forEach((container, index) => {
        container.style.display = index === pageIndex ? 'block' : 'none';
      });
      document.querySelectorAll('.page-nav button').forEach((btn, index) => {
        btn.classList.toggle('active', index === pageIndex);
      });
      renderOverlays();
    }

    async function loadFeedbackData() {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token');

      if (!token) {
        showInvalidToken();
        return;
      }

      try {
        // Fetch feedback queue entry by token
        const { data: queueEntry, error: queueError } = await supabaseClient
          .from('feedback_email_queue')
          .select('*')
          .eq('feedback_token', token)
          .maybeSingle();

        if (queueError || !queueEntry) {
          showInvalidToken();
          return;
        }

        feedbackData = queueEntry;
        userAllergens = (queueEntry.user_allergens || [])
          .map(normalizeAllergen)
          .filter(Boolean);
        userDiets = (queueEntry.user_diets || [])
          .map(normalizeDietLabel)
          .filter(Boolean);

        // Fetch restaurant data
        const { data: restaurant, error: restaurantError } = await supabaseClient
          .from('restaurants')
          .select('id, name, slug, overlays, menu_images')
          .eq('id', queueEntry.restaurant_id)
          .maybeSingle();

        if (restaurantError || !restaurant) {
          showInvalidToken();
          return;
        }

        restaurantData = restaurant;
        restaurantNameEl.textContent = restaurant.name;

        // Show the form
        loadingState.style.display = 'none';
        feedbackForm.style.display = 'block';

        // Render menu
        renderMenuPages();

      } catch (err) {
        console.error('Error loading feedback data:', err);
        showInvalidToken();
      }
    }

    function showInvalidToken() {
      loadingState.style.display = 'none';
      invalidToken.style.display = 'block';
    }

    function showError(message) {
      errorContainer.innerHTML = `<div class="error-message">${escapeHtml(message)}</div>`;
    }

    async function submitFeedback() {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
      errorContainer.innerHTML = '';

      const restaurantFeedback = document.getElementById('restaurant-feedback').value.trim();
      const websiteFeedback = document.getElementById('website-feedback').value.trim();
      const restaurantIncludeEmail = document.getElementById('restaurant-include-email').checked;
      const websiteIncludeEmail = document.getElementById('website-include-email').checked;

      // Check if there's anything to submit
      if (!restaurantFeedback && !websiteFeedback && selectedDishes.size === 0) {
        showError('Please provide some feedback or select dishes for accommodation requests.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Feedback';
        return;
      }

      try {
        // Insert feedback
        const { data: feedbackRecord, error: feedbackError } = await supabaseClient
          .from('order_feedback')
          .insert({
            order_id: feedbackData.order_id,
            restaurant_id: feedbackData.restaurant_id,
            user_id: feedbackData.user_id || null,
            restaurant_feedback: restaurantFeedback || null,
            website_feedback: websiteFeedback || null,
            restaurant_feedback_include_email: restaurantIncludeEmail,
            website_feedback_include_email: websiteIncludeEmail,
            user_email: (restaurantIncludeEmail || websiteIncludeEmail) ? feedbackData.user_email : null
          })
          .select()
          .single();

        if (feedbackError) throw feedbackError;

        // Insert accommodation requests
        if (selectedDishes.size > 0) {
          const accommodationRequests = Array.from(selectedDishes).map(dishName => ({
            feedback_id: feedbackRecord.id,
            restaurant_id: feedbackData.restaurant_id,
            user_id: feedbackData.user_id || null,
            dish_name: dishName,
            user_allergens: userAllergens,
            user_diets: userDiets
          }));

          const { error: requestsError } = await supabaseClient
            .from('accommodation_requests')
            .insert(accommodationRequests);

          if (requestsError) throw requestsError;
        }

        // Mark email as processed (update sent_at)
        await supabaseClient
          .from('feedback_email_queue')
          .update({ sent_at: new Date().toISOString() })
          .eq('id', feedbackData.id);

        // Show success
        feedbackForm.style.display = 'none';
        successMessage.style.display = 'block';

      } catch (err) {
        console.error('Error submitting feedback:', err);
        showError('Failed to submit feedback. Please try again.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Feedback';
      }
    }

    // Initialize
    submitBtn.addEventListener('click', submitFeedback);
    async function init() {
      await loadAllergenConfig();
      await loadFeedbackData();
    }
    init();

window.toggleDishSelection = toggleDishSelection;
window.switchPage = switchPage;
window.renderOverlays = renderOverlays;
