/**
 * Universal Auth Redirect Script
 * Include this script on all pages to automatically redirect non-logged-in users to landing page
 * Exceptions: index.html (landing page), account.html (login page), QR users
 */

(function() {
  function isNativePlatform() {
    if (window.Capacitor?.isNativePlatform) {
      return window.Capacitor.isNativePlatform();
    }
    if (window.Capacitor?.getPlatform) {
      return window.Capacitor.getPlatform() !== 'web';
    }
    const protocol = window.location.protocol;
    if (protocol === 'capacitor:' || protocol === 'ionic:' || protocol === 'file:') {
      return true;
    }
    if (window.navigator?.userAgent?.includes('Capacitor')) {
      return true;
    }
    return false;
  }

  function getAppPlugin() {
    return (
      window.Capacitor?.Plugins?.App ||
      window.Capacitor?.App ||
      window.App ||
      null
    );
  }

  function getBrowserPlugin() {
    return (
      window.Capacitor?.Plugins?.Browser ||
      window.Capacitor?.Browser ||
      null
    );
  }

  async function exchangeNativeOAuth(url) {
    if (!url || !window.supabaseClient) return;
    if (!url.startsWith('com.clarivore.app://')) return;
    window.__clarivoreOAuthHandledUrls =
      window.__clarivoreOAuthHandledUrls || {};
    if (window.__clarivoreOAuthHandledUrls[url]) return;
    window.__clarivoreOAuthHandledUrls[url] = true;
    try {
      const parsedUrl = new URL(url);
      const hashParams = new URLSearchParams(parsedUrl.hash.replace(/^#/, ''));
      const searchParams = parsedUrl.searchParams;
      const errorDescription =
        searchParams.get('error_description') ||
        hashParams.get('error_description') ||
        searchParams.get('error') ||
        hashParams.get('error');
      if (errorDescription) {
        throw new Error(errorDescription);
      }
      const code = searchParams.get('code') || hashParams.get('code');
      if (code) {
        const { error } =
          await window.supabaseClient.auth.exchangeCodeForSession(code);
        if (error) throw error;
      } else {
        const accessToken =
          hashParams.get('access_token') || searchParams.get('access_token');
        const refreshToken =
          hashParams.get('refresh_token') || searchParams.get('refresh_token');
        if (accessToken && refreshToken) {
          const { error } = await window.supabaseClient.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_in: Number(hashParams.get('expires_in') || 0) || undefined,
            token_type: hashParams.get('token_type') || undefined,
          });
          if (error) throw error;
        }
      }
      const browser = getBrowserPlugin();
      if (browser?.close) {
        await browser.close();
      }
      window.dispatchEvent(new CustomEvent('clarivore:auth:signed-in'));
    } catch (error) {
      window.dispatchEvent(
        new CustomEvent('clarivore:auth:error', { detail: { error } })
      );
    }
  }

  function registerNativeAuthListener() {
    if (!isNativePlatform()) return;
    if (window.__clarivoreNativeAuthListener) return;
    const app = getAppPlugin();
    if (!app?.addListener) return;
    window.__clarivoreNativeAuthListener = true;
    app.addListener('appUrlOpen', ({ url }) => {
      exchangeNativeOAuth(url);
    });
  }

  function resolveSignedInStartPage(user) {
    if (!user) return null;
    const ownerEmail = 'matt.29.ds@gmail.com';
    const role = user?.user_metadata?.role || user?.role || null;
    const isOwner = user?.email === ownerEmail;
    const isManager = role === 'manager';
    const isManagerOrOwner = isOwner || isManager;
    if (!isManagerOrOwner) return 'home.html';
    let mode = null;
    try {
      mode = localStorage.getItem('clarivoreManagerMode');
    } catch (_) {
      mode = null;
    }
    if (!mode) {
      mode = 'editor';
      try {
        localStorage.setItem('clarivoreManagerMode', mode);
      } catch (_) {
        // Ignore storage failures.
      }
    }
    return mode === 'editor' ? 'manager-dashboard.html' : 'home.html';
  }

  async function redirectSignedInUserFromLanding() {
    const currentPath = window.location.pathname;
    const currentPage = currentPath.split('/').pop() || 'index.html';
    const urlParams = new URLSearchParams(window.location.search);
    const isQRUser = urlParams.get('qr') === '1';
    const isLandingPage =
      currentPage === 'index.html' || currentPage === '' || currentPage === '/';

    if (!isLandingPage || isQRUser) return false;
    if (!isNativePlatform()) return false;

    try {
      const { data: { user } } = await window.supabaseClient.auth.getUser();
      if (!user) return false;
      const target = resolveSignedInStartPage(user);
      if (!target) return false;
      if (currentPage === target || currentPath.endsWith(`/${target}`)) return false;
      window.location.replace(target);
      return true;
    } catch (error) {
      console.error('Landing redirect check error:', error);
      return false;
    }
  }

  async function checkLaunchUrl() {
    if (!isNativePlatform()) return;
    const app = getAppPlugin();
    if (!app?.getLaunchUrl) return;
    try {
      const { url } = await app.getLaunchUrl();
      if (url) {
        await exchangeNativeOAuth(url);
      }
    } catch (_) {
      // Ignore launch URL failures.
    }
  }

  // Wait for Supabase client to be available
  function waitForSupabase(callback, attempts = 0) {
    if (window.supabaseClient) {
      callback();
    } else if (attempts < 50) {
      // Wait up to 5 seconds (50 * 100ms)
      setTimeout(() => waitForSupabase(callback, attempts + 1), 100);
    } else {
      console.warn('Supabase client not found after 5 seconds, skipping auth redirect');
    }
  }

  waitForSupabase(async function() {
    registerNativeAuthListener();
    await checkLaunchUrl();
    window.addEventListener('clarivore:auth:signed-in', () => {
      redirectSignedInUserFromLanding();
    });
    // Get current page
    const currentPath = window.location.pathname;
    const currentPage = currentPath.split('/').pop() || 'index.html';
    const urlParams = new URLSearchParams(window.location.search);
    const isQRUser = urlParams.get('qr') === '1';
    const isLandingPage =
      currentPage === 'index.html' || currentPage === '' || currentPage === '/';

    if (await redirectSignedInUserFromLanding()) {
      return;
    }

    // Skip redirect for landing page, account page, and QR users
    if (isLandingPage ||
        currentPage === 'account.html' ||
        isQRUser) {
      return;
    }

    // Check if user is logged in
    try {
      const { data: { user } } = await window.supabaseClient.auth.getUser();

      // If not logged in, redirect to landing page
      if (!user) {
        window.location.replace('/index.html');
        return;
      }
    } catch (error) {
      console.error('Auth redirect check error:', error);
      // On error, redirect to landing page to be safe
      window.location.replace('/index.html');
    }
  });
})();
