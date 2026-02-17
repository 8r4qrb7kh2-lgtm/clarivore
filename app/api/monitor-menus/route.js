import { createHash } from "node:crypto";
import {
  applyWriteOperations,
  asText,
  ensureRestaurantWriteInfrastructure,
  prisma,
  RESTAURANT_WRITE_OPERATION_TYPES,
} from "../restaurant-write/_shared/writeGatewayUtils";
import { sendNotificationEmail } from "../notifications/_shared/emailSender";

export const runtime = "nodejs";

function isAuthorized(request) {
  const systemKey = asText(process.env.CLARIVORE_SYSTEM_WRITE_KEY);
  const cronSecret = asText(process.env.CRON_SECRET);

  const headerKey = asText(request.headers.get("x-clarivore-system-key"));
  if (systemKey && headerKey && headerKey === systemKey) {
    return true;
  }

  const authHeader = asText(request.headers.get("authorization"));
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  return false;
}

function hashContent(value) {
  return createHash("sha256").update(asText(value)).digest("hex");
}

function extractMenuText(html) {
  const source = asText(html);
  if (!source) return "";

  let text = source
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length > 25000) {
    text = text.slice(0, 25000);
  }

  return text;
}

function parseDishList(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => ({
      name: asText(entry?.name || entry),
      description: asText(entry?.description),
    }))
    .filter((entry) => entry.name || entry.description);
}

function extractDishesFromText(menuText) {
  const lines = asText(menuText)
    .split(/[\n\r]+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const out = [];
  for (const line of lines) {
    if (line.length < 3 || line.length > 80) continue;
    if (/\d{1,2}[\.,]\d{2}/.test(line)) continue;
    if (/^(menu|appetizers|entrees|desserts|drinks)$/i.test(line)) continue;

    const cleaned = line.replace(/\s{2,}/g, " ").trim();
    if (!cleaned) continue;
    out.push({ name: cleaned, description: "" });
    if (out.length >= 120) break;
  }

  return out;
}

function detectDishDiff(previousDishes, currentDishes) {
  const normalize = (value) => asText(value).toLowerCase();
  const previousSet = new Set(previousDishes.map((entry) => normalize(entry.name)).filter(Boolean));
  const currentSet = new Set(currentDishes.map((entry) => normalize(entry.name)).filter(Boolean));

  const added = currentDishes
    .map((entry) => asText(entry.name))
    .filter(Boolean)
    .filter((name) => !previousSet.has(normalize(name)))
    .slice(0, 10);
  const removed = previousDishes
    .map((entry) => asText(entry.name))
    .filter(Boolean)
    .filter((name) => !currentSet.has(normalize(name)))
    .slice(0, 10);
  const kept = currentDishes
    .map((entry) => asText(entry.name))
    .filter(Boolean)
    .filter((name) => previousSet.has(normalize(name))).length;

  return {
    addedItems: added,
    removedItems: removed,
    keptItems: kept,
  };
}

async function applyMonitoringStatsWrite({ restaurantId, emailsSentIncrement }) {
  await ensureRestaurantWriteInfrastructure(prisma);

  await prisma.$transaction(async (tx) => {
    await applyWriteOperations({
      tx,
      batch: {
        author: "Menu monitor",
        restaurant_id: restaurantId,
      },
      operations: [
        {
          operation_type: RESTAURANT_WRITE_OPERATION_TYPES.MONITORING_STATS_UPDATE,
          operation_payload: {
            restaurantId,
            lastChecked: new Date().toISOString(),
            totalChecksIncrement: 1,
            emailsSentIncrement: Math.max(Number(emailsSentIncrement) || 0, 0),
          },
          summary: "Menu monitoring stats update",
        },
      ],
      userEmail: null,
    });
  });
}

export async function POST(request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const targetRestaurantId = asText(url.searchParams.get("restaurantId"));

  try {
    const where = {
      menu_url: { not: null },
      monitor_enabled: true,
    };
    if (targetRestaurantId) {
      where.id = targetRestaurantId;
    }

    const restaurants = await prisma.restaurants.findMany({
      where,
      select: {
        id: true,
        name: true,
        slug: true,
        menu_url: true,
      },
      orderBy: { name: "asc" },
    });

    const results = [];

    for (const restaurant of restaurants) {
      const restaurantId = asText(restaurant.id);
      const menuUrl = asText(restaurant.menu_url);
      const restaurantName = asText(restaurant.name) || "Restaurant";

      let emailsSentIncrement = 0;

      try {
        const menuResponse = await fetch(menuUrl, {
          headers: {
            "User-Agent": "Clarivore Menu Monitor (ops@clarivore.org)",
          },
        });

        if (!menuResponse.ok) {
          throw new Error(`Failed to fetch menu (${menuResponse.status})`);
        }

        const html = await menuResponse.text();
        const menuText = extractMenuText(html);
        const currentHash = hashContent(menuText);

        const previousSnapshot = await prisma.menu_snapshots.findFirst({
          where: { restaurant_id: restaurantId },
          orderBy: { detected_at: "desc" },
          select: {
            id: true,
            content_hash: true,
            dishes_json: true,
          },
        });

        const currentDishes = extractDishesFromText(menuText);

        if (!previousSnapshot) {
          await prisma.menu_snapshots.create({
            data: {
              restaurant_id: restaurantId,
              content_hash: currentHash,
              menu_text: menuText,
              dishes_json: currentDishes,
              detected_at: new Date(),
            },
          });

          results.push({
            restaurant: restaurantName,
            status: "baseline_created",
            dishes: currentDishes.length,
          });
        } else if (asText(previousSnapshot.content_hash) !== currentHash) {
          await prisma.menu_snapshots.create({
            data: {
              restaurant_id: restaurantId,
              content_hash: currentHash,
              menu_text: menuText,
              dishes_json: currentDishes,
              detected_at: new Date(),
            },
          });

          const previousDishes = parseDishList(previousSnapshot.dishes_json);
          const diff = detectDishDiff(previousDishes, currentDishes);

          const emailResult = await sendNotificationEmail({
            type: "menu_update",
            restaurantName,
            restaurantSlug: asText(restaurant.slug),
            addedItems: diff.addedItems,
            removedItems: diff.removedItems,
            keptItems: diff.keptItems,
          });

          if (emailResult?.success) {
            emailsSentIncrement = 1;
          }

          results.push({
            restaurant: restaurantName,
            status: "changed",
            addedItems: diff.addedItems,
            removedItems: diff.removedItems,
            emailSent: Boolean(emailResult?.success),
          });
        } else {
          results.push({
            restaurant: restaurantName,
            status: "no_change",
            dishes: currentDishes.length,
          });
        }

        await applyMonitoringStatsWrite({
          restaurantId,
          emailsSentIncrement,
        });
      } catch (error) {
        results.push({
          restaurant: restaurantName,
          status: "error",
          error: asText(error?.message) || "Unknown error",
        });

        await applyMonitoringStatsWrite({
          restaurantId,
          emailsSentIncrement: 0,
        });
      }
    }

    return Response.json(
      {
        checked: restaurants.length,
        results,
      },
      { status: 200 },
    );
  } catch (error) {
    return Response.json(
      {
        error: asText(error?.message) || "Failed to monitor menus.",
      },
      { status: 500 },
    );
  }
}
