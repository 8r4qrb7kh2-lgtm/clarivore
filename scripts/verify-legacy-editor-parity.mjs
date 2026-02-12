#!/usr/bin/env node

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const WORKTREE_ROOT =
  "/Users/mattdavis/.cursor/worktrees/clarivore-main/9J1NT";
const SNAPSHOTS_DIR = path.join(WORKTREE_ROOT, "docs/parity-snapshots");
const REPORTS_DIR = path.join(SNAPSHOTS_DIR, "reports");
const DEFAULT_BASE_URL = process.env.VERIFY_BASE_URL || "http://127.0.0.1:8081";

const args = parseArgs(process.argv.slice(2));
const runId = args.runId || process.env.VERIFY_RUN_ID || makeRunId();
const baseUrl = args.baseUrl || DEFAULT_BASE_URL;
const slug = String(args.slug || process.env.VERIFY_RESTAURANT_SLUG || "").trim();
const captureEnabled =
  (args.capture || process.env.VERIFY_CAPTURE_SNAPSHOTS || "0") === "1";

const report = {
  title: "Legacy Editor Parity Verification",
  runId,
  baseUrl,
  slug,
  startedAt: new Date().toISOString(),
  finishedAt: "",
  checks: [],
  screenshots: [],
  verdict: "PASS",
};

await main();

async function main() {
  try {
    validateInputs();
    await fsp.mkdir(REPORTS_DIR, { recursive: true });

    const tempImagePath = await createTempImage();
    const browser = await chromium.launch({ headless: true });

    try {
      await runDesktopChecks(browser, tempImagePath);
      await runMobileChecks(browser);
    } finally {
      await browser.close();
      await safeUnlink(tempImagePath);
    }
  } catch (error) {
    report.verdict = "FAIL";
    report.checks.push({
      name: "Unhandled failure",
      status: "failed",
      error: error?.message || "Unknown error",
    });
  } finally {
    report.finishedAt = new Date().toISOString();
    await writeReports();
    if (report.verdict !== "PASS") {
      process.exitCode = 1;
    }
  }
}

function validateInputs() {
  if (process.cwd() !== WORKTREE_ROOT) {
    throw new Error(`Run from ${WORKTREE_ROOT}. Current cwd: ${process.cwd()}`);
  }

  if (!slug) {
    throw new Error("Missing restaurant slug. Pass --slug or VERIFY_RESTAURANT_SLUG.");
  }

  const missing = ["QA_MANAGER_EMAIL", "QA_MANAGER_PASSWORD"].filter(
    (key) => !process.env[key],
  );
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}

async function runDesktopChecks(browser, tempImagePath) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1512, height: 982 },
  });
  const page = await context.newPage();

  try {
    await check("Manager sign in", async () => {
      await signInManager(page);
    });

    await check("Load legacy parity editor", async () => {
      await gotoEditor(page);
      await page.getByRole("heading", { name: "Webpage editor" }).first().waitFor({
        state: "visible",
        timeout: 20_000,
      });
    });

    await check("Topbar parity structure and dropdown", async () => {
      await page.locator(".simple-topbar .mode-toggle-container .mode-toggle").first().waitFor({
        state: "visible",
        timeout: 10_000,
      });

      await expectNavLabel(page, "Dashboard");
      await expectNavLabel(page, "Webpage editor");
      await expectNavLabel(page, "Tablet pages");
      await expectNavLabel(page, "Help");
      await expectNavLabel(page, "Account settings");

      const tabletTrigger = page
        .locator(".simple-nav .nav-dropdown-trigger")
        .filter({ hasText: "Tablet pages" })
        .first();
      await tabletTrigger.click();
      await page.locator(".nav-dropdown-content a", { hasText: "Server tablet" }).first().waitFor({
        state: "visible",
        timeout: 10_000,
      });
      await page.locator(".nav-dropdown-content a", { hasText: "Kitchen tablet" }).first().waitFor({
        state: "visible",
        timeout: 10_000,
      });
      await page.keyboard.press("Escape").catch(() => {});
      await page.locator("body").click({ position: { x: 20, y: 20 } });
    });

    await check("Editor shell parity actions", async () => {
      await page.getByRole("heading", { name: "Webpage editor" }).first().waitFor({
        state: "visible",
        timeout: 10_000,
      });

      if (await visibleCount(page.getByRole("button", { name: /Detect dishes/i })) > 0) {
        throw new Error("Detect dishes button should not be visible in legacy parity mode.");
      }
      if (await visibleCount(page.getByRole("button", { name: /Save changes/i })) > 0) {
        throw new Error("Always-visible Save changes button should be hidden in legacy parity mode.");
      }

      await page.getByRole("button", { name: "+ Add overlay" }).first().waitFor({
        state: "visible",
        timeout: 10_000,
      });
      await page.getByText("Drag to move. Drag any corner to resize.", { exact: false })
        .first()
        .waitFor({ state: "visible", timeout: 10_000 });
    });

    if (captureEnabled) {
      await captureSnapshot(page, "legacy-parity-editor-single-desktop.png");
    }

    await check("Overlay add and drag interaction", async () => {
      const before = await page.locator(".editBox").count();
      await page.getByRole("button", { name: "+ Add overlay" }).first().click();

      await waitFor(async () => (await page.locator(".editBox").count()) > before, 10_000);

      const overlay = page.locator(".editBox").last();
      const beforeBox = await overlay.boundingBox();
      if (!beforeBox) throw new Error("Unable to read overlay bounding box before drag.");

      const startX = beforeBox.x + beforeBox.width / 2;
      const startY = beforeBox.y + beforeBox.height / 2;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 42, startY + 30, { steps: 10 });
      await page.mouse.up();

      await page.waitForTimeout(140);
      const afterBox = await overlay.boundingBox();
      if (!afterBox) throw new Error("Unable to read overlay bounding box after drag.");

      const movedX = Math.abs(afterBox.x - beforeBox.x);
      const movedY = Math.abs(afterBox.y - beforeBox.y);
      if (movedX < 6 && movedY < 6) {
        throw new Error("Overlay did not move after drag.");
      }
    });

    await check("Save flow parity states and review modal", async () => {
      const saveButton = page
        .getByRole("button", { name: /Save to site|Retry save|Saved|Saving/ })
        .first();
      await saveButton.waitFor({ state: "visible", timeout: 10_000 });

      await saveButton.click();
      await page.getByText("Review your changes", { exact: false }).first().waitFor({
        state: "visible",
        timeout: 10_000,
      });

      await page.getByRole("button", { name: "Cancel save" }).click();
      await page.getByText("Review your changes", { exact: false }).first().waitFor({
        state: "hidden",
        timeout: 10_000,
      });

      await saveButton.click();
      await page.getByRole("button", { name: /Confirm & Save|Retry save/i }).click();

      await waitFor(
        async () =>
          (await visibleCount(page.getByRole("button", { name: /Saved|Save to site|Retry save/i }))) > 0 ||
          (await visibleCount(page.getByRole("button", { name: "Save then leave" }))) > 0,
        20_000,
      );
    });

    await check("Unsaved guard via topbar navigation", async () => {
      await page.getByRole("button", { name: "+ Add overlay" }).first().click();

      const helpNavButton = page
        .locator(".simple-nav button")
        .filter({ hasText: "Help" })
        .first();
      await helpNavButton.click();

      await page.getByText("You have unsaved changes", { exact: false }).first().waitFor({
        state: "visible",
        timeout: 10_000,
      });
      await page.getByRole("button", { name: "Stay here" }).click();

      await waitFor(async () => page.url().includes("/restaurant"), 8_000);

      await helpNavButton.click();
      await page.getByRole("button", { name: "Leave without saving" }).click();
      await page.waitForURL(/\/help-contact/, { timeout: 15_000 });
    });

    await check("Unsaved guard via mode toggle save-then-leave", async () => {
      await gotoEditor(page);
      await page.getByRole("button", { name: "+ Add overlay" }).first().click();

      const modeToggle = page.locator(".mode-toggle-container .mode-toggle").first();
      await modeToggle.click();

      await page.getByText("You have unsaved changes", { exact: false }).first().waitFor({
        state: "visible",
        timeout: 10_000,
      });

      await page.getByRole("button", { name: "Save then leave" }).click();
      await waitFor(async () => !page.url().includes("edit=1"), 20_000);
      await waitFor(async () => page.url().includes("/restaurant"), 20_000);

      const viewerLabel = page
        .locator(".mode-toggle-container .mode-toggle-label")
        .first();
      await viewerLabel.waitFor({ state: "visible", timeout: 10_000 });
      const viewerLabelText = String(await viewerLabel.innerText()).toLowerCase();
      if (!viewerLabelText.includes("customer mode")) {
        throw new Error(`Expected customer mode label after switch, got: ${viewerLabelText}`);
      }

      await modeToggle.click();
      await waitFor(async () => page.url().includes("edit=1"), 15_000);
      await page.getByRole("heading", { name: "Webpage editor" }).first().waitFor({
        state: "visible",
        timeout: 10_000,
      });
    });

    await check("Scanner modal and corner workflow", async () => {
      await page.getByRole("button", { name: /Edit menu images/i }).first().click();
      await page.getByText("Edit menu images", { exact: false }).first().waitFor({
        state: "visible",
        timeout: 10_000,
      });

      const scanChooserPromise = page.waitForEvent("filechooser", { timeout: 15_000 });
      await page.getByRole("button", { name: "Scan + add" }).click();
      const scanChooser = await scanChooserPromise;
      await scanChooser.setFiles(tempImagePath);

      await page.getByText("Adjust menu corners", { exact: false }).first().waitFor({
        state: "visible",
        timeout: 60_000,
      });

      await page.getByRole("button", { name: "Move topLeft" }).waitFor({
        state: "visible",
        timeout: 10_000,
      });
      await page.getByRole("button", { name: "Use original" }).click();

      await page.getByText("Adjust menu corners", { exact: false }).first().waitFor({
        state: "hidden",
        timeout: 20_000,
      });

      const pageCount = await ensureMultiPageState(page, tempImagePath);
      if (pageCount < 2) {
        throw new Error("Failed to produce multi-page menu state for parity checks.");
      }

      await closeModal(page, "Edit menu images");
    });

    await check("Persist multipage state and capture desktop matrix", async () => {
      const saveButton = page
        .getByRole("button", { name: /Save to site|Retry save|Saved|Saving/ })
        .first();
      if (await visibleCount(saveButton) > 0) {
        await saveButton.click();
        await page.getByRole("button", { name: /Confirm & Save|Retry save/i }).click();
        await waitFor(
          async () =>
            (await visibleCount(page.getByRole("button", { name: /Saved/i }))) > 0 ||
            !(await page.url().includes("edit=1")),
          20_000,
        );
      }

      if (captureEnabled) {
        await captureSnapshot(page, "legacy-parity-editor-multipage-desktop.png");
      }

      const modeToggle = page.locator(".mode-toggle-container .mode-toggle").first();
      await modeToggle.click();
      await waitFor(async () => !page.url().includes("edit=1"), 15_000);

      if (captureEnabled) {
        await captureSnapshot(page, "legacy-parity-viewer-multipage-desktop.png");
      }

      if (captureEnabled) {
        const currentUrl = new URL(page.url());
        currentUrl.searchParams.set("edit", "1");
        await page.goto(currentUrl.toString(), { waitUntil: "domcontentloaded" });
        await page.getByRole("heading", { name: "Webpage editor" }).first().waitFor({
          state: "visible",
          timeout: 10_000,
        });
      }
    });
  } finally {
    await context.close();
  }
}

async function runMobileChecks(browser) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  try {
    await check("Mobile manager sign in", async () => {
      await signInManager(page);
    });

    await check("Mobile viewer parity layout", async () => {
      const viewerUrl = buildLegacyRestaurantUrl({ edit: false });
      await page.goto(viewerUrl, { waitUntil: "domcontentloaded" });
      await page.locator(".simple-topbar").first().waitFor({
        state: "visible",
        timeout: 20_000,
      });
      await page.locator(".mode-toggle-container .mode-toggle").first().waitFor({
        state: "visible",
        timeout: 20_000,
      });
    });

    if (captureEnabled) {
      await captureSnapshot(page, "legacy-parity-viewer-single-mobile.png");
      await captureSnapshot(page, "legacy-parity-viewer-multipage-mobile.png");
    }

    await check("Mobile editor parity layout", async () => {
      await gotoEditor(page);
      await page.getByRole("heading", { name: "Webpage editor" }).first().waitFor({
        state: "visible",
        timeout: 20_000,
      });
      await page.getByRole("button", { name: "+ Add overlay" }).first().waitFor({
        state: "visible",
        timeout: 10_000,
      });
    });

    if (captureEnabled) {
      await captureSnapshot(page, "legacy-parity-editor-single-mobile.png");
      await captureSnapshot(page, "legacy-parity-editor-multipage-mobile.png");
    }
  } finally {
    await context.close();
  }
}

async function signInManager(page) {
  await page.goto(`${baseUrl}/account?mode=signin`, {
    waitUntil: "domcontentloaded",
  });

  await page.getByPlaceholder("Email").fill(process.env.QA_MANAGER_EMAIL);
  await page.getByPlaceholder("Password").fill(process.env.QA_MANAGER_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await waitFor(async () => {
    const url = page.url();
    const bodyText = await page.locator("body").innerText();
    return (
      url.includes("/restaurants") ||
      url.includes("/manager-dashboard") ||
      bodyText.includes("Sign out")
    );
  }, 20_000);
}

async function gotoEditor(page) {
  await page.goto(buildLegacyRestaurantUrl({ edit: true }), {
    waitUntil: "domcontentloaded",
  });

  const acknowledgeButton = page.getByRole("button", {
    name: "I understand",
    exact: true,
  });
  if (await isVisible(acknowledgeButton, 2000)) {
    await acknowledgeButton.click();
  }
}

function buildLegacyRestaurantUrl({ edit }) {
  const url = new URL(`${baseUrl}/restaurant`);
  url.searchParams.set("slug", slug);
  url.searchParams.set("editorParity", "legacy");
  if (edit) {
    url.searchParams.set("edit", "1");
  }
  return url.toString();
}

async function expectNavLabel(page, label) {
  const navRoot = page.locator(".simple-nav").first();
  const buttonMatch = navRoot.locator("button", { hasText: label }).first();
  if (await isVisible(buttonMatch, 1200)) return;
  const linkMatch = navRoot.locator("a", { hasText: label }).first();
  if (await isVisible(linkMatch, 1200)) return;
  throw new Error(`Topbar label not found: ${label}`);
}

async function ensureMultiPageState(page, tempImagePath) {
  const readPageCount = async () => {
    const labels = await page.locator("span").allInnerTexts();
    let maxPage = 0;
    for (const label of labels) {
      const match = String(label || "").match(/^Page\s+(\d+)$/i);
      if (!match) continue;
      const value = Number(match[1]);
      if (Number.isFinite(value)) {
        maxPage = Math.max(maxPage, value);
      }
    }
    return maxPage;
  };

  let count = await readPageCount();
  if (count >= 2) return count;

  const addChooserPromise = page.waitForEvent("filechooser", { timeout: 15_000 });
  await page.getByRole("button", { name: "Add page" }).click();
  const addChooser = await addChooserPromise;
  await addChooser.setFiles(tempImagePath);

  await waitFor(async () => (await readPageCount()) >= 2, 15_000);
  count = await readPageCount();
  return count;
}

async function closeModal(page, titleText) {
  const modalTitle = page.getByText(titleText, { exact: false }).first();
  if (!(await isVisible(modalTitle, 1200))) return;

  await page.keyboard.press("Escape");
  const closedOnEsc = await tryWaitHidden(modalTitle, 1600);
  if (closedOnEsc) return;

  const closeButton = page
    .locator("button")
    .filter({ hasText: /^×$/ })
    .first();
  if (await isVisible(closeButton, 1000)) {
    await closeButton.click();
    await tryWaitHidden(modalTitle, 4_000);
  }
}

async function createTempImage() {
  const tinyPngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAQAAACoWZBhAAAAIUlEQVR42mP8//8/AyUYTFhYGGQwqmhq6hA3E0QqAABnbQ4HPrmTgAAAAABJRU5ErkJggg==";
  const tempPath = path.join(os.tmpdir(), `legacy-editor-parity-${runId}.png`);
  await fsp.writeFile(tempPath, Buffer.from(tinyPngBase64, "base64"));
  return tempPath;
}

async function safeUnlink(filePath) {
  try {
    await fsp.unlink(filePath);
  } catch {
    // Ignore cleanup errors.
  }
}

async function captureSnapshot(page, filename) {
  const targetPath = path.join(SNAPSHOTS_DIR, filename);
  await page.screenshot({
    path: targetPath,
    fullPage: true,
  });
  report.screenshots.push(targetPath);
}

async function check(name, fn) {
  const startedAt = Date.now();
  try {
    await fn();
    report.checks.push({
      name,
      status: "passed",
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    report.checks.push({
      name,
      status: "failed",
      durationMs: Date.now() - startedAt,
      error: error?.message || "Unknown error",
    });
    report.verdict = "FAIL";
    throw error;
  }
}

async function writeReports() {
  const jsonPath = path.join(REPORTS_DIR, `legacy-editor-parity-${runId}.json`);
  const mdPath = path.join(REPORTS_DIR, `legacy-editor-parity-${runId}.md`);
  await fsp.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const lines = [];
  lines.push("# Legacy Editor Parity Report");
  lines.push("");
  lines.push(`- Run ID: \`${runId}\``);
  lines.push(`- Base URL: \`${baseUrl}\``);
  lines.push(`- Slug: \`${slug}\``);
  lines.push(`- Verdict: **${report.verdict}**`);
  lines.push(`- Started: ${report.startedAt}`);
  lines.push(`- Finished: ${report.finishedAt}`);
  lines.push("");
  lines.push("## Checks");
  lines.push("");

  for (const entry of report.checks) {
    lines.push(`- ${entry.status.toUpperCase()}: ${entry.name} (${entry.durationMs}ms)`);
    if (entry.error) {
      lines.push(`  - Error: ${entry.error}`);
    }
  }

  lines.push("");
  lines.push("## Screenshots");
  lines.push("");
  if (report.screenshots.length) {
    for (const shot of report.screenshots) {
      lines.push(`- \`${shot}\``);
    }
  } else {
    lines.push("- none (set VERIFY_CAPTURE_SNAPSHOTS=1 or --capture=1)");
  }
  lines.push("");

  await fsp.writeFile(mdPath, `${lines.join("\n")}\n`, "utf8");
}

function parseArgs(argv) {
  const output = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      output[key] = "1";
      continue;
    }
    output[key] = next;
    i += 1;
  }
  return {
    baseUrl: output["base-url"] || "",
    slug: output.slug || "",
    runId: output["run-id"] || "",
    capture: output.capture || "",
  };
}

function makeRunId() {
  return `legacy-parity-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
}

async function waitFor(fn, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await fn();
    if (result) return result;
    await sleep(200);
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

async function visibleCount(locator) {
  const total = await locator.count();
  let visible = 0;
  for (let i = 0; i < total; i += 1) {
    if (await locator.nth(i).isVisible().catch(() => false)) {
      visible += 1;
    }
  }
  return visible;
}

async function isVisible(locator, timeoutMs = 0) {
  try {
    await locator.waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function tryWaitHidden(locator, timeoutMs = 1000) {
  try {
    await locator.waitFor({ state: "hidden", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
