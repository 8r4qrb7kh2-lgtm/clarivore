#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import process from "node:process";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";

function asText(value) {
  return String(value ?? "").trim();
}

function toIsoDaysAgo(daysAgo) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Number(daysAgo || 0));
  return date.toISOString();
}

function buildJsonPayload(value) {
  return value == null ? null : value;
}

function toBooleanFlag(value) {
  const normalized = asText(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function shouldAllowSelfSignedTls() {
  return (
    toBooleanFlag(process.env.SUPABASE_TLS_ALLOW_SELF_SIGNED) ||
    asText(process.env.TARGET_ENV).toLowerCase() === "staging"
  );
}

function maybeRelaxNodeTls() {
  if (!shouldAllowSelfSignedTls()) return;
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
}

const CONFIG = {
  sourceSlug: asText(process.env.DOCS_MANAGER_SOURCE_SLUG) || "demo-restaurant",
  targetSlug: asText(process.env.DOCS_MANAGER_TARGET_SLUG) || "demo-menu",
  targetName: asText(process.env.DOCS_MANAGER_TARGET_NAME) || "Demo Menu",
  managerEmail:
    asText(process.env.DOCS_MANAGER_EMAIL) || "manager-guide-demo@clarivore.local",
  managerPassword:
    asText(process.env.DOCS_MANAGER_PASSWORD) || "ClarivoreDocs123!",
  managerFirstName: asText(process.env.DOCS_MANAGER_FIRST_NAME) || "Guide",
  managerLastName: asText(process.env.DOCS_MANAGER_LAST_NAME) || "Manager",
  dinerUsers: [
    {
      email: asText(process.env.DOCS_DINER_1_EMAIL) || "manager-guide-diner-1@clarivore.local",
      password: asText(process.env.DOCS_DINER_1_PASSWORD) || "ClarivoreDocs123!",
      firstName: "Avery",
      lastName: "Patel",
    },
    {
      email: asText(process.env.DOCS_DINER_2_EMAIL) || "manager-guide-diner-2@clarivore.local",
      password: asText(process.env.DOCS_DINER_2_PASSWORD) || "ClarivoreDocs123!",
      firstName: "Jordan",
      lastName: "Lee",
    },
    {
      email: asText(process.env.DOCS_DINER_3_EMAIL) || "manager-guide-diner-3@clarivore.local",
      password: asText(process.env.DOCS_DINER_3_PASSWORD) || "ClarivoreDocs123!",
      firstName: "Morgan",
      lastName: "Diaz",
    },
    {
      email: asText(process.env.DOCS_DINER_4_EMAIL) || "manager-guide-diner-4@clarivore.local",
      password: asText(process.env.DOCS_DINER_4_PASSWORD) || "ClarivoreDocs123!",
      firstName: "Taylor",
      lastName: "Nguyen",
    },
  ],
};

function requiredEnv(name) {
  const value = asText(process.env[name]);
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function createAdminClient() {
  const url = asText(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = asText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
  return createSupabaseClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function ensureAuthUser(pgClient, adminClient, userConfig) {
  const email = asText(userConfig.email).toLowerCase();
  const existing = await pgClient.query(
    "SELECT id::text FROM auth.users WHERE lower(email) = lower($1) LIMIT 1",
    [email],
  );
  const metadata = {
    first_name: asText(userConfig.firstName),
    last_name: asText(userConfig.lastName),
    role: asText(userConfig.role) || "customer",
  };

  if (existing.rows[0]?.id) {
    const userId = existing.rows[0].id;
    const { error } = await adminClient.auth.admin.updateUserById(userId, {
      email,
      password: asText(userConfig.password),
      email_confirm: true,
      user_metadata: metadata,
    });
    if (error) throw error;
    await pgClient.query(
      `UPDATE auth.users
       SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || $2::jsonb
       WHERE id = $1::uuid`,
      [userId, JSON.stringify(metadata)],
    );
    return userId;
  }

  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password: asText(userConfig.password),
    email_confirm: true,
    user_metadata: metadata,
  });
  if (error) throw error;
  const userId = asText(data?.user?.id);
  if (!userId) {
    throw new Error(`Failed to create auth user for ${email}.`);
  }
  await pgClient.query(
    `UPDATE auth.users
     SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || $2::jsonb
     WHERE id = $1::uuid`,
    [userId, JSON.stringify(metadata)],
  );
  return userId;
}

async function readRestaurantBySlug(pgClient, slug) {
  const result = await pgClient.query(
    `SELECT
      id::text,
      slug,
      name,
      last_confirmed,
      menu_url,
      last_checked,
      monitor_enabled,
      total_checks,
      emails_sent,
      check_frequency_hours,
      delivery_url,
      website,
      phone,
      write_version,
      map_location
    FROM public.restaurants
    WHERE slug = $1
    LIMIT 1`,
    [slug],
  );
  return result.rows[0] || null;
}

async function ensureTargetRestaurant(pgClient, sourceRestaurant) {
  const targetLastConfirmed = toIsoDaysAgo(45);
  const existingTarget = await readRestaurantBySlug(pgClient, CONFIG.targetSlug);

  if (existingTarget?.id) {
    await pgClient.query(
      `UPDATE public.restaurants
      SET
        name = $2,
        last_confirmed = $3,
        menu_url = $4,
        last_checked = $5,
        monitor_enabled = $6,
        total_checks = $7,
        emails_sent = $8,
        check_frequency_hours = $9,
        delivery_url = $10,
        website = $11,
        phone = $12,
        write_version = $13,
        map_location = $14,
        updated_at = now()
      WHERE id = $1`,
      [
        existingTarget.id,
        CONFIG.targetName,
        targetLastConfirmed,
        sourceRestaurant.menu_url,
        sourceRestaurant.last_checked,
        sourceRestaurant.monitor_enabled,
        sourceRestaurant.total_checks,
        sourceRestaurant.emails_sent,
        sourceRestaurant.check_frequency_hours,
        sourceRestaurant.delivery_url,
        sourceRestaurant.website,
        sourceRestaurant.phone,
        sourceRestaurant.write_version,
        sourceRestaurant.map_location,
      ],
    );
    return existingTarget.id;
  }

  const restaurantId = randomUUID();
  await pgClient.query(
    `INSERT INTO public.restaurants (
      id,
      slug,
      name,
      last_confirmed,
      created_at,
      updated_at,
      menu_url,
      last_checked,
      monitor_enabled,
      total_checks,
      emails_sent,
      check_frequency_hours,
      delivery_url,
      website,
      phone,
      write_version,
      map_location
    ) VALUES (
      $1,
      $2,
      $3,
      $4,
      now(),
      now(),
      $5,
      $6,
      $7,
      $8,
      $9,
      $10,
      $11,
      $12,
      $13,
      $14,
      $15
    )`,
    [
      restaurantId,
      CONFIG.targetSlug,
      CONFIG.targetName,
      targetLastConfirmed,
      sourceRestaurant.menu_url,
      sourceRestaurant.last_checked,
      sourceRestaurant.monitor_enabled,
      sourceRestaurant.total_checks,
      sourceRestaurant.emails_sent,
      sourceRestaurant.check_frequency_hours,
      sourceRestaurant.delivery_url,
      sourceRestaurant.website,
      sourceRestaurant.phone,
      sourceRestaurant.write_version,
      sourceRestaurant.map_location,
    ],
  );
  return restaurantId;
}

async function cloneMenuState(pgClient, sourceRestaurantId, targetRestaurantId) {
  const pagesResult = await pgClient.query(
    `SELECT page_index, image_url
     FROM public.restaurant_menu_pages
     WHERE restaurant_id = $1
     ORDER BY page_index ASC`,
    [sourceRestaurantId],
  );
  const dishesResult = await pgClient.query(
    `SELECT
      id::text,
      dish_key,
      dish_name,
      page_index,
      x,
      y,
      w,
      h,
      dish_text,
      description,
      details_json,
      allergens,
      diets,
      cross_contamination_allergens,
      cross_contamination_diets,
      removable_json,
      ingredients_blocking_diets_json,
      payload_json
     FROM public.restaurant_menu_dishes
     WHERE restaurant_id = $1
     ORDER BY page_index ASC, dish_name ASC`,
    [sourceRestaurantId],
  );
  const rowsResult = await pgClient.query(
    `SELECT
      id::text,
      dish_id::text,
      dish_name,
      row_index,
      row_text,
      applied_brand_item,
      ingredient_payload
     FROM public.restaurant_menu_ingredient_rows
     WHERE restaurant_id = $1
     ORDER BY dish_name ASC, row_index ASC`,
    [sourceRestaurantId],
  );
  const brandsResult = await pgClient.query(
    `SELECT
      ingredient_row_id::text,
      dish_name,
      row_index,
      brand_name,
      barcode,
      brand_image,
      ingredients_image,
      image,
      ingredient_list,
      ingredients_list,
      allergens,
      cross_contamination_allergens,
      diets,
      cross_contamination_diets,
      brand_payload
     FROM public.restaurant_menu_ingredient_brand_items
     WHERE restaurant_id = $1
     ORDER BY dish_name ASC, row_index ASC`,
    [sourceRestaurantId],
  );

  const dishIdMap = new Map();
  const ingredientRowIdMap = new Map();

  await pgClient.query("BEGIN");
  try {
    await pgClient.query("SELECT set_config('app.restaurant_write_context', 'gateway', true)");
    await pgClient.query(
      "DELETE FROM public.restaurant_menu_ingredient_brand_items WHERE restaurant_id = $1",
      [targetRestaurantId],
    );
    await pgClient.query(
      "DELETE FROM public.restaurant_menu_ingredient_rows WHERE restaurant_id = $1",
      [targetRestaurantId],
    );
    await pgClient.query(
      "DELETE FROM public.restaurant_menu_dishes WHERE restaurant_id = $1",
      [targetRestaurantId],
    );
    await pgClient.query(
      "DELETE FROM public.restaurant_menu_pages WHERE restaurant_id = $1",
      [targetRestaurantId],
    );

    for (const page of pagesResult.rows) {
      await pgClient.query(
        `INSERT INTO public.restaurant_menu_pages (
          id,
          restaurant_id,
          page_index,
          image_url,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, now(), now())`,
        [randomUUID(), targetRestaurantId, page.page_index, page.image_url],
      );
    }

    for (const dish of dishesResult.rows) {
      const nextDishId = randomUUID();
      dishIdMap.set(dish.id, nextDishId);
      await pgClient.query(
        `INSERT INTO public.restaurant_menu_dishes (
          id,
          restaurant_id,
          dish_key,
          dish_name,
          page_index,
          x,
          y,
          w,
          h,
          dish_text,
          description,
          details_json,
          allergens,
          diets,
          cross_contamination_allergens,
          cross_contamination_diets,
          removable_json,
          ingredients_blocking_diets_json,
          payload_json,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, now(), now()
        )`,
        [
          nextDishId,
          targetRestaurantId,
          dish.dish_key,
          dish.dish_name,
          dish.page_index,
          dish.x,
          dish.y,
          dish.w,
          dish.h,
          dish.dish_text,
          dish.description,
          buildJsonPayload(dish.details_json),
          dish.allergens,
          dish.diets,
          dish.cross_contamination_allergens,
          dish.cross_contamination_diets,
          buildJsonPayload(dish.removable_json),
          buildJsonPayload(dish.ingredients_blocking_diets_json),
          buildJsonPayload(dish.payload_json),
        ],
      );
    }

    for (const row of rowsResult.rows) {
      const nextRowId = randomUUID();
      ingredientRowIdMap.set(row.id, nextRowId);
      await pgClient.query(
        `INSERT INTO public.restaurant_menu_ingredient_rows (
          id,
          restaurant_id,
          dish_id,
          dish_name,
          row_index,
          row_text,
          applied_brand_item,
          ingredient_payload,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())`,
        [
          nextRowId,
          targetRestaurantId,
          dishIdMap.get(row.dish_id) || null,
          row.dish_name,
          row.row_index,
          row.row_text,
          row.applied_brand_item,
          buildJsonPayload(row.ingredient_payload),
        ],
      );
    }

    for (const brand of brandsResult.rows) {
      const nextIngredientRowId = ingredientRowIdMap.get(brand.ingredient_row_id);
      if (!nextIngredientRowId) continue;
      await pgClient.query(
        `INSERT INTO public.restaurant_menu_ingredient_brand_items (
          id,
          restaurant_id,
          ingredient_row_id,
          dish_name,
          row_index,
          brand_name,
          barcode,
          brand_image,
          ingredients_image,
          image,
          ingredient_list,
          ingredients_list,
          allergens,
          cross_contamination_allergens,
          diets,
          cross_contamination_diets,
          brand_payload,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, now(), now()
        )`,
        [
          randomUUID(),
          targetRestaurantId,
          nextIngredientRowId,
          brand.dish_name,
          brand.row_index,
          brand.brand_name,
          brand.barcode,
          brand.brand_image,
          brand.ingredients_image,
          brand.image,
          brand.ingredient_list,
          brand.ingredients_list,
          brand.allergens,
          brand.cross_contamination_allergens,
          brand.diets,
          brand.cross_contamination_diets,
          buildJsonPayload(brand.brand_payload),
        ],
      );
    }

    await pgClient.query(
      "UPDATE public.restaurants SET write_version = COALESCE(write_version, 0) + 1, updated_at = now() WHERE id = $1",
      [targetRestaurantId],
    );
    await pgClient.query("COMMIT");
  } catch (error) {
    await pgClient.query("ROLLBACK");
    throw error;
  }
}

function findDishName(dishNames, preferredNames, fallbackIndex = 0) {
  for (const preferredName of preferredNames) {
    const match = dishNames.find((dishName) => dishName === preferredName);
    if (match) return match;
  }
  return dishNames[fallbackIndex] || dishNames[0] || "Dish";
}

function buildSeededInteractions({ restaurantId, dinerUserIds, dishNames }) {
  const [userA, userB, userC, userD] = dinerUserIds;
  const tofu = findDishName(dishNames, ["Grilled Tofu"], 0);
  const pasta = findDishName(dishNames, ["Spaghetti Bolognese"], 1);
  const chicken = findDishName(dishNames, ["Lemon Herb Chicken"], 2);
  const salad = findDishName(dishNames, ["Greek Salad"], 3);
  const salmon = findDishName(dishNames, ["Seared Salmon"], 4);
  const curry = findDishName(dishNames, ["Vegetable Curry"], 5);

  return [
    {
      id: randomUUID(),
      user_id: userA,
      restaurant_id: restaurantId,
      dish_name: tofu,
      user_allergens: ["peanut"],
      user_diets: ["Vegan"],
      dish_status: "safe",
      conflicting_allergens: [],
      unmet_diets: [],
      created_at: toIsoDaysAgo(2),
    },
    {
      id: randomUUID(),
      user_id: userB,
      restaurant_id: restaurantId,
      dish_name: tofu,
      user_allergens: ["milk"],
      user_diets: ["Vegetarian"],
      dish_status: "safe",
      conflicting_allergens: [],
      unmet_diets: [],
      created_at: toIsoDaysAgo(3),
    },
    {
      id: randomUUID(),
      user_id: userC,
      restaurant_id: restaurantId,
      dish_name: pasta,
      user_allergens: ["wheat"],
      user_diets: ["Gluten-free"],
      dish_status: "unsafe",
      conflicting_allergens: ["wheat"],
      unmet_diets: ["Gluten-free"],
      created_at: toIsoDaysAgo(3),
    },
    {
      id: randomUUID(),
      user_id: userD,
      restaurant_id: restaurantId,
      dish_name: pasta,
      user_allergens: ["milk"],
      user_diets: [],
      dish_status: "unsafe",
      conflicting_allergens: ["milk"],
      unmet_diets: [],
      created_at: toIsoDaysAgo(4),
    },
    {
      id: randomUUID(),
      user_id: userA,
      restaurant_id: restaurantId,
      dish_name: chicken,
      user_allergens: ["soy"],
      user_diets: [],
      dish_status: "removable",
      conflicting_allergens: ["soy"],
      unmet_diets: [],
      created_at: toIsoDaysAgo(5),
    },
    {
      id: randomUUID(),
      user_id: userB,
      restaurant_id: restaurantId,
      dish_name: chicken,
      user_allergens: ["sesame"],
      user_diets: [],
      dish_status: "safe",
      conflicting_allergens: [],
      unmet_diets: [],
      created_at: toIsoDaysAgo(6),
    },
    {
      id: randomUUID(),
      user_id: userC,
      restaurant_id: restaurantId,
      dish_name: salad,
      user_allergens: ["egg"],
      user_diets: ["Vegetarian"],
      dish_status: "removable",
      conflicting_allergens: ["egg"],
      unmet_diets: [],
      created_at: toIsoDaysAgo(4),
    },
    {
      id: randomUUID(),
      user_id: userD,
      restaurant_id: restaurantId,
      dish_name: salad,
      user_allergens: [],
      user_diets: ["Vegetarian"],
      dish_status: "safe",
      conflicting_allergens: [],
      unmet_diets: [],
      created_at: toIsoDaysAgo(4),
    },
    {
      id: randomUUID(),
      user_id: userA,
      restaurant_id: restaurantId,
      dish_name: salmon,
      user_allergens: ["fish"],
      user_diets: ["Pescatarian"],
      dish_status: "safe",
      conflicting_allergens: [],
      unmet_diets: [],
      created_at: toIsoDaysAgo(1),
    },
    {
      id: randomUUID(),
      user_id: userB,
      restaurant_id: restaurantId,
      dish_name: salmon,
      user_allergens: ["milk"],
      user_diets: ["Pescatarian"],
      dish_status: "unsafe",
      conflicting_allergens: ["milk"],
      unmet_diets: [],
      created_at: toIsoDaysAgo(1),
    },
    {
      id: randomUUID(),
      user_id: userC,
      restaurant_id: restaurantId,
      dish_name: curry,
      user_allergens: [],
      user_diets: ["Vegan"],
      dish_status: "safe",
      conflicting_allergens: [],
      unmet_diets: [],
      created_at: toIsoDaysAgo(2),
    },
    {
      id: randomUUID(),
      user_id: userD,
      restaurant_id: restaurantId,
      dish_name: curry,
      user_allergens: ["tree nut"],
      user_diets: ["Vegan"],
      dish_status: "removable",
      conflicting_allergens: ["tree nut"],
      unmet_diets: [],
      created_at: toIsoDaysAgo(2),
    },
  ];
}

function buildDishAnalyticsRows({ restaurantId, interactions }) {
  const byDish = new Map();
  for (const interaction of interactions) {
    const dishName = asText(interaction.dish_name);
    if (!dishName) continue;
    if (!byDish.has(dishName)) {
      byDish.set(dishName, []);
    }
    byDish.get(dishName).push(interaction);
  }

  return Array.from(byDish.entries()).map(([dishName, dishInteractions]) => {
    const userIds = new Set(dishInteractions.map((entry) => asText(entry.user_id)).filter(Boolean));
    const dairyUsers = new Set();
    const veganUsers = new Set();
    const vegetarianUsers = new Set();
    let safeInteractions = 0;
    let unsafeInteractions = 0;

    dishInteractions.forEach((entry) => {
      const userId = asText(entry.user_id);
      if (Array.isArray(entry.user_allergens) && entry.user_allergens.includes("milk")) {
        dairyUsers.add(userId);
      }
      if (Array.isArray(entry.user_diets) && entry.user_diets.includes("Vegan")) {
        veganUsers.add(userId);
      }
      if (Array.isArray(entry.user_diets) && entry.user_diets.includes("Vegetarian")) {
        vegetarianUsers.add(userId);
      }
      if (entry.dish_status === "unsafe") {
        unsafeInteractions += 1;
      } else {
        safeInteractions += 1;
      }
    });

    return {
      restaurant_id: restaurantId,
      dish_name: dishName,
      total_interactions: dishInteractions.length,
      unique_users: userIds.size,
      users_with_dairy_allergy: dairyUsers.size,
      users_vegan: veganUsers.size,
      users_vegetarian: vegetarianUsers.size,
      safe_interactions: safeInteractions,
      unsafe_interactions: unsafeInteractions,
    };
  });
}

function buildTabletOrders({ restaurantId, dishNames }) {
  const tofu = findDishName(dishNames, ["Grilled Tofu"], 0);
  const pasta = findDishName(dishNames, ["Spaghetti Bolognese"], 1);
  const chicken = findDishName(dishNames, ["Lemon Herb Chicken"], 2);
  const salmon = findDishName(dishNames, ["Seared Salmon"], 3);
  const nowIso = new Date().toISOString();

  return [
    {
      id: randomUUID(),
      restaurant_id: restaurantId,
      status: "awaiting_server_approval",
      payload: {
        id: randomUUID(),
        restaurantId,
        customerName: "Jordan Lee",
        allergies: ["Milk", "Wheat"],
        diets: ["Gluten-free"],
        items: [pasta],
        dishes: [pasta],
        selectedDishes: [pasta],
        serverCode: "Server 1432 / Table 14",
        serverId: "1432",
        tableNumber: "14",
        status: "awaiting_server_approval",
        note: "Guest asked whether the pasta can be prepared without wheat flour.",
        history: [
          {
            at: toIsoDaysAgo(0),
            actor: "Diner",
            message: "Submitted a dietary notice for server review.",
          },
        ],
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    },
    {
      id: randomUUID(),
      restaurant_id: restaurantId,
      status: "queued_for_kitchen",
      payload: {
        id: randomUUID(),
        restaurantId,
        customerName: "Taylor Nguyen",
        allergies: ["Peanut"],
        diets: ["Vegan"],
        items: [tofu],
        dishes: [tofu],
        selectedDishes: [tofu],
        serverCode: "Server 2751 / Table 6",
        serverId: "2751",
        tableNumber: "6",
        status: "queued_for_kitchen",
        note: "Please verify the topping brand before sending to the kitchen.",
        history: [
          {
            at: toIsoDaysAgo(1),
            actor: "Diner",
            message: "Submitted a dietary notice for server review.",
          },
          {
            at: toIsoDaysAgo(1),
            actor: "Server",
            message: "Marked ready for kitchen timing.",
          },
        ],
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    },
    {
      id: randomUUID(),
      restaurant_id: restaurantId,
      status: "with_kitchen",
      payload: {
        id: randomUUID(),
        restaurantId,
        customerName: "Avery Patel",
        allergies: ["Fish"],
        diets: ["Pescatarian"],
        items: [salmon],
        dishes: [salmon],
        selectedDishes: [salmon],
        serverCode: "Server 2751 / Table 3",
        serverId: "2751",
        tableNumber: "3",
        status: "with_kitchen",
        note: "Chef needs to confirm the finishing sauce is dairy-free.",
        history: [
          {
            at: toIsoDaysAgo(1),
            actor: "Diner",
            message: "Submitted a dietary notice for server review.",
          },
          {
            at: toIsoDaysAgo(1),
            actor: "Server",
            message: "Marked ready for kitchen timing.",
          },
          {
            at: toIsoDaysAgo(1),
            actor: "Server",
            message: "Sent the notice to the kitchen.",
          },
        ],
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    },
    {
      id: randomUUID(),
      restaurant_id: restaurantId,
      status: "awaiting_user_response",
      payload: {
        id: randomUUID(),
        restaurantId,
        customerName: "Morgan Diaz",
        allergies: ["Soy"],
        diets: [],
        items: [chicken],
        dishes: [chicken],
        selectedDishes: [chicken],
        serverCode: "Server 1432 / Table 11",
        serverId: "1432",
        tableNumber: "11",
        status: "awaiting_user_response",
        note: "Kitchen asked whether a soy-free glaze substitute is acceptable.",
        kitchenQuestion: {
          text: "Would the guest accept the soy-free herb glaze instead?",
          response: null,
          askedAt: nowIso,
        },
        history: [
          {
            at: toIsoDaysAgo(0),
            actor: "Diner",
            message: "Submitted a dietary notice for server review.",
          },
          {
            at: toIsoDaysAgo(0),
            actor: "Server",
            message: "Marked ready for kitchen timing.",
          },
          {
            at: toIsoDaysAgo(0),
            actor: "Server",
            message: "Sent the notice to the kitchen.",
          },
          {
            at: nowIso,
            actor: "Kitchen",
            message: "Sent a yes/no question: \"Would the guest accept the soy-free herb glaze instead?\"",
          },
        ],
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    },
  ];
}

async function reseedManagerArtifacts(pgClient, { restaurantId, managerUserId, dinerUserIds }) {
  const dishNamesResult = await pgClient.query(
    `SELECT dish_name
     FROM public.restaurant_menu_dishes
     WHERE restaurant_id = $1
     ORDER BY page_index ASC, dish_name ASC`,
    [restaurantId],
  );
  const dishNames = dishNamesResult.rows.map((row) => row.dish_name).filter(Boolean);
  const tofu = findDishName(dishNames, ["Grilled Tofu"], 0);
  const pasta = findDishName(dishNames, ["Spaghetti Bolognese"], 1);
  const chicken = findDishName(dishNames, ["Lemon Herb Chicken"], 2);
  const salad = findDishName(dishNames, ["Greek Salad"], 3);
  const lasagna = findDishName(dishNames, ["Beef Lasagna"], 4);
  const salmon = findDishName(dishNames, ["Seared Salmon"], 5);
  const now = new Date();
  const interactions = buildSeededInteractions({ restaurantId, dinerUserIds, dishNames });
  const tabletOrders = buildTabletOrders({ restaurantId, dishNames });
  const adminMessageTimes = {
    first: new Date(now.getTime() - 1000 * 60 * 60 * 72).toISOString(),
    second: new Date(now.getTime() - 1000 * 60 * 60 * 30).toISOString(),
    third: new Date(now.getTime() - 1000 * 60 * 60 * 4).toISOString(),
    managerReply: new Date(now.getTime() - 1000 * 60 * 60 * 52).toISOString(),
    restaurantRead: new Date(now.getTime() - 1000 * 60 * 60 * 40).toISOString(),
    adminAck: new Date(now.getTime() - 1000 * 60 * 60 * 46).toISOString(),
  };

  await pgClient.query("BEGIN");
  try {
    await pgClient.query("SELECT set_config('app.restaurant_write_context', 'gateway', true)");
    await pgClient.query("DELETE FROM public.restaurant_managers WHERE restaurant_id = $1", [restaurantId]);
    await pgClient.query(
      "INSERT INTO public.restaurant_managers (id, restaurant_id, user_id, created_at) VALUES ($1, $2, $3, now())",
      [randomUUID(), restaurantId, managerUserId],
    );

    for (const tableName of [
      "accommodation_requests",
      "restaurant_direct_message_reads",
      "restaurant_direct_messages",
      "dish_interactions",
      "user_loved_dishes",
      "tablet_orders",
      "change_logs",
    ]) {
      await pgClient.query(`DELETE FROM public.${tableName} WHERE restaurant_id = $1`, [restaurantId]);
    }

    const directMessages = [
      {
        id: randomUUID(),
        restaurant_id: restaurantId,
        sender_id: null,
        sender_name: "Clarivore Team",
        sender_role: "admin",
        message:
          "Please review the overnight allergy request spike for Spaghetti Bolognese before lunch service.",
        created_at: adminMessageTimes.first,
      },
      {
        id: randomUUID(),
        restaurant_id: restaurantId,
        sender_id: managerUserId,
        sender_name: `${CONFIG.managerFirstName} ${CONFIG.managerLastName}`.trim(),
        sender_role: "restaurant",
        message:
          "Reviewed. I’m checking the wheat-free substitution path in the webpage editor and will update the dashboard after save.",
        created_at: adminMessageTimes.managerReply,
      },
      {
        id: randomUUID(),
        restaurant_id: restaurantId,
        sender_id: null,
        sender_name: "Clarivore Team",
        sender_role: "admin",
        message:
          "Reminder: the monthly menu confirmation for Demo Menu is overdue. Open the confirmation flow after the lunch edits are published.",
        created_at: adminMessageTimes.second,
      },
      {
        id: randomUUID(),
        restaurant_id: restaurantId,
        sender_id: null,
        sender_name: "Clarivore Team",
        sender_role: "admin",
        message:
          "One more check: verify the Organic Extra Firm Tofu brand image still matches the live package before you finalize the guide screenshots.",
        created_at: adminMessageTimes.third,
      },
    ];

    for (const message of directMessages) {
      await pgClient.query(
        `INSERT INTO public.restaurant_direct_messages (
          id,
          restaurant_id,
          sender_id,
          sender_name,
          sender_role,
          message,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          message.id,
          message.restaurant_id,
          message.sender_id,
          message.sender_name,
          message.sender_role,
          message.message,
          message.created_at,
        ],
      );
    }

    const readRows = [
      {
        id: randomUUID(),
        restaurant_id: restaurantId,
        reader_role: "restaurant",
        last_read_at: adminMessageTimes.restaurantRead,
        acknowledged_at: adminMessageTimes.restaurantRead,
      },
      {
        id: randomUUID(),
        restaurant_id: restaurantId,
        reader_role: "admin",
        last_read_at: adminMessageTimes.adminAck,
        acknowledged_at: adminMessageTimes.adminAck,
      },
    ];

    for (const row of readRows) {
      await pgClient.query(
        `INSERT INTO public.restaurant_direct_message_reads (
          id,
          restaurant_id,
          reader_role,
          last_read_at,
          acknowledged_at,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, now(), now())`,
        [row.id, row.restaurant_id, row.reader_role, row.last_read_at, row.acknowledged_at],
      );
    }

    const requests = [
      {
        id: randomUUID(),
        user_id: dinerUserIds[0],
        restaurant_id: restaurantId,
        dish_name: pasta,
        user_allergens: ["wheat"],
        user_diets: ["Gluten-free"],
        requested_allergens: ["wheat"],
        requested_diets: ["Gluten-free"],
        user_message: "Can this dish be prepared with a gluten-free pasta swap?",
        status: "pending",
        manager_response: null,
        manager_reviewed_at: null,
        manager_reviewed_by: null,
        created_at: toIsoDaysAgo(1),
      },
      {
        id: randomUUID(),
        user_id: dinerUserIds[1],
        restaurant_id: restaurantId,
        dish_name: tofu,
        user_allergens: ["peanut"],
        user_diets: ["Vegan"],
        requested_allergens: ["peanut"],
        requested_diets: ["Vegan"],
        user_message: "Need confirmation that the crunchy topping is peanut-free.",
        status: "pending",
        manager_response: null,
        manager_reviewed_at: null,
        manager_reviewed_by: null,
        created_at: toIsoDaysAgo(2),
      },
      {
        id: randomUUID(),
        user_id: dinerUserIds[2],
        restaurant_id: restaurantId,
        dish_name: salmon,
        user_allergens: ["milk"],
        user_diets: ["Pescatarian"],
        requested_allergens: ["milk"],
        requested_diets: [],
        user_message: "Could the finishing sauce be served on the side for a dairy allergy?",
        status: "pending",
        manager_response: null,
        manager_reviewed_at: null,
        manager_reviewed_by: null,
        created_at: toIsoDaysAgo(3),
      },
      {
        id: randomUUID(),
        user_id: dinerUserIds[3],
        restaurant_id: restaurantId,
        dish_name: salad,
        user_allergens: ["egg"],
        user_diets: ["Vegetarian"],
        requested_allergens: ["egg"],
        requested_diets: [],
        user_message: "Would a no-egg dressing option be available next visit?",
        status: "reviewed",
        manager_response: "Reviewed with the team. We can offer oil and vinegar today while we test a new dressing.",
        manager_reviewed_at: toIsoDaysAgo(6),
        manager_reviewed_by: managerUserId,
        created_at: toIsoDaysAgo(7),
      },
      {
        id: randomUUID(),
        user_id: dinerUserIds[0],
        restaurant_id: restaurantId,
        dish_name: chicken,
        user_allergens: ["soy"],
        user_diets: [],
        requested_allergens: ["soy"],
        requested_diets: [],
        user_message: "Looking for a soy-free glaze option.",
        status: "implemented",
        manager_response: "Implemented. Ask the server for the herb glaze substitution.",
        manager_reviewed_at: toIsoDaysAgo(5),
        manager_reviewed_by: managerUserId,
        created_at: toIsoDaysAgo(8),
      },
      {
        id: randomUUID(),
        user_id: dinerUserIds[1],
        restaurant_id: restaurantId,
        dish_name: lasagna,
        user_allergens: ["milk"],
        user_diets: ["Gluten-free"],
        requested_allergens: ["milk"],
        requested_diets: ["Gluten-free"],
        user_message: "Need a dairy-free and gluten-free version.",
        status: "declined",
        manager_response: "Declined for now because both substitutions are not available in the current prep flow.",
        manager_reviewed_at: toIsoDaysAgo(10),
        manager_reviewed_by: managerUserId,
        created_at: toIsoDaysAgo(11),
      },
    ];

    for (const request of requests) {
      await pgClient.query(
        `INSERT INTO public.accommodation_requests (
          id,
          user_id,
          restaurant_id,
          dish_name,
          user_allergens,
          user_diets,
          requested_allergens,
          requested_diets,
          user_message,
          status,
          manager_response,
          manager_reviewed_at,
          manager_reviewed_by,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, now()
        )`,
        [
          request.id,
          request.user_id,
          request.restaurant_id,
          request.dish_name,
          request.user_allergens,
          request.user_diets,
          request.requested_allergens,
          request.requested_diets,
          request.user_message,
          request.status,
          request.manager_response,
          request.manager_reviewed_at,
          request.manager_reviewed_by,
          request.created_at,
        ],
      );
    }

    const changeLogs = [
      {
        id: randomUUID(),
        restaurant_id: restaurantId,
        type: "update",
        description: "Guide Manager",
        photos: [],
        user_email: CONFIG.managerEmail,
        timestamp: toIsoDaysAgo(2),
        changes: {
          general: [
            "Updated the website and delivery links in Restaurant settings.",
            "Prepared the monthly confirmation review package.",
          ],
          [pasta]: ["Marked wheat handling notes for follow-up review."],
        },
      },
      {
        id: randomUUID(),
        restaurant_id: restaurantId,
        type: "update",
        description: "Guide Manager",
        photos: [],
        user_email: CONFIG.managerEmail,
        timestamp: toIsoDaysAgo(4),
        changes: {
          general: ["Reviewed active brand items before replacing the tofu topping package."],
          [tofu]: [
            "Confirmed Organic Extra Firm Tofu packaging is current.",
            "Queued the topping brand for replacement review.",
          ],
        },
      },
      {
        id: randomUUID(),
        restaurant_id: restaurantId,
        type: "confirm",
        description: "Guide Manager",
        photos: [],
        user_email: CONFIG.managerEmail,
        timestamp: toIsoDaysAgo(8),
        changes: {
          general: ["Uploaded refreshed menu images and reviewed dish overlays."],
          [chicken]: ["Verified ingredient rows and published the latest overlay adjustments."],
        },
      },
    ];

    for (const log of changeLogs) {
      await pgClient.query(
        `INSERT INTO public.change_logs (
          id,
          restaurant_id,
          type,
          description,
          photos,
          user_email,
          timestamp,
          changes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          log.id,
          log.restaurant_id,
          log.type,
          log.description,
          buildJsonPayload(log.photos),
          log.user_email,
          log.timestamp,
          buildJsonPayload(log.changes),
        ],
      );
    }

    for (const interaction of interactions) {
      await pgClient.query(
        `INSERT INTO public.dish_interactions (
          id,
          user_id,
          restaurant_id,
          dish_name,
          user_allergens,
          user_diets,
          dish_status,
          conflicting_allergens,
          unmet_diets,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          interaction.id,
          interaction.user_id,
          interaction.restaurant_id,
          interaction.dish_name,
          interaction.user_allergens,
          interaction.user_diets,
          interaction.dish_status,
          interaction.conflicting_allergens,
          interaction.unmet_diets,
          interaction.created_at,
        ],
      );
    }

    const loves = [
      { id: randomUUID(), user_id: dinerUserIds[0], restaurant_id: restaurantId, dish_name: tofu },
      { id: randomUUID(), user_id: dinerUserIds[2], restaurant_id: restaurantId, dish_name: salad },
      { id: randomUUID(), user_id: dinerUserIds[3], restaurant_id: restaurantId, dish_name: salmon },
    ];

    for (const love of loves) {
      await pgClient.query(
        `INSERT INTO public.user_loved_dishes (
          id,
          user_id,
          restaurant_id,
          dish_name,
          created_at
        ) VALUES ($1, $2, $3, $4, now())`,
        [love.id, love.user_id, love.restaurant_id, love.dish_name],
      );
    }

    for (const order of tabletOrders) {
      await pgClient.query(
        `INSERT INTO public.tablet_orders (
          id,
          restaurant_id,
          status,
          payload,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, now(), now())`,
        [order.id, order.restaurant_id, order.status, buildJsonPayload(order.payload)],
      );
    }

    await pgClient.query("COMMIT");
  } catch (error) {
    await pgClient.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  maybeRelaxNodeTls();
  const databaseUrl = requiredEnv("DATABASE_URL");
  const adminClient = createAdminClient();
  const pgClient = new PgClient({
    connectionString: databaseUrl,
    ssl: shouldAllowSelfSignedTls()
      ? {
          rejectUnauthorized: false,
        }
      : undefined,
  });
  await pgClient.connect();
  await pgClient.query("SELECT set_config('app.restaurant_write_context', 'gateway', false)");

  try {
    const sourceRestaurant = await readRestaurantBySlug(pgClient, CONFIG.sourceSlug);
    if (!sourceRestaurant?.id) {
      throw new Error(
        `Unable to find source restaurant slug "${CONFIG.sourceSlug}".`,
      );
    }

    const managerUserId = await ensureAuthUser(pgClient, adminClient, {
      email: CONFIG.managerEmail,
      password: CONFIG.managerPassword,
      firstName: CONFIG.managerFirstName,
      lastName: CONFIG.managerLastName,
      role: "manager",
    });
    const dinerUserIds = [];
    for (const dinerConfig of CONFIG.dinerUsers) {
      const dinerUserId = await ensureAuthUser(pgClient, adminClient, {
        email: dinerConfig.email,
        password: dinerConfig.password,
        firstName: dinerConfig.firstName,
        lastName: dinerConfig.lastName,
        role: "customer",
      });
      dinerUserIds.push(dinerUserId);
    }

    const targetRestaurantId = await ensureTargetRestaurant(pgClient, sourceRestaurant);
    await cloneMenuState(pgClient, sourceRestaurant.id, targetRestaurantId);
    await reseedManagerArtifacts(pgClient, {
      restaurantId: targetRestaurantId,
      managerUserId,
      dinerUserIds,
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          targetRestaurant: {
            id: targetRestaurantId,
            slug: CONFIG.targetSlug,
            name: CONFIG.targetName,
          },
          manager: {
            email: CONFIG.managerEmail,
            firstName: CONFIG.managerFirstName,
            lastName: CONFIG.managerLastName,
          },
          dinerCount: dinerUserIds.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await pgClient.end();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
