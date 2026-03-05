#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { readFile, writeFile } from "node:fs/promises";

import {
  closeBenchmarkResources,
  executeBenchmarkCase,
  planModelsForCorpus,
  sampleCorpusCases,
  scoreBenchmarkCase,
  STAGE_CONFIG,
} from "./benchmarkSuite.mjs";
import {
  asText,
  ensureDir,
  loadLocalEnv,
  nowRunId,
  parseArgs,
  readBooleanArg,
  readStringArg,
  resolveOutDir,
  writeJson,
  writeJsonLines,
} from "./benchmarkShared.mjs";

function mean(values) {
  const safe = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!safe.length) return 0;
  return safe.reduce((sum, value) => sum + value, 0) / safe.length;
}

function percentile(values, fraction) {
  const safe = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (!safe.length) return 0;
  const index = Math.min(safe.length - 1, Math.max(0, Math.ceil(safe.length * fraction) - 1));
  return safe[index];
}

function groupBy(items, keyFn) {
  const output = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const key = keyFn(item);
    if (!output.has(key)) output.set(key, []);
    output.get(key).push(item);
  });
  return output;
}

function requireFile(filePath) {
  const safe = asText(filePath);
  if (!safe) {
    throw new Error("Missing required --corpus=/abs/path/to/corpus.json");
  }
  return safe;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function loadPilotSurvivors(summaryDoc) {
  const survivors = new Map();
  (Array.isArray(summaryDoc?.promptSummaries) ? summaryDoc.promptSummaries : []).forEach((entry) => {
    const promptClass = asText(entry?.promptClass);
    const models = (Array.isArray(entry?.models) ? entry.models : [])
      .filter((modelEntry) => modelEntry.provider === "openai" && modelEntry.pass)
      .map((modelEntry) => asText(modelEntry.model))
      .filter(Boolean);
    if (promptClass) {
      survivors.set(promptClass, models);
    }
  });
  return survivors;
}

function buildExecutionPlan(corpus, env, survivors) {
  const promptPlans = planModelsForCorpus(corpus, env);
  return promptPlans
    .map((entry) => {
      const openaiModels = survivors
        ? survivors.get(entry.promptClass) || []
        : entry.openaiCandidates;
      return {
      promptClass: entry.promptClass,
      anthropicBaseline: entry.anthropicBaseline,
      openaiModels,
      };
    })
    .filter((entry) => !survivors || entry.openaiModels.length > 0);
}

function scoreDeltaThreshold(promptClass) {
  if (
    promptClass === "ingredientAllergenAnalysis" ||
    promptClass === "ingredientNameAnalysis" ||
    promptClass === "dishEditorAnalysis"
  ) {
    return 0.01;
  }
  return 0.02;
}

function latencyPassThreshold(baselineP95) {
  return Number(baselineP95 || 0) * 1.25 + 300;
}

function chooseWinner(promptSummary) {
  const passing = (Array.isArray(promptSummary?.models) ? promptSummary.models : [])
    .filter((entry) => entry.provider === "openai" && entry.pass);
  if (!passing.length) return null;
  return passing.sort((left, right) => {
    const costDelta = Number(left.meanCostUsd || 0) - Number(right.meanCostUsd || 0);
    if (costDelta !== 0) return costDelta;
    return Number(left.p95LatencyMs || 0) - Number(right.p95LatencyMs || 0);
  })[0];
}

function buildMarkdownSummary(runSummary) {
  const lines = [
    `# AI Benchmark Summary`,
    ``,
    `- Run ID: ${runSummary.runId}`,
    `- Stage: ${runSummary.stage}`,
    `- Corpus: ${runSummary.corpusPath}`,
    `- Sampled cases: ${runSummary.sampledCaseCount}`,
    ``,
    `| Prompt | Claude Baseline | OpenAI Candidates | Winner | Score Delta | p95 Delta (ms) | Mean Cost Delta ($) | Notes |`,
    `| --- | --- | --- | --- | ---: | ---: | ---: | --- |`,
  ];

  (Array.isArray(runSummary.promptSummaries) ? runSummary.promptSummaries : []).forEach((entry) => {
    const baseline = entry.baseline || {};
    const openaiModels = (Array.isArray(entry.models) ? entry.models : [])
      .filter((modelEntry) => modelEntry.provider === "openai");
    const winner = entry.winner || null;
    const winnerDelta = winner
      ? (Number(winner.meanPrimaryScore || 0) - Number(baseline.meanPrimaryScore || 0)).toFixed(4)
      : "n/a";
    const p95Delta = winner
      ? (Number(winner.p95LatencyMs || 0) - Number(baseline.p95LatencyMs || 0)).toFixed(0)
      : "n/a";
    const costDelta = winner
      ? (Number(winner.meanCostUsd || 0) - Number(baseline.meanCostUsd || 0)).toFixed(6)
      : "n/a";
    const notes = winner
      ? winner.pass
        ? "passed"
        : "failed"
      : "no passing OpenAI model";

    lines.push(
      `| ${entry.promptClass} | ${baseline.model || "n/a"} | ${openaiModels.map((modelEntry) => modelEntry.model).join(", ") || "n/a"} | ${winner?.model || "none"} | ${winnerDelta} | ${p95Delta} | ${costDelta} | ${notes} |`,
    );
  });

  return `${lines.join("\n")}\n`;
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const corpusPath = requireFile(readStringArg(args, "corpus"));
  const stage = readStringArg(args, "stage", "pilot");
  const stageConfig = STAGE_CONFIG[stage] || STAGE_CONFIG.pilot;
  const runId = readStringArg(args, "run-id", nowRunId(`ai-bench-${stage}`));
  const outDir = resolveOutDir(runId);
  const sampleRatioOverride = Number(readStringArg(args, "sample-ratio", ""));
  const sampleRatio = Number.isFinite(sampleRatioOverride) && sampleRatioOverride > 0
    ? sampleRatioOverride
    : stageConfig.sampleRatio;
  const repetitions = Math.max(1, Number(readStringArg(args, "repetitions", stageConfig.repetitions)) || 1);
  const skipAnthropic = readBooleanArg(args, "skip-anthropic", false);
  const pilotSummaryPath = readStringArg(args, "pilot-summary");
  const allowOpenAiFallback = readBooleanArg(args, "allow-openai-fallback", !pilotSummaryPath);
  const pilotSummary = pilotSummaryPath ? await readJson(pilotSummaryPath) : null;
  const survivors = pilotSummary ? loadPilotSurvivors(pilotSummary) : null;
  const baseCorpus = await readJson(corpusPath);
  const sampledCorpus = sampleCorpusCases(baseCorpus, sampleRatio);
  const executionPlan = buildExecutionPlan(sampledCorpus, process.env, survivors);

  await ensureDir(outDir);
  const rawRecords = [];
  try {
    for (const promptPlan of executionPlan) {
      const promptCases = (Array.isArray(sampledCorpus?.cases) ? sampledCorpus.cases : [])
        .filter((caseDoc) => caseDoc.promptClass === promptPlan.promptClass);

      const planItems = [];
      if (!skipAnthropic) {
        planItems.push({
          provider: "anthropic",
          model: promptPlan.anthropicBaseline,
        });
      }
      promptPlan.openaiModels.forEach((model) => {
        planItems.push({
          provider: "openai",
          model,
        });
      });

      if (!planItems.length || !promptCases.length) {
        continue;
      }

      process.stdout.write(
        `Running ${promptPlan.promptClass}: ${planItems.map((item) => `${item.provider}:${item.model}`).join(", ")} on ${promptCases.length} case(s) x${repetitions}\n`,
      );

      for (const planItem of planItems) {
        for (const caseDoc of promptCases) {
          for (let repetition = 1; repetition <= repetitions; repetition += 1) {
            try {
              const output = await executeBenchmarkCase(caseDoc, {
                provider: planItem.provider,
                model: planItem.model,
                env: process.env,
              });
              rawRecords.push({
                ok: true,
                promptClass: caseDoc.promptClass,
                caseId: caseDoc.id,
                provider: planItem.provider,
                model: planItem.model,
                repetition,
                output,
              });
            } catch (error) {
              rawRecords.push({
                ok: false,
                promptClass: caseDoc.promptClass,
                caseId: caseDoc.id,
                provider: planItem.provider,
                model: planItem.model,
                repetition,
                error: asText(error?.message) || "Unknown error",
              });
            }
          }
        }
      }
    }

    let recordsByPromptModel = groupBy(
      rawRecords,
      (record) => `${record.promptClass}::${record.provider}::${record.model}`,
    );

    if (allowOpenAiFallback) {
      for (const promptPlan of executionPlan) {
        const promptCases = (Array.isArray(sampledCorpus?.cases) ? sampledCorpus.cases : [])
          .filter((caseDoc) => caseDoc.promptClass === promptPlan.promptClass);
        const baselineKey = `${promptPlan.promptClass}::anthropic::${promptPlan.anthropicBaseline}`;
        const baselineRecords = recordsByPromptModel.get(baselineKey) || [];
        const baselineScores = baselineRecords
          .filter((record) => record.ok)
          .map((record) => {
            const caseDoc = promptCases.find((candidate) => candidate.id === record.caseId);
            return scoreBenchmarkCase(caseDoc, record.output, caseDoc?.baseline || null);
          });
        const baselinePrimary = mean(baselineScores.map((entry) => entry.primaryScore));

        const openAiPromptRecords = Array.from(recordsByPromptModel.entries())
          .filter(([key]) => key.startsWith(`${promptPlan.promptClass}::openai::`))
          .flatMap(([, rows]) => rows);

        const groupedByModel = groupBy(openAiPromptRecords, (record) => record.model);
        const hasPass = Array.from(groupedByModel.entries()).some(([, rows]) => {
          const scores = rows
            .filter((record) => record.ok)
            .map((record) => {
              const caseDoc = promptCases.find((candidate) => candidate.id === record.caseId);
              const baselineRecord = baselineRecords.find((candidate) => candidate.caseId === record.caseId && candidate.ok);
              return scoreBenchmarkCase(caseDoc, record.output, baselineRecord?.output || caseDoc?.baseline || null);
            });
          const modelPrimary = mean(scores.map((entry) => entry.primaryScore));
          return baselinePrimary - modelPrimary <= scoreDeltaThreshold(promptPlan.promptClass);
        });

        if (!hasPass) {
          for (const caseDoc of promptCases) {
            for (let repetition = 1; repetition <= repetitions; repetition += 1) {
              try {
                const output = await executeBenchmarkCase(caseDoc, {
                  provider: "openai",
                  model: "gpt-5",
                  env: process.env,
                });
                rawRecords.push({
                  ok: true,
                  promptClass: caseDoc.promptClass,
                  caseId: caseDoc.id,
                  provider: "openai",
                  model: "gpt-5",
                  repetition,
                  output,
                });
              } catch (error) {
                rawRecords.push({
                  ok: false,
                  promptClass: caseDoc.promptClass,
                  caseId: caseDoc.id,
                  provider: "openai",
                  model: "gpt-5",
                  repetition,
                  error: asText(error?.message) || "Unknown error",
                });
              }
            }
          }
        }
      }
      recordsByPromptModel = groupBy(
        rawRecords,
        (record) => `${record.promptClass}::${record.provider}::${record.model}`,
      );
    }

    const promptCaseMap = new Map((Array.isArray(sampledCorpus?.cases) ? sampledCorpus.cases : []).map((caseDoc) => [caseDoc.id, caseDoc]));
    const promptSummaries = [];

    for (const promptPlan of executionPlan) {
      const promptCases = (Array.isArray(sampledCorpus?.cases) ? sampledCorpus.cases : [])
        .filter((caseDoc) => caseDoc.promptClass === promptPlan.promptClass);
      const baselineKey = `${promptPlan.promptClass}::anthropic::${promptPlan.anthropicBaseline}`;
      const baselineRecords = (recordsByPromptModel.get(baselineKey) || []).filter((record) => record.ok);
      const fallbackBaselineByCase = new Map(
        promptCases
          .filter((caseDoc) => caseDoc?.baseline?.provider === "anthropic")
          .map((caseDoc) => [caseDoc.id, caseDoc.baseline]),
      );
      const baselineByCase = new Map();
      baselineRecords.forEach((record) => {
        if (!baselineByCase.has(record.caseId)) {
          baselineByCase.set(record.caseId, record.output);
        }
      });
      fallbackBaselineByCase.forEach((value, key) => {
        if (!baselineByCase.has(key)) baselineByCase.set(key, value);
      });

      const baselineScores = baselineRecords.map((record) => {
        const caseDoc = promptCaseMap.get(record.caseId);
        return scoreBenchmarkCase(caseDoc, record.output, caseDoc?.baseline || null);
      });
      const baselineSummary = {
        provider: "anthropic",
        model: promptPlan.anthropicBaseline,
        caseCount: promptCases.length,
        meanPrimaryScore: mean(baselineScores.map((entry) => entry.primaryScore)),
        p50LatencyMs: percentile(baselineRecords.map((record) => record.output?.latencyMs), 0.5),
        p95LatencyMs: percentile(baselineRecords.map((record) => record.output?.latencyMs), 0.95),
        meanCostUsd: mean(baselineRecords.map((record) => record.output?.estimatedCostUsd)),
        allergenFalseNegatives: baselineScores.reduce(
          (sum, entry) => sum + Number(entry?.allergenFalseNegatives || 0),
          0,
        ),
      };

      const modelSummaries = [];
      Array.from(recordsByPromptModel.entries())
        .filter(([key]) => key.startsWith(`${promptPlan.promptClass}::`))
        .forEach(([key, rows]) => {
          const [promptClass, provider, model] = key.split("::");
          const successful = rows.filter((record) => record.ok);
          const failed = rows.filter((record) => !record.ok);
          const scores = successful.map((record) => {
            const caseDoc = promptCaseMap.get(record.caseId);
            return scoreBenchmarkCase(caseDoc, record.output, baselineByCase.get(record.caseId) || caseDoc?.baseline || null);
          });
          const summary = {
            promptClass,
            provider,
            model,
            caseCount: promptCases.length,
            runCount: rows.length,
            errorRate: rows.length ? failed.length / rows.length : 1,
            meanPrimaryScore: mean(scores.map((entry) => entry.primaryScore)),
            p50LatencyMs: percentile(successful.map((record) => record.output?.latencyMs), 0.5),
            p95LatencyMs: percentile(successful.map((record) => record.output?.latencyMs), 0.95),
            meanCostUsd: mean(successful.map((record) => record.output?.estimatedCostUsd)),
            allergenFalseNegatives: scores.reduce(
              (sum, entry) => sum + Number(entry?.allergenFalseNegatives || 0),
              0,
            ),
            notableFailureCases: failed.slice(0, 5).map((record) => ({
              caseId: record.caseId,
              error: record.error,
            })),
          };

          if (provider === "openai") {
            const scoreDelta = baselineSummary.meanPrimaryScore - summary.meanPrimaryScore;
            const fnDelta = Number(summary.allergenFalseNegatives || 0) - Number(baselineSummary.allergenFalseNegatives || 0);
            const latencyCap = latencyPassThreshold(baselineSummary.p95LatencyMs);
            summary.pass =
              scoreDelta <= scoreDeltaThreshold(promptPlan.promptClass) &&
              summary.p95LatencyMs <= latencyCap &&
              (promptPlan.promptClass === "ingredientAllergenAnalysis" ||
              promptPlan.promptClass === "ingredientNameAnalysis" ||
              promptPlan.promptClass === "dishEditorAnalysis"
                ? fnDelta <= 0
                : true);
            summary.scoreDelta = scoreDelta;
            summary.latencyDeltaMs = Number(summary.p95LatencyMs || 0) - Number(baselineSummary.p95LatencyMs || 0);
            summary.costDeltaUsd = Number(summary.meanCostUsd || 0) - Number(baselineSummary.meanCostUsd || 0);
          } else {
            summary.pass = true;
            summary.scoreDelta = 0;
            summary.latencyDeltaMs = 0;
            summary.costDeltaUsd = 0;
          }

          modelSummaries.push(summary);
        });

      const promptSummary = {
        promptClass: promptPlan.promptClass,
        baseline: baselineSummary,
        models: modelSummaries.sort((left, right) => {
          if (left.provider !== right.provider) return left.provider.localeCompare(right.provider);
          return left.model.localeCompare(right.model);
        }),
      };
      promptSummary.winner = chooseWinner(promptSummary);
      promptSummaries.push(promptSummary);
    }

    const summary = {
      runId,
      stage,
      corpusPath,
      sampledCaseCount: Array.isArray(sampledCorpus?.cases) ? sampledCorpus.cases.length : 0,
      repetitions,
      sampleRatio,
      promptSummaries,
    };

    await writeJsonLines(path.join(outDir, "raw-runs.jsonl"), rawRecords);
    await writeJson(path.join(outDir, "summary.json"), summary);
    await writeJson(path.join(outDir, "sampled-corpus.json"), sampledCorpus);
    await writeJson(path.join(outDir, "execution-plan.json"), executionPlan);
    await writeJson(path.join(outDir, "winning-models.json"), promptSummaries.map((entry) => ({
      promptClass: entry.promptClass,
      winner: entry.winner ? { provider: entry.winner.provider, model: entry.winner.model } : null,
    })));
    await ensureDir(outDir);
    await writeFile(path.join(outDir, "summary.md"), buildMarkdownSummary(summary), "utf8");

    process.stdout.write(`${JSON.stringify({ ok: true, runId, outDir }, null, 2)}\n`);
  } finally {
    await closeBenchmarkResources(null);
  }
}

main().catch((error) => {
  process.stderr.write(`${asText(error?.stack || error?.message || error)}\n`);
  process.exit(1);
});
