#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";

const WORKTREE_ROOT =
  "/Users/mattdavis/.cursor/worktrees/clarivore-main/9J1NT";
const DEFAULT_BASE_URL = "http://127.0.0.1:8081";
const REPORTS_DIR = path.join(
  WORKTREE_ROOT,
  "docs/parity-snapshots/reports",
);
const SNAPSHOTS_DIR = path.join(WORKTREE_ROOT, "docs/parity-snapshots");

const REQUIRED_ENV = [
  "TARGET_ENV",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "DATABASE_URL",
  "QA_ADMIN_EMAIL",
  "QA_ADMIN_PASSWORD",
  "QA_MANAGER_EMAIL",
  "QA_MANAGER_PASSWORD",
  "QA_DINER_EMAIL",
  "QA_DINER_PASSWORD",
  "CAPACITOR_SERVER_URL",
];

const PARITY_ROUTES = [
  "/",
  "/home/",
  "/restaurants/",
  "/favorites/",
  "/dish-search/",
  "/restaurant/",
  "/account/",
  "/my-dishes/",
  "/help-contact/",
  "/report-issue/",
  "/order-feedback/",
  "/manager-dashboard/",
  "/admin-dashboard/",
  "/kitchen-tablet/",
  "/server-tablet/",
];

const LEGACY_REDIRECTS = [
  ["/index.html", "/"],
  ["/home.html", "/home/"],
  ["/restaurants.html", "/restaurants/"],
  ["/favorites.html", "/favorites/"],
  ["/dish-search.html", "/dish-search/"],
  ["/restaurant.html", "/restaurant/"],
  ["/account.html", "/account/"],
  ["/my-dishes.html", "/my-dishes/"],
  ["/help-contact.html", "/help-contact/"],
  ["/report-issue.html", "/report-issue/"],
  ["/order-feedback.html", "/order-feedback/"],
  ["/manager-dashboard.html", "/manager-dashboard/"],
  ["/admin-dashboard.html", "/admin-dashboard/"],
  ["/kitchen-tablet.html", "/kitchen-tablet/"],
  ["/server-tablet.html", "/server-tablet/"],
];

const ABSENT_PATHS = [
  "app/restaurant/runtime",
  "app/lib/restaurantRuntime",
  "app/lib/pageUiRuntime.js",
  "app/lib/pageEditorHydrationRuntime.js",
  "app/lib/hydrationRuntime.js",
  "app/lib/bootHydrationRuntime.js",
  "app/lib/pageCoreRuntime.js",
  "app/lib/pageEditorHydrationOptionsRuntime.js",
  "app/lib/pageOffsetRuntime.js",
  "app/lib/pageRouterRuntime.js",
  "app/lib/pageServicesRuntime.js",
  "app/lib/pageUiOptionsRuntime.js",
  "app/lib/pageUtilsRuntime.js",
  "app/lib/editorShellMarkup.js",
  "app/lib/reportShellMarkup.js",
  "app/lib/restaurantShellMarkup.js",
  "app/lib/restaurantReportPageRuntime.js",
  "app/restaurant/components/RestaurantCoreDom.js",
  "app/restaurant/components/RestaurantShellTemplate.js",
  "app/restaurant/components/RestaurantEditorShellTemplate.js",
  "app/restaurant/components/RestaurantReportShellTemplate.js",
];

const FORBIDDEN_IDENTIFIERS = [
  "createRestaurantRuntimeCore",
  "createRestaurantPageUiBundle",
  "createRestaurantEditorHydrationBundle",
  "createRestaurantRuntimeBrowserServices",
  "restaurantPageRuntime",
  "runtimeEnvironment",
  "pageUiRuntime",
  "pageEditorHydrationRuntime",
  "bootHydrationRuntime",
  "restaurantRuntime",
  "editorShellMarkup",
  "restaurantShellMarkup",
  "reportShellMarkup",
  "RestaurantCoreDom",
  "RestaurantShellTemplate",
  "RestaurantEditorShellTemplate",
  "RestaurantReportShellTemplate",
];

const APP_ROUTER_PAGE_FILES = [
  "app/page.js",
  "app/home/page.js",
  "app/restaurants/page.js",
  "app/favorites/page.js",
  "app/dish-search/page.js",
  "app/restaurant/page.js",
  "app/account/page.js",
  "app/my-dishes/page.js",
  "app/help-contact/page.js",
  "app/report-issue/page.js",
  "app/order-feedback/page.js",
  "app/manager-dashboard/page.js",
  "app/admin-dashboard/page.js",
  "app/kitchen-tablet/page.js",
  "app/server-tablet/page.js",
];

const ALLOWED_CAP_DELTA_PREFIXES = [
  "ios/App/App/public/",
  "ios/App/App/capacitor.config.json",
  "ios/App/App/config.xml",
];

const state = {
  startedAt: new Date().toISOString(),
  runId: process.env.VERIFY_RUN_ID || makeRunId(),
  baseUrl: process.env.VERIFY_BASE_URL || DEFAULT_BASE_URL,
  report: {
    title: "Next Transition Verification",
    stages: [],
    summary: {},
  },
  baselineGitPaths: new Set(),
  stageFailed: false,
  stageFailure: null,
  preview: null,
  createdRestaurant: null,
  managerInviteToken: "",
  inviteUrl: "",
  managerUserId: "",
  tempImagePath: "",
  qa: {},
  signalsInstalled: false,
  checks: {
    routeChecks: [],
    legacyChecks: [],
    apiChecks: [],
  },
};

const testData = {
  restaurantName: `Next Transition QA ${state.runId}`,
  dishName: `qa-dish-${state.runId}`,
  managerChatMessage: `qa-manager-chat-${state.runId}`,
  managerOrderNote: `qa-manager-order-${state.runId}`,
  dinerOrderNote: `qa-diner-order-${state.runId}`,
};

await main();

async function main() {
  installSignalHandlers();

  try {
    await stage("Environment Validation", async () => {
      validateEnvironment();
      const gitStatus = runCommand("git", ["status", "--porcelain=v1", "-uall"]);
      state.baselineGitPaths = extractPathsFromPorcelain(gitStatus.stdout);
      state.report.summary.baselineGitPathCount = state.baselineGitPaths.size;
      state.qa = {
        adminEmail: process.env.QA_ADMIN_EMAIL,
        managerEmail: process.env.QA_MANAGER_EMAIL,
        dinerEmail: process.env.QA_DINER_EMAIL,
      };
    });

    await stage("Structural Migration Checks", async () => {
      ensureRemovedPathsAbsent();
      ensureForbiddenIdentifiersAbsent();
      ensureAppRouterPagesExist();
      ensureNextConfigCompatibility();
    });

    await stage("Build + Preview Smoke", async () => {
      runCommand("npm", ["run", "build"], { stdio: "pipe" });
      state.preview = await startPreviewServer();
      await waitForServer(state.baseUrl);
      await runRouteSmokeChecks();
      await runLegacyRedirectChecks();
      await runApiContractChecks();
    });

    await stage("Authenticated Browser E2E", async () => {
      await ensurePlaywrightBrowser();
      state.tempImagePath = await createTempImage();
      await runPlaywrightFlows();
      await validateOrderArtifacts();
    });
  } catch (error) {
    state.stageFailed = true;
    state.stageFailure = error;
  } finally {
    await safeStopPreview();

    await stageNoThrow("Deterministic Cleanup", async () => {
      await runCleanup();
      await validateNoResidue();
    });

    if (!state.stageFailed) {
      await stage("Capacitor Copy Verification", async () => {
        runCommand("npm", ["run", "cap:copy"], {
          env: {
            ...process.env,
            CAPACITOR_SERVER_URL: process.env.CAPACITOR_SERVER_URL,
          },
          stdio: "pipe",
        });
        verifyCapacitorOutputs();
      });

      await stage("Git Delta Guard", async () => {
        verifyGitDeltaAfterCapCopy();
      });
    } else {
      recordSkippedStage(
        "Capacitor Copy Verification",
        "Skipped because a prior required stage failed.",
      );
      recordSkippedStage(
        "Git Delta Guard",
        "Skipped because a prior required stage failed.",
      );
    }

    if (state.tempImagePath) {
      try {
        await fsp.unlink(state.tempImagePath);
      } catch {
        // Ignore temporary file cleanup failures.
      }
    }

    const hasFailure =
      state.stageFailed ||
      state.report.stages.some((entry) => entry.status === "failed");

    state.report.summary = {
      ...state.report.summary,
      runId: state.runId,
      baseUrl: state.baseUrl,
      verdict: hasFailure ? "FAIL" : "PASS",
      finishedAt: new Date().toISOString(),
    };

    await writeReports();

    if (hasFailure) {
      console.error("FAIL");
      if (state.stageFailure) {
        console.error(`Failure reason: ${state.stageFailure.message}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log("PASS");
  }
}

function installSignalHandlers() {
  if (state.signalsInstalled) return;
  state.signalsInstalled = true;

  const handleExitSignal = async (signal) => {
    console.error(`Received ${signal}, stopping preview server...`);
    await safeStopPreview();
    process.exit(1);
  };

  process.on("SIGINT", () => {
    handleExitSignal("SIGINT");
  });
  process.on("SIGTERM", () => {
    handleExitSignal("SIGTERM");
  });
}

async function stage(name, fn) {
  const startedAt = new Date().toISOString();
  const entry = {
    name,
    startedAt,
    status: "running",
    details: [],
  };
  state.report.stages.push(entry);

  try {
    await fn(entry);
    entry.status = "passed";
    entry.finishedAt = new Date().toISOString();
  } catch (error) {
    entry.status = "failed";
    entry.error = error.message;
    entry.finishedAt = new Date().toISOString();
    throw error;
  }
}

async function stageNoThrow(name, fn) {
  try {
    await stage(name, fn);
  } catch (error) {
    state.stageFailed = true;
    if (!state.stageFailure) {
      state.stageFailure = error;
    }
  }
}

function recordSkippedStage(name, reason) {
  state.report.stages.push({
    name,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: "skipped",
    reason,
  });
}

function validateEnvironment() {
  const cwd = process.cwd();
  if (cwd !== WORKTREE_ROOT) {
    throw new Error(`Run from ${WORKTREE_ROOT}. Current cwd: ${cwd}`);
  }

  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }

  if (process.env.TARGET_ENV !== "staging") {
    throw new Error(
      `TARGET_ENV must be staging. Received: ${process.env.TARGET_ENV}`,
    );
  }

  const baseUrl = process.env.VERIFY_BASE_URL || DEFAULT_BASE_URL;
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    throw new Error(`VERIFY_BASE_URL must be an absolute URL. Received: ${baseUrl}`);
  }

  for (const binary of ["rg", "psql", "npm", "npx"]) {
    ensureBinaryAvailable(binary);
  }

  state.report.summary.environment = {
    targetEnv: process.env.TARGET_ENV,
    baseUrl,
    worktreeRoot: WORKTREE_ROOT,
  };
}

function ensureBinaryAvailable(binary) {
  const result = spawnSync("which", [binary], {
    cwd: WORKTREE_ROOT,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.error || result.status !== 0 || !result.stdout.trim()) {
    throw new Error(
      `Required binary is not available in PATH: ${binary}`,
    );
  }
}

function ensureRemovedPathsAbsent() {
  for (const relativePath of ABSENT_PATHS) {
    const fullPath = path.join(WORKTREE_ROOT, relativePath);
    if (fs.existsSync(fullPath)) {
      throw new Error(`Deprecated path still exists: ${relativePath}`);
    }
  }
}

function ensureForbiddenIdentifiersAbsent() {
  for (const token of FORBIDDEN_IDENTIFIERS) {
    const result = runCommand(
      "rg",
      [
        "-n",
        "--hidden",
        "--glob",
        "!docs/**",
        "--glob",
        "!public.backup-*/**",
        "--glob",
        "!.next/**",
        "--glob",
        "!node_modules/**",
        "--glob",
        "!scripts/verify-next-transition.mjs",
        token,
        "app",
        "scripts",
        "supabase",
        "prisma",
        "next.config.js",
        "package.json",
      ],
      { allowFailure: true },
    );

    if (result.code === 0 && result.stdout.trim()) {
      throw new Error(
        `Forbidden legacy identifier found (${token}):\n${result.stdout.trim()}`,
      );
    }

    if (result.code !== 0 && result.code !== 1) {
      throw new Error(`rg failed while checking ${token}: ${result.stderr.trim()}`);
    }
  }
}

function ensureAppRouterPagesExist() {
  const missingPages = APP_ROUTER_PAGE_FILES.filter((relativePath) => {
    return !fs.existsSync(path.join(WORKTREE_ROOT, relativePath));
  });

  if (missingPages.length) {
    throw new Error(`Missing expected App Router pages: ${missingPages.join(", ")}`);
  }
}

function ensureNextConfigCompatibility() {
  const nextConfigPath = path.join(WORKTREE_ROOT, "next.config.js");
  const nextConfigText = fs.readFileSync(nextConfigPath, "utf8");

  if (/output\s*:\s*["']export["']/.test(nextConfigText)) {
    throw new Error("next.config.js still contains output: \"export\".");
  }

  for (const [legacyPath, destination] of LEGACY_REDIRECTS) {
    const sourceNeedle = `source: \"${legacyPath}\"`;
    const destinationNeedle = `destination: \"${destination}\"`;
    if (!nextConfigText.includes(sourceNeedle) || !nextConfigText.includes(destinationNeedle)) {
      throw new Error(
        `Missing legacy redirect mapping in next.config.js: ${legacyPath} -> ${destination}`,
      );
    }
  }
}

async function startPreviewServer() {
  const child = spawn("npm", ["run", "preview"], {
    cwd: WORKTREE_ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let logBuffer = "";

  const appendLog = (chunk) => {
    logBuffer += chunk.toString();
    if (logBuffer.length > 12000) {
      logBuffer = logBuffer.slice(-12000);
    }
  };

  child.stdout.on("data", appendLog);
  child.stderr.on("data", appendLog);

  child.on("exit", (code) => {
    if (code !== 0) {
      console.error(`preview server exited with code ${code}`);
      if (logBuffer.trim()) {
        console.error(logBuffer.trim());
      }
    }
  });

  return {
    child,
    getLogs: () => logBuffer,
  };
}

async function waitForServer(baseUrl, timeoutMs = 60_000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/`, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) {
        return;
      }
    } catch {
      // Keep polling.
    }

    await sleep(800);
  }

  const logs = state.preview?.getLogs?.() || "<no logs>";
  throw new Error(`Preview server did not become ready in time.\n${logs}`);
}

async function runRouteSmokeChecks() {
  for (const route of PARITY_ROUTES) {
    const response = await fetch(`${state.baseUrl}${route}`, { redirect: "follow" });
    const body = await response.text();
    const bytes = Buffer.byteLength(body, "utf8");

    state.checks.routeChecks.push({
      route,
      status: response.status,
      bytes,
    });

    if (response.status !== 200) {
      throw new Error(`Route ${route} returned ${response.status} (expected 200).`);
    }
  }
}

async function runLegacyRedirectChecks() {
  for (const [legacyPath, destination] of LEGACY_REDIRECTS) {
    const firstResponse = await fetch(`${state.baseUrl}${legacyPath}`, {
      redirect: "manual",
    });

    const location = firstResponse.headers.get("location") || "";
    const finalResponse = await fetch(`${state.baseUrl}${legacyPath}`, {
      redirect: "follow",
    });

    state.checks.legacyChecks.push({
      legacyPath,
      firstStatus: firstResponse.status,
      location,
      finalStatus: finalResponse.status,
      expectedDestination: destination,
    });

    if (firstResponse.status !== 307 && firstResponse.status !== 308) {
      throw new Error(
        `Legacy path ${legacyPath} returned ${firstResponse.status} instead of redirect status.`,
      );
    }

    if (!location.startsWith(destination)) {
      throw new Error(
        `Legacy path ${legacyPath} redirects to ${location} (expected prefix ${destination}).`,
      );
    }

    if (finalResponse.status !== 200) {
      throw new Error(
        `Legacy path ${legacyPath} final status ${finalResponse.status} (expected 200).`,
      );
    }
  }
}

async function runApiContractChecks() {
  const checks = [
    {
      path: "/api/ai-proxy/",
      expectedGet: 405,
      expectedPost: 400,
      postBodyNeedle: "functionName is required",
    },
    {
      path: "/api/ingredient-status-sync/",
      expectedGet: 405,
      expectedPost: 401,
      postBodyNeedle: "Missing authorization token",
    },
  ];

  for (const check of checks) {
    const getResponse = await fetch(`${state.baseUrl}${check.path}`, {
      method: "GET",
      redirect: "follow",
    });

    const postResponse = await fetch(`${state.baseUrl}${check.path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      redirect: "follow",
    });

    const postBody = await postResponse.text();

    state.checks.apiChecks.push({
      path: check.path,
      getStatus: getResponse.status,
      postStatus: postResponse.status,
      postBody,
    });

    if (getResponse.status !== check.expectedGet) {
      throw new Error(
        `${check.path} GET returned ${getResponse.status} (expected ${check.expectedGet}).`,
      );
    }

    if (postResponse.status !== check.expectedPost) {
      throw new Error(
        `${check.path} POST returned ${postResponse.status} (expected ${check.expectedPost}).`,
      );
    }

    if (!postBody.includes(check.postBodyNeedle)) {
      throw new Error(
        `${check.path} POST body missing expected text: ${check.postBodyNeedle}. Body: ${postBody}`,
      );
    }
  }
}

async function ensurePlaywrightBrowser() {
  runCommand("npx", ["playwright", "install", "chromium"], {
    stdio: "pipe",
  });
}

async function createTempImage() {
  const tinyPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8NwC4AAAAASUVORK5CYII=";
  const filePath = path.join(os.tmpdir(), `${state.runId}.png`);
  await fsp.writeFile(filePath, Buffer.from(tinyPngBase64, "base64"));
  return filePath;
}

async function runPlaywrightFlows() {
  const browser = await chromium.launch({ headless: true });

  try {
    await runAnonymousFlow(browser);
    await runAdminFlow(browser);
    await runManagerFlow(browser);
    await runDinerFlow(browser);
  } finally {
    await browser.close();
  }
}

async function runAnonymousFlow(browser) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  try {
    await page.goto(`${state.baseUrl}/manager-dashboard`, {
      waitUntil: "domcontentloaded",
    });
    await waitForText(page, "Sign in Required", 20_000);

    await page.goto(`${state.baseUrl}/admin-dashboard`, {
      waitUntil: "domcontentloaded",
    });
    await waitForText(page, "Access Denied", 20_000);
  } finally {
    await context.close();
  }
}

async function runAdminFlow(browser) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
  });
  const page = await context.newPage();

  try {
    await signIn(page, process.env.QA_ADMIN_EMAIL, process.env.QA_ADMIN_PASSWORD);

    await page.goto(`${state.baseUrl}/admin-dashboard`, {
      waitUntil: "domcontentloaded",
    });
    await waitForText(page, "Admin Dashboard", 20_000);

    await page.locator("#restaurant-name").fill(testData.restaurantName);
    await page.locator("#menu-image").setInputFiles(state.tempImagePath);
    await page.locator("#submit-btn").click();

    await waitForText(page, `Added ${testData.restaurantName}`, 40_000);
    await waitForText(page, testData.restaurantName, 40_000);

    const slug = slugifyName(testData.restaurantName);
    const restaurantRecord = await queryRestaurantRecord(testData.restaurantName, slug);
    if (!restaurantRecord?.id) {
      throw new Error(
        `Failed to resolve created restaurant in database for ${testData.restaurantName}.`,
      );
    }

    state.createdRestaurant = {
      id: restaurantRecord.id,
      slug: restaurantRecord.slug,
      name: testData.restaurantName,
      initialOverlaysJson: restaurantRecord.overlaysJson || "[]",
    };

    await page.getByRole("button", { name: "Managers" }).click();
    await page.locator("#admin-restaurant-select").selectOption({
      label: testData.restaurantName,
    });

    const inviteButton = page.getByRole("button", {
      name: /Create Manager Invite Link/,
    });
    await inviteButton.click();

    const inviteInput = page.locator(".manager-invite-output input").first();
    await inviteInput.waitFor({ state: "visible", timeout: 30_000 });

    await waitFor(async () => {
      const value = await inviteInput.inputValue();
      return value.includes("invite=") ? value : "";
    }, 30_000, "Timed out waiting for generated manager invite URL.");

    const inviteUrl = await inviteInput.inputValue();
    state.inviteUrl = inviteUrl;

    const inviteToken = new URL(inviteUrl).searchParams.get("invite") || "";
    if (!inviteToken) {
      throw new Error(`Unable to parse invite token from URL: ${inviteUrl}`);
    }
    state.managerInviteToken = inviteToken;
  } finally {
    await context.close();
  }
}

async function runManagerFlow(browser) {
  if (!state.createdRestaurant?.slug) {
    throw new Error("Manager flow cannot run without created restaurant slug.");
  }
  if (!state.managerInviteToken) {
    throw new Error("Manager flow cannot run without invite token.");
  }

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  try {
    await page.goto(
      `${state.baseUrl}/account?mode=signin&invite=${encodeURIComponent(
        state.managerInviteToken,
      )}`,
      {
        waitUntil: "domcontentloaded",
      },
    );

    await page.getByPlaceholder("Email").fill(process.env.QA_MANAGER_EMAIL);
    await page.getByPlaceholder("Password").fill(process.env.QA_MANAGER_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    const useCurrentButton = page.getByRole("button", {
      name: "Use current account",
    });
    const invitePromptVisible = await tryWaitVisible(useCurrentButton, 8_000);
    if (invitePromptVisible) {
      await useCurrentButton.click();
    }

    await page.goto(`${state.baseUrl}/manager-dashboard`, {
      waitUntil: "domcontentloaded",
    });
    await waitForText(page, "Restaurant Manager Dashboard", 20_000);
    await page.locator("#restaurant-select").selectOption({
      label: testData.restaurantName,
    });

    await page.goto(
      `${state.baseUrl}/restaurant?slug=${encodeURIComponent(
        state.createdRestaurant.slug,
      )}&edit=1`,
      { waitUntil: "domcontentloaded" },
    );

    await ensureRestaurantMode(page, "editor");
    await page.getByRole("button", { name: "Add overlay" }).click();

    await page.getByTitle("Edit this item").first().click();
    const dishNameInput = page.getByLabel("Dish name").first();
    await dishNameInput.fill(testData.dishName);
    await page.getByRole("button", { name: "Done" }).click();
    await waitForText(page, "Unsaved changes", 10_000);

    await page.getByRole("button", { name: "Save changes" }).click();

    const unsavedBadge = page.getByText("Unsaved changes").first();
    await tryWaitHidden(unsavedBadge, 20_000);

    await ensureRestaurantMode(page, "viewer");
    await acknowledgeReferenceDisclaimerIfVisible(page);
    await page.locator(`button[title="${cssEscape(testData.dishName)}"]`).click();

    await page.getByRole("button", { name: "Add to order" }).click();
    await page.getByLabel("Additional notes").fill(testData.managerOrderNote);
    await page.getByRole("button", { name: "Submit notice" }).click();

    await toggleLoveDishBackToNeutral(page);

    await page.goto(`${state.baseUrl}/manager-dashboard`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator("#restaurant-select").selectOption({
      label: testData.restaurantName,
    });

    await page.locator("#chat-message-input").fill(testData.managerChatMessage);
    await page.locator("#chat-send-btn").click();
    await waitForText(page, testData.managerChatMessage, 20_000);
  } finally {
    await context.close();
  }
}

async function runDinerFlow(browser) {
  if (!state.createdRestaurant?.slug) {
    throw new Error("Diner flow cannot run without created restaurant slug.");
  }

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  try {
    await signIn(page, process.env.QA_DINER_EMAIL, process.env.QA_DINER_PASSWORD);

    await page.goto(
      `${state.baseUrl}/restaurant?slug=${encodeURIComponent(
        state.createdRestaurant.slug,
      )}`,
      { waitUntil: "domcontentloaded" },
    );

    await waitForText(page, testData.restaurantName, 20_000);
    await acknowledgeReferenceDisclaimerIfVisible(page);
    await page.locator(`button[title="${cssEscape(testData.dishName)}"]`).click();
    await page.getByRole("button", { name: "Add to order" }).click();
    await page.getByLabel("Additional notes").fill(testData.dinerOrderNote);
    await page.getByRole("button", { name: "Submit notice" }).click();

    await toggleLoveDishBackToNeutral(page);

    if (process.env.VERIFY_CAPTURE_SNAPSHOTS === "1") {
      await captureSnapshot(page, `after-restaurant-${state.runId}-desktop.png`);
    }
  } finally {
    await context.close();
  }
}

async function validateOrderArtifacts() {
  const managerCount = Number(
    await psqlScalar(
      `SELECT COUNT(*) FROM public.tablet_orders WHERE payload::text ILIKE ${sqlLike(
        testData.managerOrderNote,
      )};`,
    ),
  );

  if (!Number.isFinite(managerCount) || managerCount < 1) {
    throw new Error(
      `No tablet_orders row found for manager order note: ${testData.managerOrderNote}`,
    );
  }

  const dinerCount = Number(
    await psqlScalar(
      `SELECT COUNT(*) FROM public.tablet_orders WHERE payload::text ILIKE ${sqlLike(
        testData.dinerOrderNote,
      )};`,
    ),
  );

  if (!Number.isFinite(dinerCount) || dinerCount < 1) {
    throw new Error(
      `No tablet_orders row found for diner order note: ${testData.dinerOrderNote}`,
    );
  }
}

async function runCleanup() {
  const runIdLiteral = sqlLiteral(state.runId);
  const dishLiteral = sqlLiteral(testData.dishName);
  const managerChatLiteral = sqlLiteral(testData.managerChatMessage);
  const managerNoteLiteral = sqlLiteral(testData.managerOrderNote);
  const dinerNoteLiteral = sqlLiteral(testData.dinerOrderNote);

  const managerUserId = await psqlScalar(
    `SELECT id::text FROM auth.users WHERE lower(email) = lower(${sqlLiteral(
      process.env.QA_MANAGER_EMAIL,
    )}) LIMIT 1;`,
    { allowEmpty: true },
  );
  state.managerUserId = managerUserId || "";

  const restaurantId = state.createdRestaurant?.id || "";
  const restaurantIdLiteral = restaurantId ? sqlLiteral(restaurantId) : "NULL";

  const inviteTokenLiteral = state.managerInviteToken
    ? sqlLiteral(state.managerInviteToken)
    : "NULL";

  if (restaurantId && state.createdRestaurant?.initialOverlaysJson) {
    const overlayTag = `OVERLAY_${Date.now()}`;
    const overlayJson = state.createdRestaurant.initialOverlaysJson;
    await psqlExec(`
      UPDATE public.restaurants
      SET overlays = $${overlayTag}$${overlayJson}$${overlayTag}$::jsonb
      WHERE id = ${restaurantIdLiteral};
    `);
  }

  await psqlExec(`
    DELETE FROM public.restaurant_direct_message_reads
    WHERE restaurant_id = ${restaurantIdLiteral}
      OR restaurant_id IN (
        SELECT id FROM public.restaurants
        WHERE name ILIKE '%' || ${runIdLiteral} || '%'
           OR slug ILIKE '%' || ${runIdLiteral} || '%'
      );
  `);

  await psqlExec(`
    DELETE FROM public.restaurant_direct_messages
    WHERE message ILIKE '%' || ${runIdLiteral} || '%'
       OR message = ${managerChatLiteral}
       OR restaurant_id = ${restaurantIdLiteral}
       OR restaurant_id IN (
         SELECT id FROM public.restaurants
         WHERE name ILIKE '%' || ${runIdLiteral} || '%'
            OR slug ILIKE '%' || ${runIdLiteral} || '%'
       );
  `);

  await psqlExec(`
    DELETE FROM public.tablet_orders
    WHERE payload::text ILIKE '%' || ${runIdLiteral} || '%'
       OR payload::text ILIKE '%' || ${managerNoteLiteral} || '%'
       OR payload::text ILIKE '%' || ${dinerNoteLiteral} || '%'
       OR restaurant_id = ${restaurantIdLiteral};
  `);

  await psqlExec(`
    DELETE FROM public.user_loved_dishes
    WHERE dish_name ILIKE '%' || ${runIdLiteral} || '%'
       OR dish_name = ${dishLiteral}
       OR restaurant_id = ${restaurantIdLiteral};
  `);

  if (state.managerInviteToken) {
    await psqlExec(`
      DELETE FROM public.manager_invites
      WHERE token = ${inviteTokenLiteral}
         OR token ILIKE '%' || ${runIdLiteral} || '%';
    `);
  }

  if (restaurantId && managerUserId) {
    const managerUserIdLiteral = sqlLiteral(managerUserId);

    await psqlExec(`
      DELETE FROM public.manager_restaurant_access
      WHERE restaurant_id = ${restaurantIdLiteral}
        AND user_id = ${managerUserIdLiteral};
    `);

    await psqlExec(`
      DELETE FROM public.restaurant_managers
      WHERE restaurant_id = ${restaurantIdLiteral}
        AND user_id = ${managerUserIdLiteral};
    `);
  }

  if (restaurantId) {
    await psqlExec(`
      DELETE FROM public.restaurants
      WHERE id = ${restaurantIdLiteral};
    `);
  }

  await psqlExec(`
    DELETE FROM public.restaurants
    WHERE name ILIKE '%' || ${runIdLiteral} || '%'
       OR slug ILIKE '%' || ${runIdLiteral} || '%';
  `);
}

async function validateNoResidue() {
  const runIdLiteral = sqlLiteral(state.runId);
  const restaurantIdLiteral = state.createdRestaurant?.id
    ? sqlLiteral(state.createdRestaurant.id)
    : null;

  const scopedManagerResidueSql = restaurantIdLiteral
    ? `
      UNION ALL
      SELECT 'restaurant_direct_message_reads' AS bucket, COUNT(*)::bigint AS count
      FROM public.restaurant_direct_message_reads
      WHERE restaurant_id = ${restaurantIdLiteral}

      UNION ALL
      SELECT 'restaurant_managers' AS bucket, COUNT(*)::bigint AS count
      FROM public.restaurant_managers
      WHERE restaurant_id = ${restaurantIdLiteral}

      UNION ALL
      SELECT 'manager_restaurant_access' AS bucket, COUNT(*)::bigint AS count
      FROM public.manager_restaurant_access
      WHERE restaurant_id = ${restaurantIdLiteral}
    `
    : "";

  const residueSql = `
    WITH residue AS (
      SELECT 'restaurants' AS bucket, COUNT(*)::bigint AS count
      FROM public.restaurants
      WHERE name ILIKE '%' || ${runIdLiteral} || '%'
         OR slug ILIKE '%' || ${runIdLiteral} || '%'
         OR overlays::text ILIKE '%' || ${runIdLiteral} || '%'

      UNION ALL
      SELECT 'restaurant_direct_messages' AS bucket, COUNT(*)::bigint AS count
      FROM public.restaurant_direct_messages
      WHERE message ILIKE '%' || ${runIdLiteral} || '%'

      UNION ALL
      SELECT 'tablet_orders' AS bucket, COUNT(*)::bigint AS count
      FROM public.tablet_orders
      WHERE payload::text ILIKE '%' || ${runIdLiteral} || '%'

      UNION ALL
      SELECT 'manager_invites' AS bucket, COUNT(*)::bigint AS count
      FROM public.manager_invites
      WHERE token ILIKE '%' || ${runIdLiteral} || '%'

      UNION ALL
      SELECT 'user_loved_dishes' AS bucket, COUNT(*)::bigint AS count
      FROM public.user_loved_dishes
      WHERE dish_name ILIKE '%' || ${runIdLiteral} || '%'
      ${scopedManagerResidueSql}
    )
    SELECT bucket || ':' || count::text
    FROM residue;
  `;

  const lines = await psqlLines(residueSql);
  const residue = lines
    .map((line) => {
      const [bucket, countText] = line.split(":");
      return { bucket, count: Number(countText || "0") };
    })
    .filter((entry) => Number.isFinite(entry.count));

  state.report.summary.residue = residue;

  const remaining = residue.filter((entry) => entry.count > 0);
  if (remaining.length) {
    const detail = remaining
      .map((entry) => `${entry.bucket}=${entry.count}`)
      .join(", ");
    throw new Error(`Cleanup residue detected for runId ${state.runId}: ${detail}`);
  }
}

function verifyCapacitorOutputs() {
  const capConfigPath = path.join(WORKTREE_ROOT, "ios/App/App/capacitor.config.json");
  const capConfig = JSON.parse(fs.readFileSync(capConfigPath, "utf8"));

  const expectedUrl = process.env.CAPACITOR_SERVER_URL;
  const actualUrl = capConfig?.server?.url || "";

  if (actualUrl !== expectedUrl) {
    throw new Error(
      `Capacitor server.url mismatch. expected=${expectedUrl}, actual=${actualUrl}`,
    );
  }

  const requiredPaths = [
    "ios/App/App/public/manager-push-sw.js",
    "ios/App/App/public/css/styles.css",
    "ios/App/App/public/images/heart-icon.svg",
  ];

  for (const relativePath of requiredPaths) {
    const fullPath = path.join(WORKTREE_ROOT, relativePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Missing required Capacitor copied asset: ${relativePath}`);
    }
  }
}

function verifyGitDeltaAfterCapCopy() {
  const current = runCommand("git", ["status", "--porcelain=v1", "-uall"]);
  const currentPaths = extractPathsFromPorcelain(current.stdout);

  const introduced = [...currentPaths].filter(
    (relativePath) => !state.baselineGitPaths.has(relativePath),
  );

  const unexpected = introduced.filter((relativePath) => {
    return !ALLOWED_CAP_DELTA_PREFIXES.some((allowedPrefix) => {
      return relativePath.startsWith(allowedPrefix);
    });
  });

  state.report.summary.gitDelta = {
    baselinePathCount: state.baselineGitPaths.size,
    introducedPathCount: introduced.length,
    introduced,
    unexpected,
  };

  if (unexpected.length) {
    throw new Error(
      `Unexpected git delta after cap:copy: ${unexpected.join(", ")}`,
    );
  }
}

async function writeReports() {
  await fsp.mkdir(REPORTS_DIR, { recursive: true });

  const reportJsonPath = path.join(
    REPORTS_DIR,
    `next-transition-${state.runId}.json`,
  );
  const reportMdPath = path.join(
    REPORTS_DIR,
    `next-transition-${state.runId}.md`,
  );

  const now = new Date().toISOString();
  const failedStages = state.report.stages.filter((stageEntry) => {
    return stageEntry.status === "failed";
  });

  state.report.summary = {
    ...state.report.summary,
    runId: state.runId,
    generatedAt: now,
    baseUrl: state.baseUrl,
    restaurant: state.createdRestaurant,
    inviteTokenCaptured: Boolean(state.managerInviteToken),
    checks: state.checks,
    failedStageCount: failedStages.length,
    failedStages: failedStages.map((entry) => ({
      name: entry.name,
      error: entry.error,
    })),
  };

  await fsp.writeFile(reportJsonPath, `${JSON.stringify(state.report, null, 2)}\n`, "utf8");

  const lines = [];
  lines.push(`# Next Transition Verification Report`);
  lines.push("");
  lines.push(`- Run ID: \`${state.runId}\``);
  lines.push(`- Generated: ${now}`);
  lines.push(`- Base URL: \`${state.baseUrl}\``);
  lines.push(`- Target Env: \`${process.env.TARGET_ENV || "unknown"}\``);
  lines.push(`- Created restaurant: \`${state.createdRestaurant?.name || "n/a"}\``);
  lines.push(`- Created slug: \`${state.createdRestaurant?.slug || "n/a"}\``);
  lines.push(`- Invite token captured: ${state.managerInviteToken ? "yes" : "no"}`);
  lines.push("");

  lines.push("## Stage Results");
  lines.push("");
  for (const stageEntry of state.report.stages) {
    lines.push(`- ${stageEntry.status.toUpperCase()}: ${stageEntry.name}`);
    if (stageEntry.error) {
      lines.push(`  - Error: ${stageEntry.error}`);
    }
    if (stageEntry.reason) {
      lines.push(`  - Reason: ${stageEntry.reason}`);
    }
  }
  lines.push("");

  lines.push("## Smoke Checks");
  lines.push("");
  for (const check of state.checks.routeChecks) {
    lines.push(`- Route ${check.route}: ${check.status} (${check.bytes} bytes)`);
  }
  for (const check of state.checks.legacyChecks) {
    lines.push(
      `- Legacy ${check.legacyPath}: first=${check.firstStatus} location=${check.location} final=${check.finalStatus}`,
    );
  }
  for (const check of state.checks.apiChecks) {
    lines.push(
      `- API ${check.path}: GET=${check.getStatus} POST=${check.postStatus}`,
    );
  }
  lines.push("");

  if (state.report.summary.gitDelta) {
    lines.push("## Git Delta");
    lines.push("");
    lines.push(
      `- Introduced paths after cap copy: ${state.report.summary.gitDelta.introducedPathCount}`,
    );
    if (state.report.summary.gitDelta.unexpected?.length) {
      lines.push(
        `- Unexpected paths: ${state.report.summary.gitDelta.unexpected.join(", ")}`,
      );
    } else {
      lines.push("- Unexpected paths: none");
    }
    lines.push("");
  }

  await fsp.writeFile(reportMdPath, `${lines.join("\n")}\n`, "utf8");

  state.report.summary.reportPaths = {
    json: reportJsonPath,
    md: reportMdPath,
  };
}

async function queryRestaurantRecord(name, fallbackSlug) {
  const row = await psqlScalar(
    `
      SELECT id::text || '|' || slug || '|' || COALESCE(overlays::text, '[]')
      FROM public.restaurants
      WHERE name = ${sqlLiteral(name)}
      LIMIT 1;
    `,
    { allowEmpty: true },
  );

  if (!row) {
    return null;
  }

  const [id, slug, overlaysJson] = row.split("|");
  return {
    id,
    slug: slug || fallbackSlug,
    overlaysJson: overlaysJson || "[]",
  };
}

async function safeStopPreview() {
  if (!state.preview?.child) return;

  const child = state.preview.child;
  state.preview = null;

  if (child.killed) return;

  await new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    child.once("exit", finish);
    child.kill("SIGTERM");

    setTimeout(() => {
      if (settled) return;
      child.kill("SIGKILL");
      finish();
    }, 5_000);
  });
}

function runCommand(command, args, options = {}) {
  const {
    cwd = WORKTREE_ROOT,
    env = process.env,
    allowFailure = false,
    stdio = "pipe",
    input,
  } = options;

  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio,
    input,
  });

  if (result.error) {
    throw new Error(
      `Command failed to start: ${command} ${args.join(" ")}\n${result.error.message}`,
    );
  }

  const code = result.status ?? 1;

  if (!allowFailure && code !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\n${stderr || stdout}`,
    );
  }

  return {
    code,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function extractPathsFromPorcelain(raw) {
  const paths = new Set();
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  for (const line of lines) {
    if (line.length < 4) continue;
    const rawPath = line.slice(3);
    const resolvedPath = rawPath.includes(" -> ")
      ? rawPath.split(" -> ").at(-1)
      : rawPath;
    if (resolvedPath) {
      paths.add(resolvedPath);
    }
  }

  return paths;
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlLike(value) {
  return `'%${String(value).replace(/'/g, "''")}%` + "'";
}

async function psqlExec(sql) {
  runCommand("psql", [process.env.DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-c", sql], {
    stdio: "pipe",
  });
}

async function psqlLines(sql, options = {}) {
  const { allowEmpty = false } = options;
  const result = runCommand(
    "psql",
    [process.env.DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
    {
      stdio: "pipe",
      allowFailure: allowEmpty,
    },
  );

  if (result.code !== 0 && !allowEmpty) {
    throw new Error(`psql query failed: ${result.stderr || result.stdout}`);
  }

  const lines = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines;
}

async function psqlScalar(sql, options = {}) {
  const { allowEmpty = false } = options;
  const lines = await psqlLines(sql, { allowEmpty });

  if (!lines.length) {
    if (allowEmpty) return "";
    throw new Error(`Expected scalar result but query returned no rows: ${sql}`);
  }

  return lines[0];
}

async function signIn(page, email, password) {
  await page.goto(`${state.baseUrl}/account?mode=signin`, {
    waitUntil: "domcontentloaded",
  });

  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await waitFor(async () => {
    const url = page.url();
    const bodyText = await page.locator("body").innerText();
    const isSignedInState =
      url.includes("/restaurants") ||
      url.includes("/manager-dashboard") ||
      bodyText.includes("Your information") ||
      bodyText.includes("Sign out");
    return isSignedInState;
  }, 20_000, `Sign in did not complete for ${email}`);
}

async function toggleLoveDishBackToNeutral(page) {
  const loveButton = page.getByRole("button", { name: /Love dish|Loved/ }).first();

  if (!(await tryWaitVisible(loveButton, 10_000))) {
    throw new Error("Love dish button did not become visible.");
  }

  for (let index = 0; index < 3; index += 1) {
    const label = await loveButton.innerText();
    if (label.includes("Love dish")) {
      await loveButton.click();
      await waitFor(async () => {
        const text = await loveButton.innerText();
        return text.includes("Loved");
      }, 10_000, "Love dish action did not switch to Loved state.");
    }

    const currentLabel = await loveButton.innerText();
    if (currentLabel.includes("Loved")) {
      await loveButton.click();
      await waitFor(async () => {
        const text = await loveButton.innerText();
        return text.includes("Love dish");
      }, 10_000, "Loved action did not switch back to Love dish.");
      return;
    }
  }

  const finalLabel = await loveButton.innerText();
  if (!finalLabel.includes("Love dish")) {
    throw new Error(`Favorite button did not return to neutral state: ${finalLabel}`);
  }
}

async function captureSnapshot(page, filename) {
  const targetPath = path.join(SNAPSHOTS_DIR, filename);
  await page.screenshot({
    path: targetPath,
    fullPage: true,
  });
}

async function waitForText(page, text, timeoutMs = 15_000) {
  await page.getByText(text, { exact: false }).first().waitFor({
    state: "visible",
    timeout: timeoutMs,
  });
}

async function tryWaitVisible(locator, timeoutMs) {
  try {
    await locator.waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function tryWaitHidden(locator, timeoutMs) {
  try {
    await locator.waitFor({ state: "hidden", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function ensureRestaurantMode(page, targetMode) {
  const normalized = targetMode === "editor" ? "editor" : "viewer";
  const modeToggle = page.locator(".restaurant-legacy-mode-toggle").first();
  const isVisible = await tryWaitVisible(modeToggle, 8_000);
  if (!isVisible) return;

  const labelNode = modeToggle.locator(".restaurant-legacy-mode-label").first();
  const readCurrentMode = async () => {
    const text = String(await labelNode.innerText()).toLowerCase();
    return text.includes("editor mode") ? "editor" : "viewer";
  };

  const currentMode = await readCurrentMode();
  if (currentMode === normalized) return;

  await modeToggle.click();
  await waitFor(
    async () => (await readCurrentMode()) === normalized,
    10_000,
    `Mode toggle did not switch to ${normalized}.`,
  );
}

async function acknowledgeReferenceDisclaimerIfVisible(page) {
  const acknowledgeButton = page.getByRole("button", {
    name: "I understand",
    exact: true,
  });
  const isVisible = await tryWaitVisible(acknowledgeButton, 3_500);
  if (!isVisible) return;
  await acknowledgeButton.click();
  await tryWaitHidden(acknowledgeButton, 10_000);
}

async function waitFor(fn, timeoutMs, timeoutMessage) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await fn();
    if (result) return result;
    await sleep(250);
  }

  throw new Error(timeoutMessage);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugifyName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function makeRunId() {
  return `next-transition-${new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14)}`;
}

function cssEscape(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
