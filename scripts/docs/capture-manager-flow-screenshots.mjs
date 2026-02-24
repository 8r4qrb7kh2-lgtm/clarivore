#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const outputDir = path.join(repoRoot, "docs", "manager-flows", "screenshots");
const baseUrl = process.env.DOCS_BASE_URL || "http://127.0.0.1:8081";
const managerEmail = process.env.DOCS_MANAGER_EMAIL || "";
const managerPassword = process.env.DOCS_MANAGER_PASSWORD || "";

const DESKTOP = { width: 1600, height: 1000 };
const MOBILE = { width: 390, height: 844 };

function joinUrl(targetPath) {
  return `${baseUrl.replace(/\/$/u, "")}${targetPath.startsWith("/") ? "" : "/"}${targetPath}`;
}

async function capture(page, targetPath, fileName) {
  await page.goto(joinUrl(targetPath), { waitUntil: "networkidle" });
  await page.screenshot({
    path: path.join(outputDir, fileName),
    fullPage: true,
  });
}

async function loginAsManager(page) {
  await page.goto(joinUrl("/account?mode=signin"), { waitUntil: "networkidle" });
  await page.fill("#email", managerEmail);
  await page.fill("#password", managerPassword);
  await page.click("#login-btn");
  await page.waitForTimeout(1500);
}

async function runViewport(browser, viewport, suffix) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  await capture(page, "/account?mode=signin", `manager-signin-${suffix}.png`);
  await capture(page, "/manager-dashboard", `manager-dashboard-auth-required-${suffix}.png`);

  if (managerEmail && managerPassword) {
    try {
      await loginAsManager(page);
      await capture(page, "/manager-dashboard", `manager-dashboard-main-${suffix}.png`);
      await capture(page, "/restaurant?edit=1", `restaurant-editor-entry-${suffix}.png`);
    } catch (error) {
      console.error(`Skipping authenticated ${suffix} captures:`, error?.message || error);
    }
  }

  await context.close();
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    await runViewport(browser, DESKTOP, "desktop");
    await runViewport(browser, MOBILE, "mobile");
  } finally {
    await browser.close();
  }

  console.log("Manager flow screenshot capture complete.");
  if (!managerEmail || !managerPassword) {
    console.log(
      "Set DOCS_MANAGER_EMAIL and DOCS_MANAGER_PASSWORD to capture authenticated manager screenshots.",
    );
  }
}

main().catch((error) => {
  console.error("Failed to capture manager flow screenshots:", error?.message || error);
  process.exit(1);
});
