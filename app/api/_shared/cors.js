import { NextResponse } from "next/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, supabase-client-platform, x-supabase-client-platform",
  "Access-Control-Max-Age": "86400",
};

export function withCorsHeaders(init = {}) {
  const headers = new Headers(init?.headers || {});
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    headers.set(key, value);
  });
  return {
    ...init,
    headers,
  };
}

export function corsJson(payload, init = {}) {
  return NextResponse.json(payload, withCorsHeaders(init));
}

export function corsOptions() {
  return new Response(null, withCorsHeaders({ status: 204 }));
}

