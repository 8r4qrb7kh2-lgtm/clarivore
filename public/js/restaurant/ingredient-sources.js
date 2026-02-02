export function initIngredientSources(deps = {}) {
  const esc =
    typeof deps.esc === "function" ? deps.esc : (value) => String(value ?? "");

  function normalizeIngredientsForComparison(text) {
    return (text || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function areIngredientsSimilar(text1, text2) {
    const n1 = normalizeIngredientsForComparison(text1);
    const n2 = normalizeIngredientsForComparison(text2);
    if (n1 === n2) return true;
    const w1 = new Set(n1.split(" ").filter((w) => w.length > 2));
    const w2 = new Set(n2.split(" ").filter((w) => w.length > 2));
    const intersection = [...w1].filter((w) => w2.has(w)).length;
    const union = new Set([...w1, ...w2]).size;
    return union > 0 && intersection / union >= 0.65;
  }

  function groupSourcesByIngredientSimilarity(sources) {
    const groups = [];
    for (const source of sources) {
      let addedToGroup = false;
      for (const group of groups) {
        if (
          areIngredientsSimilar(
            source.ingredientsText,
            group[0].ingredientsText,
          )
        ) {
          group.push(source);
          addedToGroup = true;
          break;
        }
      }
      if (!addedToGroup) {
        groups.push([source]);
      }
    }
    groups.sort((a, b) => b.length - a.length);
    return groups;
  }

  function parseIngredientsToBullets(ingredientsText) {
    if (!ingredientsText) return [];

    const text = ingredientsText.replace(/ingredients:/i, "").trim();
    const ingredients = [];
    let current = "";
    let parenDepth = 0;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      if (char === "(" || char === "[") {
        parenDepth++;
        current += char;
      } else if (char === ")" || char === "]") {
        parenDepth = Math.max(0, parenDepth - 1);
        current += char;
      } else if ((char === "," || char === ";") && parenDepth === 0) {
        const trimmed = current.trim();
        if (trimmed.length > 0 && trimmed.length < 200) {
          ingredients.push(trimmed);
        }
        current = "";
      } else if (
        char === "." &&
        parenDepth === 0 &&
        i + 1 < text.length &&
        /\s+[A-Z]/.test(text.slice(i + 1, i + 4))
      ) {
        const beforePeriod = current.trim();
        const isBacterialAbbrev =
          /^[A-Za-z]$/.test(beforePeriod) || /\s[A-Za-z]$/.test(beforePeriod);

        if (isBacterialAbbrev) {
          current += char;
        } else {
          const trimmed = beforePeriod;
          if (trimmed.length > 0 && trimmed.length < 200) {
            ingredients.push(trimmed);
          }
          current = "";
        }
      } else {
        current += char;
      }
    }

    const trimmed = current.trim();
    if (trimmed.length > 0 && trimmed.length < 200) {
      ingredients.push(trimmed);
    }

    return ingredients;
  }

  function findDifferingIngredients(primaryIngredients, altIngredients) {
    const normalizedPrimary = new Set(
      primaryIngredients.map((i) => normalizeIngredientsForComparison(i)),
    );
    const differing = [];
    for (const ing of altIngredients) {
      const normalized = normalizeIngredientsForComparison(ing);
      let found = false;
      for (const pNorm of normalizedPrimary) {
        if (
          pNorm === normalized ||
          pNorm.includes(normalized) ||
          normalized.includes(pNorm)
        ) {
          found = true;
          break;
        }
      }
      if (!found) {
        differing.push(ing);
      }
    }
    return new Set(differing);
  }

  function renderGroupedSourcesHtml(sources, options = {}) {
    if (!sources || sources.length === 0) return "";

    const groups = groupSourcesByIngredientSimilarity(sources);
    const showConfirmButtons = options.showConfirmButtons !== false;
    const aiIngredientNames = options.ingredientNames || null;

    const primaryIngredients =
      aiIngredientNames ||
      (groups.length > 0
        ? parseIngredientsToBullets(groups[0][0].ingredientsText)
        : []);

    return groups
      .map((group, groupIdx) => {
        const representativeIngredients =
          groupIdx === 0 && aiIngredientNames
            ? aiIngredientNames
            : parseIngredientsToBullets(group[0].ingredientsText);
        const groupColor =
          groupIdx === 0 ? "rgba(76,212,90,0.4)" : "rgba(255,152,0,0.4)";
        const groupBgColor =
          groupIdx === 0 ? "rgba(76,212,90,0.1)" : "rgba(255,152,0,0.1)";
        const groupHeaderColor = groupIdx === 0 ? "#4caf50" : "#ff9800";

        const differingIngredients =
          groupIdx > 0
            ? findDifferingIngredients(
                primaryIngredients,
                representativeIngredients,
              )
            : new Set();

        return `
      <div style="
        background: ${groupBgColor};
        border: 2px solid ${groupColor};
        border-radius: 12px;
        padding: 20px;
        margin-bottom: 16px;
      " data-group-idx="${groupIdx}" data-ingredients-text="${esc(group[0].ingredientsText)}">
        <div style="margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
            <div>
              <span style="font-weight: 700; color: ${groupHeaderColor}; font-size: 1.1rem;">
                ${groupIdx === 0 ? "✓ Primary Ingredient List" : `⚠️ Alternate List`}
              </span>
              <span style="font-weight: 400; font-size: 0.9rem; color: #a0a0a0; margin-left: 8px;">
                (${group.length} source${group.length !== 1 ? "s" : ""} agree)
              </span>
            </div>
            ${
              showConfirmButtons
                ? `
              <button type="button" class="confirmGroupIngredientListBtn" data-group-idx="${groupIdx}" style="
                padding: 8px 16px;
                background: ${groupIdx === 0 ? "#4c5ad4" : "#ff9800"};
                border: none;
                border-radius: 6px;
                color: #fff;
                font-weight: 600;
                cursor: pointer;
                font-size: 0.85rem;
                white-space: nowrap;
                flex-shrink: 0;
              ">
                Confirm & Apply
              </button>
            `
                : ""
            }
          </div>

          ${
            representativeIngredients.length > 0
              ? `
            <div style="
              background: rgba(0,0,0,0.2);
              border-radius: 8px;
              padding: 16px;
              margin-bottom: 16px;
            ">
              <div style="font-weight: 600; color: #a0a0a0; font-size: 0.85rem; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px;">
                Ingredients:
              </div>
              <ul style="
                margin: 0;
                padding-left: 20px;
                color: #e0e0e0;
                font-size: 0.9rem;
                line-height: 1.7;
              ">
                ${representativeIngredients
                  .slice(0, 30)
                  .map((ing) => {
                    const isDifferent = differingIngredients.has(ing);
                    return `<li style="margin-bottom: 4px; ${isDifferent ? "color: #ff9800; font-weight: 600;" : ""}">${esc(ing)}${isDifferent ? ' <span style="font-size: 0.75rem; background: rgba(255,152,0,0.3); padding: 2px 6px; border-radius: 4px; margin-left: 6px;">DIFFERS</span>' : ""}</li>`;
                  })
                  .join("")}
                ${representativeIngredients.length > 30 ? `<li style="color: #a0a0a0; font-style: italic;">...and ${representativeIngredients.length - 30} more ingredients</li>` : ""}
              </ul>
            </div>
          `
              : ""
          }
        </div>

        <div style="font-weight: 600; color: #a0a0a0; font-size: 0.85rem; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
          Sources (${group.length}):
        </div>

        ${group
          .map((source, sourceIdx) => {
            const urlObj = source.url
              ? (() => {
                  try {
                    return new URL(source.url);
                  } catch {
                    return null;
                  }
                })()
              : null;
            const domain = urlObj ? urlObj.hostname.replace("www.", "") : "";
            const faviconUrl = domain
              ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
              : "";

            return `
            <div style="
              background: rgba(0,0,0,0.2);
              border-radius: 8px;
              padding: 16px;
              margin-bottom: ${sourceIdx < group.length - 1 ? "12px" : "0"};
            ">
              <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                ${
                  faviconUrl
                    ? `
                  <img src="${esc(faviconUrl)}" alt="${esc(source.sourceName || "")}"
                       style="width: 32px; height: 32px; border-radius: 4px; flex-shrink: 0;"
                       onerror="this.style.display='none';">
                `
                    : ""
                }
                <div style="flex: 1;">
                  <div style="font-weight: 600; color: #fff; font-size: 1rem; margin-bottom: 2px;">
                    ${esc(source.sourceName || `Source ${sourceIdx + 1}`)}
                  </div>
                  ${
                    source.productName
                      ? `
                    <div style="font-size: 0.85rem; color: #9ca3af; margin-bottom: 4px;">
                      📦 ${esc(source.productName)}
                    </div>
                  `
                      : ""
                  }
                  ${
                    source.url
                      ? `
                    <div style="font-size: 0.8rem; word-break: break-all;">
                      <a href="${esc(source.url)}" target="_blank"
                         style="color: ${source.urlValid === false ? "#999" : "#6b7ce6"}; text-decoration: ${source.urlValid === false ? "line-through" : "none"};"
                         rel="noopener noreferrer"
                         title="${source.urlValid === false ? "Link may be inaccessible" : ""}">
                        ${esc(source.url)}
                      </a>
                      ${source.urlValid === false ? '<span style="color: #ff9800; font-size: 0.75rem; margin-left: 8px;">(Link may be dead)</span>' : ""}
                    </div>
                  `
                      : ""
                  }
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 1fr; gap: 12px;">
                <!-- Exact Ingredients Text -->
                <div style="
                  background: rgba(0,0,0,0.3);
                  border-radius: 6px;
                  padding: 12px;
                ">
                  <div style="font-weight: 600; color: #a0a0a0; font-size: 0.8rem; margin-bottom: 6px;">
                    Exact Ingredient Text:
                  </div>
                  <div style="
                    font-size: 0.85rem;
                    color: #e0e0e0;
                    line-height: 1.5;
                    font-family: 'Monaco', 'Courier New', monospace;
                    white-space: pre-wrap;
                    word-wrap: break-word;
                  ">
                    ${esc(source.ingredientsText || "Not available")}
                  </div>
                </div>

                <!-- Allergen Statement -->
                <div style="
                  background: rgba(255,152,0,0.1);
                  border: 1px solid rgba(255,152,0,0.3);
                  border-radius: 6px;
                  padding: 12px;
                ">
                  <div style="font-weight: 600; color: #ff9800; font-size: 0.8rem; margin-bottom: 6px;">
                    ⚠️ Allergen Statement:
                  </div>
                  <div style="font-size: 0.85rem; color: #e0e0e0; line-height: 1.5;">
                    ${source.allergenStatement ? esc(source.allergenStatement) : '<span style="color: #888;">None</span>'}
                  </div>
                </div>

                <!-- Cross-Contamination Statement -->
                <div style="
                  background: rgba(156,39,176,0.1);
                  border: 1px solid rgba(156,39,176,0.3);
                  border-radius: 6px;
                  padding: 12px;
                ">
                  <div style="font-weight: 600; color: #ce93d8; font-size: 0.8rem; margin-bottom: 6px;">
                    🏭 Cross-Contamination / Facility:
                  </div>
                  <div style="font-size: 0.85rem; color: #e0e0e0; line-height: 1.5;">
                    ${source.crossContaminationStatement ? esc(source.crossContaminationStatement) : '<span style="color: #888;">None</span>'}
                  </div>
                </div>
              </div>
            </div>
          `;
          })
          .join("")}
      </div>
    `;
      })
      .join("");
  }

  return {
    normalizeIngredientsForComparison,
    areIngredientsSimilar,
    groupSourcesByIngredientSimilarity,
    parseIngredientsToBullets,
    findDifferingIngredients,
    renderGroupedSourcesHtml,
  };
}
