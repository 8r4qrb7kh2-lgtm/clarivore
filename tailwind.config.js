/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./public/**/*.html",
  ],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        panel: "var(--panel)",
        ink: "var(--ink)",
        text: "var(--text)",
        muted: "var(--muted)",
        brand: "var(--brand)",
        ok: "var(--ok)",
        warn: "var(--warn)",
        bad: "var(--bad)",
        border: "var(--border)",
      },
      boxShadow: {
        panel: "var(--shadow)",
      },
    },
  },
  plugins: [],
};
