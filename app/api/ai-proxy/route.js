import { corsJson, corsOptions } from "../_shared/cors";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsOptions();
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return corsJson({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const { functionName, payload } = body || {};

  if (!functionName) {
    return corsJson({ error: "functionName is required" }, { status: 400 });
  }

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return corsJson(
      { error: "Supabase env vars are missing" },
      { status: 500 },
    );
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseAnonKey}`,
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    if (!response.ok) {
      return corsJson(data, { status: response.status });
    }

    return corsJson(data, { status: 200 });
  } catch (error) {
    console.error("Proxy error:", error);
    return corsJson(
      {
        error: "Failed to proxy request",
        message: error?.message || "Unknown proxy error",
      },
      { status: 500 },
    );
  }
}
