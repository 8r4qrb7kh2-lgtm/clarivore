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
const managerFirstName = process.env.DOCS_MANAGER_FIRST_NAME || "QA";
const managerLastName = process.env.DOCS_MANAGER_LAST_NAME || "Manager";

const DESKTOP = { width: 1720, height: 1180 };
const MOBILE = { width: 390, height: 844 };

const CALLOUT_COLORS = [
  "#2563eb",
  "#d97706",
  "#059669",
  "#dc2626",
  "#7c3aed",
  "#0f766e",
  "#be123c",
  "#1d4ed8",
  "#0f766e",
  "#b45309",
];

function joinUrl(targetPath) {
  return `${baseUrl.replace(/\/$/u, "")}${targetPath.startsWith("/") ? "" : "/"}${targetPath}`;
}

function normalizePathFromHref(href) {
  if (!href) return "";
  try {
    const url = new URL(href, joinUrl("/"));
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}

function viewerPathFromEditorPath(editorPath) {
  if (!editorPath) return "";
  try {
    const url = new URL(editorPath, joinUrl("/"));
    url.searchParams.delete("edit");
    url.searchParams.delete("openLog");
    url.searchParams.delete("openConfirm");
    url.searchParams.delete("openAI");
    url.searchParams.delete("autoReplaceBrand");
    url.searchParams.delete("replaceBrandKey");
    url.searchParams.delete("replaceBrandName");
    const query = url.searchParams.toString();
    return `${url.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return editorPath;
  }
}

function sanitizeEditorPath(editorPath) {
  if (!editorPath) return "";
  try {
    const url = new URL(editorPath, joinUrl("/"));
    url.searchParams.delete("openLog");
    url.searchParams.delete("openConfirm");
    url.searchParams.delete("openAI");
    url.searchParams.delete("autoReplaceBrand");
    url.searchParams.delete("replaceBrandKey");
    url.searchParams.delete("replaceBrandName");
    if (!url.searchParams.get("edit")) {
      url.searchParams.set("edit", "1");
    }
    const query = url.searchParams.toString();
    return `${url.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return editorPath;
  }
}

async function pause(page, ms = 350) {
  await page.waitForTimeout(ms);
}

async function gotoStable(page, targetPath) {
  await page.goto(joinUrl(targetPath), { waitUntil: "networkidle" });
  await pause(page, 450);
}

async function captureRaw(page, fileName, { fullPage = true } = {}) {
  await page.screenshot({
    path: path.join(outputDir, fileName),
    fullPage,
  });
}

function resolveLocator(page, def) {
  if (typeof def.locator === "function") {
    return def.locator(page);
  }
  if (def.selector) {
    return page.locator(def.selector);
  }
  if (def.role) {
    return page.getByRole(def.role, {
      name: def.name,
      exact: Boolean(def.exact),
    });
  }
  if (def.text) {
    return page.getByText(def.text, { exact: Boolean(def.exact) });
  }
  return page.locator("__non_existent__");
}

async function resolveBox(page, def) {
  const locator = resolveLocator(page, def);
  const count = await locator.count();
  if (count < 1) return null;

  const target = locator.nth(Math.max(0, Number(def.nth) || 0));
  try {
    await target.scrollIntoViewIfNeeded();
  } catch {
    // Best effort.
  }
  await pause(page, 120);

  const box = await target.boundingBox();
  if (!box || box.width < 2 || box.height < 2) return null;

  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    label: def.label,
    color: def.color || CALLOUT_COLORS[(Number(def.index) || 0) % CALLOUT_COLORS.length],
  };
}

async function clearOverlay(page) {
  await page.evaluate(() => {
    const existing = document.getElementById("__docs-annotation-layer");
    if (existing) existing.remove();
  });
}

async function drawOverlay(page, boxes, title = "Key Features") {
  await page.evaluate(
    ({ payload, panelTitle }) => {
      const existing = document.getElementById("__docs-annotation-layer");
      if (existing) existing.remove();

      const root = document.createElement("div");
      root.id = "__docs-annotation-layer";
      root.style.position = "fixed";
      root.style.left = "0";
      root.style.top = "0";
      root.style.width = "100vw";
      root.style.height = "100vh";
      root.style.pointerEvents = "none";
      root.style.zIndex = "2147483647";

      payload.forEach((item, index) => {
        const idx = index + 1;
        const color = item.color || "#2563eb";

        const box = document.createElement("div");
        box.style.position = "fixed";
        box.style.left = `${item.x}px`;
        box.style.top = `${item.y}px`;
        box.style.width = `${item.width}px`;
        box.style.height = `${item.height}px`;
        box.style.border = `3px solid ${color}`;
        box.style.borderRadius = "10px";
        box.style.background = `${color}14`;
        box.style.boxShadow = `0 0 0 2px rgba(255,255,255,0.85) inset`;

        const badge = document.createElement("div");
        badge.textContent = `${idx}. ${item.label}`;
        badge.style.position = "fixed";
        badge.style.left = `${Math.max(10, item.x)}px`;
        badge.style.top = `${Math.max(8, item.y - 30)}px`;
        badge.style.padding = "4px 8px";
        badge.style.borderRadius = "8px";
        badge.style.font = "600 12px/1.2 ui-sans-serif, system-ui, -apple-system";
        badge.style.color = "#fff";
        badge.style.background = color;
        badge.style.boxShadow = "0 2px 8px rgba(0,0,0,0.25)";
        badge.style.maxWidth = "340px";

        root.appendChild(box);
        root.appendChild(badge);
      });

      const legend = document.createElement("div");
      legend.style.position = "fixed";
      legend.style.right = "14px";
      legend.style.top = "14px";
      legend.style.maxWidth = "340px";
      legend.style.background = "rgba(8,12,25,0.92)";
      legend.style.border = "1px solid rgba(120,146,214,0.55)";
      legend.style.borderRadius = "12px";
      legend.style.padding = "10px 12px";
      legend.style.color = "#e8efff";
      legend.style.font = "500 12px/1.45 ui-sans-serif, system-ui, -apple-system";
      legend.style.boxShadow = "0 8px 24px rgba(0,0,0,0.35)";

      const heading = document.createElement("div");
      heading.textContent = panelTitle || "Key Features";
      heading.style.fontWeight = "700";
      heading.style.marginBottom = "6px";
      heading.style.fontSize = "12px";
      legend.appendChild(heading);

      payload.forEach((item, index) => {
        const line = document.createElement("div");
        line.style.display = "flex";
        line.style.alignItems = "center";
        line.style.gap = "6px";
        line.style.marginBottom = "4px";

        const dot = document.createElement("span");
        dot.textContent = String(index + 1);
        dot.style.display = "inline-flex";
        dot.style.alignItems = "center";
        dot.style.justifyContent = "center";
        dot.style.width = "18px";
        dot.style.height = "18px";
        dot.style.borderRadius = "999px";
        dot.style.fontSize = "11px";
        dot.style.fontWeight = "700";
        dot.style.background = item.color || "#2563eb";
        dot.style.color = "#fff";

        const text = document.createElement("span");
        text.textContent = item.label;

        line.appendChild(dot);
        line.appendChild(text);
        legend.appendChild(line);
      });

      root.appendChild(legend);
      document.body.appendChild(root);
    },
    {
      payload: boxes,
      panelTitle: title,
    },
  );
}

async function captureAnnotated(page, {
  fileName,
  title,
  annotations,
  fullPage = false,
  scrollSelector = "",
  preCapture,
}) {
  if (typeof preCapture === "function") {
    await preCapture();
  }
  if (scrollSelector) {
    const target = page.locator(scrollSelector).first();
    if ((await target.count()) > 0) {
      await target.scrollIntoViewIfNeeded();
      await pause(page, 200);
    }
  }

  const resolved = [];
  for (let i = 0; i < annotations.length; i += 1) {
    const box = await resolveBox(page, { ...annotations[i], index: i });
    if (box) resolved.push(box);
  }

  if (resolved.length) {
    await drawOverlay(page, resolved, title);
  }

  await captureRaw(page, fileName, { fullPage });
  await clearOverlay(page);
}

async function loginAsManager(page) {
  if (!managerEmail || !managerPassword) {
    throw new Error("Manager credentials missing. Set DOCS_MANAGER_EMAIL and DOCS_MANAGER_PASSWORD.");
  }

  await gotoStable(page, "/account?mode=signin");
  await page.getByPlaceholder("Email").first().fill(managerEmail);
  await page.getByPlaceholder("Password").first().fill(managerPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
  await page.waitForLoadState("networkidle");
  await pause(page, 1200);

  // Fresh QA accounts can land in onboarding and need profile completion
  // before manager dashboard access appears.
  const onboardingHeading = page.getByRole("heading", { name: /Welcome to Clarivore/i }).first();
  if ((await onboardingHeading.count()) > 0) {
    const firstNameInput = page.getByPlaceholder("First name").first();
    const lastNameInput = page.getByPlaceholder("Last name").first();
    if ((await firstNameInput.count()) > 0) {
      await firstNameInput.fill(managerFirstName);
    }
    if ((await lastNameInput.count()) > 0) {
      await lastNameInput.fill(managerLastName);
    }
    await page.getByRole("button", { name: /Complete setup/i }).first().click();
    await page.waitForLoadState("networkidle");
    await pause(page, 1200);
  }

  const invitePromptButton = page.getByRole("button", { name: /Use current account/i }).first();
  if ((await invitePromptButton.count()) > 0) {
    await invitePromptButton.click();
    await page.waitForLoadState("networkidle");
    await pause(page, 500);
  }
}

async function resolveEditorPath(page) {
  const links = await page
    .locator("a[href*='/restaurant?slug='][href*='edit=1'], a[href*='/restaurant/?slug='][href*='edit=1']")
    .evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute("href") || "")
        .filter(Boolean),
    );
  if (!links.length) return "";
  return normalizePathFromHref(links[0]);
}

async function resolveEditorPathFromDashboard(page) {
  const navPath = await resolveEditorPath(page);
  if (navPath) {
    return sanitizeEditorPath(navPath);
  }

  const confirmButton = page.locator("#confirmNowBtn").first();
  if ((await confirmButton.count()) > 0) {
    const beforeUrl = page.url();
    try {
      await Promise.all([
        page.waitForURL(/\/restaurant\/?\?/u, { timeout: 12000 }),
        confirmButton.click(),
      ]);
      await page.waitForLoadState("networkidle");
      return sanitizeEditorPath(normalizePathFromHref(page.url()));
    } catch {
      // Fallback: best-effort read current URL if navigation happened without regex match.
      const current = page.url();
      if (current !== beforeUrl && /\/restaurant\/?\?/u.test(current)) {
        return sanitizeEditorPath(normalizePathFromHref(current));
      }
      // Fall back to nav-link discovery.
    }
  }

  return sanitizeEditorPath(await resolveEditorPath(page));
}

async function closeModalByButton(page, pattern) {
  const dialog = page.locator("[role='dialog']").last();
  if ((await dialog.count()) < 1) return;
  const button = dialog.getByRole("button", { name: pattern }).first();
  if ((await button.count()) < 1) return;
  await button.click();
  await pause(page, 300);
}

async function runDesktopAnnotated(browser) {
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();

  await gotoStable(page, "/account?mode=signin");
  await captureAnnotated(page, {
    fileName: "manager-signin-annotated-desktop.png",
    title: "Sign-In Controls",
    annotations: [
      { selector: "input[type='email']", label: "Manager email input" },
      { selector: "input[type='password']", label: "Password input" },
      { role: "button", name: /^sign in$/i, label: "Primary sign-in action" },
      { role: "button", name: /create an account/i, label: "Account creation option" },
    ],
    fullPage: true,
  });

  await gotoStable(page, "/manager-dashboard");
  await captureAnnotated(page, {
    fileName: "manager-dashboard-auth-required-annotated-desktop.png",
    title: "Access Gate State",
    annotations: [
      { selector: "#auth-required", label: "Authentication-required message" },
      { role: "link", name: /sign in/i, label: "Sign-in recovery path" },
    ],
    fullPage: true,
  });

  if (!managerEmail || !managerPassword) {
    console.log("Skipping authenticated annotated captures: manager credentials not provided.");
    await context.close();
    return;
  }

  await loginAsManager(page);
  await gotoStable(page, "/manager-dashboard");

  await captureAnnotated(page, {
    fileName: "manager-dashboard-overview-annotated-desktop.png",
    title: "Dashboard Operations Overview",
    annotations: [
      { selector: "header", label: "Topbar with mode toggle and navigation" },
      { selector: ".dashboard-header", label: "Dashboard title and scope" },
      { selector: ".quick-actions-section", label: "Direct message panel" },
      { selector: "#requests-list", label: "Accommodation request queue" },
      { selector: "#confirmation-status", label: "Monthly confirmation status card" },
    ],
  });

  await captureAnnotated(page, {
    fileName: "manager-dashboard-requests-annotated-desktop.png",
    title: "Request Triage Controls",
    scrollSelector: "#requests-list",
    annotations: [
      { selector: ".tabs", label: "Pending vs All request filters" },
      { selector: "#requests-list", label: "Request cards and status badges" },
      { selector: ".request-actions", label: "Implement / Review / Decline actions" },
      { selector: "#confirmation-status", label: "Confirmation due-state in same workflow" },
    ],
  });

  await captureAnnotated(page, {
    fileName: "manager-dashboard-change-brand-annotated-desktop.png",
    title: "Change Review and Brand Management",
    scrollSelector: "#recent-changes-list",
    annotations: [
      { selector: "#recent-changes-list", label: "Recent change preview" },
      { selector: "#viewFullLogBtn", label: "Open full change log" },
      { selector: "#brand-items-search", label: "Brand item search" },
      { selector: "#brand-items-list", label: "Brand item cards and replace actions" },
    ],
  });

  await captureAnnotated(page, {
    fileName: "manager-dashboard-analytics-annotated-desktop.png",
    title: "Analytics Interpretation Panel",
    scrollSelector: "#menu-heatmap-container",
    annotations: [
      { selector: ".heatmap-controls", label: "Metric toggles and legend" },
      { selector: "#menu-heatmap-container", label: "Heatmap dish overlay surface" },
      { selector: "#menu-accommodation-breakdown", label: "Accommodation breakdown bars" },
      { selector: "#user-dietary-profile-section", label: "User allergen and diet distribution" },
    ],
  });

  const editorPath = await resolveEditorPathFromDashboard(page);
  if (!editorPath) {
    console.log("No editor link found from dashboard; skipping editor/viewer captures.");
    await context.close();
    return;
  }

  await gotoStable(page, editorPath);
  await page.waitForSelector(".restaurant-editor", { timeout: 25000 });

  await captureAnnotated(page, {
    fileName: "restaurant-editor-overview-annotated-desktop.png",
    title: "Editor Core Controls",
    annotations: [
      { selector: ".restaurant-page-thumb", label: "Mini-map jump navigator" },
      { selector: ".editorGroupButtons", label: "Add overlay, undo/redo, save actions" },
      { role: "button", name: /edit menu images/i, label: "Menu image management modal" },
      { role: "button", name: /view log of changes/i, label: "Change log modal" },
      { selector: ".editorRestaurantSettingsBtn", label: "Restaurant settings modal" },
      { role: "button", name: /confirm information is up-to-date/i, label: "Monthly confirmation flow" },
      { selector: ".restaurant-editor-stage", label: "Menu canvas with draggable overlays" },
    ],
  });

  const editBadge = page.locator(".editBadge").first();
  if ((await editBadge.count()) > 0) {
    await editBadge.click();
    await page.waitForSelector(".restaurant-editor-dish-modal", { timeout: 12000 });
    await captureAnnotated(page, {
      fileName: "restaurant-editor-dish-modal-annotated-desktop.png",
      title: "Dish Editor and Ingredient Controls",
      annotations: [
        { selector: ".restaurant-editor-dish-head", label: "Dish editor header and Done/Delete actions" },
        { selector: ".restaurant-editor-dish-media-row", label: "Upload / camera input actions" },
        { selector: ".restaurant-editor-dish-text-wrap", label: "Recipe text, dictation, generic recipe" },
        { selector: ".restaurant-editor-dish-process-btn", label: "AI process input action" },
        { selector: ".restaurant-editor-dish-ingredient-list", label: "Ingredient rows and brand assignment controls" },
      ],
    });
    await page.getByRole("button", { name: /^Done$/i }).first().click();
    await pause(page, 350);
  }

  await page.getByRole("button", { name: /view log of changes/i }).first().click();
  await page.waitForSelector("[role='dialog']", { timeout: 10000 });
  await captureAnnotated(page, {
    fileName: "restaurant-editor-change-log-annotated-desktop.png",
    title: "Change Log Review",
    annotations: [
      { selector: "[role='dialog']", label: "Change log modal" },
      { text: "Change Log", label: "Change history context" },
      { role: "button", name: /close/i, label: "Close log after review" },
    ],
  });
  await closeModalByButton(page, /close/i);

  await page.getByRole("button", { name: /edit menu images/i }).first().click();
  await page.waitForSelector("[role='dialog']", { timeout: 10000 });
  await captureAnnotated(page, {
    fileName: "restaurant-editor-menu-pages-annotated-desktop.png",
    title: "Menu Page Management",
    annotations: [
      { selector: "[role='dialog']", label: "Edit menu images modal" },
      { role: "button", name: /add page/i, label: "Add new menu page" },
      { text: "Replace", label: "Replace individual page image" },
      { text: "Remove", label: "Remove obsolete page" },
      { role: "button", name: /^Save$/i, label: "Save page updates" },
    ],
  });
  await closeModalByButton(page, /cancel/i);

  await page.locator(".editorRestaurantSettingsBtn").first().click();
  await page.waitForSelector("[role='dialog']", { timeout: 10000 });
  await captureAnnotated(page, {
    fileName: "restaurant-editor-settings-annotated-desktop.png",
    title: "Restaurant Settings",
    annotations: [
      { selector: "[role='dialog']", label: "Restaurant settings modal" },
      { text: "Website", label: "Website field" },
      { text: "Delivery URL", label: "Delivery URL field" },
      { text: "Menu URL", label: "Menu URL field" },
      { role: "button", name: /^Save$/i, label: "Save settings" },
    ],
  });
  await closeModalByButton(page, /cancel/i);

  await page.getByRole("button", { name: /confirm information is up-to-date/i }).first().click();
  await page.waitForSelector("[role='dialog']", { timeout: 12000 });
  await captureAnnotated(page, {
    fileName: "restaurant-editor-confirmation-annotated-desktop.png",
    title: "Monthly Confirmation Workflow",
    annotations: [
      { selector: "[role='dialog']", label: "Confirmation modal" },
      { text: "Confirm Allergen Information", label: "Two-step confirmation flow" },
      { text: "Continue to brand items", label: "Step transition gate" },
      { text: "Confirm information is up-to-date", label: "Final confirmation submit" },
    ],
  });
  await closeModalByButton(page, /cancel/i);

  const viewerPath = viewerPathFromEditorPath(editorPath);
  if (viewerPath) {
    await gotoStable(page, viewerPath);
    await page.waitForSelector(".restaurant-viewer", { timeout: 20000 });
    const referenceAckButton = page.getByRole("button", { name: /I understand/i }).first();
    if ((await referenceAckButton.count()) > 0) {
      await referenceAckButton.click();
      await pause(page, 350);
    }

    await captureAnnotated(page, {
      fileName: "restaurant-viewer-overview-annotated-desktop.png",
      title: "Diner Experience Surface (Manager Perspective)",
      annotations: [
        { selector: ".restaurant-preference-wrap", label: "Saved allergen and diet preferences" },
        { selector: ".restaurant-legend", label: "Complies / modifiable / cannot-modify legend" },
        { selector: ".restaurant-menu-page", label: "Menu image browsing surface" },
        { selector: ".restaurant-overlay", label: "Dish-level compatibility overlays" },
      ],
    });

    const firstOverlay = page.locator(".restaurant-overlay").first();
    if ((await firstOverlay.count()) > 0) {
      try {
        const stageLock = page.locator(".restaurant-menu-stage.is-locked").first();
        if ((await stageLock.count()) > 0) {
          await stageLock.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
        }

        await firstOverlay.click({ timeout: 8000 });
        await page.waitForSelector(".restaurant-dish-popover", { timeout: 10000 });

        await captureAnnotated(page, {
          fileName: "restaurant-viewer-dish-popover-annotated-desktop.png",
          title: "Dish Detail UX",
          annotations: [
            { selector: ".restaurant-dish-popover", label: "Dish detail modal/popover" },
            { selector: ".restaurant-dish-popover-favorite-btn", label: "Favorite toggle (signal for loves metric)" },
            { selector: ".restaurant-dish-order-btn", label: "Order/add action (signals conversion intent)" },
            { selector: ".restaurant-dish-popover-section", label: "Allergen and diet reasoning by status" },
          ],
        });

        const closeButton = page.locator(".restaurant-dish-popover-close-btn").first();
        if ((await closeButton.count()) > 0) {
          await closeButton.click();
        }
      } catch (error) {
        console.warn("Skipping viewer dish popover capture:", error?.message || error);
      }
    }
  }

  await context.close();
}

async function runMobileBaseline(browser) {
  const context = await browser.newContext({ viewport: MOBILE });
  const page = await context.newPage();

  await gotoStable(page, "/account?mode=signin");
  await captureRaw(page, "manager-signin-mobile.png", { fullPage: true });

  await gotoStable(page, "/manager-dashboard");
  await captureRaw(page, "manager-dashboard-auth-required-mobile.png", { fullPage: true });

  if (managerEmail && managerPassword) {
    try {
      await loginAsManager(page);
      await gotoStable(page, "/manager-dashboard");
      await captureRaw(page, "manager-dashboard-main-mobile.png", { fullPage: true });
    } catch (error) {
      console.error("Skipping authenticated mobile capture:", error?.message || error);
    }
  }

  await context.close();
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    await runDesktopAnnotated(browser);
    await runMobileBaseline(browser);
  } finally {
    await browser.close();
  }

  console.log("Manager flow screenshot capture complete.");
  if (!managerEmail || !managerPassword) {
    console.log(
      "Set DOCS_MANAGER_EMAIL and DOCS_MANAGER_PASSWORD to enable authenticated annotated captures.",
    );
  }
}

main().catch((error) => {
  console.error("Failed to capture manager flow screenshots:", error?.message || error);
  process.exit(1);
});
