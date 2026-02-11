import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.clarivore.app",
  appName: "Clarivore",
  webDir: "public",
  server: {
    url: process.env.CAPACITOR_SERVER_URL || "https://clarivore.org",
    cleartext: false,
  },
};

export default config;
