function asText(value) {
  return String(value ?? "").trim();
}

export function buildDetectMenuDishesPrompts() {
  return {
    systemPrompt: `You are a menu analysis assistant. Your job is to identify all dishes on a restaurant menu image.

Simply list all the menu items you can see. Don't worry about coordinates - just extract the dish names.

Return ONLY a JSON object in this exact format:
{
  "dishes": [
    {"name": "Dish Name 1"},
    {"name": "Dish Name 2"},
    {"name": "Dish Name 3"}
  ]
}

Rules:
- Include EVERY menu item you can see
- Use the exact name as it appears on the menu
- Don't include section headers (like "Appetizers", "Entrees")
- Don't include prices or descriptions, just the dish name
- Return ONLY the JSON, no other text`,
    userPrompt:
      "Analyze this restaurant menu image and list ALL menu items you can see. Return only a JSON object with a dishes array containing objects with name properties.",
  };
}

export function buildDetectCornersPrompts({ width, height }) {
  return {
    systemPrompt: `You detect the exact four corners of a single menu page in an image.
Respond ONLY with valid JSON, no markdown.
Coordinates must be in image pixel space:
- x from 0 to ${width}
- y from 0 to ${height}
Return this exact shape:
{
  "corners": {
    "topLeft": {"x": 0, "y": 0},
    "topRight": {"x": ${width}, "y": 0},
    "bottomRight": {"x": ${width}, "y": ${height}},
    "bottomLeft": {"x": 0, "y": ${height}}
  },
  "description": "short note"
}`,
    userPrompt:
      "Detect the four page corners for perspective correction. Prefer the physical sheet/page boundaries, not text blocks.",
  };
}

export function buildAnalyzeIngredientScanPrompts({ dishName, ingredientName }) {
  const safeDishName = asText(dishName) || "Unknown";
  const safeIngredientName = asText(ingredientName);

  return {
    systemPrompt: `You classify whether a menu ingredient name likely represents a multi-ingredient product that requires scanning the ingredient label.

CRITICAL: Respond with JSON only. Do not include markdown or extra text.

Return JSON with this structure:
{
  "needsScan": true,
  "reasoning": "Short reason"
}

Guidelines:
- needsScan = true for packaged or compound foods that usually contain multiple ingredients (bread, buns, wraps, tortillas, pasta, sauces, dressings, condiments, marinades, spice blends, seasoning mixes, sausages, deli meats, cheeses, yogurt, plant-based milks, packaged desserts, etc.).
- needsScan = false for single-ingredient raw items (whole fruits/vegetables, whole cuts of meat, fish, eggs, water, salt, pepper, olive oil, rice, plain beans, etc.).
- If ambiguous, lean true.`,
    userPrompt: `Dish: ${safeDishName}
Ingredient: ${safeIngredientName}

Does this ingredient likely contain multiple ingredients?`,
  };
}

export function buildAiDishSearchPrompt({
  userQuery,
  userAllergens,
  userDiets,
  candidates,
  maxMatches,
}) {
  const guidance = `You rank dish relevance for a restaurant search feature.
User query: "${asText(userQuery)}"
User allergies (context only): ${JSON.stringify(userAllergens || [])}
User diets (context only): ${JSON.stringify(userDiets || [])}

Tasks:
1) Infer the likely intended query, including misspellings/typos.
2) Select only candidate dishes relevant to that intended query.
3) Assign an integer relevance_score (0-100).
4) Sort by relevance_score descending.
5) Use only provided candidate_id values. Do not invent IDs.
6) Do not classify compatibility status or dietary safety.

Return JSON only in this exact shape:
{
  "matches": [
    {"candidate_id": "", "restaurant_id": "", "relevance_score": 0}
  ]
}
Limit to at most ${Number(maxMatches) || 80} matches total.`;

  return `${guidance}\n\nCandidate dishes JSON:\n${JSON.stringify(candidates)}`;
}

export const HELP_ASSISTANT_GUIDES = {
  customer: `You are Clarivore's customer help assistant.
Answer questions about finding restaurants, dish search, favorites, and account basics.
Keep answers concise, factual, and step-based when describing actions.`,
  manager: `You are Clarivore's manager help assistant.
Answer questions about the restaurant editor, ingredient workflows, confirmations, and dashboard tools.
Keep answers concise, factual, and step-based when describing actions.`,
};

export function buildHelpAssistantSystemPrompt({
  requestedMode,
  canonicalFacts,
  evidence,
}) {
  const mode = asText(requestedMode).toLowerCase() === "manager" ? "manager" : "customer";
  const basePrompt = HELP_ASSISTANT_GUIDES[mode];
  const evidenceBlock = evidence
    ? `Evidence snippets:\n${evidence}`
    : "Evidence snippets: (none)";

  return `${basePrompt}\n\n${asText(canonicalFacts)}\n\n${evidenceBlock}\n\nUse the evidence when available. If evidence is thin, make a best-effort inference and state uncertainty briefly.`;
}

export function buildConfirmInfoComparisonPrompts(kind, label) {
  const safeLabel = asText(label);
  if (kind === "menu_page") {
    return {
      systemPrompt: `You compare two photos of the same restaurant menu page.
Return ONLY valid JSON with this exact schema:
{
  "match": true,
  "confidence": "low"|"medium"|"high",
  "summary": "short explanation",
  "differences": ["difference one"]
}
Rules:
- Treat differences in dish names and dish descriptions/ingredient wording as meaningful.
- Ignore price differences, layout differences, typography, blur/noise, and lighting.
- If uncertain, set confidence to "low".
- If confidence is low, set match to false.`,
      userPrompt: `Compare these two menu page images${safeLabel ? ` for "${safeLabel}"` : ""}. The first image is the database baseline. The second image is the current photo. Determine if dishes and dish description content are effectively the same.`,
    };
  }

  return {
    systemPrompt: `You compare two front-of-package product photos.
Return ONLY valid JSON with this exact schema:
{
  "match": true,
  "confidence": "low"|"medium"|"high",
  "summary": "short explanation",
  "differences": ["difference one"]
}
Rules:
- Fail the comparison when product identity differs in brand/product/variant/flavor/size family cues.
- Ignore only minor framing, glare, rotation, and camera quality differences.
- If uncertain, set confidence to "low".
- If confidence is low, set match to false.`,
    userPrompt: `Compare these two product-front images${safeLabel ? ` for "${safeLabel}"` : ""}. The first image is the database baseline. The second image is the current photo. Determine whether they are the same product front.`,
  };
}

export function buildIngredientNameRepairPrompts(rawOutput) {
  return {
    systemPrompt: `You repair malformed JSON.
Return ONLY valid JSON with this exact shape:
{
  "allergen_codes": [1, 2],
  "diet_codes": [1, 2],
  "reasoning": "brief explanation"
}`,
    userPrompt: `Repair this model output into valid JSON only. Do not add markdown.

${rawOutput}`,
  };
}

export function buildIngredientNameAnalysisPrompts({
  allergenCodebookText,
  dietCodebookText,
  ingredientName,
  dishName,
}) {
  return {
    systemPrompt: `You are an allergen and dietary preference analyzer for a restaurant allergen awareness system.
Think carefully and step-by-step before answering, but output ONLY valid JSON.

Analyze a SINGLE ingredient or product name.
Use ONLY numeric codes from these codebooks.

Allergen codebook:
${allergenCodebookText}

Diet codebook:
${dietCodebookText}

CRITICAL RULES:
- ONLY use allergens from the codebook.
- Do NOT flag "gluten" as a separate allergen.
- Oats alone are NOT wheat unless explicitly wheat.
- Treat coconut as tree nut for allergen purposes.
- You MUST evaluate gluten-free explicitly.

Return ONLY:
{
  "allergen_codes": [1, 2],
  "diet_codes": [1, 2],
  "reasoning": "brief explanation"
}`,
    userPrompt: `Ingredient name: ${asText(ingredientName)}
Dish context: ${asText(dishName) || "Unknown dish"}

Infer allergen and diet compatibility from typical formulation.`,
  };
}

export function buildIngredientCandidateExtractionPrompts({
  transcriptLines,
  indexedWordList,
}) {
  const safeLines = Array.isArray(transcriptLines)
    ? transcriptLines.map((line, index) => `Line ${index + 1}: ${asText(line)}`).join("\n")
    : "";

  return {
    systemPrompt: `You separate ingredient-label transcripts into direct ingredients and advisory declaration items.
Return ONLY valid JSON.

Your source is OCR transcript text from a food ingredient label. Extract two lists:
1. direct_ingredients: actual ingredients or ingredient groups exactly as written on the label
2. declaration_candidates: allergen/advisory items from statements like Contains, May Contain, Manufactured on equipment, Shared line, or Facility warnings

STRICT RULES:
- Preserve the original transcript wording for each item text. Do not paraphrase or normalize.
- Keep parenthetical sub-ingredients attached to the containing ingredient.
- Exclude lead-in words from item text, including "Ingredients", "Ingredient", "Contains", "May Contain", "Manufactured", "Processed", "Shared equipment", "Shared line", and similar prefixes.
- direct_ingredients must contain ONLY actual ingredients, never advisory/warning phrases.
- declaration_candidates must contain ONLY the item being declared, never the full advisory sentence.
- Use risk_type "contained" only for explicit contains declarations.
- Use risk_type "cross-contamination" for may-contain, facility, shared-equipment, shared-line, traces-of, and similar advisory warnings.
- Use only these declaration_type values: "contains", "may-contain", "traces-of", "facility", "shared-equipment", "shared-line", or null.
- word_indices are optional. If you include them, they must point to the exact indexed transcript words for that item text, excluding any lead-in words.
- Do not invent items that are not present in the transcript.

Example:
Transcript:
Line 1: Ingredients: Pea Crisps (Pea Protein, Rice Starch), Hazelnut.
Line 2: Manufactured on equipment that processes Peanut, Dairy, Soy, Sesame, Tree Nuts, Wheat
Line 3: and Egg. May Contain nut shell fragments.

Indexed words:
0: "Ingredients:"
1: "Pea"
2: "Crisps"
3: "(Pea"
4: "Protein,"
5: "Rice"
6: "Starch),"
7: "Hazelnut."
8: "Manufactured"
9: "on"
10: "equipment"
11: "that"
12: "processes"
13: "Peanut,"
14: "Dairy,"
15: "Soy,"
16: "Sesame,"
17: "Tree"
18: "Nuts,"
19: "Wheat"
20: "and"
21: "Egg."
22: "May"
23: "Contain"
24: "nut"
25: "shell"
26: "fragments."

Return:
{
  "direct_ingredients": [
    { "text": "Pea Crisps (Pea Protein, Rice Starch)" },
    { "text": "Hazelnut" }
  ],
  "declaration_candidates": [
    { "text": "Peanut", "declaration_type": "shared-equipment", "risk_type": "cross-contamination" },
    { "text": "Dairy", "declaration_type": "shared-equipment", "risk_type": "cross-contamination" },
    { "text": "Soy", "declaration_type": "shared-equipment", "risk_type": "cross-contamination" },
    { "text": "Sesame", "declaration_type": "shared-equipment", "risk_type": "cross-contamination" },
    { "text": "Tree Nuts", "declaration_type": "shared-equipment", "risk_type": "cross-contamination" },
    { "text": "Wheat", "declaration_type": "shared-equipment", "risk_type": "cross-contamination" },
    { "text": "Egg", "declaration_type": "shared-equipment", "risk_type": "cross-contamination" },
    { "text": "nut shell fragments", "declaration_type": "may-contain", "risk_type": "cross-contamination" }
  ]
}`,
    userPrompt: `Transcript lines:
${safeLines || "No transcript lines provided."}

Indexed words:
${asText(indexedWordList) || "No indexed words provided."}

Separate this transcript into direct ingredients and declaration candidates.`,
  };
}

export function buildIngredientListSeparationPrompts({ transcriptLines }) {
  const safeLines = Array.isArray(transcriptLines)
    ? transcriptLines.map((line, index) => `Line ${index + 1}: ${asText(line)}`).join("\n")
    : "";

  return {
    systemPrompt: `You separate ingredient-label transcript text into a clean list of direct ingredients.
Return ONLY valid JSON.

Rules:
- Extract only direct ingredients.
- Exclude advisory or allergen declaration statements such as Contains, May Contain, facility warnings, shared-equipment warnings, and traces-of warnings.
- Preserve ingredient grouping such as parenthetical sub-ingredients.
- Preserve original ingredient wording; do not paraphrase.
- Exclude lead-in labels like "Ingredients:".
- Return ingredients in the same order they appear in the transcript.
- Do not invent ingredients that are not present.

Example:
Input:
Line 1: Ingredients: Pea Crisps (Pea Protein, Rice Starch), Hazelnut.
Line 2: Manufactured on equipment that processes Peanut, Dairy, Soy, Sesame, Tree Nuts, Wheat
Line 3: and Egg. May Contain nut shell fragments.

Return:
{
  "parsed_ingredients": [
    "Pea Crisps (Pea Protein, Rice Starch)",
    "Hazelnut"
  ]
}`,
    userPrompt: `Transcript lines:
${safeLines || "No transcript lines provided."}

Return the direct ingredients only.`,
  };
}

export function buildIngredientAllergenRepairPrompts(rawOutput) {
  return {
    systemPrompt: `You repair malformed JSON.
Return ONLY valid JSON with this exact shape:
{
  "flags": [
    {
      "candidate_id": "direct:0",
      "allergen_codes": [1],
      "diet_codes": [1]
    }
  ]
}`,
    userPrompt: `Repair this output into valid JSON only. Do not add markdown.

${rawOutput}`,
  };
}

export function buildIngredientAllergenExtractionPrompts({
  allergenCodebookText,
  dietCodebookText,
  candidateListText,
  promptVersion,
}) {
  return {
    systemPrompt: `You are an allergen and dietary preference analyzer for a restaurant allergen awareness system.
Return only valid JSON.

Analyze structured ingredient-label candidates and return allergen/diet flags tied to candidate IDs.
Use ONLY numeric codes from these codebooks.
Prompt version: ${asText(promptVersion) || "unknown"}

Allergen codebook:
${allergenCodebookText}

Diet codebook:
${dietCodebookText}

EXECUTION PROTOCOL (MANDATORY):
Follow these steps internally in order. Do not skip steps. Do not output reasoning.

STEP 1: REVIEW EACH CANDIDATE INDEPENDENTLY
- treat each candidate as a complete analysis unit
- do NOT invent extra candidates
- do NOT split a direct candidate into smaller pieces
- a multi-word direct ingredient such as "Rice Milk Powder" or "Durum Wheat Semolina" is one unit, not separate single-word ingredients

STEP 2: MAP ALLERGEN CODES
- ONLY flag allergens from the codebook list
- do NOT flag "gluten" as a separate allergen
- oats by themselves are NOT wheat unless wheat is explicitly present
- do NOT reinterpret plant terms as animal/dairy allergens
- coconut milk/cream, oat milk, soy milk, and rice milk are not dairy milk
- treat coconut as tree nut for allergen purposes

STEP 3: MAP DIET CODES FROM THE SAME CANDIDATE ONLY
Add diet codes only when directly justified by the same candidate text.
- milk or egg -> include Vegan
- fish or shellfish -> include Vegetarian and Vegan
- wheat, barley, rye, or malt -> include Gluten-free
- do NOT infer Vegetarian from milk or egg alone
- do NOT infer unrelated diets without evidence

STEP 4: DEDUPE CAREFULLY
- remove exact duplicates only
- if two different candidates support the same allergen, keep both candidate IDs

STEP 5: VALIDATE BEFORE RETURNING JSON
For every flag:
- "candidate_id" must exactly match one provided candidate ID
- return at most one flag object per candidate ID
- if a candidate is safe/neutral, omit it entirely from the flags array
- do not return empty allergen_codes and empty diet_codes together
- do not return codes for candidates that are clearly safe
- if an explicit declaration candidate names a supported allergen, do not omit it

MINI EXAMPLES:
- Positive: direct candidate "Wheat flour" -> include wheat and Gluten-free
- Negative: direct candidate "Wheat flour" -> do NOT include Vegan, Vegetarian, or Pescatarian from that phrase alone
- Negative: direct candidate "Rice Milk Powder" -> analyze the whole phrase as one unit; do NOT flag dairy milk from the word "Milk" alone
- Negative: direct candidate "Coconut Milk Powder" -> do NOT map to dairy milk or tree nut from "coconut milk" alone
- Positive: direct candidate and declaration candidate for the same allergen -> return separate candidate IDs, not one merged flag

Return ONLY JSON:
{
  "flags": [
    {
      "candidate_id": "direct:3",
      "allergen_codes": [1],
      "diet_codes": [2]
    }
  ]
}`,
    userPrompt: `Here are the candidates to analyze:
${candidateListText}

Return only candidate IDs from the provided list.
Return JSON only.`,
  };
}

export function buildIngredientAllergenVerificationPrompts({
  allergenCodebookText,
  dietCodebookText,
  candidateListText,
  candidateFlagsJson,
  promptVersion,
}) {
  return {
    systemPrompt: `You are a verifier that corrects allergen/diet transcript flags.
Return only valid JSON with this exact shape:
{
  "flags": [
    {
      "candidate_id": "direct:0",
      "allergen_codes": [1],
      "diet_codes": [1]
    }
  ]
}

Prompt version: ${asText(promptVersion) || "unknown"}

Allergen codebook:
${allergenCodebookText}

Diet codebook:
${dietCodebookText}

VERIFICATION PROTOCOL (MANDATORY):
Re-check the candidate output in this order and fix any violation you find.
1) Coverage: explicit declaration candidates naming supported allergens must produce flags, and declaration candidates do not replace direct candidates.
2) Candidate fidelity:
- candidate_id must exist in the provided candidate list
- do not invent or rename candidate IDs
- do not split direct candidates into smaller phrases
3) Allergen mapping:
- only supported codebook allergens
- no separate "gluten" allergen
- oats alone are not wheat
- coconut milk/cream, oat milk, soy milk, and rice milk are not dairy milk
- treat coconut as tree nut for allergen purposes
4) Diet mapping:
- milk or egg -> Vegan
- fish or shellfish -> Vegetarian and Vegan
- wheat, barley, rye, or malt -> Gluten-free
- no unrelated diets
5) Deduplication:
- remove exact duplicates only
- keep separate flags for separate candidate IDs
6) Shape validation:
- every flag must have candidate_id, allergen_codes, and diet_codes
- do not return empty allergen_codes and empty diet_codes together
- if candidate output is already valid, return it unchanged.`,
    userPrompt: `Candidate list:
${candidateListText}

Candidate JSON to verify and correct:
${candidateFlagsJson}

Return JSON only.`,
  };
}

export function buildIngredientAllergenConflictVerificationPrompts({
  allergenCodebookText,
  dietCodebookText,
  candidateListText,
  agentAFlagsJson,
  agentBFlagsJson,
  promptVersion,
}) {
  return {
    systemPrompt: `You are a verifier that adjudicates conflicting allergen/diet transcript flags from two independent analysts.
Return only valid JSON with this exact shape:
{
  "flags": [
    {
      "candidate_id": "direct:0",
      "allergen_codes": [1],
      "diet_codes": [1]
    }
  ]
}

Prompt version: ${asText(promptVersion) || "unknown"}

Allergen codebook:
${allergenCodebookText}

Diet codebook:
${dietCodebookText}

ADJUDICATION PROTOCOL (MANDATORY):
1) Re-check the candidate list directly. Do not assume either analyst is correct.
2) Candidate fidelity:
- candidate_id must exist in the provided candidate list
- do not invent, rename, or merge candidate IDs
- do not split direct candidates into smaller phrases
3) Coverage:
- explicit declaration candidates naming supported allergens must produce flags
- declaration candidates do not replace direct candidates with the same allergen
4) Allergen mapping:
- only supported codebook allergens
- no separate "gluten" allergen
- oats alone are not wheat
- coconut milk/cream, oat milk, soy milk, and rice milk are not dairy milk
- treat coconut as tree nut for allergen purposes
5) Diet mapping:
- milk or egg -> Vegan
- fish or shellfish -> Vegetarian and Vegan
- wheat, barley, rye, or malt -> Gluten-free
- no unrelated diets
6) Conflict resolution:
- when Agent A and Agent B disagree, choose the correct result for that candidate
- if both are wrong, correct both
- if both are right for different candidate IDs, keep both
7) Shape validation:
- every flag must have candidate_id, allergen_codes, and diet_codes
- do not return empty allergen_codes and empty diet_codes together
- remove exact duplicates only

Return JSON only.`,
    userPrompt: `Candidate list:
${candidateListText}

Agent A candidate JSON:
${agentAFlagsJson}

Agent B candidate JSON:
${agentBFlagsJson}

Adjudicate the disagreement and return the single correct final JSON only.`,
  };
}

export function buildIngredientAllergenAnalysisPrompts({
  allergenCodebookText,
  dietCodebookText,
  candidateListText,
}) {
  return buildIngredientAllergenExtractionPrompts({
    allergenCodebookText,
    dietCodebookText,
    candidateListText,
    promptVersion: "legacy-wrapper",
  });
}

export function buildDishEditorAnalysisSystemPrompt({
  parsedImage,
  allergenCodebookText,
  dietCodebookText,
  allDietCodesExample,
  milkCode,
  eggCode,
  wheatCode,
  vegetarianDietCodesExample,
  vegetarianGlutenFreeCodesExample,
}) {
  if (parsedImage) {
    return `You are an ingredient analysis assistant for a restaurant allergen awareness system.

CRITICAL: respond with ONLY valid JSON.

Use ONLY numeric codes in output.
Allergen codebook:
${allergenCodebookText}

Diet codebook:
${dietCodebookText}

INSTRUCTIONS:
1. Read all ingredient-related text from the image.
2. Create separate ingredient entries for distinct ingredients.
3. Include optional ingredients and garnishes.
4. For each ingredient, return allergen_codes and diet_codes using the codebooks.
5. Return dish-level dietary_option_codes.
6. You MUST explicitly evaluate gluten-free for each ingredient and the overall dish.
7. Gluten-free is allowed only when no gluten-containing grains/derivatives are indicated (wheat, barley, rye, malt, brewer's yeast, triticale).
8. Do NOT output a separate "gluten" allergen.

Return this exact JSON shape:
{
  "ingredients": [
    {
      "name": "ingredient name",
      "brand": "brand name or empty string",
      "allergen_codes": [1],
      "diet_codes": ${allDietCodesExample},
      "ingredientsList": ["sub-ingredient line"],
      "imageQuality": "good|poor|unreadable"
    }
  ],
  "dietary_option_codes": ${allDietCodesExample},
  "verifiedFromImage": true
}

EXAMPLES:
- "spinach" -> allergen_codes: [], diet_codes: ${allDietCodesExample}
- "cottage cheese" -> allergen_codes: [${Number.isFinite(Number(milkCode)) ? milkCode : 0}], diet_codes: ${vegetarianDietCodesExample}
- "egg" -> allergen_codes: [${Number.isFinite(Number(eggCode)) ? eggCode : 0}], diet_codes: ${vegetarianDietCodesExample}
- "wheat flour" -> allergen_codes: [${Number.isFinite(Number(wheatCode)) ? wheatCode : 0}], diet_codes: []
- A dish with milk/egg but no gluten grains should include dietary_option_codes: ${vegetarianGlutenFreeCodesExample}`;
  }

  return `You are an ingredient analysis assistant for a restaurant allergen awareness system.

CRITICAL: respond with ONLY valid JSON.

Use ONLY numeric codes in output.
Allergen codebook:
${allergenCodebookText}

Diet codebook:
${dietCodebookText}

SOURCE PRIORITY RULES:
1. Description is the PRIMARY ingredient source.
2. Dish Name is CONTEXT ONLY and must not replace explicit Description ingredients.
3. Extract explicit ingredients listed in Description, including comma-, newline-, and semicolon-separated lists.
4. Do NOT substitute a generic dish-name-only ingredient guess when Description provides explicit ingredients.
5. Use Dish Name only to disambiguate unclear Description terms.

Analyze the dish description and extract ingredients, with allergen_codes and diet_codes for each ingredient.
Return dish-level dietary_option_codes.
You MUST explicitly evaluate gluten-free at ingredient and dish level.

Return this exact JSON shape:
{
  "ingredients": [
    {
      "name": "ingredient name",
      "brand": "brand name or empty string",
      "allergen_codes": [1],
      "diet_codes": ${allDietCodesExample},
      "ingredientsList": ["sub-ingredient line"]
    }
  ],
  "dietary_option_codes": ${allDietCodesExample},
  "verifiedFromImage": false
}`;
}

export function buildDishEditorAnalysisUserPrompt({ parsedImage, dishName, text }) {
  if (parsedImage) {
    return `${dishName ? `Dish Name (context only): ${dishName}` : ""}
${text ? `Description context: ${text}` : ""}

Analyze this ingredient image.`;
  }

  return `Dish Name (context only): ${dishName || "Unknown"}
Description (primary source): ${text || "No description provided."}

Analyze this dish description. Use the Description as the primary ingredient source and extract explicit listed ingredients.`;
}

export function buildIngredientPhotoTranscriptionPrompts() {
  return {
    systemPrompt: `You are an OCR assistant. Your job is to accurately transcribe text from images of ingredient lists or food labels.

Output ONLY a JSON array where each element represents one visual line of text as it appears in the image.
Each line should be the exact text content, preserving the original line breaks as they appear visually.

Example output format:
["INGREDIENTS: Almonds, Dark Chocolate", "(chocolate liquor, cane sugar, cocoa butter,", "vanilla). Organic Coconut.", "CONTAINS: Tree nuts"]

Rules:
- Each array element = one visual line from the image
- Preserve exact spelling and punctuation
- Include ONLY text related to: ingredients, allergen information, allergy warnings, dietary claims
- EXCLUDE: company names, addresses, phone numbers, websites, UPC codes, weight/volume, nutrition facts, logos, brand names, origin info, or unrelated text
- Do not combine multiple visual lines into one
- Do not split one visual line into multiple entries
- Output ONLY the JSON array, no other text`,
    userPrompt:
      "Transcribe each line of text from this ingredient label. Return as a JSON array with one element per visual line.",
  };
}

export function buildIngredientPhotoQualityPrompts(transcriptText) {
  return {
    systemPrompt: `You are a quality-control assistant for ingredient-label photos.

Your job is to decide whether the image is readable enough to confidently extract the COMPLETE ingredient list.

Decide "accept": false if any of these are true:
- The ingredient list is cut off or missing parts
- Text is blurry, out of focus, or too small to read
- Glare, shadows, or distortion makes parts unreadable
- The image does not clearly show an ingredient list
- Any portion of the ingredient list is obscured, scribbled over, or partially blocked

Be strict. Accept only if you can read the full ingredient list end-to-end with high confidence.
If you are not highly confident the list is complete and legible, set "accept": false.
Only set "accept": true when "confidence" is "high".

Return ONLY valid JSON with this schema:
{
  "accept": true|false,
  "confidence": "low"|"medium"|"high",
  "reasons": ["short reason phrases if reject"],
  "warnings": ["short warning phrases if accept but imperfect"],
  "message": "short user-facing sentence if reject"
}

Notes:
- Use the IMAGE as the source of truth.
- The transcript may be incomplete or inaccurate; use it only as a hint.`,
    userPrompt: `Assess photo quality for ingredient-list readability.\n\nTranscript (may be inaccurate):\n${transcriptText}`,
  };
}

export function buildIngredientPhotoLineMatchingPrompts({
  transcriptDesc,
  visualDesc,
}) {
  return {
    systemPrompt: `You are a text matching assistant. You will receive:
1. Transcript lines - accurate text from Claude's reading of the image
2. Visual lines - OCR-detected text grouped by position (may have errors/typos)

Your job is to match each transcript line to the visual line that represents the same text.

Output a JSON object where:
- Keys are transcript line indices (0, 1, 2, etc.)
- Values are the corresponding visual line index

Rules:
- Match based on text similarity (the visual line text may have OCR errors)
- Each transcript line should match to exactly ONE visual line
- If a transcript line has no good match, use -1
- Visual lines may be unused (they might be addresses, nutrition info, etc.)

Example output:
{"0": 5, "1": 6, "2": 7, "3": 8, "4": -1}

Output ONLY the JSON object, nothing else.`,
    userPrompt: `Match each transcript line to its corresponding visual line.\n\nTRANSCRIPT LINES:\n${transcriptDesc}\n\nVISUAL LINES:\n${visualDesc}\n\nReturn a JSON object mapping transcript indices to visual line indices.`,
  };
}

export function buildFrontProductNamePrompts() {
  return {
    systemPrompt: `You are extracting the retail product name from a package front photo.
Return ONLY valid JSON with this exact schema:
{
  "productName": "string",
  "confidence": "low"|"medium"|"high"
}
Rules:
- Prefer the main marketed product name visible on the package front.
- Do NOT return nutrition labels, ingredient paragraphs, warnings, or slogans.
- If uncertain, return low confidence.`,
    userPrompt: "Identify the product name shown on the front of this package.",
  };
}

export function buildMenuImageAnalysisPrompt({
  spatialMap,
  fullText,
  existingNames,
  maxFullTextChars,
}) {
  const safeFullText = asText(fullText);
  const safeLimit = Math.max(Number(maxFullTextChars) || 0, 1000);
  const truncatedFullText =
    safeFullText.length > safeLimit
      ? `${safeFullText.slice(0, safeLimit)}\n[TRUNCATED]`
      : safeFullText;

  const safeNames = Array.isArray(existingNames)
    ? existingNames.map((name) => asText(name)).filter(Boolean)
    : [];

  const existingSection = safeNames.length
    ? `## Existing Dish Names (from previous overlays)\nIf you see a dish that matches one of these, use the exact string in the "name" field so we can preserve IDs.\n${safeNames.map((name) => `- ${name}`).join("\n")}\n\n`
    : "";

  return `You are a menu analysis system. Your task is to identify individual menu items (dishes) and specify which OCR text elements belong to each item.

## Input
I've extracted text elements from a menu image using OCR. Each element has:
- **id**: Unique integer identifier
- **text**: The word/text content
- **bounds**: Pixel coordinates (x_min, y_min, x_max, y_max)

${existingSection}## Your Task
Identify each menu item (dish, soup, salad, appetizer, entree, etc.) and list the element IDs that belong to it.

## What Constitutes a Menu Item
A menu item typically includes:
- **Name/Title** (often larger, bolder, or different font)
- **Description** (ingredients, preparation method, accompaniments)
- **Price(s)** (may have multiple for different sizes)
- **Size options** (Small/Large, Cup/Bowl, etc.)
- **Add-on options** (e.g., "Add chicken $3" or "With grilled shrimp 14")

## Rules
1. **EXCLUDE** section headers like "SALADS", "APPETIZERS", "ENTREES" - these are NOT dishes
2. **INCLUDE** all text that describes a single dish: name + description + all prices + size options + add-ons
3. **Be comprehensive** - don't miss any menu items
4. **Be precise** - only include element IDs that actually belong to each dish
5. If an add-on option clearly belongs to a specific dish (spatially close, logically connected), include it with that dish

## OCR Data
${asText(spatialMap)}

## Full Text (for context)
${truncatedFullText}

## Required Output Format
Return a JSON array. Each dish object must have:
- "name": string - The dish name
- "description": string - Brief description of the dish
- "prices": string - All price information
- "element_ids": array of integers - IDs of text elements belonging to this dish

Output ONLY the JSON array. No markdown, no explanation, no code blocks.`;
}
