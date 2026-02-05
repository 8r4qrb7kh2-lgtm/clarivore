const { PrismaClient } = require("@prisma/client");
const { createClient } = require("@supabase/supabase-js");

let prisma;
if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient();
} else {
  if (!global.__clarivorePrisma) {
    global.__clarivorePrisma = new PrismaClient();
  }
  prisma = global.__clarivorePrisma;
}

const parseAiIngredients = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
};

const normalizeRowText = (row) => {
  const name = String(row?.name || row?.ingredient || "").trim();
  if (name) return name;
  const list = Array.isArray(row?.ingredientsList)
    ? row.ingredientsList.filter(Boolean)
    : [];
  if (list.length) return list.join(", ");
  return "";
};

const coerceRowIndex = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const respond = (res, status, payload) => {
  res.status(status).json(payload);
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return respond(res, 405, { error: "Method not allowed" });
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;
  if (!token) {
    return respond(res, 401, { error: "Missing authorization token" });
  }

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return respond(res, 500, { error: "Supabase server credentials missing" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(
    token,
  );
  if (userError || !userData?.user) {
    return respond(res, 401, { error: "Invalid user session" });
  }

  const userId = userData.user.id;
  const { restaurantId, overlays } = req.body || {};
  if (!restaurantId || !Array.isArray(overlays)) {
    return respond(res, 400, { error: "Invalid payload" });
  }

  const manager = await prisma.restaurant_managers.findFirst({
    where: {
      user_id: userId,
      restaurant_id: restaurantId,
    },
  });
  if (!manager) {
    return respond(res, 403, { error: "Not authorized" });
  }

  const allergens = await prisma.allergens.findMany({
    where: { is_active: true },
    select: { id: true, key: true },
  });
  const diets = await prisma.diets.findMany({
    where: { is_active: true, is_supported: true },
    select: { id: true, label: true },
  });

  const allergenIdByKey = new Map(
    allergens.map((row) => [row.key, row.id]),
  );
  const dietIdByLabel = new Map(diets.map((row) => [row.label, row.id]));
  const supportedDietLabels = diets.map((row) => row.label);

  let rowCount = 0;
  let allergenCount = 0;
  let dietCount = 0;

  for (const overlay of overlays) {
    const dishName = overlay?.id || overlay?.name || overlay?.dishName;
    if (!dishName) continue;

    const rows = parseAiIngredients(overlay?.aiIngredients);

    await prisma.dish_ingredient_rows.deleteMany({
      where: {
        restaurant_id: restaurantId,
        dish_name: dishName,
      },
    });

    if (!rows.length) continue;

    const rowPayload = rows.map((row, idx) => ({
      restaurant_id: restaurantId,
      dish_name: dishName,
      row_index: coerceRowIndex(row?.index, idx),
      row_text: normalizeRowText(row) || null,
    }));

    await prisma.dish_ingredient_rows.createMany({ data: rowPayload });

    const insertedRows = await prisma.dish_ingredient_rows.findMany({
      where: {
        restaurant_id: restaurantId,
        dish_name: dishName,
      },
      select: { id: true, row_index: true },
    });

    const rowIdByIndex = new Map(
      insertedRows.map((row) => [row.row_index, row.id]),
    );

    const allergenEntries = [];
    const dietEntries = [];

    rows.forEach((row, idx) => {
      const rowIndex = coerceRowIndex(row?.index, idx);
      const rowId = rowIdByIndex.get(rowIndex);
      if (!rowId) return;

      const isRemovable = row?.removable === true;
      const allergensList = Array.isArray(row?.allergens) ? row.allergens : [];
      const crossContamination = Array.isArray(row?.crossContamination)
        ? row.crossContamination
        : [];
      const allergenStatus = new Map();

      allergensList.forEach((key) => {
        if (!key) return;
        allergenStatus.set(key, {
          is_violation: true,
          is_cross_contamination: false,
        });
      });
      crossContamination.forEach((key) => {
        if (!key) return;
        const existing =
          allergenStatus.get(key) ||
          {
            is_violation: false,
            is_cross_contamination: false,
          };
        existing.is_cross_contamination = true;
        allergenStatus.set(key, existing);
      });

      allergenStatus.forEach((status, key) => {
        const allergenId = allergenIdByKey.get(key);
        if (!allergenId) return;
        allergenEntries.push({
          ingredient_row_id: rowId,
          allergen_id: allergenId,
          is_violation: status.is_violation,
          is_cross_contamination: status.is_cross_contamination,
          is_removable: isRemovable,
        });
      });

      const dietsList = Array.isArray(row?.diets) ? row.diets : [];
      const crossContaminationDiets = Array.isArray(row?.crossContaminationDiets)
        ? row.crossContaminationDiets
        : [];
      const dietSet = new Set(dietsList);
      const crossContaminationSet = new Set(crossContaminationDiets);
      const compatible = new Set([...dietSet, ...crossContaminationSet]);

      supportedDietLabels.forEach((label) => {
        const dietId = dietIdByLabel.get(label);
        if (!dietId) return;
        if (crossContaminationSet.has(label)) {
          dietEntries.push({
            ingredient_row_id: rowId,
            diet_id: dietId,
            is_violation: false,
            is_cross_contamination: true,
            is_removable: isRemovable,
          });
          return;
        }
        if (!compatible.has(label)) {
          dietEntries.push({
            ingredient_row_id: rowId,
            diet_id: dietId,
            is_violation: true,
            is_cross_contamination: false,
            is_removable: isRemovable,
          });
        }
      });
    });

    if (allergenEntries.length) {
      await prisma.dish_ingredient_allergens.createMany({
        data: allergenEntries,
      });
    }
    if (dietEntries.length) {
      await prisma.dish_ingredient_diets.createMany({ data: dietEntries });
    }

    rowCount += insertedRows.length;
    allergenCount += allergenEntries.length;
    dietCount += dietEntries.length;
  }

  return respond(res, 200, {
    ok: true,
    rows: rowCount,
    allergens: allergenCount,
    diets: dietCount,
  });
};
