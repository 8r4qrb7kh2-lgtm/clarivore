function asText(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return asText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildMenuUpdateEmail(body) {
  const restaurantName = escapeHtml(body?.restaurantName || "Unknown Restaurant");
  const restaurantSlug = asText(body?.restaurantSlug);
  const addedItems = Array.isArray(body?.addedItems) ? body.addedItems : [];
  const removedItems = Array.isArray(body?.removedItems) ? body.removedItems : [];
  const keptItems = Number(body?.keptItems || 0);
  const hasChanges = addedItems.length + removedItems.length > 0;

  const subject = `Menu Update: ${restaurantName}${hasChanges ? " - Changes Detected" : ""}`;

  const linksHtml = restaurantSlug
    ? `<p><a href="https://clarivore.org/restaurant?slug=${encodeURIComponent(restaurantSlug)}" style="background: #4c5ad4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Menu</a></p>`
    : "";

  let html = `
    <h2 style="color: #333;">Menu Update at ${restaurantName}</h2>
    <p>Your restaurant monitoring system detected a menu change.</p>
    ${hasChanges ? '<h3 style="color: #dc5252;">Changes Detected - Review Required</h3>' : '<h3 style="color: #4caf50;">No Changes Detected</h3>'}
  `;

  if (addedItems.length > 0) {
    html += `
      <h4 style="color: #4caf50;">New Items (${addedItems.length}):</h4>
      <ul>${addedItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    `;
  }

  if (removedItems.length > 0) {
    html += `
      <h4 style="color: #dc5252;">Removed Items (${removedItems.length}):</h4>
      <ul>${removedItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    `;
  }

  if (keptItems > 0) {
    html += `<p><strong>Existing items found:</strong> ${keptItems}</p>`;
  }

  html += linksHtml;

  return {
    subject,
    html,
  };
}

function buildAppealEmail(body) {
  const restaurantName = escapeHtml(body?.restaurantName || "Unknown Restaurant");
  const restaurantSlug = asText(body?.restaurantSlug);
  const dishName = escapeHtml(body?.dishName || "");
  const ingredientName = escapeHtml(body?.ingredientName || "Unknown ingredient");
  const managerMessage = escapeHtml(body?.managerMessage || "");
  const photoUrl = asText(body?.photoUrl);

  const subject = `Ingredient Scan Appeal: ${restaurantName}`;
  const menuUrl = restaurantSlug
    ? `https://clarivore.org/restaurant?slug=${encodeURIComponent(restaurantSlug)}`
    : "https://clarivore.org/restaurants";

  const html = `
    <h2 style="color: #333;">Ingredient Scan Appeal</h2>
    <p><strong>Restaurant:</strong> ${restaurantName}</p>
    ${dishName ? `<p><strong>Dish:</strong> ${dishName}</p>` : ""}
    <p><strong>Ingredient:</strong> ${ingredientName}</p>
    ${managerMessage ? `<p><strong>Manager message:</strong><br>${managerMessage}</p>` : ""}
    ${photoUrl ? `<p><strong>Photo:</strong> <a href="${escapeHtml(photoUrl)}">View label image</a></p>` : ""}
    <p><a href="${menuUrl}" style="background: #4c5ad4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Menu</a></p>
  `;

  return {
    subject,
    html,
  };
}

function buildFeedbackEmail(body) {
  const restaurantName = escapeHtml(body?.restaurantName || "Clarivore");
  const restaurantSlug = asText(body?.restaurantSlug);
  const feedbackText = escapeHtml(body?.feedbackText || body?.message || "No feedback text provided.");
  const subject = `Feedback: ${restaurantName}`;

  const menuUrl = restaurantSlug
    ? `https://clarivore.org/restaurant?slug=${encodeURIComponent(restaurantSlug)}`
    : "https://clarivore.org/help-contact";

  const html = `
    <h2 style="color: #333;">Feedback</h2>
    <p><strong>Restaurant:</strong> ${restaurantName}</p>
    <p style="white-space: pre-wrap;">${feedbackText}</p>
    <p><a href="${menuUrl}" style="background: #4c5ad4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Open Clarivore</a></p>
  `;

  return {
    subject,
    html,
  };
}

function buildIssueEmail(body) {
  const context = escapeHtml(body?.context || "issue");
  const message = escapeHtml(body?.message || "");
  const reporterName = escapeHtml(body?.reporterName || body?.accountName || "Unknown reporter");
  const userEmail = escapeHtml(body?.userEmail || "");
  const restaurantName = escapeHtml(body?.restaurantName || "Clarivore");
  const pageUrl = asText(body?.pageUrl);

  const subject = `Issue Report (${context}): ${restaurantName}`;
  const html = `
    <h2 style="color: #333;">Issue Report</h2>
    <p><strong>Context:</strong> ${context}</p>
    <p><strong>Reporter:</strong> ${reporterName}</p>
    ${userEmail ? `<p><strong>Email:</strong> ${userEmail}</p>` : ""}
    <p><strong>Restaurant:</strong> ${restaurantName}</p>
    ${pageUrl ? `<p><strong>Page:</strong> <a href="${escapeHtml(pageUrl)}">${escapeHtml(pageUrl)}</a></p>` : ""}
    <p><strong>Message:</strong></p>
    <div style="background: #f3f4f6; padding: 12px; border-radius: 8px; white-space: pre-wrap;">${message}</div>
  `;

  return {
    subject,
    html,
  };
}

function buildEmail(type, body) {
  const normalizedType = asText(type || "menu_update").toLowerCase();
  if (normalizedType === "appeal") {
    return buildAppealEmail(body);
  }
  if (normalizedType === "feedback") {
    return buildFeedbackEmail(body);
  }
  if (normalizedType === "issue") {
    return buildIssueEmail(body);
  }
  return buildMenuUpdateEmail(body);
}

function wrapEmailHtml(content) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 640px; margin: 0 auto; padding: 20px;">
        ${content}
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">Sent by Clarivore</p>
      </body>
    </html>
  `;
}

export async function sendNotificationEmail(body = {}) {
  const sendgridApiKey = asText(process.env.SENDGRID_API_KEY);
  const adminEmail =
    asText(process.env.NOTIFICATION_ADMIN_EMAIL) ||
    asText(process.env.ADMIN_EMAIL) ||
    "matt.29.ds@gmail.com";
  const fromEmail =
    asText(process.env.NOTIFICATION_FROM_EMAIL) ||
    asText(process.env.SENDGRID_FROM_EMAIL) ||
    "notifications@clarivore.org";
  const fromName = asText(process.env.NOTIFICATION_FROM_NAME) || "Clarivore";

  const type = asText(body?.type || "menu_update").toLowerCase();
  const emailContent = buildEmail(type, body);
  const subject = asText(emailContent?.subject);
  const html = wrapEmailHtml(asText(emailContent?.html));

  if (!sendgridApiKey) {
    return {
      success: false,
      skipped: true,
      error: "SendGrid API key not configured",
      type,
    };
  }

  const sendgridResponse = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sendgridApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: adminEmail }],
          subject,
        },
      ],
      from: { email: fromEmail, name: fromName },
      content: [
        {
          type: "text/html",
          value: html,
        },
      ],
    }),
  });

  if (!sendgridResponse.ok) {
    const errorText = await sendgridResponse.text();
    return {
      success: false,
      error: `Failed to send email: ${errorText}`,
      type,
    };
  }

  return {
    success: true,
    provider: "sendgrid",
    type,
  };
}
