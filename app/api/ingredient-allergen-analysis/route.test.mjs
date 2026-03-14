import assert from "node:assert/strict";
import test from "node:test";

const { POST } = await import("./route.js");

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function createOpenAiStructuredPayload(flags) {
  return {
    output_text: JSON.stringify({ flags }),
    usage: {
      input_tokens: 100,
      output_tokens: 25,
      total_tokens: 125,
    },
  };
}

function createOpenAiCandidateExtractionPayload({
  directIngredients = [],
  declarationCandidates = [],
}) {
  return {
    output_text: JSON.stringify({
      direct_ingredients: directIngredients,
      declaration_candidates: declarationCandidates,
    }),
    usage: {
      input_tokens: 100,
      output_tokens: 25,
      total_tokens: 125,
    },
  };
}

function createOpenAiParsedContentPayload(parsed) {
  return {
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "",
            parsed,
          },
        ],
      },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 25,
      total_tokens: 125,
    },
  };
}

function createConfigPayloads() {
  return {
    allergens: [
      { key: "wheat", label: "Wheat", sort_order: 1, is_active: true },
      { key: "milk", label: "Milk", sort_order: 2, is_active: true },
      { key: "soy", label: "Soy", sort_order: 3, is_active: true },
      { key: "tree_nut", label: "Tree Nut", sort_order: 4, is_active: true },
      { key: "sesame", label: "Sesame", sort_order: 5, is_active: true },
    ],
    diets: [
      {
        key: "gluten_free",
        label: "Gluten-free",
        sort_order: 1,
        is_active: true,
        is_supported: true,
        is_ai_enabled: true,
      },
      {
        key: "vegan",
        label: "Vegan",
        sort_order: 2,
        is_active: true,
        is_supported: true,
        is_ai_enabled: true,
      },
      {
        key: "vegetarian",
        label: "Vegetarian",
        sort_order: 3,
        is_active: true,
        is_supported: true,
        is_ai_enabled: true,
      },
      {
        key: "pescatarian",
        label: "Pescatarian",
        sort_order: 4,
        is_active: true,
        is_supported: true,
        is_ai_enabled: true,
      },
    ],
    conflicts: [
      { diet: { label: "Gluten-free" }, allergen: { key: "wheat" } },
      { diet: { label: "Vegan" }, allergen: { key: "milk" } },
    ],
  };
}

async function invokeRoute({
  transcriptLines,
  openAiPayloads,
  catalogRows = [],
}) {
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_ANON_KEY = "supabase-anon-test";
  process.env.OPENAI_API_KEY = "openai-test";

  const { allergens, diets, conflicts } = createConfigPayloads();
  const openAiRequests = [];
  let openAiIndex = 0;
  const originalFetch = global.fetch;

  global.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || "";
    if (url.startsWith("https://supabase.test/rest/v1/allergens")) {
      return jsonResponse(allergens);
    }
    if (url.startsWith("https://supabase.test/rest/v1/diets")) {
      return jsonResponse(diets);
    }
    if (url.startsWith("https://supabase.test/rest/v1/diet_allergen_conflicts")) {
      return jsonResponse(conflicts);
    }
    if (url.startsWith("https://supabase.test/rest/v1/ingredient_catalog_entries")) {
      return jsonResponse(catalogRows);
    }
    if (url === "https://api.openai.com/v1/responses") {
      const body = JSON.parse(String(init?.body || "{}"));
      openAiRequests.push(body);
      const payload = openAiPayloads[openAiIndex];
      openAiIndex += 1;
      if (!payload) {
        throw new Error(`Missing OpenAI payload for request ${openAiIndex}.`);
      }
      return jsonResponse(payload);
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const request = new Request("http://localhost/api/ingredient-allergen-analysis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        transcriptLines,
        analysisOptions: {
          disableCache: true,
          debug: true,
        },
      }),
    });
    const response = await POST(request);
    return {
      status: response.status,
      body: await response.json(),
      openAiRequests,
    };
  } finally {
    global.fetch = originalFetch;
  }
}

test("ingredient allergen route uses gpt-5.4 medium reasoning and accepts matching parallel agent results", async () => {
  const agreedFlags = [
    {
      candidate_id: "direct:0",
      allergen_codes: [1],
      diet_codes: [1],
    },
  ];

  const { body, openAiRequests } = await invokeRoute({
    transcriptLines: ["Ingredients: Wheat flour"],
    openAiPayloads: [
      createOpenAiCandidateExtractionPayload({
        directIngredients: [{ text: "Wheat flour", word_indices: [1, 2] }],
      }),
      createOpenAiStructuredPayload(agreedFlags),
      createOpenAiStructuredPayload(agreedFlags),
    ],
  });

  assert.equal(body.success, true);
  assert.equal(openAiRequests.length, 3);
  assert.ok(openAiRequests.every((request) => request.model === "gpt-5.4"));
  assert.ok(
    openAiRequests.every((request) => request.reasoning?.effort === "medium"),
  );
  assert.deepEqual(body.flags, [
    {
      ingredient: "Wheat flour",
      word_indices: [1, 2],
      allergens: ["wheat"],
      diets: ["Gluten-free"],
      risk_type: "contained",
    },
  ]);
  assert.equal(body.debug.provider, "openai");
  assert.equal(body.debug.model, "gpt-5.4");
  assert.equal(body.debug.reasoningEffort, "medium");
  assert.equal(body.debug.agentAgreement, "agreed");
  assert.equal(body.debug.adjudicationUsed, false);
  assert.equal(body.debug.aiCandidateCount, 1);
  assert.equal(body.debug.ingredientExtractionMethod, "ai");
});

test("ingredient allergen route adjudicates conflicting parallel agent results with a third verification call", async () => {
  const agentAFlags = [
    {
      candidate_id: "direct:0",
      allergen_codes: [1],
      diet_codes: [1],
    },
  ];
  const agentBFlags = [];

  const { body, openAiRequests } = await invokeRoute({
    transcriptLines: ["Ingredients: Wheat flour"],
    openAiPayloads: [
      createOpenAiCandidateExtractionPayload({
        directIngredients: [{ text: "Wheat flour", word_indices: [1, 2] }],
      }),
      createOpenAiStructuredPayload(agentAFlags),
      createOpenAiStructuredPayload(agentBFlags),
      createOpenAiStructuredPayload(agentAFlags),
    ],
  });

  assert.equal(body.success, true);
  assert.equal(openAiRequests.length, 4);
  assert.equal(body.debug.agentAgreement, "conflict-resolved");
  assert.equal(body.debug.adjudicationUsed, true);
  assert.equal(body.debug.fallbackReason, null);
  assert.deepEqual(body.flags, [
    {
      ingredient: "Wheat flour",
      word_indices: [1, 2],
      allergens: ["wheat"],
      diets: ["Gluten-free"],
      risk_type: "contained",
    },
  ]);

  const adjudicationInput = JSON.stringify(openAiRequests[3].input);
  assert.match(adjudicationInput, /Agent A candidate JSON/);
  assert.match(adjudicationInput, /Agent B candidate JSON/);
});

test("ingredient allergen route accepts nested parsed structured output from OpenAI candidate extraction", async () => {
  const agreedFlags = [
    {
      candidate_id: "direct:0",
      allergen_codes: [4],
      diet_codes: [],
    },
  ];

  const { body, openAiRequests } = await invokeRoute({
    transcriptLines: ["Ingredients: Hazelnuts"],
    openAiPayloads: [
      createOpenAiParsedContentPayload({
        direct_ingredients: [{ text: "Hazelnuts", word_indices: [1] }],
        declaration_candidates: [],
      }),
      createOpenAiStructuredPayload(agreedFlags),
      createOpenAiStructuredPayload(agreedFlags),
    ],
  });

  assert.equal(body.success, true);
  assert.equal(openAiRequests.length, 3);
  assert.deepEqual(body.flags, [
    {
      ingredient: "Hazelnuts",
      word_indices: [1],
      allergens: ["tree_nut"],
      diets: [],
      risk_type: "contained",
    },
  ]);
  assert.equal(body.debug.ingredientExtractionMethod, "ai");
  assert.equal(body.debug.aiCandidateCount, 1);
});

test("ingredient allergen route accepts candidate extraction payloads with camelCase keys and no declaration list", async () => {
  const agreedFlags = [
    {
      candidate_id: "direct:0",
      allergen_codes: [5],
      diet_codes: [],
    },
  ];

  const { body, openAiRequests } = await invokeRoute({
    transcriptLines: ["Ingredients: Sesame oil"],
    openAiPayloads: [
      createOpenAiParsedContentPayload({
        directIngredients: [{ text: "Sesame oil", word_indices: [1, 2] }],
      }),
      createOpenAiStructuredPayload(agreedFlags),
      createOpenAiStructuredPayload(agreedFlags),
    ],
  });

  assert.equal(body.success, true);
  assert.equal(openAiRequests.length, 3);
  assert.deepEqual(body.flags, [
    {
      ingredient: "Sesame oil",
      word_indices: [1, 2],
      allergens: ["sesame"],
      diets: [],
      risk_type: "contained",
    },
  ]);
  assert.deepEqual(body.parsedIngredientsList, ["Sesame oil"]);
  assert.equal(body.debug.aiCandidateCount, 1);
});

test("ingredient allergen route analyzes hazelnuts via AI", async () => {
  const agreedFlags = [
    {
      candidate_id: "direct:0",
      allergen_codes: [4],
      diet_codes: [],
    },
  ];

  const { body, openAiRequests } = await invokeRoute({
    transcriptLines: ["Ingredients: Hazelnuts"],
    openAiPayloads: [
      createOpenAiCandidateExtractionPayload({
        directIngredients: [{ text: "Hazelnuts", word_indices: [1] }],
      }),
      createOpenAiStructuredPayload(agreedFlags),
      createOpenAiStructuredPayload(agreedFlags),
    ],
  });

  assert.equal(body.success, true);
  assert.equal(openAiRequests.length, 3);
  assert.deepEqual(body.flags, [
    {
      ingredient: "Hazelnuts",
      word_indices: [1],
      allergens: ["tree_nut"],
      diets: [],
      risk_type: "contained",
    },
  ]);
  assert.equal(body.debug.aiCandidateCount, 1);
});

test("ingredient allergen route debug reflects AI-flattened parenthetical ingredients", async () => {
  const agreedFlags = [
    {
      candidate_id: "direct:2",
      allergen_codes: [4],
      diet_codes: [],
    },
  ];

  const { body } = await invokeRoute({
    transcriptLines: [
      "Ingredients: Pea Crisps (Pea Protein, Rice Starch), Hazelnut.",
      "Manufactured on equipment that processes Peanut, Dairy, Soy, Sesame, Tree Nuts, Wheat",
      "and Egg. May Contain nut shell fragments.",
    ],
    openAiPayloads: [
      createOpenAiCandidateExtractionPayload({
        directIngredients: [
          { text: "Pea Protein" },
          { text: "Rice Starch" },
          { text: "Hazelnut", word_indices: [7] },
        ],
        declarationCandidates: [
          {
            text: "Peanut",
            declaration_type: "shared-equipment",
            risk_type: "cross-contamination",
          },
          {
            text: "Dairy",
            declaration_type: "shared-equipment",
            risk_type: "cross-contamination",
          },
          {
            text: "Soy",
            declaration_type: "shared-equipment",
            risk_type: "cross-contamination",
          },
          {
            text: "Sesame",
            declaration_type: "shared-equipment",
            risk_type: "cross-contamination",
          },
          {
            text: "Tree Nuts",
            declaration_type: "shared-equipment",
            risk_type: "cross-contamination",
          },
          {
            text: "Wheat",
            declaration_type: "shared-equipment",
            risk_type: "cross-contamination",
          },
          {
            text: "Egg",
            declaration_type: "shared-equipment",
            risk_type: "cross-contamination",
          },
          {
            text: "nut shell fragments",
            declaration_type: "may-contain",
            risk_type: "cross-contamination",
          },
        ],
      }),
      createOpenAiStructuredPayload(agreedFlags),
      createOpenAiStructuredPayload(agreedFlags),
    ],
  });

  assert.equal(body.success, true);
  assert.equal(body.debug.ingredientExtractionMethod, "ai");
  assert.deepEqual(body.parsedIngredientsList, [
    "Pea Protein",
    "Rice Starch",
    "Hazelnut",
  ]);
  assert.ok(body.debug.aiCandidateTexts.includes("Pea Protein"));
  assert.ok(body.debug.aiCandidateTexts.includes("Rice Starch"));
  assert.ok(!body.debug.aiCandidateTexts.includes("Pea Crisps (Pea Protein, Rice Starch)"));
});

test("ingredient allergen route surfaces ingredient catalog matches in debug output", async () => {
  const { body } = await invokeRoute({
    transcriptLines: [
      "Ingredients: Pea Protein, Rice Starch, Organic Tapioca Syrup, Pistachio.",
    ],
    openAiPayloads: [
      createOpenAiCandidateExtractionPayload({
        directIngredients: [
          { text: "Pea Protein", word_indices: [1, 2] },
          { text: "Rice Starch", word_indices: [3, 4] },
          { text: "Organic Tapioca Syrup", word_indices: [5, 6, 7] },
          { text: "Pistachio", word_indices: [8] },
        ],
      }),
      createOpenAiStructuredPayload([]),
      createOpenAiStructuredPayload([]),
    ],
    catalogRows: [
      {
        canonical_name: "Pea Protein",
        normalized_name: "Pea Protein",
        lookup_terms: ["pea protein"],
        lookup_count: 3,
        seed_source: "smartlabel_ground_truth_safe_v1",
        is_ready: true,
      },
      {
        canonical_name: "Rice Starch",
        normalized_name: "Rice Starch",
        lookup_terms: ["rice starch"],
        lookup_count: 2,
        seed_source: "smartlabel_ground_truth_safe_v1",
        is_ready: true,
      },
      {
        canonical_name: "Organic Tapioca Syrup",
        normalized_name: "Organic Tapioca Syrup",
        lookup_terms: ["organic tapioca syrup"],
        lookup_count: 1,
        seed_source: "smartlabel_ground_truth_safe_v1",
        is_ready: true,
      },
      {
        canonical_name: "Pistachios",
        normalized_name: "Pistachios",
        lookup_terms: ["pistachios"],
        lookup_count: 1,
        seed_source: "smartlabel_ground_truth_safe_v1",
        is_ready: true,
      },
    ],
  });

  assert.equal(body.success, true);
  assert.deepEqual(body.debug.catalogMatchedCandidateTexts, [
    "Pea Protein",
    "Rice Starch",
    "Organic Tapioca Syrup",
    "Pistachio",
  ]);
  assert.equal(body.debug.catalogMatchedCandidateCount, 4);
  assert.deepEqual(body.debug.catalogMatchedEntriesByCandidateText.Pistachio, [
    {
      canonicalName: "Pistachios",
      normalizedName: "Pistachios",
      lookupCount: 1,
      seedSource: "smartlabel_ground_truth_safe_v1",
    },
  ]);
});
