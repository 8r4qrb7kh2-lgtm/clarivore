function getApiKey(keyName) {
  return localStorage.getItem(`clarivore_${keyName}`) || "";
}

async function callClaudeForAnalysis(messages, systemPrompt = "", options = {}) {
  const apiKey = getApiKey("anthropic_api_key");
  if (!apiKey) {
    throw new Error("Anthropic API key not configured.");
  }

  const { useExtendedThinking = false, model = "claude-sonnet-4-5-20250929" } =
    options;

  const requestBody = {
    model: model,
    max_tokens: useExtendedThinking ? 16000 : 4096,
    messages: messages,
  };

  if (!useExtendedThinking && systemPrompt) {
    requestBody.system = systemPrompt;
  }

  if (useExtendedThinking) {
    requestBody.thinking = {
      type: "enabled",
      budget_tokens: 10000,
    };
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || "Claude API request failed");
  }

  const data = await response.json();

  if (useExtendedThinking) {
    for (const block of data.content) {
      if (block.type === "text") {
        return block.text;
      }
    }
    return "";
  }

  return data.content[0].text;
}

// Browser-based allergen analysis using Claude
// Uses the exact transcript from image analysis to ensure word indices match
// Input: array of transcript line strings
// Output: { success, data: { flags: [{ ingredient, word_indices, allergens, diets, risk_type }] } }
export async function analyzeAllergensWithLabelCropper(transcriptLines) {
  const config =
    typeof window !== "undefined" && window.loadAllergenDietConfig
      ? await window.loadAllergenDietConfig()
      : typeof window !== "undefined"
        ? window.ALLERGEN_DIET_CONFIG || {}
        : {};
  const allergenKeys = Array.isArray(config.ALLERGENS) ? config.ALLERGENS : [];
  const dietLabels = Array.isArray(config.DIETS) ? config.DIETS : [];
  const allergenListText = allergenKeys.join(", ");
  const dietLabelMap = {};
  dietLabels.forEach((diet) => {
    if (!diet) return;
    dietLabelMap[String(diet)] = diet;
  });
  const veganLabel = dietLabelMap.Vegan;
  const vegetarianLabel = dietLabelMap.Vegetarian;
  const pescatarianLabel = dietLabelMap.Pescatarian;
  const glutenFreeLabel = dietLabelMap["Gluten-free"];
  const dietListText = dietLabels.join(", ");
  const dietViolationText = [
    veganLabel ? `${veganLabel} (no animal products)` : null,
    vegetarianLabel ? `${vegetarianLabel} (no meat/fish)` : null,
    pescatarianLabel ? `${pescatarianLabel} (no meat)` : null,
    glutenFreeLabel ? `${glutenFreeLabel} (no wheat/barley/rye)` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const glutenFreeExample = glutenFreeLabel
    ? JSON.stringify([glutenFreeLabel])
    : "[]";

  // Build word list with 0-based indices using SAME tokenization as displayCroppedLines
  // (split each line by /\s+/ and accumulate global index)
  const wordList = [];
  for (const line of transcriptLines) {
    const words = line.split(/\s+/);
    for (const word of words) {
      if (word) wordList.push(word);
    }
  }

  // Create indexed word list for Claude to reference
  const indexedWordList = wordList
    .map((word, idx) => `${idx}: "${word}"`)
    .join("\n");

  const userPrompt = `You are analyzing text from a food product label for allergens and dietary violations.

Here is the transcript with each word numbered (0-based index):
${indexedWordList}

Analyze for:
- Allergens: ${allergenListText}
- Diet violations: ${dietViolationText}
Use ONLY these exact names in your output (no synonyms or variants). If you cannot match to a listed term, omit it:
- Allergens: ${allergenListText}
- Diets: ${dietListText}

IMPORTANT: Look for TWO types of allergen declarations:
1. Allergens in the ingredient list itself (e.g., "wheat flour", "milk", "soybean oil")
2. Allergen statements at the end like "CONTAINS: WHEAT, SOY" or "MAY CONTAIN: MILK" or "PRODUCED IN THE SAME FACILITY", and other similar text.

For "CONTAINS:" statements, flag each allergen individually:
- "CONTAINS: WHEAT, SOY, AND SESAME" should produce 3 separate flags for WHEAT, SOY, and SESAME

For each allergen/diet violation found, report:
- The ingredient name as it appears
- The exact word indices from the numbered list above
- Whether it's exactly "contained" or exactly "cross-contamination" (use "cross-contamination" for cross-contamination/facility warnings)

Return ONLY valid JSON:
{
  "flags": [
{
  "ingredient": "WHEAT",
  "word_indices": [45],
  "allergens": ["wheat"],
  "diets": ${glutenFreeExample},
  "risk_type": "contained"
},
{
  "ingredient": "SOY",
  "word_indices": [46],
  "allergens": ["soy"],
  "diets": [],
  "risk_type": "contained"
}
  ]
}

Use the EXACT indices from the numbered list above. Do not calculate your own indices.`;

  const response = await callClaudeForAnalysis(
    [
      {
        role: "user",
        content: userPrompt,
      },
    ],
    "",
    { useExtendedThinking: true, model: "claude-sonnet-4-5-20250929" },
  );

  // Parse JSON from response
  let responseText = response.trim();
  if (responseText.startsWith("```")) {
    const lines = responseText.split("\n");
    lines.shift();
    responseText = lines.join("\n");
  }
  if (responseText.endsWith("```")) {
    responseText = responseText.slice(0, -3);
  }
  responseText = responseText.trim();

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("Could not parse allergen analysis response");
    return { success: true, data: { flags: [] } };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    console.log("Allergen analysis result:", parsed);
    console.log("Word list used:", wordList);
    return { success: true, data: { flags: parsed.flags || [] } };
  } catch (e) {
    console.error("Failed to parse allergen JSON:", e);
    return { success: true, data: { flags: [] } };
  }
}
