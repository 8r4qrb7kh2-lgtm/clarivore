const allowedOriginHosts = new Set(["clarivore.org", "localhost"]);
const localDevPort = "3000";
const defaultPorts = new Set(["", "80", "443"]);
const capacitorScheme = "capacitor:";

const allowHeaders =
  "authorization, x-client-info, apikey, content-type, supabase-client-platform, x-supabase-client-platform";
const allowMethods = "GET, POST, OPTIONS";

const isAllowedOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    if (url.protocol === capacitorScheme) {
      return url.hostname === "localhost";
    }
    if (!allowedOriginHosts.has(url.hostname)) {
      return false;
    }
    if (url.hostname === "localhost") {
      return url.port === localDevPort;
    }
    if (url.hostname === "clarivore.org") {
      return defaultPorts.has(url.port);
    }
    return false;
  } catch {
    return false;
  }
};

export const getCorsHeaders = (req: Request): Record<string, string> => {
  const origin = req.headers.get("Origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Allow-Methods": allowMethods,
  };

  if (origin && isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }

  return headers;
};
