const allowHeaders =
  "authorization, x-client-info, apikey, content-type, supabase-client-platform, x-supabase-client-platform";
const allowMethods = "GET, POST, OPTIONS";

export const getCorsHeaders = (_req: Request): Record<string, string> => {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Allow-Methods": allowMethods,
  };
};

