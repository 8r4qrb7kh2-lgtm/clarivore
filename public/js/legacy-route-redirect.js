(function () {
  var doc = document.documentElement;
  var targetRoute = doc && doc.getAttribute('data-next-route');
  if (!targetRoute) return;

  var currentPath = (window.location && window.location.pathname) || '';
  var nextUrl = new URL(targetRoute, window.location.origin);
  nextUrl.search = window.location.search || '';
  nextUrl.hash = window.location.hash || '';

  var samePath = nextUrl.pathname === currentPath;
  var sameSearch = nextUrl.search === (window.location.search || '');
  var sameHash = nextUrl.hash === (window.location.hash || '');

  if (samePath && sameSearch && sameHash) return;
  window.location.replace(nextUrl.toString());
})();
