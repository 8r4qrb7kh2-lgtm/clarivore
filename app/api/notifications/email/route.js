import { corsJson, corsOptions } from "../../_shared/cors";
import { sendNotificationEmail } from "../_shared/emailSender";

export const runtime = "nodejs";

function asText(value) {
  return String(value ?? "").trim();
}

export function OPTIONS() {
  return corsOptions();
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return corsJson({ success: false, error: "Invalid JSON payload." }, { status: 400 });
  }

  try {
    const result = await sendNotificationEmail(body || {});
    if (!result?.success) {
      const status = asText(result?.error).includes("not configured") ? 200 : 500;
      return corsJson(result, { status });
    }

    return corsJson(result, { status: 200 });
  } catch (error) {
    return corsJson(
      {
        success: false,
        error: asText(error?.message) || "Failed to send notification email.",
      },
      { status: 500 },
    );
  }
}
