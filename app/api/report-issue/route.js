import { corsJson, corsOptions } from "../_shared/cors";
import { prisma, asText, toJsonSafe } from "../editor-pending-save/_shared/pendingSaveUtils";
import { sendNotificationEmail } from "../notifications/_shared/emailSender";

export const runtime = "nodejs";

function normalizePayload(body) {
  return {
    message: asText(body?.message),
    context: asText(body?.context) || "issue",
    productName: asText(body?.productName),
    barcode: asText(body?.barcode),
    analysisDetails:
      body?.analysisDetails && typeof body.analysisDetails === "object"
        ? body.analysisDetails
        : null,
    userEmail: asText(body?.userEmail),
    restaurantName: asText(body?.restaurantName) || "Clarivore",
    reporterName: asText(body?.reporterName),
    accountName: asText(body?.accountName),
    accountId: asText(body?.accountId),
    pageUrl: asText(body?.pageUrl),
  };
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

  const payload = normalizePayload(body);
  if (!payload.message) {
    return corsJson({ success: false, error: "message is required." }, { status: 400 });
  }

  try {
    const metadata = toJsonSafe(
      {
        context: payload.context,
        reporter_name: payload.reporterName || null,
        account_name: payload.accountName || null,
        account_id: payload.accountId || null,
        page_url: payload.pageUrl || null,
        analysis_details:
          payload.analysisDetails && typeof payload.analysisDetails === "object"
            ? payload.analysisDetails
            : null,
      },
      {},
    );

    const created = await prisma.product_issue_reports.create({
      data: {
        message: payload.message,
        report_type: payload.context,
        product_name: payload.productName || null,
        barcode: payload.barcode || null,
        analysis_details: metadata,
        user_email: payload.userEmail || null,
        restaurant_name: payload.restaurantName || null,
      },
      select: { id: true },
    });

    const emailResult = await sendNotificationEmail({
      type: "issue",
      context: payload.context,
      message: payload.message,
      userEmail: payload.userEmail,
      reporterName: payload.reporterName,
      accountName: payload.accountName,
      accountId: payload.accountId,
      pageUrl: payload.pageUrl,
      restaurantName: payload.restaurantName,
    });

    return corsJson(
      {
        success: true,
        id: asText(created?.id),
        email: emailResult,
      },
      { status: 200 },
    );
  } catch (error) {
    return corsJson(
      {
        success: false,
        error: asText(error?.message) || "Failed to report issue.",
      },
      { status: 500 },
    );
  }
}
