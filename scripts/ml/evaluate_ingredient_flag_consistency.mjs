#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

function asText(value) {
  return String(value ?? "").trim();
}

function canonicalToken(value) {
  return asText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseArgs(argv) {
  const options = {
    baseUrl:
      process.env.INGREDIENT_FLAG_EVAL_URL ||
      "http://localhost:3000/api/ingredient-allergen-analysis",
    casesPath: "ml/data/evals/ingredient_transcript_cases.jsonl",
    runsPerCase: 3,
    delayMs: 120,
    timeoutMs: 30000,
    outDir: "ml/data/evals/reports",
    debug: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === "--base-url" && next) {
      options.baseUrl = next;
      i += 1;
    } else if (key === "--cases" && next) {
      options.casesPath = next;
      i += 1;
    } else if (key === "--runs" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.runsPerCase = Math.trunc(parsed);
      }
      i += 1;
    } else if (key === "--delay-ms" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        options.delayMs = Math.trunc(parsed);
      }
      i += 1;
    } else if (key === "--timeout-ms" && next) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.timeoutMs = Math.trunc(parsed);
      }
      i += 1;
    } else if (key === "--out-dir" && next) {
      options.outDir = next;
      i += 1;
    } else if (key === "--no-debug") {
      options.debug = false;
    }
  }

  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readCases(jsonlPath) {
  const raw = await fs.readFile(jsonlPath, "utf8");
  const rows = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  return rows.map((line, index) => {
    const parsed = JSON.parse(line);
    const id = asText(parsed?.id) || `case_${index + 1}`;
    const transcriptLines = (Array.isArray(parsed?.transcriptLines)
      ? parsed.transcriptLines
      : []
    )
      .map((value) => asText(value))
      .filter(Boolean);

    if (!transcriptLines.length) {
      throw new Error(`Case ${id} has no transcript lines.`);
    }

    const expectedDeclarationAllergens = (Array.isArray(parsed?.expectedDeclarationAllergens)
      ? parsed.expectedDeclarationAllergens
      : []
    )
      .map((value) => asText(value))
      .filter(Boolean);

    return {
      id,
      notes: asText(parsed?.notes),
      transcriptLines,
      expectedDeclarationAllergens,
    };
  });
}

function normalizeFlag(flag) {
  const ingredient = asText(flag?.ingredient).toLowerCase();
  const riskRaw = asText(flag?.risk_type).toLowerCase();
  const riskType = riskRaw.includes("cross")
    ? "cross-contamination"
    : "contained";

  const allergens = Array.from(
    new Set(
      (Array.isArray(flag?.allergens) ? flag.allergens : [])
        .map((value) => asText(value).toLowerCase())
        .filter(Boolean),
    ),
  ).sort();

  const diets = Array.from(
    new Set(
      (Array.isArray(flag?.diets) ? flag.diets : [])
        .map((value) => asText(value).toLowerCase())
        .filter(Boolean),
    ),
  ).sort();

  const wordIndices = Array.from(
    new Set(
      (Array.isArray(flag?.word_indices) ? flag.word_indices : [flag?.word_indices])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 0)
        .map((value) => Math.trunc(value)),
    ),
  ).sort((a, b) => a - b);

  return {
    ingredient,
    risk_type: riskType,
    allergens,
    diets,
    word_indices: wordIndices,
  };
}

function normalizeFlags(flags) {
  const rows = (Array.isArray(flags) ? flags : [])
    .map((flag) => normalizeFlag(flag))
    .filter(
      (flag) =>
        flag.ingredient ||
        flag.word_indices.length ||
        flag.allergens.length ||
        flag.diets.length,
    );

  rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return rows;
}

function signatureExact(flags) {
  return JSON.stringify(flags);
}

function signatureSemantic(flags) {
  const projected = flags
    .map((flag) => ({
      ingredient: flag.ingredient,
      risk_type: flag.risk_type,
      allergens: flag.allergens,
      diets: flag.diets,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify(projected);
}

function signatureDiet(flags) {
  const projected = flags
    .map((flag) => ({
      ingredient: flag.ingredient,
      allergens: flag.allergens,
      risk_type: flag.risk_type,
      diets: flag.diets,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify(projected);
}

function majorityScore(signatures) {
  const counts = new Map();
  signatures.forEach((signature) => {
    counts.set(signature, (counts.get(signature) || 0) + 1);
  });

  let majorityCount = 0;
  counts.forEach((count) => {
    if (count > majorityCount) {
      majorityCount = count;
    }
  });

  return {
    uniqueCount: counts.size,
    majorityCount,
  };
}

async function callAnalysis({
  baseUrl,
  transcriptLines,
  timeoutMs,
  debug,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transcriptLines,
        analysisOptions: {
          disableCache: true,
          debug,
        },
      }),
      signal: controller.signal,
    });

    const bodyText = await response.text();
    let payload = null;
    try {
      payload = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      payload = null;
    }

    if (!response.ok || payload?.success === false) {
      const errorText =
        asText(payload?.error) ||
        asText(payload?.message) ||
        `Request failed (${response.status}).`;
      throw new Error(errorText);
    }

    return {
      flags: normalizeFlags(payload?.flags),
      debug: payload?.debug && typeof payload.debug === "object" ? payload.debug : null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function summarizeCase(caseDefinition, runs) {
  const successfulRuns = runs.filter((run) => run.success);
  const exactSignatures = successfulRuns.map((run) => signatureExact(run.flags));
  const semanticSignatures = successfulRuns.map((run) => signatureSemantic(run.flags));
  const dietSignatures = successfulRuns.map((run) => signatureDiet(run.flags));

  const exact = majorityScore(exactSignatures);
  const semantic = majorityScore(semanticSignatures);
  const diet = majorityScore(dietSignatures);

  const expectedDeclarationTokens = caseDefinition.expectedDeclarationAllergens
    .map((value) => canonicalToken(value))
    .filter(Boolean);

  let declarationChecks = 0;
  let declarationHits = 0;
  let declarationEmptyRuns = 0;

  successfulRuns.forEach((run) => {
    const present = new Set();
    run.flags.forEach((flag) => {
      flag.allergens.forEach((allergen) => {
        present.add(canonicalToken(allergen));
      });
    });

    if (expectedDeclarationTokens.length && run.flags.length === 0) {
      declarationEmptyRuns += 1;
    }

    expectedDeclarationTokens.forEach((token) => {
      declarationChecks += 1;
      if (present.has(token)) {
        declarationHits += 1;
      }
    });
  });

  return {
    id: caseDefinition.id,
    notes: caseDefinition.notes,
    runsRequested: runs.length,
    successes: successfulRuns.length,
    errors: runs
      .filter((run) => !run.success)
      .map((run) => ({ run: run.index, error: run.error })),
    expectedDeclarationAllergens: caseDefinition.expectedDeclarationAllergens,
    declarationChecks,
    declarationHits,
    declarationEmptyRuns,
    exactUniqueCount: exact.uniqueCount,
    semanticUniqueCount: semantic.uniqueCount,
    dietUniqueCount: diet.uniqueCount,
    exactStability: successfulRuns.length
      ? Number((exact.majorityCount / successfulRuns.length).toFixed(4))
      : 0,
    semanticStability: successfulRuns.length
      ? Number((semantic.majorityCount / successfulRuns.length).toFixed(4))
      : 0,
    dietDriftDetected: diet.uniqueCount > 1,
    runSummaries: runs.map((run) => ({
      run: run.index,
      success: run.success,
      error: run.error,
      debug: run.debug,
      flags: run.flags,
    })),
  };
}

function toMarkdownReport({ summary, cases, options }) {
  const lines = [];
  lines.push("# Ingredient Flag Consistency Report");
  lines.push("");
  lines.push(`- Generated at: ${summary.finishedAt}`);
  lines.push(`- Endpoint: ${options.baseUrl}`);
  lines.push(`- Case file: ${options.casesPath}`);
  lines.push(`- Runs per case: ${options.runsPerCase}`);
  lines.push("");
  lines.push("## Aggregate Metrics");
  lines.push("");
  lines.push(`- Cases: ${summary.caseCount}`);
  lines.push(`- Total runs: ${summary.totalRuns}`);
  lines.push(`- Successful runs: ${summary.successfulRuns}`);
  lines.push(`- Failed runs: ${summary.failedRuns}`);
  lines.push(`- Exact stability (majority-weighted): ${summary.exactStabilityWeighted}`);
  lines.push(`- Semantic stability (majority-weighted): ${summary.semanticStabilityWeighted}`);
  lines.push(`- Declaration allergen coverage rate: ${summary.declarationCoverageRate}`);
  lines.push(`- Declaration empty-output runs: ${summary.declarationEmptyRuns}`);
  lines.push(`- Diet drift rate: ${summary.dietDriftRate}`);
  lines.push("");

  lines.push("## Acceptance Checks");
  lines.push("");
  lines.push(`- Semantic stability >= 0.95: ${summary.acceptance.semanticStabilityPass ? "PASS" : "FAIL"}`);
  lines.push(`- Declaration coverage >= 0.99: ${summary.acceptance.declarationCoveragePass ? "PASS" : "FAIL"}`);
  lines.push(`- Empty output on declaration runs == 0: ${summary.acceptance.declarationNonEmptyPass ? "PASS" : "FAIL"}`);
  lines.push(`- Diet drift reduction target: ${summary.acceptance.dietDriftReductionNote}`);
  lines.push("");

  lines.push("## Case Breakdown");
  lines.push("");
  lines.push("| Case | Success | Exact U | Semantic U | Exact Stability | Semantic Stability | Declaration Coverage | Diet Drift |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");

  cases.forEach((caseSummary) => {
    const declarationCoverage = caseSummary.declarationChecks
      ? (caseSummary.declarationHits / caseSummary.declarationChecks).toFixed(4)
      : "n/a";
    lines.push(
      `| ${caseSummary.id} | ${caseSummary.successes}/${caseSummary.runsRequested} | ${caseSummary.exactUniqueCount} | ${caseSummary.semanticUniqueCount} | ${caseSummary.exactStability.toFixed(4)} | ${caseSummary.semanticStability.toFixed(4)} | ${declarationCoverage} | ${caseSummary.dietDriftDetected ? "yes" : "no"} |`,
    );
  });

  lines.push("");
  lines.push("## Unstable Cases");
  lines.push("");

  const unstable = cases.filter(
    (caseSummary) =>
      caseSummary.semanticUniqueCount > 1 ||
      caseSummary.exactUniqueCount > 1 ||
      caseSummary.dietDriftDetected,
  );

  if (!unstable.length) {
    lines.push("- None");
  } else {
    unstable.forEach((caseSummary) => {
      lines.push(`- ${caseSummary.id}: exactU=${caseSummary.exactUniqueCount}, semanticU=${caseSummary.semanticUniqueCount}, dietU=${caseSummary.dietUniqueCount}`);
    });
  }

  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const caseDefinitions = await readCases(options.casesPath);
  const caseSummaries = [];

  for (const caseDefinition of caseDefinitions) {
    const runs = [];

    for (let runIndex = 1; runIndex <= options.runsPerCase; runIndex += 1) {
      try {
        const result = await callAnalysis({
          baseUrl: options.baseUrl,
          transcriptLines: caseDefinition.transcriptLines,
          timeoutMs: options.timeoutMs,
          debug: options.debug,
        });
        runs.push({
          index: runIndex,
          success: true,
          flags: result.flags,
          debug: result.debug,
          error: "",
        });
      } catch (error) {
        runs.push({
          index: runIndex,
          success: false,
          flags: [],
          debug: null,
          error: asText(error?.message) || "Unknown error",
        });
      }

      if (runIndex < options.runsPerCase && options.delayMs > 0) {
        await sleep(options.delayMs);
      }
    }

    const summary = summarizeCase(caseDefinition, runs);
    caseSummaries.push(summary);

    console.log(
      `${caseDefinition.id}: successes=${summary.successes}/${summary.runsRequested}, exactU=${summary.exactUniqueCount}, semanticU=${summary.semanticUniqueCount}, dietU=${summary.dietUniqueCount}`,
    );
  }

  const totalRuns = caseSummaries.reduce(
    (sum, caseSummary) => sum + caseSummary.runsRequested,
    0,
  );
  const successfulRuns = caseSummaries.reduce(
    (sum, caseSummary) => sum + caseSummary.successes,
    0,
  );

  const exactMajorityTotal = caseSummaries.reduce((sum, caseSummary) => {
    return sum + Math.round(caseSummary.exactStability * caseSummary.successes);
  }, 0);
  const semanticMajorityTotal = caseSummaries.reduce((sum, caseSummary) => {
    return sum + Math.round(caseSummary.semanticStability * caseSummary.successes);
  }, 0);

  const declarationChecks = caseSummaries.reduce(
    (sum, caseSummary) => sum + caseSummary.declarationChecks,
    0,
  );
  const declarationHits = caseSummaries.reduce(
    (sum, caseSummary) => sum + caseSummary.declarationHits,
    0,
  );
  const declarationEmptyRuns = caseSummaries.reduce(
    (sum, caseSummary) => sum + caseSummary.declarationEmptyRuns,
    0,
  );

  const dietDriftCases = caseSummaries.filter(
    (caseSummary) => caseSummary.dietDriftDetected,
  ).length;

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    caseCount: caseSummaries.length,
    totalRuns,
    successfulRuns,
    failedRuns: totalRuns - successfulRuns,
    exactStabilityWeighted: successfulRuns
      ? Number((exactMajorityTotal / successfulRuns).toFixed(4))
      : 0,
    semanticStabilityWeighted: successfulRuns
      ? Number((semanticMajorityTotal / successfulRuns).toFixed(4))
      : 0,
    declarationCoverageRate: declarationChecks
      ? Number((declarationHits / declarationChecks).toFixed(4))
      : null,
    declarationChecks,
    declarationHits,
    declarationEmptyRuns,
    dietDriftRate: caseSummaries.length
      ? Number((dietDriftCases / caseSummaries.length).toFixed(4))
      : 0,
    dietDriftCases,
    acceptance: {
      semanticStabilityPass: successfulRuns
        ? semanticMajorityTotal / successfulRuns >= 0.95
        : false,
      declarationCoveragePass: declarationChecks
        ? declarationHits / declarationChecks >= 0.99
        : true,
      declarationNonEmptyPass: declarationEmptyRuns === 0,
      dietDriftReductionNote:
        "Requires baseline comparison from a prior run; compare dietDriftRate against baseline artifact.",
    },
  };

  const reportPayload = {
    summary,
    options,
    cases: caseSummaries,
  };

  await fs.mkdir(options.outDir, { recursive: true });

  const stamp = summary.finishedAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(
    options.outDir,
    `ingredient-flag-consistency-${stamp}.json`,
  );
  const mdPath = path.join(
    options.outDir,
    `ingredient-flag-consistency-${stamp}.md`,
  );

  await fs.writeFile(jsonPath, `${JSON.stringify(reportPayload, null, 2)}\n`, "utf8");
  await fs.writeFile(
    mdPath,
    `${toMarkdownReport({ summary, cases: caseSummaries, options })}\n`,
    "utf8",
  );

  console.log("\nSummary:");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWrote JSON report: ${jsonPath}`);
  console.log(`Wrote Markdown report: ${mdPath}`);
}

main().catch((error) => {
  console.error(asText(error?.stack) || asText(error?.message) || "Failed to run evaluator.");
  process.exitCode = 1;
});
