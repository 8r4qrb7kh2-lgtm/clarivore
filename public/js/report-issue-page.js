import supabaseClient from './supabase-client.js';
import { setupTopbar, attachSignOutHandler } from './shared-nav.js';
import { fetchManagerRestaurants } from './manager-context.js';

async function initNav() {
  const {
    data: { user },
  } = await supabaseClient.auth.getUser();
  let managerRestaurants = [];
  if (user) {
    const isOwner = user.email === 'matt.29.ds@gmail.com';
    const isManager = user.user_metadata?.role === 'manager';
    if (isOwner || isManager) {
      managerRestaurants = await fetchManagerRestaurants(supabaseClient, user.id);
    }
  }
  setupTopbar('report-issue', user, { managerRestaurants });
  if (user) {
    attachSignOutHandler(supabaseClient);
  }
}

function launchReportModal() {
  if (typeof window.openReportModal === 'function') {
    window.openReportModal();
    return;
  }
  document.addEventListener('reportModalReady', launchReportModal, {
    once: true,
  });
}

initNav();
launchReportModal();
