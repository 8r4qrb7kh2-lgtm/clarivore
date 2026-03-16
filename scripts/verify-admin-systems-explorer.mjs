#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";

const WORKTREE_ROOT = "/Users/mattdavis/.cursor/worktrees/clarivore-main/9J1NT";
const PORT = Number.parseInt(process.env.ADMIN_SYSTEMS_VERIFY_PORT || "3210", 10);
const BASE_URL = process.env.ADMIN_SYSTEMS_VERIFY_BASE_URL || `http://127.0.0.1:${PORT}`;
const PROBE_FILE = path.join(WORKTREE_ROOT, "app/kitchen-tablet/kitchenTabletLogic.js");
const PROBE_SEARCH_TEXT = 'label: "Awaiting acknowledgement",';
const PROBE_VISIBLE_TEXT = "Awaiting acknowledgement";
const TIMEOUT_MS = 60_000;

async function waitFor(check, timeoutMs, message) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(lastError?.message || message);
}

async function waitForServer(url) {
  await waitFor(
    async () => {
      const response = await fetch(url, { redirect: "manual" });
      return response.ok || response.status === 307 || response.status === 308;
    },
    TIMEOUT_MS,
    `Timed out waiting for server at ${url}`,
  );
}

async function ensurePlaywrightBrowser() {
  const install = spawnSync("npx", ["playwright", "install", "chromium"], {
    cwd: WORKTREE_ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (install.status !== 0) {
    throw new Error("Failed to install Playwright Chromium.");
  }
}

async function startDevServer() {
  const child = spawn("npx", ["next", "dev", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: WORKTREE_ROOT,
    env: {
      ...process.env,
      NEXT_PUBLIC_ADMIN_DASHBOARD_DEV_BYPASS: "1",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  try {
    await waitForServer(`${BASE_URL}/admin-dashboard`);
    return { child, outputRef: () => output };
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(`${error.message}\n\nDev server output:\n${output}`);
  }
}

async function stopDevServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 5_000);
  });
}

async function verifyExplorer(page) {
  const liveSystemsButton = page.locator("button").filter({ hasText: "Live Systems" });
  await page.goto(`${BASE_URL}/admin-dashboard`, { waitUntil: "networkidle" });
  await waitFor(
    async () => {
      const url = page.url();
      const text = (await page.textContent("body", { timeout: 1_000 }).catch(() => "")) || "";
      return url.includes("/admin-dashboard") && text.includes("Admin Dashboard");
    },
    TIMEOUT_MS,
    "Admin dashboard never reached a ready state.",
  );
  await waitFor(
    async () => (await liveSystemsButton.count()) > 0,
    TIMEOUT_MS,
    "Live Systems tab never rendered.",
  );
  await liveSystemsButton.click();
  await page.waitForSelector('[data-testid="systems-current-node"]');

  const currentNode = page.getByTestId("systems-current-node");
  await waitFor(
    async () => (await currentNode.textContent())?.includes("Clarivore Runtime"),
    TIMEOUT_MS,
    "Root runtime node never rendered.",
  );

  const dataFlowsButton = page.getByRole("button", { name: /data flows/i });
  if (await dataFlowsButton.count()) {
    throw new Error("Old Data Flows tab is still visible.");
  }

  await page.locator('[data-node-id="dir:app/admin-dashboard"]').click();
  await page.waitForFunction(() => {
    const target = document.querySelector('[data-testid="systems-current-node"]');
    return target && /Admin Dashboard/i.test(target.textContent || "");
  });

  await page.locator(".admin-systems-chat textarea").fill(
    "Which user types can access this system and where is that enforced?",
  );
  await page.getByRole("button", { name: /ask the codebase/i }).click();
  await waitFor(
    async () => {
      const count = await page.locator(".admin-systems-chat-history").count();
      if (!count) return false;
      const text = await page.locator(".admin-systems-chat-history").textContent({
        timeout: 1_000,
      });
      return text && text.includes("app/admin-dashboard/");
    },
    TIMEOUT_MS,
    "Chat answer never cited admin-dashboard code.",
  );

  await page.locator('.admin-systems-breadcrumb:has-text("Clarivore Runtime")').click();
  await page.locator('[data-node-id="dir:app/kitchen-tablet"]').click();
  await page.waitForFunction(() => {
    const target = document.querySelector(".admin-systems-current-path code");
    return target && target.textContent === "app/kitchen-tablet";
  });

  await page.locator('[data-node-id="file:app/kitchen-tablet/kitchenTabletLogic.js"]').click();
  await page.waitForFunction(() => {
    const target = document.querySelector(".admin-systems-current-path code");
    return target && target.textContent === "app/kitchen-tablet/kitchenTabletLogic.js";
  });

  await waitFor(
    async () => {
      const count = await page.locator('[data-testid="systems-source-refs"]').count();
      if (!count) return false;
      const text = await page.locator('[data-testid="systems-source-refs"]').textContent({
        timeout: 1_000,
      });
      return text && text.includes(PROBE_VISIBLE_TEXT);
    },
    TIMEOUT_MS,
    "Initial kitchenTabletLogic code excerpt was not visible.",
  );
}

async function verifyLiveRefresh(page) {
  const originalFile = await fs.readFile(PROBE_FILE, "utf8");
  const probeSuffix = `[live probe ${Date.now()}]`;
  const probeText = `label: "Awaiting acknowledgement ${probeSuffix}",`;
  if (!originalFile.includes(PROBE_SEARCH_TEXT)) {
    throw new Error("Probe text not found in kitchenTabletLogic.js");
  }

  try {
    await fs.writeFile(PROBE_FILE, originalFile.replace(PROBE_SEARCH_TEXT, probeText), "utf8");
    await waitFor(
      async () => {
        const count = await page.locator('[data-testid="systems-source-refs"]').count();
        if (!count) return false;
        const text = await page.locator('[data-testid="systems-source-refs"]').textContent({
          timeout: 1_000,
        });
        return text && text.includes(probeSuffix);
      },
      TIMEOUT_MS,
      "Explorer did not refresh after runtime file change.",
    );

    await fs.writeFile(PROBE_FILE, originalFile, "utf8");
    await waitFor(
      async () => {
        const count = await page.locator('[data-testid="systems-source-refs"]').count();
        if (!count) return false;
        const text = await page.locator('[data-testid="systems-source-refs"]').textContent({
          timeout: 1_000,
        });
        return text && !text.includes(probeSuffix);
      },
      TIMEOUT_MS,
      "Explorer did not refresh after restoring the runtime file.",
    );
  } catch (error) {
    await fs.writeFile(PROBE_FILE, originalFile, "utf8");
    throw error;
  }
}

async function main() {
  await ensurePlaywrightBrowser();
  const { child, outputRef } = await startDevServer();
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await verifyExplorer(page);
    await verifyLiveRefresh(page);
    console.log("Admin systems explorer verification passed.");
  } catch (error) {
    throw new Error(`${error.message}\n\nDev server output:\n${outputRef()}`);
  } finally {
    await browser.close();
    await stopDevServer(child);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
