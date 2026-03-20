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
  scenario: asText(process.env.DOCS_MANAGER_SCENARIO) || "final",
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
      allergens: ["peanut"],
      diets: ["Vegan"],
      profileLabel: "peanut-free vegan regular",
    },
    {
      email: asText(process.env.DOCS_DINER_2_EMAIL) || "manager-guide-diner-2@clarivore.local",
      password: asText(process.env.DOCS_DINER_2_PASSWORD) || "ClarivoreDocs123!",
      firstName: "Jordan",
      lastName: "Lee",
      allergens: ["milk"],
      diets: ["Vegetarian"],
      profileLabel: "dairy-free vegetarian",
    },
    {
      email: asText(process.env.DOCS_DINER_3_EMAIL) || "manager-guide-diner-3@clarivore.local",
      password: asText(process.env.DOCS_DINER_3_PASSWORD) || "ClarivoreDocs123!",
      firstName: "Morgan",
      lastName: "Diaz",
      allergens: ["wheat"],
      diets: ["Gluten-free"],
      profileLabel: "gluten-free traveler",
    },
    {
      email: asText(process.env.DOCS_DINER_4_EMAIL) || "manager-guide-diner-4@clarivore.local",
      password: asText(process.env.DOCS_DINER_4_PASSWORD) || "ClarivoreDocs123!",
      firstName: "Taylor",
      lastName: "Nguyen",
      allergens: ["soy"],
      diets: [],
      profileLabel: "soy-sensitive diner",
    },
    {
      email: "manager-guide-diner-5@clarivore.local",
      password: "ClarivoreDocs123!",
      firstName: "Casey",
      lastName: "Brooks",
      allergens: ["egg"],
      diets: ["Vegetarian"],
      profileLabel: "egg-free vegetarian",
    },
    {
      email: "manager-guide-diner-6@clarivore.local",
      password: "ClarivoreDocs123!",
      firstName: "Riley",
      lastName: "Santos",
      allergens: ["tree nut"],
      diets: ["Vegan"],
      profileLabel: "tree-nut-free vegan",
    },
    {
      email: "manager-guide-diner-7@clarivore.local",
      password: "ClarivoreDocs123!",
      firstName: "Devon",
      lastName: "Kim",
      allergens: ["sesame"],
      diets: [],
      profileLabel: "sesame allergy",
    },
    {
      email: "manager-guide-diner-8@clarivore.local",
      password: "ClarivoreDocs123!",
      firstName: "Quinn",
      lastName: "Rivera",
      allergens: ["fish"],
      diets: ["Pescatarian"],
      profileLabel: "fish-aware pescatarian",
    },
    {
      email: "manager-guide-diner-9@clarivore.local",
      password: "ClarivoreDocs123!",
      firstName: "Parker",
      lastName: "Cole",
      allergens: ["shellfish"],
      diets: [],
      profileLabel: "shellfish allergy",
    },
    {
      email: "manager-guide-diner-10@clarivore.local",
      password: "ClarivoreDocs123!",
      firstName: "Jamie",
      lastName: "Turner",
      allergens: [],
      diets: ["Vegetarian"],
      profileLabel: "vegetarian planner",
    },
    {
      email: "manager-guide-diner-11@clarivore.local",
      password: "ClarivoreDocs123!",
      firstName: "Cameron",
      lastName: "Foster",
      allergens: ["milk", "egg"],
      diets: [],
      profileLabel: "multi-allergen family diner",
    },
    {
      email: "manager-guide-diner-12@clarivore.local",
      password: "ClarivoreDocs123!",
      firstName: "Skyler",
      lastName: "Bell",
      allergens: [],
      diets: ["Vegan"],
      profileLabel: "vegan lunch regular",
    },
  ],
};

const VALID_SCENARIOS = new Set([
  "foundation",
  "foundation_review",
  "foundation_manual_review",
  "final",
]);

const FOUNDATION_REVIEW_RECIPE =
  "Press the extra-firm tofu for 20 minutes, toss it with tamari and lime juice, roast it until browned, then serve it over jasmine rice with sliced scallions.";

const FOUNDATION_REVIEW_ROWS = [
  {
    name: "extra-firm tofu",
    allergens: ["soy"],
    diets: ["Gluten-free", "Pescatarian", "Vegan", "Vegetarian"],
  },
  {
    name: "tamari",
    allergens: ["soy"],
    diets: ["Gluten-free", "Pescatarian", "Vegan", "Vegetarian"],
  },
  {
    name: "lime juice",
    allergens: [],
    diets: ["Gluten-free", "Pescatarian", "Vegan", "Vegetarian"],
  },
  {
    name: "jasmine rice",
    allergens: [],
    diets: ["Gluten-free", "Pescatarian", "Vegan", "Vegetarian"],
  },
  {
    name: "scallions",
    allergens: [],
    diets: ["Gluten-free", "Pescatarian", "Vegan", "Vegetarian"],
  },
];

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

function buildRestaurantSeedState(sourceRestaurant, scenario) {
  const isFoundation =
    scenario === "foundation" ||
    scenario === "foundation_review" ||
    scenario === "foundation_manual_review";
  return {
    lastConfirmed: isFoundation ? null : toIsoDaysAgo(45),
    menuUrl: isFoundation ? null : sourceRestaurant.menu_url,
    lastChecked: isFoundation ? null : sourceRestaurant.last_checked,
    monitorEnabled: sourceRestaurant.monitor_enabled,
    totalChecks: isFoundation ? 0 : sourceRestaurant.total_checks,
    emailsSent: isFoundation ? 0 : sourceRestaurant.emails_sent,
    checkFrequencyHours: sourceRestaurant.check_frequency_hours,
    deliveryUrl: isFoundation ? null : sourceRestaurant.delivery_url,
    website: isFoundation ? null : sourceRestaurant.website,
    phone: isFoundation ? null : sourceRestaurant.phone,
    writeVersion: isFoundation ? 0 : sourceRestaurant.write_version,
    mapLocation: isFoundation ? null : sourceRestaurant.map_location,
  };
}

async function ensureTargetRestaurant(pgClient, sourceRestaurant, scenario) {
  const seedState = buildRestaurantSeedState(sourceRestaurant, scenario);
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
        seedState.lastConfirmed,
        seedState.menuUrl,
        seedState.lastChecked,
        seedState.monitorEnabled,
        seedState.totalChecks,
        seedState.emailsSent,
        seedState.checkFrequencyHours,
        seedState.deliveryUrl,
        seedState.website,
        seedState.phone,
        seedState.writeVersion,
        seedState.mapLocation,
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
      seedState.lastConfirmed,
      seedState.menuUrl,
      seedState.lastChecked,
      seedState.monitorEnabled,
      seedState.totalChecks,
      seedState.emailsSent,
      seedState.checkFrequencyHours,
      seedState.deliveryUrl,
      seedState.website,
      seedState.phone,
      seedState.writeVersion,
      seedState.mapLocation,
    ],
  );
  return restaurantId;
}

async function resetTargetRestaurantState(pgClient, targetRestaurantId) {
  await pgClient.query("BEGIN");
  try {
    await pgClient.query("SELECT set_config('app.restaurant_write_context', 'gateway', true)");
    for (const tableName of [
      "restaurant_menu_ingredient_brand_items",
      "restaurant_menu_ingredient_rows",
      "restaurant_menu_dishes",
      "restaurant_menu_pages",
      "accommodation_requests",
      "restaurant_direct_message_reads",
      "restaurant_direct_messages",
      "dish_interactions",
      "user_loved_dishes",
      "tablet_orders",
      "change_logs",
      "restaurant_managers",
    ]) {
      await pgClient.query(`DELETE FROM public.${tableName} WHERE restaurant_id = $1`, [
        targetRestaurantId,
      ]);
    }
    await pgClient.query("COMMIT");
  } catch (error) {
    await pgClient.query("ROLLBACK");
    throw error;
  }
}

async function copyMenuPagesOnly(pgClient, sourceRestaurantId, targetRestaurantId) {
  const pagesResult = await pgClient.query(
    `SELECT page_index, image_url
     FROM public.restaurant_menu_pages
     WHERE restaurant_id = $1
     ORDER BY page_index ASC`,
    [sourceRestaurantId],
  );

  await pgClient.query("BEGIN");
  try {
    await pgClient.query("SELECT set_config('app.restaurant_write_context', 'gateway', true)");
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

function buildFoundationIngredientPayload(row) {
  const allergens = Array.isArray(row?.allergens) ? row.allergens : [];
  const diets = Array.isArray(row?.diets) ? row.diets : [];
  return {
    name: asText(row?.name),
    rowText: asText(row?.name),
    allergens,
    diets,
    crossContaminationAllergens: [],
    crossContaminationDiets: [],
    aiDetectedAllergens: allergens,
    aiDetectedDiets: diets,
    aiDetectedCrossContaminationAllergens: [],
    aiDetectedCrossContaminationDiets: [],
    brandRequired: false,
    brandRequirementReason: "",
    confirmed: false,
    removable: true,
    brands: [],
  };
}

async function seedFoundationReviewState(
  pgClient,
  sourceRestaurantId,
  targetRestaurantId,
  { includeManualRow = false } = {},
) {
  await copyMenuPagesOnly(pgClient, sourceRestaurantId, targetRestaurantId);

  const templateDishResult = await pgClient.query(
    `SELECT
      page_index,
      x,
      y,
      w,
      h,
      details_json,
      removable_json,
      ingredients_blocking_diets_json,
      payload_json
     FROM public.restaurant_menu_dishes
     WHERE restaurant_id = $1
     ORDER BY page_index ASC, dish_name ASC
     LIMIT 1`,
    [sourceRestaurantId],
  );
  const templateDish = templateDishResult.rows[0];
  if (!templateDish) {
    throw new Error("Unable to build foundation review state without a source dish template.");
  }

  const dishId = randomUUID();
  const dishName = "Citrus Tofu Bowl";
  const dishKey = "citrus-tofu-bowl";
  const dishDescription = "Roasted tofu over rice with tamari, lime, and scallions.";

  await pgClient.query("BEGIN");
  try {
    await pgClient.query("SELECT set_config('app.restaurant_write_context', 'gateway', true)");
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
        dishId,
        targetRestaurantId,
        dishKey,
        dishName,
        templateDish.page_index,
        templateDish.x,
        templateDish.y,
        templateDish.w,
        templateDish.h,
        FOUNDATION_REVIEW_RECIPE,
        dishDescription,
        buildJsonPayload(templateDish.details_json),
        ["soy"],
        ["Gluten-free", "Pescatarian", "Vegan", "Vegetarian"],
        [],
        [],
        buildJsonPayload(templateDish.removable_json),
        buildJsonPayload(templateDish.ingredients_blocking_diets_json),
        buildJsonPayload(templateDish.payload_json),
      ],
    );

    const rowsToInsert = includeManualRow
      ? [
          ...FOUNDATION_REVIEW_ROWS,
          {
            name: "lime zest",
            allergens: [],
            diets: ["Gluten-free", "Pescatarian", "Vegan", "Vegetarian"],
          },
        ]
      : FOUNDATION_REVIEW_ROWS;

    for (const [rowIndex, row] of rowsToInsert.entries()) {
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
          randomUUID(),
          targetRestaurantId,
          dishId,
          dishName,
          rowIndex,
          row.name,
          null,
          buildFoundationIngredientPayload(row),
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

async function copyFullMenuState(pgClient, sourceRestaurantId, targetRestaurantId) {
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

function mergeBrandPayload(payload, patch) {
  const base = payload && typeof payload === "object" ? { ...payload } : {};
  if (patch.brandName) {
    base.name = patch.brandName;
    base.brandName = patch.brandName;
    base.brand = patch.brandName;
    base.appliedBrand = patch.brandName;
    base.appliedBrandItem = patch.brandName;
  }
  if (Array.isArray(patch.ingredientsList)) {
    base.ingredientList = patch.ingredientsList;
    base.ingredientsList = patch.ingredientsList;
  }
  if (Array.isArray(patch.allergens)) {
    base.allergens = patch.allergens;
    base.aiDetectedAllergens = patch.allergens;
  }
  if (Array.isArray(patch.diets)) {
    base.diets = patch.diets;
    base.aiDetectedDiets = patch.diets;
  }
  if (Array.isArray(patch.crossContaminationAllergens)) {
    base.crossContaminationAllergens = patch.crossContaminationAllergens;
    base.aiDetectedCrossContaminationAllergens = patch.crossContaminationAllergens;
  }
  if (Array.isArray(patch.crossContaminationDiets)) {
    base.crossContaminationDiets = patch.crossContaminationDiets;
    base.aiDetectedCrossContaminationDiets = patch.crossContaminationDiets;
  }
  return base;
}

function mergeIngredientPayload(payload, patch) {
  const base = payload && typeof payload === "object" ? { ...payload } : {};
  if (patch.rowText) {
    base.name = patch.rowText;
    base.rowText = patch.rowText;
  }
  if (patch.brandName) {
    base.brand = patch.brandName;
    base.appliedBrand = patch.brandName;
    base.appliedBrandItem = patch.brandName;
  }
  if (Array.isArray(patch.ingredientsList)) {
    base.ingredientsList = patch.ingredientsList;
  }
  if (Array.isArray(patch.allergens)) {
    base.allergens = patch.allergens;
    base.aiDetectedAllergens = patch.allergens;
  }
  if (Array.isArray(patch.diets)) {
    base.diets = patch.diets;
    base.aiDetectedDiets = patch.diets;
  }
  if (Array.isArray(patch.crossContaminationAllergens)) {
    base.crossContaminationAllergens = patch.crossContaminationAllergens;
    base.aiDetectedCrossContaminationAllergens = patch.crossContaminationAllergens;
  }
  if (Array.isArray(patch.crossContaminationDiets)) {
    base.crossContaminationDiets = patch.crossContaminationDiets;
    base.aiDetectedCrossContaminationDiets = patch.crossContaminationDiets;
  }
  if (Array.isArray(base.brands) && base.brands.length) {
    base.brands = base.brands.map((brand, index) =>
      index === 0 ? mergeBrandPayload(brand, patch) : brand,
    );
  }
  return base;
}

async function normalizeGuideBrandData(pgClient, restaurantId) {
  const tofuDishName = "Grilled Tofu";
  const rowPatches = new Map([
    [
      0,
      {
        rowText: "extra-firm tofu",
        brandName: "Hodo Organic Extra Firm Tofu",
        ingredientsList: ["Organic soybeans, water, calcium sulfate."],
        allergens: ["soy"],
        diets: ["Gluten-free", "Pescatarian", "Vegan", "Vegetarian"],
        crossContaminationAllergens: [],
        crossContaminationDiets: [],
      },
    ],
    [
      1,
      {
        rowText: "tamari",
        brandName: "San-J Tamari Gluten Free Soy Sauce",
        ingredientsList: ["Water, soybeans, salt, alcohol."],
        allergens: ["soy"],
        diets: ["Gluten-free", "Pescatarian", "Vegan", "Vegetarian"],
        crossContaminationAllergens: [],
        crossContaminationDiets: [],
      },
    ],
    [
      3,
      {
        rowText: "maple syrup",
        brandName: "Coombs Family Farms Organic Maple Syrup",
        ingredientsList: ["Organic maple syrup."],
        allergens: [],
        diets: ["Gluten-free", "Pescatarian", "Vegan", "Vegetarian"],
        crossContaminationAllergens: [],
        crossContaminationDiets: [],
      },
    ],
  ]);

  const rowsResult = await pgClient.query(
    `SELECT id::text, row_index, ingredient_payload
     FROM public.restaurant_menu_ingredient_rows
     WHERE restaurant_id = $1
       AND dish_name = $2
       AND row_index = ANY($3::int[])
     ORDER BY row_index ASC`,
    [restaurantId, tofuDishName, Array.from(rowPatches.keys())],
  );
  const brandRowsResult = await pgClient.query(
    `SELECT id::text, row_index, brand_payload
     FROM public.restaurant_menu_ingredient_brand_items
     WHERE restaurant_id = $1
       AND dish_name = $2
       AND row_index = ANY($3::int[])
     ORDER BY row_index ASC`,
    [restaurantId, tofuDishName, Array.from(rowPatches.keys())],
  );

  await pgClient.query("BEGIN");
  try {
    await pgClient.query("SELECT set_config('app.restaurant_write_context', 'gateway', true)");

    for (const row of rowsResult.rows) {
      const patch = rowPatches.get(Number(row.row_index));
      if (!patch) continue;
      await pgClient.query(
        `UPDATE public.restaurant_menu_ingredient_rows
         SET
           row_text = $2,
           applied_brand_item = $3,
           ingredient_payload = $4,
           updated_at = now()
         WHERE id = $1::uuid`,
        [
          row.id,
          patch.rowText,
          patch.brandName,
          mergeIngredientPayload(buildJsonPayload(row.ingredient_payload), patch),
        ],
      );
    }

    for (const brandRow of brandRowsResult.rows) {
      const patch = rowPatches.get(Number(brandRow.row_index));
      if (!patch) continue;
      const normalizedPayload = mergeBrandPayload(buildJsonPayload(brandRow.brand_payload), patch);
      await pgClient.query(
        `UPDATE public.restaurant_menu_ingredient_brand_items
         SET
           brand_name = $2,
           ingredient_list = $3,
           ingredients_list = $4,
           allergens = $5,
           cross_contamination_allergens = $6,
           diets = $7,
           cross_contamination_diets = $8,
           brand_payload = $9,
           updated_at = now()
         WHERE id = $1::uuid`,
        [
          brandRow.id,
          patch.brandName,
          patch.ingredientsList,
          patch.ingredientsList,
          patch.allergens,
          patch.crossContaminationAllergens,
          patch.diets,
          patch.crossContaminationDiets,
          normalizedPayload,
        ],
      );
    }

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

function buildInteractionEntry({
  restaurantId,
  dinerProfile,
  dishName,
  dishStatus,
  daysAgo,
  conflictingAllergens = [],
  unmetDiets = [],
}) {
  return {
    id: randomUUID(),
    user_id: dinerProfile.userId,
    restaurant_id: restaurantId,
    dish_name: dishName,
    user_allergens: dinerProfile.allergens || [],
    user_diets: dinerProfile.diets || [],
    dish_status: dishStatus,
    conflicting_allergens: conflictingAllergens,
    unmet_diets: unmetDiets,
    created_at: toIsoDaysAgo(daysAgo),
  };
}

function buildSeededInteractions({ restaurantId, dinerProfiles, dishNames }) {
  const tofu = findDishName(dishNames, ["Grilled Tofu"], 0);
  const pasta = findDishName(dishNames, ["Spaghetti Bolognese"], 1);
  const chicken = findDishName(dishNames, ["Lemon Herb Chicken"], 2);
  const salad = findDishName(dishNames, ["Greek Salad"], 3);
  const salmon = findDishName(dishNames, ["Seared Salmon"], 4);
  const curry = findDishName(dishNames, ["Vegetable Curry"], 5);
  const lasagna = findDishName(dishNames, ["Beef Lasagna"], 6);
  const dishLookup = { tofu, pasta, chicken, salad, salmon, curry, lasagna };
  const interactionPlans = [
    { profileIndex: 0, dish: "tofu", status: "safe", daysAgo: 1 },
    { profileIndex: 0, dish: "curry", status: "safe", daysAgo: 2 },
    { profileIndex: 0, dish: "pasta", status: "unsafe", daysAgo: 5, unmetDiets: ["Vegan"] },
    { profileIndex: 1, dish: "salad", status: "safe", daysAgo: 1 },
    { profileIndex: 1, dish: "salmon", status: "unsafe", daysAgo: 3, conflictingAllergens: ["milk"] },
    { profileIndex: 1, dish: "lasagna", status: "unsafe", daysAgo: 7, conflictingAllergens: ["milk"] },
    { profileIndex: 2, dish: "pasta", status: "unsafe", daysAgo: 1, conflictingAllergens: ["wheat"], unmetDiets: ["Gluten-free"] },
    { profileIndex: 2, dish: "salad", status: "safe", daysAgo: 4 },
    { profileIndex: 2, dish: "tofu", status: "safe", daysAgo: 6 },
    { profileIndex: 3, dish: "chicken", status: "removable", daysAgo: 1, conflictingAllergens: ["soy"] },
    { profileIndex: 3, dish: "tofu", status: "unsafe", daysAgo: 2, conflictingAllergens: ["soy"] },
    { profileIndex: 3, dish: "salad", status: "safe", daysAgo: 6 },
    { profileIndex: 4, dish: "salad", status: "removable", daysAgo: 2, conflictingAllergens: ["egg"] },
    { profileIndex: 4, dish: "curry", status: "safe", daysAgo: 4 },
    { profileIndex: 4, dish: "lasagna", status: "unsafe", daysAgo: 8, conflictingAllergens: ["egg"] },
    { profileIndex: 5, dish: "curry", status: "removable", daysAgo: 1, conflictingAllergens: ["tree nut"] },
    { profileIndex: 5, dish: "tofu", status: "safe", daysAgo: 3 },
    { profileIndex: 5, dish: "pasta", status: "unsafe", daysAgo: 7, unmetDiets: ["Vegan"] },
    { profileIndex: 6, dish: "chicken", status: "safe", daysAgo: 2 },
    { profileIndex: 6, dish: "salad", status: "safe", daysAgo: 4 },
    { profileIndex: 6, dish: "tofu", status: "removable", daysAgo: 8, conflictingAllergens: ["sesame"] },
    { profileIndex: 7, dish: "salmon", status: "unsafe", daysAgo: 1, conflictingAllergens: ["fish"] },
    { profileIndex: 7, dish: "chicken", status: "safe", daysAgo: 3 },
    { profileIndex: 7, dish: "pasta", status: "safe", daysAgo: 6 },
    { profileIndex: 8, dish: "salmon", status: "safe", daysAgo: 2 },
    { profileIndex: 8, dish: "pasta", status: "unsafe", daysAgo: 5, conflictingAllergens: ["shellfish"] },
    { profileIndex: 8, dish: "salad", status: "safe", daysAgo: 7 },
    { profileIndex: 9, dish: "salad", status: "safe", daysAgo: 1 },
    { profileIndex: 9, dish: "tofu", status: "safe", daysAgo: 2 },
    { profileIndex: 9, dish: "chicken", status: "unsafe", daysAgo: 6, unmetDiets: ["Vegetarian"] },
    { profileIndex: 10, dish: "salad", status: "removable", daysAgo: 1, conflictingAllergens: ["milk", "egg"] },
    { profileIndex: 10, dish: "lasagna", status: "unsafe", daysAgo: 4, conflictingAllergens: ["milk", "egg"] },
    { profileIndex: 10, dish: "chicken", status: "safe", daysAgo: 9 },
    { profileIndex: 11, dish: "tofu", status: "safe", daysAgo: 1 },
    { profileIndex: 11, dish: "curry", status: "safe", daysAgo: 2 },
    { profileIndex: 11, dish: "pasta", status: "unsafe", daysAgo: 4, unmetDiets: ["Vegan"] },
  ];

  return interactionPlans
    .map((plan) => {
      const dinerProfile = dinerProfiles[plan.profileIndex];
      const dishName = dishLookup[plan.dish];
      if (!dinerProfile || !dishName) return null;
      return buildInteractionEntry({
        restaurantId,
        dinerProfile,
        dishName,
        dishStatus: plan.status,
        daysAgo: plan.daysAgo,
        conflictingAllergens: plan.conflictingAllergens || [],
        unmetDiets: plan.unmetDiets || [],
      });
    })
    .filter(Boolean);
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
        customerName: "Morgan Diaz",
        allergies: ["Wheat"],
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
        customerName: "Avery Patel",
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
        customerName: "Jordan Lee",
        allergies: ["Milk"],
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
        customerName: "Taylor Nguyen",
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

async function ensureRestaurantManagerAccess(pgClient, { restaurantId, managerUserId }) {
  await pgClient.query("BEGIN");
  try {
    await pgClient.query("SELECT set_config('app.restaurant_write_context', 'gateway', true)");
    await pgClient.query(
      "INSERT INTO public.restaurant_managers (id, restaurant_id, user_id, created_at) VALUES ($1, $2, $3, now())",
      [randomUUID(), restaurantId, managerUserId],
    );
    await pgClient.query("COMMIT");
  } catch (error) {
    await pgClient.query("ROLLBACK");
    throw error;
  }
}

async function reseedManagerArtifacts(pgClient, { restaurantId, managerUserId, dinerProfiles }) {
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
  const curry = findDishName(dishNames, ["Vegetable Curry"], 6);
  const now = new Date();
  const interactions = buildSeededInteractions({ restaurantId, dinerProfiles, dishNames });
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

    const directMessages = [
      {
        id: randomUUID(),
        restaurant_id: restaurantId,
        sender_id: null,
        sender_name: "Clarivore Team",
        sender_role: "admin",
        message:
          "Breakfast service drove a sharp increase in gluten-free checks on Spaghetti Bolognese. Please review that dish before the next rush.",
        created_at: adminMessageTimes.first,
      },
      {
        id: randomUUID(),
        restaurant_id: restaurantId,
        sender_id: managerUserId,
        sender_name: `${CONFIG.managerFirstName} ${CONFIG.managerLastName}`.trim(),
        sender_role: "restaurant",
        message:
          "Reviewed. I’m updating the pasta substitution notes and checking whether the tofu topping package still matches the saved brand item.",
        created_at: adminMessageTimes.managerReply,
      },
      {
        id: randomUUID(),
        restaurant_id: restaurantId,
        sender_id: null,
        sender_name: "Clarivore Team",
        sender_role: "admin",
        message:
          "Reminder: monthly confirmation is still overdue for Demo Menu. Finish the lunch edits, then open the confirmation workflow before close.",
        created_at: adminMessageTimes.second,
      },
      {
        id: randomUUID(),
        restaurant_id: restaurantId,
        sender_id: null,
        sender_name: "Clarivore Team",
        sender_role: "admin",
        message:
          "One more check: the salmon sauce photo was viewed several times by dairy-free diners today. Confirm the current prep note is still accurate.",
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
        user_id: dinerProfiles[2].userId,
        restaurant_id: restaurantId,
        dish_name: pasta,
        user_allergens: dinerProfiles[2].allergens,
        user_diets: dinerProfiles[2].diets,
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
        user_id: dinerProfiles[0].userId,
        restaurant_id: restaurantId,
        dish_name: tofu,
        user_allergens: dinerProfiles[0].allergens,
        user_diets: dinerProfiles[0].diets,
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
        user_id: dinerProfiles[1].userId,
        restaurant_id: restaurantId,
        dish_name: salmon,
        user_allergens: dinerProfiles[1].allergens,
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
        user_id: dinerProfiles[4].userId,
        restaurant_id: restaurantId,
        dish_name: salad,
        user_allergens: dinerProfiles[4].allergens,
        user_diets: dinerProfiles[4].diets,
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
        user_id: dinerProfiles[3].userId,
        restaurant_id: restaurantId,
        dish_name: chicken,
        user_allergens: dinerProfiles[3].allergens,
        user_diets: dinerProfiles[3].diets,
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
        user_id: dinerProfiles[10].userId,
        restaurant_id: restaurantId,
        dish_name: lasagna,
        user_allergens: dinerProfiles[10].allergens,
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
      {
        id: randomUUID(),
        user_id: dinerProfiles[5].userId,
        restaurant_id: restaurantId,
        dish_name: curry,
        user_allergens: dinerProfiles[5].allergens,
        user_diets: dinerProfiles[5].diets,
        requested_allergens: ["tree nut"],
        requested_diets: ["Vegan"],
        user_message: "Can you confirm whether the garnish can be removed to avoid tree nuts?",
        status: "reviewed",
        manager_response: "Reviewed. The garnish can be left off, but we still need to verify the latest prep station handling before marking implemented.",
        manager_reviewed_at: toIsoDaysAgo(4),
        manager_reviewed_by: managerUserId,
        created_at: toIsoDaysAgo(5),
      },
      {
        id: randomUUID(),
        user_id: dinerProfiles[6].userId,
        restaurant_id: restaurantId,
        dish_name: tofu,
        user_allergens: dinerProfiles[6].allergens,
        user_diets: dinerProfiles[6].diets,
        requested_allergens: ["sesame"],
        requested_diets: [],
        user_message: "Is there a sesame-free topping brand available for this dish?",
        status: "pending",
        manager_response: null,
        manager_reviewed_at: null,
        manager_reviewed_by: null,
        created_at: toIsoDaysAgo(1),
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
            "Updated restaurant settings after the new QR print run.",
            "Published revised substitution notes for the gluten-free pasta request spike.",
          ],
          [pasta]: ["Clarified wheat handling notes and marked the dish for follow-up during the next confirmation pass."],
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
          general: ["Reviewed brand items attached to high-traffic vegan dishes before lunch service."],
          [tofu]: [
            "Confirmed Hodo Organic Extra Firm Tofu packaging is current.",
            "Queued the crunchy topping brand for replacement review.",
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
          general: ["Uploaded refreshed menu images and reviewed the full restaurant shell before opening public access."],
          [chicken]: ["Verified ingredient rows and published updated overlay bounds after the menu page refresh."],
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
      { id: randomUUID(), user_id: dinerProfiles[0].userId, restaurant_id: restaurantId, dish_name: tofu },
      { id: randomUUID(), user_id: dinerProfiles[2].userId, restaurant_id: restaurantId, dish_name: salad },
      { id: randomUUID(), user_id: dinerProfiles[5].userId, restaurant_id: restaurantId, dish_name: curry },
      { id: randomUUID(), user_id: dinerProfiles[7].userId, restaurant_id: restaurantId, dish_name: pasta },
      { id: randomUUID(), user_id: dinerProfiles[8].userId, restaurant_id: restaurantId, dish_name: salmon },
      { id: randomUUID(), user_id: dinerProfiles[9].userId, restaurant_id: restaurantId, dish_name: salad },
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
  if (!VALID_SCENARIOS.has(CONFIG.scenario)) {
    throw new Error(
      `Unsupported DOCS_MANAGER_SCENARIO "${CONFIG.scenario}". Expected one of: ${Array.from(
        VALID_SCENARIOS,
      ).join(", ")}`,
    );
  }
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
    const dinerProfiles = CONFIG.dinerUsers.map((dinerConfig, index) => ({
      ...dinerConfig,
      userId: dinerUserIds[index],
    }));

    const targetRestaurantId = await ensureTargetRestaurant(
      pgClient,
      sourceRestaurant,
      CONFIG.scenario,
    );
    await resetTargetRestaurantState(pgClient, targetRestaurantId);

    if (CONFIG.scenario === "foundation") {
      await copyMenuPagesOnly(pgClient, sourceRestaurant.id, targetRestaurantId);
      await ensureRestaurantManagerAccess(pgClient, {
        restaurantId: targetRestaurantId,
        managerUserId,
      });
    } else if (CONFIG.scenario === "foundation_review") {
      await seedFoundationReviewState(pgClient, sourceRestaurant.id, targetRestaurantId);
      await ensureRestaurantManagerAccess(pgClient, {
        restaurantId: targetRestaurantId,
        managerUserId,
      });
    } else if (CONFIG.scenario === "foundation_manual_review") {
      await seedFoundationReviewState(pgClient, sourceRestaurant.id, targetRestaurantId, {
        includeManualRow: true,
      });
      await ensureRestaurantManagerAccess(pgClient, {
        restaurantId: targetRestaurantId,
        managerUserId,
      });
    } else {
      await copyFullMenuState(pgClient, sourceRestaurant.id, targetRestaurantId);
      await normalizeGuideBrandData(pgClient, targetRestaurantId);
      await ensureRestaurantManagerAccess(pgClient, {
        restaurantId: targetRestaurantId,
        managerUserId,
      });
      await reseedManagerArtifacts(pgClient, {
        restaurantId: targetRestaurantId,
        managerUserId,
        dinerProfiles,
      });
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          scenario: CONFIG.scenario,
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
