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
        box.style.boxShadow = "0 0 0 2px rgba(255,255,255,0.85) inset";

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

async function captureAnnotated(
  page,
  { fileName, title, annotations, fullPage = false, scrollSelector = "", preCapture },
) {
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

async function setManagerMode(page, nextMode = "editor") {
  await page.evaluate((mode) => {
    window.localStorage.setItem("clarivoreManagerMode", mode);
  }, nextMode);
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
      const current = page.url();
      if (current !== beforeUrl && /\/restaurant\/?\?/u.test(current)) {
        return sanitizeEditorPath(normalizePathFromHref(current));
      }
    }
  }

  return sanitizeEditorPath(await resolveEditorPath(page));
}

async function closeModalByButton(page, pattern) {
  const dialog = page.locator("[role='dialog']").last();
  if ((await dialog.count()) < 1) return false;
  const button = dialog.getByRole("button", { name: pattern }).first();
  if ((await button.count()) < 1) return false;
  await button.click();
  await pause(page, 300);
  return true;
}

async function clickIfPresent(locator) {
  if ((await locator.count()) < 1) return false;
  await locator.first().click();
  return true;
}

async function dismissViewerReferenceBanner(page) {
  const button = page.getByRole("button", { name: /I understand/i }).first();
  if ((await button.count()) > 0) {
    await button.click();
    await pause(page, 350);
  }
}

async function openRequestsHistoryTab(page) {
  const allTab = page.locator(".tabs .tab-btn").nth(1);
  if ((await allTab.count()) > 0) {
    await allTab.click();
    await pause(page, 250);
  }
}

async function openRequestsPendingTab(page) {
  const pendingTab = page.locator(".tabs .tab-btn").first();
  if ((await pendingTab.count()) > 0) {
    await pendingTab.click();
    await pause(page, 250);
  }
}

async function openFirstRequestActionModal(page) {
  const button = page.getByRole("button", { name: /Mark Implemented/i }).first();
  if ((await button.count()) < 1) return false;
  await button.click();
  await page.waitForSelector("#response-modal.show", { timeout: 10000 });
  await pause(page, 250);
  return true;
}

async function closeRequestActionModal(page) {
  const cancelButton = page.locator("#modal-cancel").first();
  if ((await cancelButton.count()) < 1) return false;
  await cancelButton.click();
  await pause(page, 300);
  return true;
}

async function openTabletPagesDropdown(page) {
  const trigger = page.getByRole("button", { name: /Tablet pages/i }).first();
  if ((await trigger.count()) < 1) return false;
  await trigger.click();
  await pause(page, 250);
  return true;
}

async function ensureServerActionCardVisible(page) {
  const actionable = page.getByRole("button", { name: /Approve & stage for kitchen|Send to kitchen/i }).first();
  if ((await actionable.count()) > 0) return true;

  const tabs = page.locator(".server-tab");
  const count = await tabs.count();
  for (let i = 0; i < count; i += 1) {
    await tabs.nth(i).click();
    await pause(page, 250);
    if ((await actionable.count()) > 0) {
      return true;
    }
  }
  return false;
}

async function openServerRejectModal(page) {
  await ensureServerActionCardVisible(page);
  const rejectButton = page.getByRole("button", { name: /Reject notice/i }).first();
  if ((await rejectButton.count()) < 1) return false;
  await rejectButton.click();
  await page.waitForSelector(".server-modal", { timeout: 10000 });
  await pause(page, 250);
  return true;
}

async function closeServerRejectModal(page) {
  const cancelButton = page.getByRole("button", { name: /Cancel rejection/i }).first();
  if ((await cancelButton.count()) < 1) return false;
  await cancelButton.click();
  await pause(page, 300);
  return true;
}

async function openKitchenPromptModal(page) {
  const questionButton = page.getByRole("button", { name: /Send follow-up question/i }).first();
  if ((await questionButton.count()) < 1) return false;
  await questionButton.click();
  await page.waitForSelector(".kitchen-prompt-modal", { timeout: 10000 });
  await pause(page, 250);
  return true;
}

async function closeKitchenPromptModal(page) {
  const cancelButton = page.getByRole("button", { name: /^Cancel$/i }).first();
  if ((await cancelButton.count()) < 1) return false;
  await cancelButton.click();
  await pause(page, 300);
  return true;
}

async function createTemporaryEditorChange(page) {
  const saveButton = page.getByRole("button", { name: /Save to site/i }).first();
  if ((await saveButton.count()) > 0) return true;

  const editBox = page.locator(".editBox").first();
  if ((await editBox.count()) > 0) {
    try {
      const box = await editBox.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 8, {
          steps: 8,
        });
        await page.mouse.up();
        await pause(page, 600);
        if ((await saveButton.count()) > 0) return true;
      }
    } catch {
      // Fallback below.
    }
  }

  const addOverlayButton = page.getByRole("button", { name: /Add overlay/i }).first();
  if ((await addOverlayButton.count()) > 0) {
    await addOverlayButton.click();
    await pause(page, 450);
  }

  return (await saveButton.count()) > 0;
}

async function openSaveReviewModal(page) {
  const prepared = await createTemporaryEditorChange(page);
  if (!prepared) return false;

  const saveButton = page.getByRole("button", { name: /Save to site/i }).first();
  if ((await saveButton.count()) < 1) return false;
  await saveButton.click();
  await page.waitForSelector("[role='dialog']", { timeout: 12000 });
  await page.getByText(/Review your changes/i).first().waitFor({ timeout: 12000 });
  await pause(page, 250);
  return true;
}

async function closeSaveReviewModal(page) {
  const cancelButton = page.getByRole("button", { name: /Cancel save/i }).first();
  if ((await cancelButton.count()) < 1) return false;
  await cancelButton.click();
  await pause(page, 300);
  return true;
}

async function openEditorConfirmationModal(page) {
  const button = page.getByRole("button", { name: /Confirm information is up-to-date/i }).first();
  if ((await button.count()) < 1) return false;
  await button.click();
  await page.waitForSelector("[role='dialog']", { timeout: 12000 });
  await pause(page, 300);
  return true;
}

function extensionFromContentType(contentType = "", sourceUrl = "") {
  const safeType = String(contentType || "").toLowerCase();
  if (safeType.includes("image/jpeg") || safeType.includes("image/jpg")) return "jpg";
  if (safeType.includes("image/webp")) return "webp";
  if (safeType.includes("image/gif")) return "gif";
  if (safeType.includes("image/png")) return "png";
  if (/^data:image\/jpeg/i.test(sourceUrl) || /^data:image\/jpg/i.test(sourceUrl)) return "jpg";
  if (/^data:image\/webp/i.test(sourceUrl)) return "webp";
  if (/^data:image\/gif/i.test(sourceUrl)) return "gif";
  if (/\.jpe?g(\?|$)/iu.test(sourceUrl)) return "jpg";
  if (/\.webp(\?|$)/iu.test(sourceUrl)) return "webp";
  if (/\.gif(\?|$)/iu.test(sourceUrl)) return "gif";
  return "png";
}

async function createLocalCopyFromUrl(sourceUrl, fileStem) {
  if (!sourceUrl) return "";
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${sourceUrl}: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const tempDir = path.join(outputDir, ".tmp");
  await fs.mkdir(tempDir, { recursive: true });
  const extension = extensionFromContentType(
    response.headers.get("content-type") || "",
    sourceUrl,
  );
  const targetPath = path.join(tempDir, `${fileStem}.${extension}`);
  await fs.writeFile(targetPath, buffer);
  return targetPath;
}

async function prepareConfirmationMenuCards(page) {
  const captureInputs = page.locator("[role='dialog'] input[type='file'][capture='environment']");
  const inputCount = await captureInputs.count();
  if (inputCount < 1) return false;

  const baselineSources = await page
    .locator("[role='dialog'] img[alt*='baseline']")
    .evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute("src") || "")
        .filter(Boolean),
    );

  if (!baselineSources.length) return false;

  const localCopies = [];
  for (let i = 0; i < baselineSources.length; i += 1) {
    try {
      const nextPath = await createLocalCopyFromUrl(
        baselineSources[i],
        `confirm-menu-card-${i}`,
      );
      if (nextPath) {
        localCopies.push(nextPath);
      }
    } catch (error) {
      console.warn("Unable to prepare confirmation baseline image:", error?.message || error);
    }
  }

  if (!localCopies.length) return false;

  for (let i = 0; i < inputCount; i += 1) {
    const sourcePath = localCopies[Math.min(i, localCopies.length - 1)];
    await captureInputs.nth(i).setInputFiles(sourcePath);
    await pause(page, 250);
  }

  const comparingMessage = page.getByText(/Comparing current photos to saved menu pages/i).first();
  if ((await comparingMessage.count()) > 0) {
    await comparingMessage.waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
  }

  const continueButton = page.getByRole("button", { name: /Continue to brand items/i }).first();
  for (let i = 0; i < 30; i += 1) {
    if ((await continueButton.count()) > 0 && (await continueButton.isEnabled())) {
      return true;
    }
    await pause(page, 400);
  }

  return (await continueButton.count()) > 0 && (await continueButton.isEnabled());
}

async function moveEditorConfirmationToBrandStep(page) {
  const continueButton = page.getByRole("button", { name: /Continue to brand items/i }).first();
  if ((await continueButton.count()) < 1) return false;

  if (!(await continueButton.isEnabled())) {
    await prepareConfirmationMenuCards(page);
  }

  const yesButtons = page.getByRole("button", { name: /^Yes$/i });
  const yesCount = await yesButtons.count();
  if (yesCount >= 2) {
    await yesButtons.nth(0).click();
    await pause(page, 150);
    await yesButtons.nth(1).click();
    await pause(page, 300);
  }

  const comparingMessage = page.getByText(/Comparing current photos to saved menu pages/i).first();
  if ((await comparingMessage.count()) > 0) {
    await comparingMessage.waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
  }

  for (let i = 0; i < 15; i += 1) {
    if (await continueButton.isEnabled()) {
      break;
    }
    await pause(page, 500);
  }

  if (!(await continueButton.isEnabled())) return false;

  await continueButton.click();
  await pause(page, 500);
  return true;
}

async function captureDashboardSequence(page) {
  await captureAnnotated(page, {
    fileName: "manager-topbar-navigation-annotated-desktop.png",
    title: "Manager Navigation",
    annotations: [
      { text: "Manager", label: "Mode toggle and current manager-mode label" },
      { role: "link", name: /^Dashboard$/i, label: "Dashboard home" },
      { role: "link", name: /Webpage editor/i, label: "Jump directly to the managed restaurant editor" },
      { role: "button", name: /Tablet pages/i, label: "Open server and kitchen tablet pages" },
      { role: "link", name: /^Help$/i, label: "Help and support center" },
      { role: "link", name: /Account settings/i, label: "Account and sign-out page" },
    ],
  });

  if (await openTabletPagesDropdown(page)) {
    await captureAnnotated(page, {
      fileName: "manager-topbar-tablet-pages-menu-annotated-desktop.png",
      title: "Tablet Pages Menu",
      annotations: [
        { role: "button", name: /Tablet pages/i, label: "Tablet-pages menu trigger" },
        { role: "link", name: /Server tablet/i, label: "Open the server-side notice queue" },
        { role: "link", name: /Kitchen tablet/i, label: "Open the kitchen acknowledgement queue" },
      ],
    });
    await page.keyboard.press("Escape").catch(() => {});
    await pause(page, 200);
  }

  await captureAnnotated(page, {
    fileName: "manager-dashboard-overview-annotated-desktop.png",
    title: "Dashboard Operations Overview",
    annotations: [
      { selector: "header", label: "Topbar with navigation across every manager surface" },
      { selector: ".dashboard-header", label: "Dashboard title and current restaurant scope" },
      { selector: ".quick-actions-section", label: "Direct messages and published-overlay summary" },
      { selector: "#requests-list", label: "Accommodation request queue" },
      { selector: "#confirmation-status", label: "Monthly confirmation status card" },
    ],
  });

  await captureAnnotated(page, {
    fileName: "manager-dashboard-messages-review-annotated-desktop.png",
    title: "Direct Messages Review Step",
    scrollSelector: ".quick-actions-section",
    annotations: [
      { selector: ".quick-actions-section", label: "Direct-messages workspace" },
      { text: "Direct Messages", label: "Message-thread title and unread badge" },
      { selector: ".chat-preview-list", label: "Conversation history with timestamps and acknowledgement markers" },
      { role: "button", name: /Acknowledge message/i, label: "Mark the current admin message run as reviewed" },
    ],
  });

  await captureAnnotated(page, {
    fileName: "manager-dashboard-messages-compose-annotated-desktop.png",
    title: "Direct Messages Compose Step",
    scrollSelector: ".quick-actions-section",
    annotations: [
      { selector: ".chat-preview-list", label: "Review the latest admin context before replying" },
      { selector: "input[placeholder='Message Clarivore']", label: "Compose your reply to Clarivore" },
      { role: "button", name: /^Send$/i, label: "Send the current message to the admin thread" },
      { selector: ".publication-summary-panel", label: "Published-overlay summary and quick editor shortcut" },
    ],
  });

  await openRequestsPendingTab(page);
  await captureAnnotated(page, {
    fileName: "manager-dashboard-requests-annotated-desktop.png",
    title: "Accommodation Queue Overview",
    scrollSelector: "#requests-list",
    annotations: [
      { selector: ".tabs", label: "Switch between Pending and All request history" },
      { selector: "#requests-list", label: "Request cards with dish, date, and need details" },
      { selector: ".request-actions", label: "Inline triage actions for pending requests" },
      { selector: "#confirmation-status", label: "Confirmation risk remains visible during queue work" },
    ],
  });

  if (await openFirstRequestActionModal(page)) {
    await captureAnnotated(page, {
      fileName: "manager-dashboard-request-modal-annotated-desktop.png",
      title: "Accommodation Action Confirmation",
      annotations: [
        { selector: "#response-modal .response-modal-content", label: "Action-confirmation dialog" },
        { selector: "#modal-title", label: "Current action and expected status transition" },
        { selector: "#modal-dish", label: "Dish being updated" },
        { selector: "#response-text", label: "Optional manager rationale that stays with the request" },
        { selector: "#modal-implement", label: "Commit the selected status change" },
      ],
    });
    await closeRequestActionModal(page);
  }

  await openRequestsHistoryTab(page);
  await captureAnnotated(page, {
    fileName: "manager-dashboard-requests-history-annotated-desktop.png",
    title: "Accommodation History Review",
    scrollSelector: "#requests-list",
    annotations: [
      { selector: ".tabs", label: "All-history tab for completed and pending requests" },
      { selector: "#requests-list", label: "Status history across every accommodation request" },
      { selector: ".status-badge", label: "Final request status badges" },
      { text: /Manager Response/i, label: "Saved manager-response text when rationale was added" },
    ],
  });

  await captureAnnotated(page, {
    fileName: "manager-dashboard-confirmation-card-annotated-desktop.png",
    title: "Monthly Confirmation Dashboard Step",
    scrollSelector: "#confirmation-status",
    annotations: [
      { selector: "#confirmation-status", label: "Confirmation due-state card" },
      { selector: ".confirmation-due-label", label: "Due-date label" },
      { selector: ".confirmation-due-date", label: "Urgency state: due soon, due today, or overdue" },
      { selector: ".confirmation-last", label: "Last completed confirmation timestamp" },
      { selector: "#confirmNowBtn", label: "Launch the editor-based confirmation workflow" },
    ],
  });

  await captureAnnotated(page, {
    fileName: "manager-dashboard-change-brand-annotated-desktop.png",
    title: "Change Review and Brand Management",
    scrollSelector: "#recent-changes-list",
    annotations: [
      { selector: "#recent-changes-list", label: "Recent change preview" },
      { selector: "#viewFullLogBtn", label: "Open the full editor changelog" },
      { selector: "#brand-items-search", label: "Search by brand, ingredient, or dish" },
      { selector: "#brand-items-list", label: "Brand-item cards with drill-in and replacement actions" },
    ],
  });

  const moreButton = page.locator(".brand-item-more").first();
  if ((await moreButton.count()) > 0) {
    await moreButton.click();
    await pause(page, 250);
    await captureAnnotated(page, {
      fileName: "manager-dashboard-brand-expanded-annotated-desktop.png",
      title: "Expanded Brand Item Card",
      scrollSelector: "#brand-items-list",
      annotations: [
        { selector: ".brand-item-card[data-expanded='true']", label: "Expanded brand-item record" },
        { text: "Allergens", label: "Saved allergen metadata for the current branded item" },
        { text: "Diets", label: "Saved diet metadata for the branded item" },
        { text: "Dishes using this item", label: "Every dish currently linked to the item" },
        { role: "button", name: /Replace item/i, label: "Open replacement workflow in the webpage editor" },
      ],
    });
  }

  await captureAnnotated(page, {
    fileName: "manager-dashboard-analytics-annotated-desktop.png",
    title: "Analytics Interpretation Panel",
    scrollSelector: "#menu-heatmap-container",
    annotations: [
      { selector: ".heatmap-controls", label: "Metric toggles and legend" },
      { selector: "#menu-heatmap-container", label: "Heatmap overlay surface" },
      { selector: "#menu-accommodation-breakdown", label: "Accommodation breakdown bars" },
      { selector: "#user-dietary-profile-section", label: "User allergen and diet distribution" },
    ],
  });

  const firstHeatmapOverlay = page.locator(".heatmap-overlay").first();
  if ((await firstHeatmapOverlay.count()) > 0) {
    await firstHeatmapOverlay.click();
    await page.waitForSelector("#dish-analytics-modal.show", { timeout: 10000 });
    await pause(page, 250);
    await captureAnnotated(page, {
      fileName: "manager-dashboard-dish-analytics-modal-annotated-desktop.png",
      title: "Dish Analytics Drill-Down",
      annotations: [
        { selector: "#dish-analytics-title", label: "Selected dish name" },
        { selector: "#cannot-accommodate-row", label: "Restrictions that cannot be accommodated" },
        { selector: "#can-accommodate-row", label: "Restrictions that can be accommodated" },
        { selector: "#analytics-stacked-chart", label: "Views and status-distribution comparison" },
        { selector: "#conflict-breakdown-section", label: "Conflict counts by allergen and diet" },
        { selector: "#analytics-requests", label: "Total accommodation requests for this dish" },
      ],
    });
    const closeButton = page.locator("#dish-analytics-close").first();
    if ((await closeButton.count()) > 0) {
      await closeButton.click();
      await pause(page, 250);
    }
  }
}

async function captureEditorSequence(page, editorPath) {
  await gotoStable(page, editorPath);
  await page.waitForSelector(".restaurant-editor", { timeout: 25000 });

  await captureAnnotated(page, {
    fileName: "restaurant-editor-overview-annotated-desktop.png",
    title: "Editor Core Controls",
    annotations: [
      { selector: ".restaurant-page-thumb", label: "Mini-map jump navigator" },
      { selector: ".editorGroupButtons", label: "Add overlay, undo/redo, and save actions" },
      { role: "button", name: /edit menu images/i, label: "Menu image management modal" },
      { role: "button", name: /view log of changes/i, label: "Change log modal" },
      { selector: ".editorRestaurantSettingsBtn", label: "Restaurant settings modal" },
      { role: "button", name: /confirm information is up-to-date/i, label: "Monthly confirmation flow" },
      { selector: ".restaurant-editor-stage", label: "Menu canvas with draggable overlays" },
    ],
  });

  await captureAnnotated(page, {
    fileName: "restaurant-editor-open-dish-annotated-desktop.png",
    title: "Open a Dish Overlay",
    annotations: [
      { selector: ".restaurant-page-thumb", label: "Use the minimap to jump to a page region" },
      { selector: ".editBox", label: "Overlay box positioned over the matching menu item" },
      { selector: ".editBadge", label: "Open the selected dish for detailed editing" },
      { selector: ".editorOverlayLegend", label: "Published vs unpublished overlay legend" },
    ],
  });

  const editBadge = page.locator(".editBadge").first();
  if ((await editBadge.count()) > 0) {
    await editBadge.click();
    await page.waitForSelector(".restaurant-editor-dish-modal", { timeout: 12000 });

    await captureAnnotated(page, {
      fileName: "restaurant-editor-dish-modal-annotated-desktop.png",
      title: "Dish Editor Main Step",
      annotations: [
        { selector: ".restaurant-editor-dish-head", label: "Dish editor header with Done and Delete" },
        { selector: ".restaurant-editor-dish-name-input", label: "Dish name field" },
        { selector: ".restaurant-editor-dish-media-row", label: "Upload or capture recipe-photo evidence" },
        { selector: ".restaurant-editor-dish-text-wrap", label: "Recipe text, dictation, and generic-recipe tools" },
        { selector: ".restaurant-editor-dish-process-btn", label: "Process Input builds ingredient rows from the current evidence" },
      ],
    });

    await captureAnnotated(page, {
      fileName: "restaurant-editor-dish-ingredients-annotated-desktop.png",
      title: "Dish Ingredients and Preview Step",
      scrollSelector: ".restaurant-editor-dish-preview",
      annotations: [
        { selector: ".restaurant-editor-dish-ingredient-list", label: "Ingredient rows with brand, allergen, diet, and confirmation controls" },
        { selector: ".restaurant-editor-dish-ingredient-actions", label: "Add an ingredient row manually" },
        { selector: ".restaurant-editor-dish-preview", label: "Customer-facing preview of allergen and diet messaging" },
        { selector: ".restaurant-editor-dish-footer-actions", label: "Close the modal when every row is reviewed" },
      ],
    });

    await page.getByRole("button", { name: /^Done$/i }).first().click();
    await pause(page, 350);
  }

  await page.getByRole("button", { name: /view log of changes/i }).first().click();
  await page.waitForSelector("[role='dialog']", { timeout: 10000 });
  await captureAnnotated(page, {
    fileName: "restaurant-editor-change-log-annotated-desktop.png",
    title: "Editor Change Log",
    annotations: [
      { selector: "[role='dialog']", label: "Change-log dialog" },
      { text: "Change Log", label: "Full change-history heading" },
      { role: "button", name: /Close/i, label: "Close the log when review is complete" },
    ],
  });
  await closeModalByButton(page, /close/i);

  await page.getByRole("button", { name: /edit menu images/i }).first().click();
  await page.waitForSelector("[role='dialog']", { timeout: 10000 });
  await captureAnnotated(page, {
    fileName: "restaurant-editor-menu-pages-annotated-desktop.png",
    title: "Menu Page Management",
    annotations: [
      { selector: "[role='dialog']", label: "Menu-page management modal" },
      { role: "button", name: /Add page/i, label: "Add a new menu page image" },
      { text: "Replace", label: "Replace a stale page image" },
      { text: "Remove", label: "Remove a page that is no longer current" },
      { role: "button", name: /^Save$/i, label: "Save page-image changes" },
    ],
  });
  await closeModalByButton(page, /cancel/i);

  await page.locator(".editorRestaurantSettingsBtn").first().click();
  await page.waitForSelector("[role='dialog']", { timeout: 10000 });
  await captureAnnotated(page, {
    fileName: "restaurant-editor-settings-annotated-desktop.png",
    title: "Restaurant Settings",
    annotations: [
      { selector: "[role='dialog']", label: "Restaurant-settings modal" },
      { text: "Website", label: "Website field" },
      { text: "Delivery URL", label: "Delivery link field" },
      { text: "Menu URL", label: "Public menu URL field" },
      { role: "button", name: /^Save$/i, label: "Save restaurant settings" },
    ],
  });
  await closeModalByButton(page, /cancel/i);

  if (await openEditorConfirmationModal(page)) {
    await captureAnnotated(page, {
      fileName: "restaurant-editor-confirmation-menu-annotated-desktop.png",
      title: "Confirmation Step 1: Menu Verification",
      annotations: [
        { selector: "[role='dialog']", label: "Confirmation workflow dialog" },
        { text: /Are all dishes clearly visible/i, label: "Photo-visibility attestation" },
        { text: /Are these photos of your most current menu/i, label: "Current-menu attestation" },
        { role: "button", name: /Continue to brand items/i, label: "Move to branded-item verification" },
        { role: "button", name: /^Cancel$/i, label: "Exit without submitting confirmation" },
      ],
    });

    if (await moveEditorConfirmationToBrandStep(page)) {
      await captureAnnotated(page, {
        fileName: "restaurant-editor-confirmation-brand-annotated-desktop.png",
        title: "Confirmation Step 2: Brand Verification",
        annotations: [
          { selector: "[role='dialog']", label: "Brand-verification step" },
          { text: "Saved", label: "Baseline image for the existing verified brand item" },
          { text: "Current", label: "Current captured or replacement image" },
          { role: "button", name: /Replace|View results/i, label: "Replace or review the brand-item comparison" },
          { role: "button", name: /Capture photo of current version/i, label: "Capture a current item photo from the restaurant" },
          { role: "button", name: /Confirm information is up-to-date/i, label: "Final confirmation action after every card matches" },
        ],
      });
    }

    await page.keyboard.press("Escape").catch(() => {});
    await pause(page, 250);
  }

  if (await openSaveReviewModal(page)) {
    await captureAnnotated(page, {
      fileName: "restaurant-editor-save-review-annotated-desktop.png",
      title: "Save Review Before Publish",
      annotations: [
        { selector: "[role='dialog']", label: "Pre-publish review modal" },
        { text: /Confirm everything looks right before saving/i, label: "Reminder to review before publishing" },
        { selector: ".max-h-\\[52vh\\]", label: "Grouped list of pending changes that will be published" },
        { role: "button", name: /Cancel save/i, label: "Discard the staged save review" },
        { role: "button", name: /Confirm & Save/i, label: "Publish the reviewed changes to the live site" },
      ],
    });
    await closeSaveReviewModal(page);
    await gotoStable(page, editorPath);
    await page.waitForSelector(".restaurant-editor", { timeout: 25000 });
  }
}

async function captureViewerSequence(page, viewerPath) {
  await setManagerMode(page, "customer");
  await gotoStable(page, viewerPath);
  await page.waitForSelector(".restaurant-viewer", { timeout: 20000 });

  await captureAnnotated(page, {
    fileName: "restaurant-viewer-reference-banner-annotated-desktop.png",
    title: "Viewer First-Look State",
    annotations: [
      { selector: ".restaurant-preference-wrap", label: "Saved allergen and diet preferences" },
      { selector: ".restaurant-legend", label: "Compatibility legend and viewing guidance" },
      { selector: ".restaurant-reference-banner", label: "Reference-only warning that must be acknowledged" },
      { selector: ".restaurant-menu-stage.is-locked", label: "Menu surface stays locked until the notice is acknowledged" },
    ],
  });

  await dismissViewerReferenceBanner(page);

  await captureAnnotated(page, {
    fileName: "restaurant-viewer-overview-annotated-desktop.png",
    title: "Viewer Validation Overview",
    annotations: [
      { selector: ".restaurant-preference-wrap", label: "Saved allergen and diet preferences" },
      { selector: ".restaurant-legend", label: "Complies / modifiable / cannot-modify legend" },
      { selector: ".restaurant-menu-page", label: "Menu image browsing surface" },
      { selector: ".restaurant-overlay", label: "Dish-level compatibility overlays" },
    ],
  });

  const firstOverlay = page.locator(".restaurant-overlay").first();
  if ((await firstOverlay.count()) > 0) {
    const stageLock = page.locator(".restaurant-menu-stage.is-locked").first();
    if ((await stageLock.count()) > 0) {
      await stageLock.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
    }

    await firstOverlay.click({ timeout: 8000 });
    await page.waitForSelector(".restaurant-dish-popover", { timeout: 10000 });

    await captureAnnotated(page, {
      fileName: "restaurant-viewer-dish-popover-annotated-desktop.png",
      title: "Dish Detail Validation",
      annotations: [
        { selector: ".restaurant-dish-popover", label: "Dish-detail panel" },
        { selector: ".restaurant-dish-popover-toggle-btn", label: "Switch between ingredient list and compatibility reasoning" },
        { selector: ".restaurant-dish-popover-favorite-btn", label: "Favorite toggle that feeds loves analytics" },
        { selector: ".restaurant-dish-order-btn", label: "Add the dish to the notice dashboard" },
        { selector: ".restaurant-dish-popover-section", label: "Allergen and diet reasoning blocks" },
      ],
    });

    await page.getByRole("button", { name: /Add to order/i }).first().click();
    await pause(page, 600);

    const sidebar = page.locator(".restaurant-order-sidebar").first();
    if ((await sidebar.count()) > 0) {
      await captureAnnotated(page, {
        fileName: "restaurant-viewer-order-sidebar-annotated-desktop.png",
        title: "Notice Dashboard Sidebar",
        annotations: [
          { selector: ".restaurant-order-sidebar-header", label: "Notice-dashboard header with refresh and badge count" },
          { text: "Pending notices", label: "Selected dishes waiting to be confirmed" },
          { selector: ".restaurant-order-sidebar-item", label: "Each dish selected for the current notice" },
          { selector: ".restaurant-order-sidebar-actions", label: "Proceed to confirmation once the dish list is ready" },
        ],
      });

      const proceedButton = page.getByRole("button", { name: /Proceed to confirmation/i }).first();
      if ((await proceedButton.count()) > 0) {
        await proceedButton.click();
        await page.waitForSelector(".restaurant-order-confirm-drawer.show", { timeout: 10000 });
        await pause(page, 250);

        await captureAnnotated(page, {
          fileName: "restaurant-viewer-order-confirm-annotated-desktop.png",
          title: "Notice Confirmation Drawer",
          annotations: [
            { text: "Send allergy and diet notice", label: "Final notice-confirmation drawer" },
            { text: "Dishes in this notice", label: "Selected dishes and compatibility summary" },
            { text: "Your name", label: "Diner-name field" },
            { text: "Dining mode", label: "Dine-in versus delivery selector" },
            { role: "button", name: /Submit notice/i, label: "Submit the confirmed notice to the restaurant workflow" },
          ],
        });

        const closeButton = page.getByRole("button", { name: /Close notice drawer/i }).first();
        if ((await closeButton.count()) > 0) {
          await closeButton.click();
          await pause(page, 250);
        }
      }
    }
  }
}

async function captureServerTabletSequence(page) {
  await setManagerMode(page, "editor");
  await gotoStable(page, "/server-tablet");
  await page.getByRole("heading", { name: /Server monitor/i }).first().waitFor({ timeout: 15000 });
  await ensureServerActionCardVisible(page);

  await captureAnnotated(page, {
    fileName: "server-tablet-overview-annotated-desktop.png",
    title: "Server Tablet Overview",
    annotations: [
      { role: "heading", name: /Server monitor/i, label: "Server-tablet heading and purpose" },
      { role: "button", name: /Refresh orders/i, label: "Manual refresh for the queue" },
      { selector: ".tablet-filters", label: "Completed/rescinded filter" },
      { selector: ".server-tabs", label: "Server tabs when multiple staff members have active notices" },
      { selector: ".server-order-card", label: "Server notice card with diner, dish, and restriction context" },
      { selector: ".server-order-actions", label: "Approve, dispatch, or reject actions" },
    ],
  });

  if (await openServerRejectModal(page)) {
    await captureAnnotated(page, {
      fileName: "server-tablet-reject-modal-annotated-desktop.png",
      title: "Server Tablet Reject Flow",
      annotations: [
        { selector: ".server-modal", label: "Reject-notice dialog" },
        { text: /Reject .*notice/i, label: "Rejection confirmation prompt" },
        { selector: ".server-modal textarea", label: "Optional message explaining what the diner must fix" },
        { role: "button", name: /Confirm rejection/i, label: "Send the rejection back to the diner" },
      ],
    });
    await closeServerRejectModal(page);
  }
}

async function captureKitchenTabletSequence(page) {
  await setManagerMode(page, "editor");
  await gotoStable(page, "/kitchen-tablet");
  await page.getByRole("heading", { name: /Kitchen monitor/i }).first().waitFor({ timeout: 15000 });

  await captureAnnotated(page, {
    fileName: "kitchen-tablet-overview-annotated-desktop.png",
    title: "Kitchen Tablet Overview",
    annotations: [
      { role: "heading", name: /Kitchen monitor/i, label: "Kitchen-tablet heading and purpose" },
      { role: "button", name: /Refresh orders/i, label: "Manual queue refresh" },
      { selector: ".tablet-filters", label: "Completed/rescinded filter" },
      { selector: ".kitchen-card", label: "Kitchen notice card" },
      { selector: ".kitchen-action-row", label: "Acknowledge, follow-up, and reject controls" },
      { selector: ".ack-log", label: "Acknowledgement history for the current notice" },
    ],
  });

  if (await openKitchenPromptModal(page)) {
    await captureAnnotated(page, {
      fileName: "kitchen-tablet-followup-modal-annotated-desktop.png",
      title: "Kitchen Follow-Up Question",
      annotations: [
        { selector: ".kitchen-prompt-modal", label: "Kitchen follow-up modal" },
        { selector: ".kitchen-prompt-modal textarea", label: "Question text that will be sent back to the diner" },
        { role: "button", name: /^Cancel$/i, label: "Close the prompt without sending" },
        { role: "button", name: /Send question/i, label: "Submit the follow-up question to the diner" },
      ],
    });
    await closeKitchenPromptModal(page);
  }
}

async function captureSupportSequence(page) {
  await setManagerMode(page, "editor");

  await gotoStable(page, "/help-contact");
  await page.getByRole("heading", { name: /^Help$/i }).first().waitFor({ timeout: 15000 });
  await captureAnnotated(page, {
    fileName: "manager-help-overview-annotated-desktop.png",
    title: "Manager Help Center",
    annotations: [
      { selector: "header", label: "Manager topbar still available while in help" },
      { selector: "#helpSearchPanel", label: "Help assistant search and conversation panel" },
      { text: "Direct chat with Clarivore administrator", label: "Manager-to-admin support thread" },
      { text: "Report an issue", label: "Issue-report form for operational problems" },
      { role: "button", name: /^Ask$/i, label: "Send the current help-assistant question" },
    ],
  });

  await gotoStable(page, "/account");
  await page.getByRole("heading", { name: /Your information/i }).first().waitFor({ timeout: 15000 });
  await captureAnnotated(page, {
    fileName: "manager-account-overview-annotated-desktop.png",
    title: "Manager Account Settings",
    annotations: [
      { selector: "header", label: "Manager navigation remains available in account settings" },
      { text: "Your information", label: "Profile-information section" },
      { selector: "input[placeholder='First name']", label: "First-name field" },
      { selector: "input[placeholder='Last name']", label: "Last-name field" },
      { selector: "input[placeholder='Email']", label: "Email field" },
      { role: "button", name: /Sign out/i, label: "End the current session" },
      { role: "button", name: /Delete account/i, label: "Open destructive account-deletion confirmation" },
      { role: "link", name: /Report an issue/i, label: "Jump to the standalone issue-report page" },
    ],
  });
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
  await setManagerMode(page, "editor");
  await gotoStable(page, "/manager-dashboard");

  await captureDashboardSequence(page);

  const editorPath = await resolveEditorPathFromDashboard(page);
  if (!editorPath) {
    console.log("No editor link found from dashboard; skipping editor and downstream captures.");
    await captureSupportSequence(page);
    await context.close();
    return;
  }

  await captureEditorSequence(page, editorPath);

  const viewerPath = viewerPathFromEditorPath(editorPath);
  if (viewerPath) {
    await captureViewerSequence(page, viewerPath);
  }

  await captureServerTabletSequence(page);
  await captureKitchenTabletSequence(page);
  await captureSupportSequence(page);

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
      await setManagerMode(page, "editor");
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
