import { prisma } from "../app/api/editor-pending-save/_shared/pendingSaveUtils.js";
import {
  ensureRestaurantWriteInfrastructure,
  setRestaurantWriteContext,
  syncIngredientStatusFromOverlays,
} from "../app/api/restaurant-write/_shared/writeGatewayUtils.js";

function asText(value) {
  return String(value ?? "").trim();
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function hasLegacyColumns() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'restaurants'
      AND column_name IN ('overlays', 'menu_images', 'menu_image')
  `);
  const names = new Set((Array.isArray(rows) ? rows : []).map((row) => asText(row?.column_name)));
  return {
    overlays: names.has("overlays"),
    menuImages: names.has("menu_images"),
    menuImage: names.has("menu_image"),
  };
}

async function loadLegacyRestaurants() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT id, name, overlays, menu_images, menu_image
    FROM public.restaurants
    ORDER BY name ASC
  `);
  return Array.isArray(rows) ? rows : [];
}

function readMenuImages(row) {
  const images = parseJsonArray(row?.menu_images)
    .map((value) => asText(value))
    .filter(Boolean);
  const single = asText(row?.menu_image);
  if (!images.length && single) {
    images.push(single);
  }
  return images;
}

async function clearLegacyColumns() {
  await prisma.$transaction(async (tx) => {
    await setRestaurantWriteContext(tx);
    await tx.$executeRawUnsafe(`
      UPDATE public.restaurants
      SET
        overlays = '[]'::jsonb,
        menu_images = '[]'::jsonb,
        menu_image = NULL
    `);
  });
}

async function dropLegacyColumns() {
  await prisma.$transaction(async (tx) => {
    await setRestaurantWriteContext(tx);
    await tx.$executeRawUnsafe(`
      ALTER TABLE public.restaurants
        DROP COLUMN IF EXISTS overlays,
        DROP COLUMN IF EXISTS menu_images,
        DROP COLUMN IF EXISTS menu_image
    `);
  });
}

async function main() {
  const shouldDropColumns = process.argv.includes("--drop-legacy-columns");

  await ensureRestaurantWriteInfrastructure(prisma);

  const columns = await hasLegacyColumns();
  if (!columns.overlays || !columns.menuImages || !columns.menuImage) {
    console.log("[backfill-menu-state-to-tables] Legacy columns already removed; skipping backfill.");
    if (shouldDropColumns) {
      await dropLegacyColumns();
      console.log("[backfill-menu-state-to-tables] Verified legacy columns are dropped.");
    }
    return;
  }

  const restaurants = await loadLegacyRestaurants();

  let totalRows = 0;
  let totalAllergens = 0;
  let totalDiets = 0;
  let totalMenuPages = 0;
  let totalMenuDishes = 0;
  let totalMenuIngredientRows = 0;
  let totalMenuBrandItems = 0;

  for (let index = 0; index < restaurants.length; index += 1) {
    const restaurant = restaurants[index];
    const restaurantId = asText(restaurant?.id);
    if (!restaurantId) continue;

    const overlays = parseJsonArray(restaurant?.overlays);
    const menuImages = readMenuImages(restaurant);

    const result = await prisma.$transaction(async (tx) => {
      return await syncIngredientStatusFromOverlays(tx, restaurantId, overlays, {
        menuImages,
      });
    });

    totalRows += Number(result?.rows || 0);
    totalAllergens += Number(result?.allergens || 0);
    totalDiets += Number(result?.diets || 0);
    totalMenuPages += Number(result?.menuPages || 0);
    totalMenuDishes += Number(result?.menuDishes || 0);
    totalMenuIngredientRows += Number(result?.menuIngredientRows || 0);
    totalMenuBrandItems += Number(result?.menuBrandItems || 0);

    if ((index + 1) % 20 === 0 || index + 1 === restaurants.length) {
      console.log(
        `[backfill-menu-state-to-tables] Synced ${index + 1}/${restaurants.length} restaurants`,
      );
    }
  }

  await clearLegacyColumns();
  console.log("[backfill-menu-state-to-tables] Cleared legacy menu JSON column values.");

  if (shouldDropColumns) {
    await dropLegacyColumns();
    console.log("[backfill-menu-state-to-tables] Dropped legacy columns overlays/menu_images/menu_image.");
  }

  console.log("[backfill-menu-state-to-tables] Complete", {
    restaurants: restaurants.length,
    rows: totalRows,
    allergens: totalAllergens,
    diets: totalDiets,
    menuPages: totalMenuPages,
    menuDishes: totalMenuDishes,
    menuIngredientRows: totalMenuIngredientRows,
    menuBrandItems: totalMenuBrandItems,
    droppedLegacyColumns: shouldDropColumns,
  });
}

try {
  await main();
} catch (error) {
  console.error("[backfill-menu-state-to-tables] Failed", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
