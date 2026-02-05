export function createDishEditorAnalysis({
  ensureAiAssistElements = () => {},
  collectAiTableData = () => [],
  renderAiTable = () => {},
  updateAiPreview = () => {},
  aiAssistSetStatus = () => {},
  getDishNameForAi = () => "",
  supabaseClient = null,
  scanDecisionRequests = new Map(),
  aiAssistState = {},
  error = () => {},
} = {}) {
  const invokeFunction = async (name, body) => {
    if (!supabaseClient?.functions?.invoke) {
      throw new Error("Supabase client not available");
    }
    return supabaseClient.functions.invoke(name, { body });
  };

  const fetchIngredientScanDecision = async (ingredientName, dishName) => {
    const { data, error: invokeError } = await invokeFunction(
      "analyze-ingredient-scan",
      {
        ingredientName,
        dishName,
      },
    );
    if (invokeError) throw invokeError;
    const needsScan = data?.needsScan;
    return {
      needsScan: typeof needsScan === "boolean" ? needsScan : null,
      reasoning: data?.reasoning || "",
    };
  };

  const requestIngredientScanDecision = async (
    rowIdx,
    ingredientName,
    opts = {},
  ) => {
    ensureAiAssistElements();
    const name = (ingredientName || "").trim();
    const data = collectAiTableData();
    const row = data[rowIdx];
    if (!row) return null;
    const emptyResult = { needsScan: null, reasoning: "" };

    if (!name) {
      row.needsScan = undefined;
      row.scanDecisionSource = null;
      row.scanDecisionName = null;
      row.analysisPending = false;
      row.analysisMessage = "";
      renderAiTable(data);
      updateAiPreview();
      return emptyResult;
    }

    const canSkip =
      !opts.force &&
      row.scanDecisionName === name &&
      row.scanDecisionSource === "claude" &&
      typeof row.needsScan === "boolean";
    if (canSkip) return { needsScan: row.needsScan, reasoning: "" };

    const existing = scanDecisionRequests.get(rowIdx);
    if (existing && existing.name === name) {
      return existing.promise;
    }

    row.analysisPending = true;
    row.analysisMessage = `Checking label requirement for "${name}"...`;
    row.userOverriddenScan = false;
    row.appealReviewStatus = null;
    row.appealReviewNotes = null;
    row.issueReported = false;
    renderAiTable(data);
    updateAiPreview();

    const requestId = `scan-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
    const promise = (async () => {
      try {
        const result = await fetchIngredientScanDecision(
          name,
          getDishNameForAi(),
        );
        const refreshed = collectAiTableData();
        const target = refreshed[rowIdx];
        if (!target) return emptyResult;
        if ((target.name || "").trim() !== name) return emptyResult;
        target.analysisPending = false;
        target.analysisMessage = "";
        if (typeof result.needsScan === "boolean") {
          target.needsScan = result.needsScan;
          target.scanDecisionSource = "claude";
          target.scanDecisionName = name;
          target.userOverriddenScan = false;
        } else {
          target.needsScan = undefined;
          target.scanDecisionSource = null;
          target.scanDecisionName = null;
        }
        renderAiTable(refreshed);
        updateAiPreview();
        return result;
      } catch (err) {
        error("Ingredient scan decision failed:", err);
        const refreshed = collectAiTableData();
        const target = refreshed[rowIdx];
        if (target && (target.name || "").trim() === name) {
          target.analysisPending = false;
          target.analysisMessage = "";
          renderAiTable(refreshed);
          updateAiPreview();
        }
        if (!opts.silent) {
          aiAssistSetStatus(
            `Could not determine label requirement for "${name}".`,
            "warn",
          );
        }
        return emptyResult;
      } finally {
        const current = scanDecisionRequests.get(rowIdx);
        if (current && current.requestId === requestId) {
          scanDecisionRequests.delete(rowIdx);
        }
      }
    })();

    scanDecisionRequests.set(rowIdx, { requestId, name, promise });
    return promise;
  };

  const analyzeIngredientRow = async (rowIdx, ingredientName, opts = {}) => {
    ensureAiAssistElements();
    const name = (ingredientName || "").trim();
    if (!name) {
      if (!opts.silent) {
        aiAssistSetStatus("Enter an ingredient name first.", "warn");
      }
      return;
    }
    const data = collectAiTableData();
    if (!data[rowIdx]) return;
    const row = data[rowIdx];

    row.name = name;
    row.needsScan = undefined;
    row.userOverriddenScan = false;
    row.appealReviewStatus = null;
    row.appealReviewNotes = null;
    row.issueReported = false;
    row.analysisPending = true;
    row.analysisMessage = opts.analysisMessage || "Analyzing ingredient…";
    row.aiDetectionCompleted = false;
    row.confirmed = false;
    row.requiresApply = false;
    row.scanDecisionName = name;

    renderAiTable(data);

    try {
      if (!opts.silent) {
        aiAssistSetStatus(`Analyzing "${name}"...`, "info");
      }

      const inFlightScan = scanDecisionRequests.get(rowIdx);
      const scanPromise =
        inFlightScan && inFlightScan.name === name
          ? inFlightScan.promise
          : fetchIngredientScanDecision(name, getDishNameForAi());
      const allergenPromise = (async () => {
        const { data: analysisData, error: invokeError } = await invokeFunction(
          "analyze-brand-allergens",
          {
            ingredientText: name,
            analysisMode: "name",
          },
        );
        if (invokeError) throw invokeError;
        return analysisData || {};
      })();

      const [scanResult, allergenResult] = await Promise.allSettled([
        scanPromise,
        allergenPromise,
      ]);

      const refreshed = collectAiTableData();
      const current = refreshed[rowIdx];
      if (!current) return;
      if ((current.name || "").trim() !== name) return;

      current.analysisPending = false;
      current.analysisMessage = "";
      current.confirmed = false;

      let scanDecision = null;
      if (scanResult.status === "fulfilled") {
        const scanValue = scanResult.value;
        scanDecision =
          typeof scanValue === "boolean"
            ? scanValue
            : typeof scanValue?.needsScan === "boolean"
              ? scanValue.needsScan
              : null;
        if (typeof scanDecision === "boolean") {
          current.needsScan = scanDecision;
          current.scanDecisionSource = "claude";
          current.scanDecisionName = name;
          current.userOverriddenScan = false;
        } else {
          current.needsScan = undefined;
          current.scanDecisionSource = null;
          current.scanDecisionName = null;
        }
      } else {
        error("Scan decision error:", scanResult.reason || scanResult);
      }

      const clearAiDetections = () => {
        current.aiDetectedAllergens = [];
        current.aiDetectedDiets = [];
        current.aiDetectedCrossContamination = [];
        current.aiDetectedCrossContaminationDiets = [];
        current.aiDetectionCompleted = false;
      };

      let appliedAllergens = false;
      if (allergenResult.status === "fulfilled") {
        const analysisData = allergenResult.value || {};
        const aiAllergens = Array.isArray(analysisData.allergens)
          ? [...analysisData.allergens]
          : [];
        const aiDiets = Array.isArray(analysisData.diets)
          ? [...analysisData.diets]
          : [];
        current.allergens = aiAllergens.slice();
        current.diets = aiDiets.slice();
        current.crossContamination = [];
        current.crossContaminationDiets = [];
        current.aiDetectedAllergens = aiAllergens.slice();
        current.aiDetectedDiets = aiDiets.slice();
        current.aiDetectedCrossContamination = [];
        current.aiDetectedCrossContaminationDiets = [];
        current.aiDetectionCompleted = true;
        appliedAllergens = true;
      } else if (allergenResult.status === "rejected") {
        error("AI analysis error:", allergenResult.reason || allergenResult);
        clearAiDetections();
      }

      renderAiTable(refreshed);

      if (!opts.silent) {
        if (scanDecision === true) {
          aiAssistSetStatus(
            appliedAllergens
              ? `Label required for "${name}". AI prefill added.`
              : `Label required for "${name}".`,
            "warn",
          );
        } else if (scanDecision === false) {
          aiAssistSetStatus(
            appliedAllergens
              ? `Label optional for "${name}". Allergens/diets updated.`
              : `Label optional for "${name}", but allergens/diets could not be updated.`,
            appliedAllergens ? "success" : "warn",
          );
        } else if (appliedAllergens) {
          aiAssistSetStatus(
            `Updated allergens/diets for "${name}".`,
            "success",
          );
        } else {
          aiAssistSetStatus(
            `Could not complete ingredient analysis for "${name}".`,
            "warn",
          );
        }
      }

      aiAssistState.savedToDish = false;
    } catch (err) {
      error("Failed to analyze ingredient name:", err);
      const errored = collectAiTableData();
      if (errored[rowIdx]) {
        errored[rowIdx].analysisPending = false;
        errored[rowIdx].analysisMessage = "";
        renderAiTable(errored);
      }
      if (!opts.silent) {
        aiAssistSetStatus(
          `Could not complete ingredient analysis for "${name}".`,
          "warn",
        );
      }
    }
  };

  const shouldAutoAnalyzeRow = (row) => {
    if (!row || !row.name) return false;
    if (row.analysisPending) return false;
    if (row.aiDetectionCompleted === true && typeof row.needsScan === "boolean") {
      return false;
    }
    return true;
  };

  const autoAnalyzeIngredientRows = async () => {
    const data = collectAiTableData();
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (!shouldAutoAnalyzeRow(row)) continue;
      await analyzeIngredientRow(i, row.name, { silent: true });
    }
  };

  return {
    requestIngredientScanDecision,
    analyzeIngredientRow,
    autoAnalyzeIngredientRows,
  };
}
