function stringArraySchema() {
  return {
    type: "array",
    items: { type: "string" },
  };
}

function integerArraySchema() {
  return {
    type: "array",
    items: { type: "integer" },
  };
}

export const analyzeIngredientScanSchema = {
  name: "analyze_ingredient_scan",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["needsScan", "reasoning"],
    properties: {
      needsScan: { type: "boolean" },
      reasoning: { type: "string" },
    },
  },
};

export const aiDishSearchSchema = {
  name: "ai_dish_search",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["matches"],
    properties: {
      matches: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["candidate_id", "restaurant_id", "relevance_score"],
          properties: {
            candidate_id: { type: "string" },
            restaurant_id: { type: "string" },
            relevance_score: { type: "integer" },
          },
        },
      },
    },
  },
};

export const confirmInfoCompareSchema = {
  name: "confirm_info_compare",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["match", "confidence", "summary", "differences"],
    properties: {
      match: { type: "boolean" },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
      },
      summary: { type: "string" },
      differences: stringArraySchema(),
    },
  },
};

export const detectCornersSchema = {
  name: "detect_corners",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["corners", "description"],
    properties: {
      corners: {
        type: "object",
        additionalProperties: false,
        required: ["topLeft", "topRight", "bottomRight", "bottomLeft"],
        properties: {
          topLeft: {
            type: "object",
            additionalProperties: false,
            required: ["x", "y"],
            properties: { x: { type: "number" }, y: { type: "number" } },
          },
          topRight: {
            type: "object",
            additionalProperties: false,
            required: ["x", "y"],
            properties: { x: { type: "number" }, y: { type: "number" } },
          },
          bottomRight: {
            type: "object",
            additionalProperties: false,
            required: ["x", "y"],
            properties: { x: { type: "number" }, y: { type: "number" } },
          },
          bottomLeft: {
            type: "object",
            additionalProperties: false,
            required: ["x", "y"],
            properties: { x: { type: "number" }, y: { type: "number" } },
          },
        },
      },
      description: { type: "string" },
    },
  },
};

export const detectMenuDishesSchema = {
  name: "detect_menu_dishes",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["dishes"],
    properties: {
      dishes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: {
            name: { type: "string" },
          },
        },
      },
    },
  },
};

export const dishEditorAnalysisSchema = {
  name: "dish_editor_analysis",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["ingredients", "dietary_option_codes", "verifiedFromImage"],
    properties: {
      ingredients: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "brand", "allergen_codes", "diet_codes", "ingredientsList", "imageQuality"],
          properties: {
            name: { type: "string" },
            brand: { type: "string" },
            allergen_codes: integerArraySchema(),
            diet_codes: integerArraySchema(),
            ingredientsList: stringArraySchema(),
            imageQuality: {
              type: ["string", "null"],
              enum: ["good", "poor", "unreadable", null],
            },
          },
        },
      },
      dietary_option_codes: integerArraySchema(),
      verifiedFromImage: { type: "boolean" },
    },
  },
};

export const frontProductNameSchema = {
  name: "front_product_name",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["productName", "confidence"],
    properties: {
      productName: { type: "string" },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
      },
    },
  },
};

export const ingredientAllergenFlagsSchema = {
  name: "ingredient_allergen_flags",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["flags"],
    properties: {
      flags: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ingredient", "word_indices", "allergen_codes", "diet_codes", "risk_type"],
          properties: {
            ingredient: { type: "string" },
            word_indices: integerArraySchema(),
            allergen_codes: integerArraySchema(),
            diet_codes: integerArraySchema(),
            risk_type: {
              type: "string",
              enum: ["contained", "cross-contamination"],
            },
          },
        },
      },
    },
  },
};

export const ingredientAllergenCandidateFlagsSchema = {
  name: "ingredient_allergen_candidate_flags",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["flags"],
    properties: {
      flags: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["candidate_id", "allergen_codes", "diet_codes"],
          properties: {
            candidate_id: { type: "string" },
            allergen_codes: integerArraySchema(),
            diet_codes: integerArraySchema(),
          },
        },
      },
    },
  },
};

export const ingredientNameAnalysisSchema = {
  name: "ingredient_name_analysis",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["allergen_codes", "diet_codes", "reasoning"],
    properties: {
      allergen_codes: integerArraySchema(),
      diet_codes: integerArraySchema(),
      reasoning: { type: "string" },
    },
  },
};

export const ingredientPhotoLineMatchingSchema = {
  name: "ingredient_photo_line_matching",
  schema: {
    type: "object",
    additionalProperties: { type: "integer" },
  },
};

export const ingredientPhotoQualitySchema = {
  name: "ingredient_photo_quality",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["accept", "confidence", "reasons", "warnings", "message"],
    properties: {
      accept: { type: "boolean" },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
      },
      reasons: stringArraySchema(),
      warnings: stringArraySchema(),
      message: { type: "string" },
    },
  },
};

export const ingredientPhotoTranscriptionSchema = {
  name: "ingredient_photo_transcription",
  schema: {
    type: "array",
    items: { type: "string" },
  },
};

export const menuImageAnalysisSchema = {
  name: "menu_image_analysis",
  schema: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["name", "description", "prices", "element_ids"],
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        prices: { type: "string" },
        element_ids: integerArraySchema(),
      },
    },
  },
};
