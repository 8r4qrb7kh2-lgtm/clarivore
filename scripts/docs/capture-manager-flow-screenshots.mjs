#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const outputDir = path.join(repoRoot, "docs", "manager-flows", "screenshots");
const baseUrl = process.env.DOCS_BASE_URL || "http://127.0.0.1:8081";
const targetSlug = process.env.DOCS_MANAGER_TARGET_SLUG || "demo-menu";
const managerEmail = process.env.DOCS_MANAGER_EMAIL || "manager-guide-demo@clarivore.local";
const managerPassword = process.env.DOCS_MANAGER_PASSWORD || "ClarivoreDocs123!";
const managerFirstName = process.env.DOCS_MANAGER_FIRST_NAME || "Guide";
const managerLastName = process.env.DOCS_MANAGER_LAST_NAME || "Manager";
const captureSegment = String(process.env.DOCS_CAPTURE_SEGMENT || "").trim().toLowerCase() || "full";

const DESKTOP = { width: 1720, height: 1180 };

function stepFile(index, slug) {
  return `${String(index).padStart(2, "0")}-${slug}.png`;
}

function stepFileVariant(index, variantIndex, slug) {
  if (variantIndex <= 0) return stepFile(index, slug);
  let value = variantIndex;
  let suffix = "";
  while (value > 0) {
    value -= 1;
    suffix = String.fromCharCode(97 + (value % 26)) + suffix;
    value = Math.floor(value / 26);
  }
  return stepFile(`${index}${suffix}`, slug);
}

function joinUrl(targetPath) {
  return `${baseUrl.replace(/\/$/u, "")}${targetPath.startsWith("/") ? "" : "/"}${targetPath}`;
}

function editorPath() {
  return `/restaurant/?slug=${encodeURIComponent(targetSlug)}&edit=1`;
}

function viewerPath() {
  return `/restaurant/?slug=${encodeURIComponent(targetSlug)}`;
}

function setupScriptPath() {
  return path.join(repoRoot, "scripts", "docs", "setup-manager-guide-demo.mjs");
}

async function pause(page, ms = 350) {
  await page.waitForTimeout(ms);
}

async function gotoStable(page, targetPath) {
  await page.goto(joinUrl(targetPath), { waitUntil: "networkidle" });
  await pause(page, 450);
}

async function clearOutputDir() {
  await fs.mkdir(outputDir, { recursive: true });
  const entries = await fs.readdir(outputDir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
      .map((entry) => fs.unlink(path.join(outputDir, entry.name))),
  );
}

function runSetupScenario(scenario) {
  execFileSync(process.execPath, [setupScriptPath()], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      DOCS_MANAGER_SCENARIO: scenario,
    },
  });
}

function resolveLocator(page, target) {
  if (typeof target?.locator === "function") {
    return target.locator(page);
  }
  if (target?.selector) {
    return page.locator(target.selector);
  }
  if (target?.role) {
    return page.getByRole(target.role, {
      name: target.name,
      exact: Boolean(target.exact),
    });
  }
  if (target?.text) {
    return page.getByText(target.text, { exact: Boolean(target.exact) });
  }
  throw new Error("Unsupported step target.");
}

async function resolveBox(page, target) {
  const locator = resolveLocator(page, target);
  const count = await locator.count();
  if (count < 1) {
    throw new Error(`Unable to locate step target for ${JSON.stringify(target)}`);
  }

  const nextIndex = Math.min(Math.max(0, Number(target.nth) || 0), count - 1);
  const nextTarget = locator.nth(nextIndex);
  await nextTarget.scrollIntoViewIfNeeded().catch(() => {});
  await pause(page, 120);
  const box = await nextTarget.boundingBox();
  if (!box || box.width < 2 || box.height < 2) {
    throw new Error(`Invalid bounding box for ${JSON.stringify(target)}`);
  }
  return box;
}

async function clearOverlay(page) {
  await page.evaluate(() => {
    document.getElementById("__docs-step-overlay")?.remove();
  });
}

async function drawStepOverlay(page, { instruction, box, placement = "auto" }) {
  await page.evaluate(
    ({ payloadInstruction, payloadBox, payloadPlacement }) => {
      document.getElementById("__docs-step-overlay")?.remove();

      const root = document.createElement("div");
      root.id = "__docs-step-overlay";
      root.style.position = "fixed";
      root.style.left = "0";
      root.style.top = "0";
      root.style.width = "100vw";
      root.style.height = "100vh";
      root.style.pointerEvents = "none";
      root.style.zIndex = "2147483647";

      const margin = 18;
      const gap = 30;
      const labelWidth = 340;
      const labelHeight = 84;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const paddedBox = {
        x: Math.max(payloadBox.x - 4, 6),
        y: Math.max(payloadBox.y - 4, 6),
        width: payloadBox.width + 8,
        height: payloadBox.height + 8,
      };

      const targetCenterX = paddedBox.x + paddedBox.width / 2;
      const targetCenterY = paddedBox.y + paddedBox.height / 2;
      let nextPlacement = payloadPlacement;
      if (nextPlacement === "auto") {
        nextPlacement = targetCenterX < viewportWidth / 2 ? "right" : "left";
      }

      const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
      const label = { x: margin, y: margin, width: labelWidth, height: labelHeight };
      let anchorX = 0;
      let anchorY = 0;

      if (nextPlacement === "left") {
        label.x = clamp(
          paddedBox.x - label.width - gap,
          margin,
          viewportWidth - label.width - margin,
        );
        label.y = clamp(
          targetCenterY - label.height / 2,
          margin,
          viewportHeight - label.height - margin,
        );
        anchorX = label.x + label.width;
        anchorY = label.y + label.height / 2;
      } else if (nextPlacement === "top") {
        label.x = clamp(
          targetCenterX - label.width / 2,
          margin,
          viewportWidth - label.width - margin,
        );
        label.y = clamp(
          paddedBox.y - label.height - gap,
          margin,
          viewportHeight - label.height - margin,
        );
        anchorX = label.x + label.width / 2;
        anchorY = label.y + label.height;
      } else if (nextPlacement === "bottom") {
        label.x = clamp(
          targetCenterX - label.width / 2,
          margin,
          viewportWidth - label.width - margin,
        );
        label.y = clamp(
          paddedBox.y + paddedBox.height + gap,
          margin,
          viewportHeight - label.height - margin,
        );
        anchorX = label.x + label.width / 2;
        anchorY = label.y;
      } else {
        label.x = clamp(
          paddedBox.x + paddedBox.width + gap,
          margin,
          viewportWidth - label.width - margin,
        );
        label.y = clamp(
          targetCenterY - label.height / 2,
          margin,
          viewportHeight - label.height - margin,
        );
        anchorX = label.x;
        anchorY = label.y + label.height / 2;
      }

      const lineDx = targetCenterX - anchorX;
      const lineDy = targetCenterY - anchorY;
      const lineLength = Math.max(Math.hypot(lineDx, lineDy), 1);
      const lineAngle = (Math.atan2(lineDy, lineDx) * 180) / Math.PI;

      const highlight = document.createElement("div");
      highlight.style.position = "fixed";
      highlight.style.left = `${paddedBox.x}px`;
      highlight.style.top = `${paddedBox.y}px`;
      highlight.style.width = `${paddedBox.width}px`;
      highlight.style.height = `${paddedBox.height}px`;
      highlight.style.borderRadius = "12px";
      highlight.style.border = "3px solid #f97316";
      highlight.style.background = "rgba(249, 115, 22, 0.14)";
      highlight.style.boxShadow = "0 0 0 2px rgba(255,255,255,0.85) inset";

      const targetDot = document.createElement("div");
      targetDot.style.position = "fixed";
      targetDot.style.left = `${targetCenterX - 8}px`;
      targetDot.style.top = `${targetCenterY - 8}px`;
      targetDot.style.width = "16px";
      targetDot.style.height = "16px";
      targetDot.style.borderRadius = "999px";
      targetDot.style.background = "#f97316";
      targetDot.style.boxShadow = "0 0 0 5px rgba(249, 115, 22, 0.24)";

      const line = document.createElement("div");
      line.style.position = "fixed";
      line.style.left = `${anchorX}px`;
      line.style.top = `${anchorY - 2}px`;
      line.style.width = `${lineLength}px`;
      line.style.height = "4px";
      line.style.transformOrigin = "0 50%";
      line.style.transform = `rotate(${lineAngle}deg)`;
      line.style.background = "#f97316";
      line.style.borderRadius = "999px";
      line.style.boxShadow = "0 1px 4px rgba(0,0,0,0.22)";

      const arrowHead = document.createElement("div");
      arrowHead.style.position = "fixed";
      arrowHead.style.left = `${targetCenterX - 10}px`;
      arrowHead.style.top = `${targetCenterY - 10}px`;
      arrowHead.style.width = "0";
      arrowHead.style.height = "0";
      arrowHead.style.borderTop = "10px solid transparent";
      arrowHead.style.borderBottom = "10px solid transparent";
      arrowHead.style.borderLeft = "16px solid #f97316";
      arrowHead.style.transformOrigin = "50% 50%";
      arrowHead.style.transform = `rotate(${lineAngle}deg)`;

      const labelWrap = document.createElement("div");
      labelWrap.style.position = "fixed";
      labelWrap.style.left = `${label.x}px`;
      labelWrap.style.top = `${label.y}px`;
      labelWrap.style.width = `${label.width}px`;
      labelWrap.style.minHeight = `${label.height}px`;
      labelWrap.style.display = "flex";
      labelWrap.style.alignItems = "center";
      labelWrap.style.padding = "14px 16px";
      labelWrap.style.borderRadius = "16px";
      labelWrap.style.background = "rgba(15, 23, 42, 0.96)";
      labelWrap.style.border = "1px solid rgba(251, 146, 60, 0.75)";
      labelWrap.style.boxShadow = "0 12px 32px rgba(0,0,0,0.35)";
      labelWrap.style.color = "#fff7ed";
      labelWrap.style.font = "700 19px/1.35 ui-sans-serif, system-ui, -apple-system";
      labelWrap.textContent = payloadInstruction;

      root.appendChild(line);
      root.appendChild(arrowHead);
      root.appendChild(highlight);
      root.appendChild(targetDot);
      root.appendChild(labelWrap);
      document.body.appendChild(root);
    },
    {
      payloadInstruction: instruction,
      payloadBox: box,
      payloadPlacement: placement,
    },
  );
}

async function captureStep(page, { fileName, instruction, target, placement = "auto", preCapture }) {
  if (typeof preCapture === "function") {
    await preCapture();
  }
  const box = await resolveBox(page, target);
  await drawStepOverlay(page, { instruction, box, placement });
  await page.screenshot({
    path: path.join(outputDir, fileName),
    fullPage: false,
  });
  await clearOverlay(page);
}

async function loginAsManager(page) {
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

async function closeModalByButton(page, pattern) {
  const dialog = page.locator("[role='dialog']").last();
  if ((await dialog.count()) < 1) return false;
  const button = dialog.getByRole("button", { name: pattern }).first();
  if ((await button.count()) < 1) return false;
  await button.click();
  await pause(page, 300);
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

async function ensureServerActionCardVisible(page, timeout = 45000) {
  const actionable = page
    .getByRole("button", { name: /Approve & stage for kitchen|Send to kitchen/i })
    .first();
  const tabs = page.locator(".server-tab");
  const emptyState = page.getByText(/Waiting for diners to submit codes|No active notices/i).first();
  const start = Date.now();
  let tabIndex = 0;
  let reloadCount = 0;

  while (Date.now() - start < timeout) {
    if ((await actionable.count()) > 0 && (await actionable.isVisible().catch(() => false))) {
      return true;
    }

    const count = await tabs.count();
    if (count > 0) {
      await tabs.nth(tabIndex % count).click();
      tabIndex += 1;
      await pause(page, 300);
      continue;
    }

    if (
      (await emptyState.count()) > 0 &&
      (await emptyState.isVisible().catch(() => false)) &&
      reloadCount < 2
    ) {
      await page.reload({ waitUntil: "networkidle" });
      reloadCount += 1;
      await pause(page, 600);
      continue;
    }

    await pause(page, 500);
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

async function ensureKitchenQuestionActionVisible(page, timeout = 45000) {
  const questionButton = page.getByRole("button", { name: /Send follow-up question/i }).first();
  const emptyState = page.getByText(/Waiting for server handoff|No active notices/i).first();
  const start = Date.now();
  let reloadCount = 0;

  while (Date.now() - start < timeout) {
    if ((await questionButton.count()) > 0 && (await questionButton.isVisible().catch(() => false))) {
      return true;
    }

    if (
      (await emptyState.count()) > 0 &&
      (await emptyState.isVisible().catch(() => false)) &&
      reloadCount < 2
    ) {
      await page.reload({ waitUntil: "networkidle" });
      reloadCount += 1;
      await pause(page, 600);
      continue;
    }

    await pause(page, 500);
  }

  return false;
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
      // Best effort only.
    }
  }

  const addOverlayButton = page.getByRole("button", { name: /Add overlay/i }).first();
  if ((await addOverlayButton.count()) > 0) {
    await addOverlayButton.click();
    await pause(page, 350);
  }

  return (await saveButton.count()) > 0;
}

async function openSaveReviewModal(page) {
  const prepared = await createTemporaryEditorChange(page);
  if (!prepared) return false;
  const saveButton = page.getByRole("button", { name: /Save to site/i }).first();
  if ((await saveButton.count()) < 1) return false;
  await saveButton.click();
  await page.waitForSelector("[role='dialog']", { timeout: 30000 });
  await page.getByText(/Review your changes/i).first().waitFor({ timeout: 30000 });
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

async function createSyntheticCardImage(browser, fileStem, html, viewport = { width: 1200, height: 900 }) {
  const tempDir = path.join(outputDir, ".tmp");
  await fs.mkdir(tempDir, { recursive: true });
  const imagePath = path.join(tempDir, `${fileStem}.png`);
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  try {
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8" />
      <style>
        html, body { margin: 0; padding: 0; background: #eef2ff; }
        body { font-family: "Helvetica Neue", Arial, sans-serif; }
      </style></head><body>${html}</body></html>`,
    );
    await page.locator("#card").screenshot({ path: imagePath });
    return imagePath;
  } finally {
    await context.close();
  }
}

async function createProductFrontImage(browser, fileStem, { productName, subtitle }) {
  return await createSyntheticCardImage(
    browser,
    fileStem,
    `
      <div id="card" style="width:900px;height:1200px;background:linear-gradient(180deg,#fef3c7 0%,#fdba74 100%);display:flex;align-items:center;justify-content:center;">
        <div style="width:760px;height:1040px;background:#fff7ed;border-radius:42px;border:18px solid #7c2d12;box-shadow:0 30px 80px rgba(0,0,0,0.18);padding:58px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;">
          <div>
            <div style="font-size:46px;font-weight:800;letter-spacing:0.14em;color:#9a3412;text-transform:uppercase;">Clarivore Pantry</div>
            <div style="margin-top:26px;font-size:104px;line-height:1.03;font-weight:900;color:#1f2937;">${productName}</div>
            <div style="margin-top:22px;font-size:42px;line-height:1.3;color:#7c2d12;">${subtitle}</div>
          </div>
          <div style="height:380px;border-radius:34px;background:radial-gradient(circle at top left,#f59e0b 0%,#ea580c 55%,#9a3412 100%);position:relative;overflow:hidden;">
            <div style="position:absolute;left:48px;top:56px;width:240px;height:240px;border-radius:999px;background:rgba(255,255,255,0.26);"></div>
            <div style="position:absolute;right:52px;bottom:48px;width:300px;height:180px;border-radius:28px;background:rgba(255,255,255,0.22);"></div>
            <div style="position:absolute;left:54px;bottom:54px;font-size:34px;font-weight:800;color:#fff;">Front of package</div>
          </div>
        </div>
      </div>
    `,
    { width: 1000, height: 1300 },
  );
}

async function createIngredientLabelImage(browser, fileStem, { heading, lines }) {
  const safeLines = (Array.isArray(lines) ? lines : [])
    .map((line) => `<div style="margin-top:14px;">${line}</div>`)
    .join("");
  return await createSyntheticCardImage(
    browser,
    fileStem,
    `
      <div id="card" style="width:1100px;height:1400px;background:#f8fafc;display:flex;align-items:center;justify-content:center;padding:60px;box-sizing:border-box;">
        <div style="width:900px;background:white;border:10px solid #0f172a;border-radius:28px;padding:56px 60px;box-shadow:0 24px 60px rgba(15,23,42,0.18);box-sizing:border-box;">
          <div style="font-size:64px;font-weight:900;color:#0f172a;">${heading}</div>
          <div style="margin-top:28px;font-size:34px;line-height:1.4;color:#111827;">
            ${safeLines}
          </div>
        </div>
      </div>
    `,
    { width: 1200, height: 1500 },
  );
}

async function uploadViaFileChooser(page, clickTarget, filePath) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), clickTarget()]);
  await chooser.setFiles(filePath);
  await pause(page, 300);
}

async function waitForEnabled(locator, timeout = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await locator.count()) > 0 && (await locator.isEnabled())) {
      return true;
    }
    await locator.page().waitForTimeout(400);
  }
  return false;
}

async function waitForIngredientRows(page, minimum = 1, timeout = 90000) {
  const start = Date.now();
  const list = page.locator(".restaurant-editor-dish-ingredient-card");
  while (Date.now() - start < timeout) {
    if ((await list.count()) >= minimum) {
      const overlay = page.locator(".restaurant-editor-dish-generation-overlay");
      if ((await overlay.count()) < 1 || !(await overlay.first().isVisible().catch(() => false))) {
        return true;
      }
    }
    await pause(page, 500);
  }
  return (await list.count()) >= minimum;
}

async function waitForBrandAssignmentButtons(page, rowIndex = 0, timeout = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const row = page.locator(".restaurant-editor-dish-ingredient-card").nth(rowIndex);
    if ((await row.count()) > 0) {
      const searchButton = row.getByRole("button", { name: /Search existing items/i });
      if ((await searchButton.count()) > 0) {
        return row;
      }
    }
    await pause(page, 400);
  }
  throw new Error("Brand assignment buttons did not appear on the target ingredient row.");
}

async function buildConfirmationCardUploads(dialog) {
  const page = dialog.page();
  const captureInputs = dialog.locator("input[type='file'][capture='environment']");
  const inputCount = await captureInputs.count();
  if (inputCount < 1) return [];

  const baselineSources = await dialog
    .locator("img[alt*='baseline']")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("src") || "").filter(Boolean));

  if (!baselineSources.length) return [];

  const localCopies = [];
  for (let i = 0; i < inputCount; i += 1) {
    const source = baselineSources[Math.min(i, baselineSources.length - 1)];
    const copyPath = await createLocalCopyFromUrl(source, `confirm-card-${Date.now()}-${i}`);
    if (copyPath) {
      localCopies.push(copyPath);
    }
  }

  if (!localCopies.length) return [];
  await pause(page, 150);
  return localCopies;
}

async function captureConfirmationCardSequence(page, {
  dialog,
  baseIndex,
  slugPrefix,
  cardLabel,
}) {
  const uploads = await buildConfirmationCardUploads(dialog);
  if (!uploads.length) return 0;

  const captureInputs = dialog.locator("input[type='file'][capture='environment']");
  const inputCount = await captureInputs.count();
  for (let i = 0; i < inputCount; i += 1) {
    await captureStep(page, {
      fileName: stepFileVariant(baseIndex, i, `${slugPrefix}-${i + 1}`),
      instruction: `Click Capture photo of current version on ${cardLabel} ${i + 1}.`,
      target: {
        locator: () =>
          dialog.getByRole("button", { name: /Capture photo of current version/i }).nth(i),
      },
      placement: "left",
    });
    const sourcePath = uploads[Math.min(i, uploads.length - 1)];
    await captureInputs.nth(i).setInputFiles(sourcePath);
    await pause(page, 250);
  }

  return inputCount;
}

async function captureScanLineConfirmationSequence(page, {
  dialog,
  baseIndex,
  slugPrefix,
  instructionPrefix,
}) {
  const confirmButtons = dialog.getByRole("button", { name: /^Confirm$/i });
  let confirmCount = await confirmButtons.count();
  let index = 0;

  while (confirmCount > 0) {
    await captureStep(page, {
      fileName: stepFileVariant(baseIndex, index + 1, `${slugPrefix}-${index + 1}`),
      instruction: `${instructionPrefix} scanned label line ${index + 1}.`,
      target: {
        locator: () => dialog.getByRole("button", { name: /^Confirm$/i }).first(),
      },
      placement: "left",
    });
    await dialog.getByRole("button", { name: /^Confirm$/i }).first().click();
    await pause(page, 250);
    index += 1;
    confirmCount = await confirmButtons.count();
  }

  return index;
}

async function waitForConfirmationContinue(page, timeout = 60000) {
  const continueButton = page.getByRole("button", { name: /Continue to brand items/i }).first();
  return await waitForEnabled(continueButton, timeout);
}

async function waitForConfirmationSubmit(page, timeout = 60000) {
  const confirmButton = page
    .getByRole("button", { name: /Confirm information is up-to-date/i })
    .last();
  return await waitForEnabled(confirmButton, timeout);
}

async function ensureChatOpen(page) {
  const input = page.locator("input[placeholder='Message Clarivore']").first();
  if ((await input.count()) > 0) return true;
  const summary = page.locator(".restaurant-chat-preview summary").first();
  if ((await summary.count()) > 0) {
    await summary.click();
    await pause(page, 250);
  }
  return (await input.count()) > 0;
}

async function openDishAnalyticsModal(page) {
  const overlay = page.locator(".heatmap-overlay").first();
  if ((await overlay.count()) < 1) return false;
  await overlay.click();
  await page.waitForSelector("#dish-analytics-modal.show", { timeout: 10000 });
  await pause(page, 250);
  return true;
}

async function closeDishAnalyticsModal(page) {
  const closeButton = page.locator("#dish-analytics-close").first();
  if ((await closeButton.count()) < 1) return false;
  await closeButton.click();
  await pause(page, 250);
  return true;
}

async function createFoundationOverlay(page) {
  const addOverlayButton = page.getByRole("button", { name: /Add overlay/i }).first();
  if ((await addOverlayButton.count()) < 1) return false;
  await addOverlayButton.click();
  await pause(page, 250);

  const stage = page.locator(".restaurant-editor-page").first();
  const box = await stage.boundingBox();
  if (!box) return false;

  const startX = box.x + box.width * 0.2;
  const startY = box.y + box.height * 0.22;
  const endX = box.x + box.width * 0.52;
  const endY = box.y + box.height * 0.3;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 14 });
  await page.mouse.up();
  await pause(page, 450);
  return (await page.locator(".editBox").count()) > 0;
}

async function openFirstEditorDish(page) {
  const editBadge = page.locator(".editBadge").first();
  if ((await editBadge.count()) < 1) return false;
  await editBadge.click();
  await page.waitForSelector(".restaurant-editor-dish-modal", { timeout: 12000 });
  await pause(page, 250);
  return true;
}

async function closeDishEditor(page) {
  const doneButton = page.getByRole("button", { name: /^Done$/i }).last();
  if ((await doneButton.count()) < 1) return false;
  await doneButton.click();
  await pause(page, 300);
  return true;
}

async function openWebpageEditorFromDashboard(page) {
  await setManagerMode(page, "editor");
  await gotoStable(page, "/manager-dashboard");
  await gotoStable(page, editorPath());
  const editorRoot = page.locator(".restaurant-editor").first();
  const viewerRoot = page.locator(".restaurant-viewer").first();
  const authGate = page.locator("#auth-required").first();
  const guestAccessHeading = page.getByText(/GUEST MENU ACCESS/i).first();

  for (let attempt = 0; attempt < 15; attempt += 1) {
    if ((await editorRoot.count()) > 0 && (await editorRoot.isVisible())) {
      return;
    }
    if ((await viewerRoot.count()) > 0 && (await viewerRoot.isVisible())) {
      await setManagerMode(page, "editor");
      await page.reload({ waitUntil: "networkidle" });
      await pause(page, 750);
      continue;
    }
    if ((await authGate.count()) > 0 && (await authGate.isVisible())) {
      await loginAsManager(page);
      await setManagerMode(page, "editor");
      await gotoStable(page, editorPath());
      continue;
    }
    if (
      page.url().includes("/guest") ||
      ((await guestAccessHeading.count()) > 0 &&
        (await guestAccessHeading.isVisible().catch(() => false)))
    ) {
      await loginAsManager(page);
      await setManagerMode(page, "editor");
      await gotoStable(page, editorPath());
      continue;
    }
    await pause(page, 1000);
  }

  const currentUrl = page.url();
  const bodyText = await page.locator("body").innerText().catch(() => "");
  throw new Error(
    `Editor did not load at ${currentUrl}. Body started with: ${String(bodyText).slice(0, 220)}`,
  );
}

async function openReplacementCaptureModal(page, replacementUrl, timeout = 90000) {
  const heading = page.getByRole("heading", { name: /Capture Product Front/i }).first();
  const guestAccessHeading = page.getByText(/GUEST MENU ACCESS/i).first();
  const editorRoot = page.locator(".restaurant-editor").first();
  const start = Date.now();
  let reloadCount = 0;

  while (Date.now() - start < timeout) {
    if ((await heading.count()) > 0 && (await heading.isVisible().catch(() => false))) {
      return true;
    }

    if (
      page.url().includes("/guest") ||
      ((await guestAccessHeading.count()) > 0 &&
        (await guestAccessHeading.isVisible().catch(() => false)))
    ) {
      await loginAsManager(page);
      await setManagerMode(page, "editor");
      await gotoStable(page, replacementUrl);
      continue;
    }

    if (
      (await editorRoot.count()) > 0 &&
      (await editorRoot.isVisible().catch(() => false)) &&
      replacementUrl &&
      reloadCount < 1 &&
      Date.now() - start > 20000
    ) {
      await gotoStable(page, replacementUrl);
      reloadCount += 1;
      continue;
    }

    await pause(page, 1000);
  }

  return false;
}

async function prepareScenario(browser, scenario) {
  runSetupScenario(scenario);
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  await loginAsManager(page);
  return { context, page };
}

async function captureAccessWorkflow(page) {
  await gotoStable(page, "/account?mode=signin");
  await captureStep(page, {
    fileName: stepFile(1, "sign-in-email"),
    instruction: "Type the manager email here.",
    target: { selector: "input[placeholder='Email']" },
    placement: "right",
  });
  await captureStep(page, {
    fileName: stepFile(2, "sign-in-password"),
    instruction: "Type the password here.",
    target: { selector: "input[placeholder='Password']" },
    placement: "right",
  });
  await captureStep(page, {
    fileName: stepFile(3, "sign-in-submit"),
    instruction: "Click Sign in to enter the manager workspace.",
    target: { role: "button", name: /^sign in$/i },
    placement: "right",
  });
}

async function captureFoundationWorkflow(page) {
  await setManagerMode(page, "editor");
  await gotoStable(page, "/manager-dashboard");

  await captureStep(page, {
    fileName: stepFile(4, "dashboard-open-editor"),
    instruction: "Click Webpage editor to start building the new restaurant.",
    target: { role: "link", name: /Webpage editor/i },
    placement: "left",
  });

  await openWebpageEditorFromDashboard(page);

  await captureStep(page, {
    fileName: stepFile(5, "editor-open-settings"),
    instruction: "Click Restaurant settings to enter the core restaurant details.",
    target: { selector: ".editorRestaurantSettingsBtn" },
    placement: "left",
  });
  await page.locator(".editorRestaurantSettingsBtn").first().click();
  await page.waitForSelector("[role='dialog']", { timeout: 10000 });
  await page.locator("label:has-text('Website') input").first().fill("https://demo-menu.example");
  await captureStep(page, {
    fileName: stepFile(6, "settings-website-field"),
    instruction: "Enter the restaurant website in this field.",
    target: { selector: "label:has-text('Website') input" },
    placement: "right",
  });
  await captureStep(page, {
    fileName: stepFile(7, "settings-save"),
    instruction: "Click Save after the restaurant details are filled in.",
    target: { role: "button", name: /^save$/i },
    placement: "left",
  });
  await closeModalByButton(page, /cancel|close/i);

  await captureStep(page, {
    fileName: stepFile(8, "editor-open-menu-images"),
    instruction: "Click Edit menu images when you need to add, replace, or reorder menu pages.",
    target: { role: "button", name: /edit menu images/i },
    placement: "left",
  });
  await page.getByRole("button", { name: /edit menu images/i }).first().click();
  await page.waitForSelector("[role='dialog']", { timeout: 10000 });
  await captureStep(page, {
    fileName: stepFile(9, "menu-images-add-page"),
    instruction: "Click Add Page to upload another menu page image.",
    target: { role: "button", name: /Add Page/i },
    placement: "right",
  });
  await captureStep(page, {
    fileName: stepFile(10, "menu-images-save"),
    instruction: "Click Save after the menu page list is ready.",
    target: { role: "button", name: /^save$/i },
    placement: "left",
  });
  await closeModalByButton(page, /cancel|close/i);

  await captureStep(page, {
    fileName: stepFile(11, "editor-add-overlay"),
    instruction: "Click Add overlay to start mapping a dish on the menu image.",
    target: { role: "button", name: /Add overlay/i },
    placement: "left",
  });
  await createFoundationOverlay(page);
  await captureStep(page, {
    fileName: stepFile(12, "editor-place-overlay"),
    instruction: "Drag on the menu image until the orange box matches the dish area.",
    target: { selector: ".editBox" },
    placement: "right",
  });
  await captureStep(page, {
    fileName: stepFile(13, "editor-open-dish"),
    instruction: "Click the pencil icon on the overlay to open the dish editor.",
    target: { selector: ".editBadge" },
    placement: "left",
  });

  await openFirstEditorDish(page);
  await page.locator(".restaurant-editor-dish-name-input").first().fill("Citrus Tofu Bowl");
  await page.locator(".restaurant-editor-dish-textarea").first().fill(
    "Press the extra-firm tofu for 20 minutes, toss it with tamari and lime juice, roast it until browned, then serve it over jasmine rice with sliced scallions.",
  );
  await captureStep(page, {
    fileName: stepFile(14, "dish-name-field"),
    instruction: "Type the menu item name in the Dish name field.",
    target: { selector: ".restaurant-editor-dish-name-input" },
    placement: "right",
  });
  await captureStep(page, {
    fileName: stepFile(15, "dish-recipe-text"),
    instruction: "Paste the full recipe or prep notes into this text box.",
    target: { selector: ".restaurant-editor-dish-textarea" },
    placement: "right",
  });
  await captureStep(page, {
    fileName: stepFile(16, "dish-process-input"),
    instruction: "Click Process Input to turn the recipe into ingredient rows.",
    target: { selector: ".restaurant-editor-dish-process-btn" },
    placement: "left",
  });
  runSetupScenario("foundation_review");
  await loginAsManager(page);
  await openWebpageEditorFromDashboard(page);
  await openFirstEditorDish(page);

  await captureStep(page, {
    fileName: stepFile(17, "dish-generated-rows"),
    instruction: "Review the generated rows. If they still show Applying..., wait for that to finish before editing them.",
    target: {
      locator: (nextPage) =>
        nextPage.locator(".restaurant-editor-dish-ingredient-name-input").first(),
    },
    placement: "right",
  });
  await captureStep(page, {
    fileName: stepFile(18, "dish-add-ingredient"),
    instruction: "Click Add ingredient when the recipe needs another manual row.",
    target: { role: "button", name: /Add ingredient/i },
    placement: "left",
  });
  await page.getByRole("button", { name: /Add ingredient/i }).first().click();
  await pause(page, 300);
  await captureStep(page, {
    fileName: stepFile(19, "dish-new-ingredient-name"),
    instruction: "Type the missing ingredient name in this new row.",
    target: {
      locator: (nextPage) =>
        nextPage
          .locator(".restaurant-editor-dish-ingredient-card")
          .last()
          .locator(".restaurant-editor-dish-ingredient-name-input"),
    },
    placement: "right",
  });
  const manualRow = page.locator(".restaurant-editor-dish-ingredient-card").last();
  await manualRow.locator(".restaurant-editor-dish-ingredient-name-input").fill("lime zest");
  await pause(page, 250);
  await captureStep(page, {
    fileName: stepFile(20, "dish-apply-ingredient-name"),
    instruction: "Click Apply so Clarivore updates the new row after you type the ingredient name.",
    target: {
      locator: (nextPage) =>
        nextPage
          .locator(".restaurant-editor-dish-ingredient-card")
          .last()
          .getByRole("button", { name: /^Apply$/i }),
    },
    placement: "left",
  });
  await manualRow.getByRole("button", { name: /^Apply$/i }).click();
  runSetupScenario("foundation_manual_review");
  await loginAsManager(page);
  await openWebpageEditorFromDashboard(page);
  await openFirstEditorDish(page);
  const manualReadyRow = page.locator(".restaurant-editor-dish-ingredient-card").last();
  const manualMilkChip = manualReadyRow.getByRole("button", { name: /^Milk$/i });
  await captureStep(page, {
    fileName: stepFile(21, "dish-manual-allergen"),
    instruction: "Click the allergen chip until it matches the row you are editing.",
    target: {
      locator: (nextPage) =>
        nextPage
          .locator(".restaurant-editor-dish-ingredient-card")
          .last()
          .getByRole("button", { name: /^Milk$/i }),
    },
    placement: "right",
  });
  await manualMilkChip.click();
  await pause(page, 250);
  await captureStep(page, {
    fileName: stepFile(22, "dish-manual-diet"),
    instruction: "Click the diet chip until it matches the row you are editing.",
    target: {
      locator: (nextPage) =>
        nextPage
          .locator(".restaurant-editor-dish-ingredient-card")
          .last()
          .getByRole("button", { name: /^Vegan$/i }),
    },
    placement: "right",
  });
  await manualReadyRow.getByRole("button", { name: /^Vegan$/i }).click();
  await pause(page, 250);
  await captureStep(page, {
    fileName: stepFile(23, "dish-mark-confirmed"),
    instruction: "Click Mark confirmed after the ingredient row is fully reviewed.",
    target: {
      locator: (nextPage) =>
        nextPage
          .locator(".restaurant-editor-dish-ingredient-card")
          .last()
          .getByRole("button", { name: /Mark confirmed|Confirmed/i }),
    },
    placement: "left",
  });
  await manualReadyRow.getByRole("button", { name: /Mark confirmed|Confirmed/i }).click();
  await pause(page, 250);
  await captureStep(page, {
    fileName: stepFile(24, "dish-delete-ingredient"),
    instruction: "Click Delete to remove an ingredient row you no longer need.",
    target: {
      locator: (nextPage) =>
        nextPage
          .locator(".restaurant-editor-dish-ingredient-card")
          .last()
          .getByRole("button", { name: /^Delete$/i }),
    },
    placement: "left",
  });
}

async function captureExistingBrandAssignmentWorkflow(page) {
  await openWebpageEditorFromDashboard(page);
  await openFirstEditorDish(page);

  await captureStep(page, {
    fileName: stepFile(25, "dish-remove-current-brand"),
    instruction: "Click Remove item when the linked brand item is no longer correct.",
    target: {
      locator: (nextPage) =>
        nextPage.locator(".restaurant-editor-dish-ingredient-card").first().getByRole("button", {
          name: /Remove item/i,
        }),
    },
    placement: "left",
  });
  await page
    .locator(".restaurant-editor-dish-ingredient-card")
    .first()
    .getByRole("button", { name: /Remove item/i })
    .click();
  await waitForBrandAssignmentButtons(page, 0);

  await captureStep(page, {
    fileName: stepFile(26, "dish-search-existing-brand"),
    instruction: "Click Search existing items to assign a saved brand item from this menu.",
    target: {
      locator: (nextPage) =>
        nextPage.locator(".restaurant-editor-dish-ingredient-card").first().getByRole("button", {
          name: /Search existing items/i,
        }),
    },
    placement: "left",
  });
  await page
    .locator(".restaurant-editor-dish-ingredient-card")
    .first()
    .getByRole("button", { name: /Search existing items/i })
    .click();
  await pause(page, 250);

  const firstRow = page.locator(".restaurant-editor-dish-ingredient-card").first();
  await firstRow.locator(".restaurant-editor-dish-brand-search-input").fill("san-j");
  await pause(page, 250);
  await captureStep(page, {
    fileName: stepFile(27, "dish-brand-search-field"),
    instruction: "Type part of the product name into the brand search field.",
    target: {
      locator: (nextPage) =>
        nextPage
          .locator(".restaurant-editor-dish-ingredient-card")
          .first()
          .locator(".restaurant-editor-dish-brand-search-input"),
    },
    placement: "right",
  });
  await captureStep(page, {
    fileName: stepFile(28, "dish-select-existing-brand"),
    instruction: "Click the matching brand item to assign it to this ingredient row.",
    target: {
      locator: (nextPage) =>
        nextPage
          .locator(".restaurant-editor-dish-ingredient-card")
          .first()
          .getByRole("button", { name: /San-J Tamari Gluten Free Soy Sauce/i }),
    },
    placement: "right",
  });
}

async function captureNewBrandItemWorkflow(page, browser) {
  await openWebpageEditorFromDashboard(page);
  await openFirstEditorDish(page);

  const productFrontPath = await createProductFrontImage(browser, "add-brand-front", {
    productName: "Roasted Garlic Tamari",
    subtitle: "Small batch soy sauce",
  });
  const labelPath = await createIngredientLabelImage(browser, "add-brand-label", {
    heading: "INGREDIENTS",
    lines: [
      "Water, organic soybeans, sea salt, roasted garlic.",
      "Contains: soy.",
      "Gluten-free.",
    ],
  });

  const garlicRow = page
    .locator(".restaurant-editor-dish-ingredient-card")
    .filter({
      has: page.locator(".restaurant-editor-dish-ingredient-name-input[value='garlic']"),
    })
    .first();

  await captureStep(page, {
    fileName: stepFile(29, "dish-add-new-brand"),
    instruction: "Click Add new item if the ingredient needs a brand item that is not already saved.",
    target: {
      locator: () => garlicRow.getByRole("button", { name: /Add new item/i }),
    },
    placement: "left",
  });
  await garlicRow.getByRole("button", { name: /Add new item/i }).click();
  await page.getByRole("heading", { name: /Capture Product Front/i }).waitFor({ timeout: 15000 });

  const productFrontDialog = page.getByRole("dialog", { name: /Capture Product Front/i }).last();
  await captureStep(page, {
    fileName: stepFile(30, "scan-upload-front-photo"),
    instruction: "Click Upload Photo to add the front of the product package.",
    target: {
      locator: () => productFrontDialog.getByRole("button", { name: /Upload Photo/i }),
    },
    placement: "right",
  });
  await uploadViaFileChooser(
    page,
    () => productFrontDialog.getByRole("button", { name: /Upload Photo/i }).click(),
    productFrontPath,
  );
  const productNameInput = productFrontDialog.getByRole("textbox", { name: /Product Name/i });
  await productNameInput.fill("Roasted Garlic Tamari");
  await pause(page, 250);

  await captureStep(page, {
    fileName: stepFile(31, "scan-capture-label-button"),
    instruction: "Click Capture ingredient label image after the product front is correct.",
    target: {
      locator: () =>
        productFrontDialog.getByRole("button", { name: /Capture ingredient label image/i }),
    },
    placement: "left",
  });
  await productFrontDialog.getByRole("button", { name: /Capture ingredient label image/i }).click();
  const ingredientUploadButton = page.getByRole("button", { name: /Upload Photo/i }).first();
  if (!(await waitForEnabled(ingredientUploadButton, 15000))) {
    throw new Error("Ingredient label upload button did not appear for Add new item flow.");
  }
  await captureStep(page, {
    fileName: stepFile(32, "scan-upload-label-photo"),
    instruction: "Click Upload Photo to add the ingredient label image.",
    target: {
      locator: () => ingredientUploadButton,
    },
    placement: "right",
  });
  await uploadViaFileChooser(
    page,
    () => ingredientUploadButton.click(),
    labelPath,
  );

  const analyzeLabelButton = page.getByRole("button", { name: /^Analyze$/i }).first();
  await captureStep(page, {
    fileName: stepFile(33, "scan-analyze-label"),
    instruction: "Click Analyze so Clarivore can read the ingredient label.",
    target: {
      locator: () => analyzeLabelButton,
    },
    placement: "left",
  });
  await analyzeLabelButton.click();

  const reviewScanResultsButton = garlicRow.getByRole("button", {
    name: /Review scan results/i,
  });
  if (!(await waitForEnabled(reviewScanResultsButton, 90000))) {
    throw new Error("Review scan results did not become available for Add new item flow.");
  }
  await captureStep(page, {
    fileName: stepFile(34, "scan-review-results"),
    instruction: "Click Review scan results after the background analysis finishes.",
    target: {
      locator: () => reviewScanResultsButton,
    },
    placement: "left",
  });
  await reviewScanResultsButton.click();

  const reviewDialog = page.locator("[role='dialog']").last();
  const saveAndApply = reviewDialog.getByRole("button", { name: /Save & Apply Results/i }).first();
  await saveAndApply.waitFor({ timeout: 30000 });
  await captureScanLineConfirmationSequence(page, {
    dialog: reviewDialog,
    baseIndex: 34,
    slugPrefix: "scan-confirm-line",
    instructionPrefix: "Click Confirm for",
  });
  if (!(await waitForEnabled(saveAndApply, 90000))) {
    throw new Error("Save & Apply Results did not become enabled for Add new item flow.");
  }
  await captureStep(page, {
    fileName: stepFile(35, "scan-save-and-apply"),
    instruction: "Click Save & Apply Results to attach the new brand item to the row.",
    target: {
      locator: () => saveAndApply,
    },
    placement: "left",
  });
}

async function captureBrandAppealWorkflow(page, browser) {
  await openWebpageEditorFromDashboard(page);
  await openFirstEditorDish(page);

  const appealPhotoPath = await createProductFrontImage(browser, "brand-appeal-photo", {
    productName: "Prep Bin Photo",
    subtitle: "House-filled container without branded packaging",
  });

  await captureStep(page, {
    fileName: stepFile(36, "appeal-remove-current-brand"),
    instruction: "Click Remove item first if you need to appeal the brand-item requirement.",
    target: {
      locator: (nextPage) =>
        nextPage.locator(".restaurant-editor-dish-ingredient-card").first().getByRole("button", {
          name: /Remove item/i,
        }),
    },
    placement: "left",
  });
  await page
    .locator(".restaurant-editor-dish-ingredient-card")
    .first()
    .getByRole("button", { name: /Remove item/i })
    .click();
  const firstRow = await waitForBrandAssignmentButtons(page, 0);

  const submitAppealButton = firstRow.getByRole("button", { name: /Submit appeal/i });
  await submitAppealButton.waitFor({ timeout: 45000 });
  await captureStep(page, {
    fileName: stepFile(37, "appeal-open-form"),
    instruction: "Click Submit appeal if this ingredient should not require a brand item.",
    target: {
      locator: () => submitAppealButton,
    },
    placement: "left",
  });
  await submitAppealButton.click();
  await pause(page, 250);

  await captureStep(page, {
    fileName: stepFile(38, "appeal-message-field"),
    instruction: "Type the reason for the appeal in this message field.",
    target: {
      locator: () =>
        firstRow.locator(".restaurant-editor-dish-appeal-input"),
    },
    placement: "right",
  });
  await firstRow
    .locator(".restaurant-editor-dish-appeal-input")
    .fill("This tofu is portioned in-house from an unlabeled prep bin, so no branded package is available.");

  await captureStep(page, {
    fileName: stepFile(39, "appeal-upload-photo"),
    instruction: "Click Take/upload photo to attach the evidence photo for this appeal.",
    target: {
      locator: () =>
        firstRow.locator("label[for^='appeal-photo-']"),
    },
    placement: "right",
  });
  await firstRow.locator("input[type='file'][id^='appeal-photo-']").setInputFiles(appealPhotoPath);
  await pause(page, 350);

  await captureStep(page, {
    fileName: stepFile(40, "appeal-add-button"),
    instruction: "Click Add appeal to stage the appeal for this ingredient row.",
    target: {
      locator: () =>
        firstRow.getByRole("button", { name: /Add appeal/i }),
    },
    placement: "left",
  });
}

async function capturePublishWorkflow(page) {
  await openWebpageEditorFromDashboard(page);
  await captureStep(page, {
    fileName: stepFile(41, "editor-save-to-site"),
    instruction: "Click Save to site when you are ready to review a publish batch.",
    target: { role: "button", name: /Save to site/i },
    placement: "left",
    preCapture: async () => {
      await createTemporaryEditorChange(page);
    },
  });
  if (await openSaveReviewModal(page)) {
    await captureStep(page, {
      fileName: stepFile(42, "editor-confirm-save"),
      instruction: "Click Confirm & Save to publish the reviewed changes.",
      target: { role: "button", name: /Confirm & Save/i },
      placement: "left",
    });
  }
}

async function captureMonthlyConfirmationWorkflow(page) {
  await openWebpageEditorFromDashboard(page);
  await captureStep(page, {
    fileName: stepFile(43, "editor-open-confirmation"),
    instruction: "Click Confirm information is up-to-date to start monthly confirmation.",
    target: { role: "button", name: /Confirm information is up-to-date/i },
    placement: "left",
  });
  if (!(await openEditorConfirmationModal(page))) {
    throw new Error("Monthly confirmation modal did not open.");
  }

  const confirmationDialog = page.locator("[role='dialog']").last();
  const menuCardCount = await captureConfirmationCardSequence(page, {
    dialog: confirmationDialog,
    baseIndex: 44,
    slugPrefix: "confirmation-menu-capture",
    cardLabel: "menu page",
  });
  if (menuCardCount < 1) {
    throw new Error("No menu confirmation cards were available.");
  }

  const yesButtons = confirmationDialog.getByRole("button", { name: /^Yes$/i });
  await captureStep(page, {
    fileName: stepFile(45, "confirmation-dishes-visible"),
    instruction: "Click Yes after checking that every dish is visible in the menu photos.",
    target: {
      locator: () => yesButtons.nth(0),
    },
    placement: "right",
  });
  await yesButtons.nth(0).click();
  await pause(page, 200);

  await captureStep(page, {
    fileName: stepFile(46, "confirmation-most-current"),
    instruction: "Click Yes after checking that the photos show the most current menu.",
    target: {
      locator: () => yesButtons.nth(1),
    },
    placement: "right",
  });
  await yesButtons.nth(1).click();
  await pause(page, 300);

  if (!(await waitForConfirmationContinue(page, 90000))) {
    throw new Error("Continue to brand items did not become enabled.");
  }
  await captureStep(page, {
    fileName: stepFile(47, "confirmation-continue-brand"),
    instruction: "Click Continue to brand items after the menu pages are matched.",
    target: { role: "button", name: /Continue to brand items/i },
    placement: "left",
  });
  await page.getByRole("button", { name: /Continue to brand items/i }).first().click();
  await pause(page, 500);

  const brandCardCount = await captureConfirmationCardSequence(page, {
    dialog: confirmationDialog,
    baseIndex: 48,
    slugPrefix: "confirmation-brand-capture",
    cardLabel: "brand item",
  });
  if (brandCardCount < 1) {
    throw new Error("No brand confirmation cards were available.");
  }

  if (!(await waitForConfirmationSubmit(page, 90000))) {
    throw new Error("Final monthly confirmation button did not become enabled.");
  }
  await captureStep(page, {
    fileName: stepFile(49, "confirmation-final-submit"),
    instruction: "Click Confirm information is up-to-date to finish the monthly confirmation.",
    target: {
      locator: () =>
        confirmationDialog.getByRole("button", { name: /Confirm information is up-to-date/i }).last(),
    },
    placement: "left",
  });
}

async function captureBrandReplacementWorkflow(page, browser) {
  await setManagerMode(page, "editor");
  await gotoStable(page, "/manager-dashboard");

  const searchInput = page.locator("#brand-items-search").first();
  await searchInput.fill("maple");
  await pause(page, 250);
  await captureStep(page, {
    fileName: stepFile(50, "dashboard-brand-search"),
    instruction: "Use the brand search box to find the item you need to replace.",
    target: { selector: "#brand-items-search" },
    placement: "right",
  });

  const moreOptionsButton = page.locator(".brand-item-more").first();
  await captureStep(page, {
    fileName: stepFile(51, "dashboard-brand-more-options"),
    instruction: "Click More options to expand the brand item details.",
    target: {
      locator: () => moreOptionsButton,
    },
    placement: "left",
  });
  await moreOptionsButton.click();
  await pause(page, 250);

  const replaceButton = page.getByRole("button", { name: /Replace item/i }).first();
  await captureStep(page, {
    fileName: stepFile(52, "dashboard-replace-brand"),
    instruction: "Click Replace item to start the replacement workflow.",
    target: {
      locator: () => replaceButton,
    },
    placement: "left",
  });
  const replacementUrl =
    `/restaurant/?slug=${encodeURIComponent(targetSlug)}&edit=1&autoReplaceBrand=1&replaceBrandKey=${encodeURIComponent("name:coombs family farms organic maple syrup")}&replaceBrandName=${encodeURIComponent("Coombs Family Farms Organic Maple Syrup")}`;
  await gotoStable(page, replacementUrl);
  if (!(await openReplacementCaptureModal(page, replacementUrl, 90000))) {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    throw new Error(
      `Replacement capture modal did not open at ${page.url()}. Body started with: ${String(bodyText).slice(0, 220)}`,
    );
  }

  const replacementFrontPath = await createProductFrontImage(browser, "replace-brand-front", {
    productName: "Organic Tamari Tofu",
    subtitle: "Replacement package",
  });
  const replacementLabelPath = await createIngredientLabelImage(browser, "replace-brand-label", {
    heading: "INGREDIENTS",
    lines: [
      "Water, organic soybeans, nigari, tamari, sea salt.",
      "Contains: soy.",
      "Gluten-free.",
    ],
  });

  const productFrontDialog = page.getByRole("dialog", { name: /Capture Product Front/i }).last();
  await captureStep(page, {
    fileName: stepFile(53, "replace-upload-front"),
    instruction: "Click Upload Photo to add the front of the replacement package.",
    target: {
      locator: () => productFrontDialog.getByRole("button", { name: /Upload Photo/i }),
    },
    placement: "right",
  });
  await uploadViaFileChooser(
    page,
    () => productFrontDialog.getByRole("button", { name: /Upload Photo/i }).click(),
    replacementFrontPath,
  );
  await productFrontDialog
    .getByRole("textbox", { name: /Product Name/i })
    .fill("Organic Tamari Tofu");
  await pause(page, 250);

  await captureStep(page, {
    fileName: stepFile(54, "replace-capture-label"),
    instruction: "Click Capture ingredient label image after the replacement front is correct.",
    target: {
      locator: () =>
        productFrontDialog.getByRole("button", { name: /Capture ingredient label image/i }),
    },
    placement: "left",
  });
  await productFrontDialog.getByRole("button", { name: /Capture ingredient label image/i }).click();

  const replacementUploadButton = page.getByRole("button", { name: /Upload Photo/i }).first();
  if (!(await waitForEnabled(replacementUploadButton, 15000))) {
    throw new Error("Ingredient label upload button did not appear for replacement flow.");
  }
  await captureStep(page, {
    fileName: stepFile(55, "replace-upload-label"),
    instruction: "Click Upload Photo to add the replacement ingredient label.",
    target: {
      locator: () => replacementUploadButton,
    },
    placement: "right",
  });
  await uploadViaFileChooser(
    page,
    () => replacementUploadButton.click(),
    replacementLabelPath,
  );

  const analyzeReplacementButton = page.getByRole("button", { name: /^Analyze$/i }).first();
  await captureStep(page, {
    fileName: stepFile(56, "replace-analyze-label"),
    instruction: "Click Analyze so Clarivore can compare the replacement label.",
    target: {
      locator: () => analyzeReplacementButton,
    },
    placement: "left",
  });
  await analyzeReplacementButton.click();

  const reviewDialog = page.locator("[role='dialog']").last();
  const lineConfirmButtons = reviewDialog.getByRole("button", { name: /^Confirm$/i });
  await lineConfirmButtons.first().waitFor({ timeout: 90000 });
  let lineConfirmCount = await lineConfirmButtons.count();
  let lineConfirmIndex = 0;
  while (lineConfirmCount > 0) {
    await captureStep(page, {
      fileName: stepFileVariant(57, lineConfirmIndex, `replace-confirm-line-${lineConfirmIndex + 1}`),
      instruction: `Click Confirm for replacement label line ${lineConfirmIndex + 1}.`,
      target: {
        locator: () => reviewDialog.getByRole("button", { name: /^Confirm$/i }).first(),
      },
      placement: "left",
    });
    await reviewDialog.getByRole("button", { name: /^Confirm$/i }).first().click();
    await pause(page, 250);
    lineConfirmIndex += 1;
    lineConfirmCount = await lineConfirmButtons.count();
  }

  const saveAndApply = reviewDialog.getByRole("button", { name: /Save & Apply Results/i }).first();
  await saveAndApply.waitFor({ timeout: 30000 });
  if (!(await waitForEnabled(saveAndApply, 90000))) {
    throw new Error("Save & Apply Results did not become enabled for replacement flow.");
  }
  await captureStep(page, {
    fileName: stepFile(58, "replace-save-and-apply"),
    instruction: "Click Save & Apply Results to replace the brand item across the matching rows.",
    target: {
      locator: () => saveAndApply,
    },
    placement: "left",
  });
  await saveAndApply.click();
  await pause(page, 1500);

  const confirmButtons = page.getByRole("button", { name: /Mark confirmed/i });
  await confirmButtons.first().waitFor({ timeout: 30000 });
  let reconfirmCount = await confirmButtons.count();
  let reconfirmIndex = 0;
  while (reconfirmCount > 0) {
    await captureStep(page, {
      fileName: stepFileVariant(59, reconfirmIndex, `replace-reconfirm-row-${reconfirmIndex + 1}`),
      instruction: `Click Mark confirmed on affected ingredient row ${reconfirmIndex + 1}.`,
      target: {
        locator: () => page.getByRole("button", { name: /Mark confirmed/i }).first(),
      },
      placement: "left",
    });
    await page.getByRole("button", { name: /Mark confirmed/i }).first().click();
    await pause(page, 350);
    reconfirmIndex += 1;
    reconfirmCount = await confirmButtons.count();
  }

  await captureStep(page, {
    fileName: stepFile(60, "replace-done"),
    instruction: "Click Done after the affected rows are reviewed again.",
    target: {
      locator: (nextPage) => nextPage.getByRole("button", { name: /^Done$/i }).last(),
    },
    placement: "left",
  });
  await closeDishEditor(page);

  const saveToSiteButton = page.getByRole("button", { name: /Save to site/i }).first();
  await captureStep(page, {
    fileName: stepFile(61, "replace-save-to-site"),
    instruction: "Click Save to site to publish the replacement when review is complete.",
    target: { role: "button", name: /Save to site/i },
    placement: "left",
  });
  await saveToSiteButton.click();
  await page.getByRole("button", { name: /Confirm & Save/i }).first().waitFor({ timeout: 30000 });
  await pause(page, 250);
  await captureStep(page, {
    fileName: stepFile(62, "replace-confirm-save"),
    instruction: "Click Confirm & Save to finish publishing the replacement batch.",
    target: { role: "button", name: /Confirm & Save/i },
    placement: "left",
  });
}

async function captureViewerWorkflow(page) {
  await setManagerMode(page, "customer");
  await gotoStable(page, viewerPath());
  await page.waitForSelector(".restaurant-viewer", { timeout: 20000 });

  await captureStep(page, {
    fileName: stepFile(63, "viewer-acknowledge-banner"),
    instruction: "Click I understand to unlock the restaurant viewer.",
    target: { role: "button", name: /I understand/i },
    placement: "left",
  });
  await dismissViewerReferenceBanner(page);

  await captureStep(page, {
    fileName: stepFile(64, "viewer-open-dish"),
    instruction: "Click a colored overlay to open that dish.",
    target: { selector: ".restaurant-overlay" },
    placement: "right",
  });
  await page.locator(".restaurant-overlay").first().click({ timeout: 8000 });
  await page.waitForSelector(".restaurant-dish-popover", { timeout: 10000 });

  await captureStep(page, {
    fileName: stepFile(65, "viewer-add-to-order"),
    instruction: "Click Add to order to add this dish to the notice workflow.",
    target: { role: "button", name: /Add to order/i },
    placement: "left",
  });
  await page.getByRole("button", { name: /Add to order/i }).first().click();
  await pause(page, 600);

  await captureStep(page, {
    fileName: stepFile(66, "viewer-proceed-confirmation"),
    instruction: "Click Proceed to confirmation after the dish list is correct.",
    target: { role: "button", name: /Proceed to confirmation/i },
    placement: "left",
  });
  await page.getByRole("button", { name: /Proceed to confirmation/i }).first().click();
  await page.waitForSelector(".restaurant-order-confirm-drawer.show", { timeout: 10000 });
  await pause(page, 250);

  await captureStep(page, {
    fileName: stepFile(67, "viewer-submit-notice"),
    instruction: "Click Submit notice to send the order notice to the restaurant team.",
    target: { role: "button", name: /Submit notice/i },
    placement: "left",
  });

  const closeButton = page.getByRole("button", { name: /Close notice drawer/i }).first();
  if ((await closeButton.count()) > 0) {
    await closeButton.click();
    await pause(page, 250);
  }
}

async function submitViewerNoticeForTabletWorkflow(page) {
  await setManagerMode(page, "customer");
  await gotoStable(page, viewerPath());
  await page.waitForSelector(".restaurant-viewer", { timeout: 20000 });
  await dismissViewerReferenceBanner(page);
  await page.locator(".restaurant-overlay").first().click({ timeout: 8000 });
  await page.waitForSelector(".restaurant-dish-popover", { timeout: 10000 });
  await page.getByRole("button", { name: /Add to order/i }).first().click();
  await pause(page, 500);
  await page.getByRole("button", { name: /Proceed to confirmation/i }).first().click();
  await page.waitForSelector(".restaurant-order-confirm-drawer.show", { timeout: 10000 });
  await pause(page, 250);
  await page.getByRole("button", { name: /Submit notice/i }).first().click();
  await pause(page, 1500);
}

async function captureDashboardWorkflow(page) {
  await setManagerMode(page, "editor");
  await gotoStable(page, "/manager-dashboard");
  await ensureChatOpen(page);

  await captureStep(page, {
    fileName: stepFile(68, "dashboard-acknowledge-message"),
    instruction: "Click Acknowledge message(s) after you finish reviewing the latest admin messages.",
    target: { role: "button", name: /Acknowledge message/i },
    placement: "left",
  });
  await page
    .locator("input[placeholder='Message Clarivore']")
    .first()
    .fill("Checked the pending accommodation items and opened the confirmation flow.");
  await captureStep(page, {
    fileName: stepFile(69, "dashboard-compose-message"),
    instruction: "Type your response to Clarivore in this message field.",
    target: { selector: "input[placeholder='Message Clarivore']" },
    placement: "right",
  });
  await captureStep(page, {
    fileName: stepFile(70, "dashboard-send-message"),
    instruction: "Click Send to post the reply into the manager-admin thread.",
    target: { role: "button", name: /^Send$/i },
    placement: "left",
  });

  await openRequestsPendingTab(page);
  await captureStep(page, {
    fileName: stepFile(71, "dashboard-mark-request"),
    instruction: "Click a request action to update the status of that accommodation request.",
    target: { role: "button", name: /Mark Implemented/i },
    placement: "left",
  });
  if (await openFirstRequestActionModal(page)) {
    await captureStep(page, {
      fileName: stepFile(72, "dashboard-submit-request-update"),
      instruction: "Click the action button to save the request decision.",
      target: { selector: "#modal-implement" },
      placement: "left",
    });
    await closeRequestActionModal(page);
  }

  await openRequestsPendingTab(page);
  await captureStep(page, {
    fileName: stepFile(73, "dashboard-open-history"),
    instruction: "Click All to review the full request history, not just pending items.",
    target: {
      locator: (nextPage) => nextPage.locator(".tabs .tab-btn").nth(1),
    },
    placement: "right",
  });
  await openRequestsHistoryTab(page);

  await captureStep(page, {
    fileName: stepFile(74, "dashboard-open-confirmation-card"),
    instruction: "Click Confirm now from the dashboard when you need to reopen monthly confirmation.",
    target: { selector: "#confirmNowBtn" },
    placement: "left",
  });

  await captureStep(page, {
    fileName: stepFile(75, "dashboard-open-analytics"),
    instruction: "Click a heatmap overlay to drill into dish-level statistics.",
    target: { selector: ".heatmap-overlay" },
    placement: "right",
  });
  if (await openDishAnalyticsModal(page)) {
    await captureStep(page, {
      fileName: stepFile(76, "dashboard-analytics-details"),
      instruction: "Review the conflict and view counts here to understand why the dish is receiving attention.",
      target: { selector: "#conflict-breakdown-section" },
      placement: "right",
    });
    await closeDishAnalyticsModal(page);
  }
}

async function captureTabletWorkflow(page) {
  await submitViewerNoticeForTabletWorkflow(page);
  await setManagerMode(page, "editor");
  await gotoStable(page, "/manager-dashboard");

  if (await openTabletPagesDropdown(page)) {
    await captureStep(page, {
      fileName: stepFile(77, "nav-open-server-tablet"),
      instruction: "Click Server tablet to open the server-side notice queue.",
      target: { role: "link", name: /Server tablet/i },
      placement: "left",
    });
    await page.getByRole("link", { name: /Server tablet/i }).first().click();
  } else {
    await gotoStable(page, "/server-tablet");
  }
  await page.getByRole("heading", { name: /Server monitor/i }).first().waitFor({ timeout: 15000 });
  await ensureServerActionCardVisible(page);
  const serverActionButton = page
    .getByRole("button", { name: /Approve & stage for kitchen|Send to kitchen/i })
    .first();
  await captureStep(page, {
    fileName: stepFile(78, "server-send-to-kitchen"),
    instruction: "Click Send to kitchen when the notice is ready for kitchen review.",
    target: {
      locator: () => serverActionButton,
    },
    placement: "left",
  });
  if (await openServerRejectModal(page)) {
    await captureStep(page, {
      fileName: stepFile(79, "server-confirm-rejection"),
      instruction: "Click Confirm rejection only when the diner notice must be sent back.",
      target: { role: "button", name: /Confirm rejection/i },
      placement: "left",
    });
    await closeServerRejectModal(page);
  }
  await serverActionButton.click();
  await pause(page, 750);

  const dispatchButton = page.getByRole("button", { name: /Send to kitchen/i }).first();
  if ((await dispatchButton.count()) > 0 && (await dispatchButton.isVisible().catch(() => false))) {
    await captureStep(page, {
      fileName: stepFile("78a", "server-dispatch-kitchen"),
      instruction: "Click Send to kitchen after the notice is staged for kitchen review.",
      target: {
        locator: () => dispatchButton,
      },
      placement: "left",
    });
    await dispatchButton.click();
    await pause(page, 750);
  }

  await gotoStable(page, "/manager-dashboard");
  if (await openTabletPagesDropdown(page)) {
    await captureStep(page, {
      fileName: stepFile(80, "nav-open-kitchen-tablet"),
      instruction: "Click Kitchen tablet to open the kitchen-side notice queue.",
      target: { role: "link", name: /Kitchen tablet/i },
      placement: "left",
    });
    await page.getByRole("link", { name: /Kitchen tablet/i }).first().click();
  } else {
    await gotoStable(page, "/kitchen-tablet");
  }
  await page.getByRole("heading", { name: /Kitchen monitor/i }).first().waitFor({ timeout: 15000 });
  await ensureKitchenQuestionActionVisible(page);
  await captureStep(page, {
    fileName: stepFile(81, "kitchen-open-follow-up"),
    instruction: "Click Send follow-up question when the kitchen needs a yes-or-no answer from the diner.",
    target: { role: "button", name: /Send follow-up question/i },
    placement: "left",
  });
  if (await openKitchenPromptModal(page)) {
    await captureStep(page, {
      fileName: stepFile(82, "kitchen-send-question"),
      instruction: "Click Send question to deliver the kitchen follow-up back through the notice workflow.",
      target: { role: "button", name: /Send question/i },
      placement: "left",
    });
    await closeKitchenPromptModal(page);
  }
}

async function captureHelpAndAccountWorkflow(page) {
  await setManagerMode(page, "editor");
  await gotoStable(page, "/help-contact");
  await page.getByRole("heading", { name: /^Help$/i }).first().waitFor({ timeout: 15000 });
  await captureStep(page, {
    fileName: stepFile(83, "help-ask"),
    instruction: "Click Ask to send the current help question to Clarivore.",
    target: { role: "button", name: /^Ask$/i },
    placement: "left",
  });

  await gotoStable(page, "/account");
  await page.getByRole("heading", { name: /Your information/i }).first().waitFor({ timeout: 15000 });
  await captureStep(page, {
    fileName: stepFile(84, "account-sign-out"),
    instruction: "Click Sign out to end the current manager session.",
    target: { role: "button", name: /Sign out/i },
    placement: "left",
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  let context = await browser.newContext({ viewport: DESKTOP });
  let page = await context.newPage();

  try {
    if (captureSegment === "full") {
      await clearOutputDir();
      runSetupScenario("foundation");

      await captureAccessWorkflow(page);
      await loginAsManager(page);
      await captureFoundationWorkflow(page);
      await context.close();

      ({ context, page } = await prepareScenario(browser, "final"));
      await captureExistingBrandAssignmentWorkflow(page);
      await context.close();

      ({ context, page } = await prepareScenario(browser, "final"));
      await captureNewBrandItemWorkflow(page, browser);
      await context.close();

      ({ context, page } = await prepareScenario(browser, "final"));
      await captureBrandAppealWorkflow(page, browser);
      await context.close();

      ({ context, page } = await prepareScenario(browser, "final"));
      await capturePublishWorkflow(page);
      await context.close();

      ({ context, page } = await prepareScenario(browser, "final"));
      await captureMonthlyConfirmationWorkflow(page);
      await context.close();

      ({ context, page } = await prepareScenario(browser, "final"));
      await captureBrandReplacementWorkflow(page, browser);
      await context.close();

      ({ context, page } = await prepareScenario(browser, "final"));
      await captureViewerWorkflow(page);
      await captureDashboardWorkflow(page);
      await captureTabletWorkflow(page);
      await captureHelpAndAccountWorkflow(page);
    } else if (captureSegment === "late_flows") {
      await context.close();

      ({ context, page } = await prepareScenario(browser, "final"));
      await captureBrandReplacementWorkflow(page, browser);
      await context.close();

      ({ context, page } = await prepareScenario(browser, "final"));
      await captureViewerWorkflow(page);
      await captureDashboardWorkflow(page);
      await captureTabletWorkflow(page);
      await captureHelpAndAccountWorkflow(page);
    } else {
      throw new Error(`Unsupported DOCS_CAPTURE_SEGMENT: ${captureSegment}`);
    }
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    await browser.close();
    await fs.rm(path.join(outputDir, ".tmp"), { recursive: true, force: true }).catch(() => {});
  }

  console.log("Manager flow screenshot capture complete.");
}

main().catch((error) => {
  console.error("Failed to capture manager flow screenshots:", error?.stack || error?.message || error);
  process.exit(1);
});
