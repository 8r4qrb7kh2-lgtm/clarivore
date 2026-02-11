const htmlRedirects = [
  { source: "/index.html", destination: "/", permanent: true },
  { source: "/home.html", destination: "/home/", permanent: true },
  { source: "/restaurants.html", destination: "/restaurants/", permanent: true },
  { source: "/favorites.html", destination: "/favorites/", permanent: true },
  { source: "/dish-search.html", destination: "/dish-search/", permanent: true },
  { source: "/my-dishes.html", destination: "/my-dishes/", permanent: true },
  { source: "/restaurant.html", destination: "/restaurant/", permanent: true },
  { source: "/account.html", destination: "/account/", permanent: true },
  { source: "/help-contact.html", destination: "/help-contact/", permanent: true },
  { source: "/report-issue.html", destination: "/report-issue/", permanent: true },
  { source: "/order-feedback.html", destination: "/order-feedback/", permanent: true },
  { source: "/manager-dashboard.html", destination: "/manager-dashboard/", permanent: true },
  { source: "/admin-dashboard.html", destination: "/admin-dashboard/", permanent: true },
  { source: "/kitchen-tablet.html", destination: "/kitchen-tablet/", permanent: true },
  { source: "/server-tablet.html", destination: "/server-tablet/", permanent: true },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
  async redirects() {
    return htmlRedirects;
  },
};

module.exports = nextConfig;
