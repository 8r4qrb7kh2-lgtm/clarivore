import {
  asText,
  isAppAdminUser,
  prisma,
  requireAuthenticatedSession,
} from "../../restaurant-write/_shared/writeGatewayUtils";

export const runtime = "nodejs";

function json(payload, status = 200) {
  return Response.json(payload, { status });
}

function escapeHtml(value) {
  return asText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmailHtml({ senderName, message, restaurantName, dashboardUrl }) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 640px; margin: 0 auto; padding: 20px;">
        <h2 style="margin-bottom: 8px;">New chat message</h2>
        <p style="margin-top: 0; color: #555;">Restaurant: <strong>${escapeHtml(restaurantName)}</strong></p>
        <p><strong>Sender:</strong> ${escapeHtml(senderName)}</p>
        <p><strong>Message:</strong></p>
        <div style="background: #f3f4f6; padding: 12px 14px; border-radius: 8px; white-space: pre-wrap;">${escapeHtml(message)}</div>
        <p style="margin-top: 16px;">
          <a href="${escapeHtml(dashboardUrl)}" style="background: #1f4fd7; color: white; text-decoration: none; padding: 10px 16px; border-radius: 6px; display: inline-block;">Open manager dashboard</a>
        </p>
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e7eb;">
        <p style="color: #6b7280; font-size: 12px;">Sent by Clarivore</p>
      </body>
    </html>
  `;
}

async function sendChatEmails({ emails, senderName, message, restaurantName, dashboardUrl }) {
  const sendgridApiKey = asText(process.env.SENDGRID_API_KEY);
  if (!sendgridApiKey || !Array.isArray(emails) || !emails.length) {
    return { skipped: true, sent: 0 };
  }

  const fromEmail =
    asText(process.env.CHAT_NOTIFICATIONS_FROM) ||
    asText(process.env.NOTIFICATION_FROM_EMAIL) ||
    "clarivoretesting@gmail.com";
  const fromName = asText(process.env.NOTIFICATION_FROM_NAME) || "Clarivore";

  const subject = `New chat message from ${senderName}`;
  const html = buildEmailHtml({ senderName, message, restaurantName, dashboardUrl });

  let sent = 0;
  for (const email of emails) {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sendgridApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email }],
            subject,
          },
        ],
        from: { email: fromEmail, name: fromName },
        content: [{ type: "text/html", value: html }],
      }),
    });

    if (response.ok) {
      sent += 1;
    }
  }

  return { sent };
}

async function ensureCallerAuthorized({ userId, restaurantId }) {
  const isAdmin = await isAppAdminUser(prisma, userId);
  if (isAdmin) return true;

  const manager = await prisma.restaurant_managers.findFirst({
    where: {
      user_id: userId,
      restaurant_id: restaurantId,
    },
    select: { id: true },
  });

  return Boolean(manager?.id);
}

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    const session = await requireAuthenticatedSession(request);
    const messageId = asText(body?.messageId);
    if (!messageId) {
      return json({ error: "Missing messageId" }, 400);
    }

    const message = await prisma.restaurant_direct_messages.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        restaurant_id: true,
        message: true,
        sender_role: true,
        sender_name: true,
      },
    });

    if (!message) {
      return json({ error: "Message not found" }, 404);
    }

    const authorized = await ensureCallerAuthorized({
      userId: session.userId,
      restaurantId: asText(message.restaurant_id),
    });

    if (!authorized) {
      return json({ error: "Not authorized" }, 403);
    }

    if (asText(message.sender_role) === "restaurant") {
      return json({ skipped: true, reason: "sender_role" }, 200);
    }

    const restaurant = await prisma.restaurants.findUnique({
      where: { id: asText(message.restaurant_id) },
      select: { id: true, name: true },
    });

    const managerRows = await prisma.restaurant_managers.findMany({
      where: { restaurant_id: asText(message.restaurant_id) },
      select: { user_id: true },
    });

    const managerIds = Array.from(
      new Set(managerRows.map((row) => asText(row.user_id)).filter(Boolean)),
    );

    if (!managerIds.length) {
      return json({ skipped: true, reason: "no_managers" }, 200);
    }

    const users = await prisma.users.findMany({
      where: {
        id: {
          in: managerIds,
        },
      },
      select: {
        id: true,
        email: true,
      },
    });

    const emails = Array.from(new Set(users.map((user) => asText(user.email)).filter(Boolean)));

    const senderName = asText(message.sender_name) || "Clarivore team";
    const restaurantName = asText(restaurant?.name) || "Your restaurant";
    const dashboardUrl = "https://clarivore.org/manager-dashboard";
    const messageText = asText(message.message);

    const emailResult = await sendChatEmails({
      emails,
      senderName,
      message: messageText,
      restaurantName,
      dashboardUrl,
    });

    return json(
      {
        success: true,
        emailsSent: Number(emailResult?.sent || 0),
        pushesSent: 0,
        iosPushesSent: 0,
        managerCount: managerIds.length,
      },
      200,
    );
  } catch (error) {
    const message = asText(error?.message) || "Request failed";
    const status =
      message === "Missing authorization token" || message === "Invalid user session"
        ? 401
        : message === "Not authorized"
          ? 403
          : 500;
    return json({ error: message }, status);
  }
}
