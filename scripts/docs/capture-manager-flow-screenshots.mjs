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

const DESKTOP = { width: 1720, height: 1180 };

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
      const box = {
        x: Math.max(payloadBox.x - 4, 6),
        y: Math.max(payloadBox.y - 4, 6),
        width: payloadBox.width + 8,
        height: payloadBox.height + 8,
      };

      const targetCenterX = box.x + box.width / 2;
      const targetCenterY = box.y + box.height / 2;
      let placement = payloadPlacement;
      if (placement === "auto") {
        placement = targetCenterX < viewportWidth / 2 ? "right" : "left";
      }

      const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
      const label = { x: margin, y: margin, width: labelWidth, height: labelHeight };
      let anchorX = 0;
      let anchorY = 0;

      if (placement === "left") {
        label.x = clamp(box.x - label.width - gap, margin, viewportWidth - label.width - margin);
        label.y = clamp(
          targetCenterY - label.height / 2,
          margin,
          viewportHeight - label.height - margin,
        );
        anchorX = label.x + label.width;
        anchorY = label.y + label.height / 2;
      } else if (placement === "top") {
        label.x = clamp(
          targetCenterX - label.width / 2,
          margin,
          viewportWidth - label.width - margin,
        );
        label.y = clamp(box.y - label.height - gap, margin, viewportHeight - label.height - margin);
        anchorX = label.x + label.width / 2;
        anchorY = label.y + label.height;
      } else if (placement === "bottom") {
        label.x = clamp(
          targetCenterX - label.width / 2,
          margin,
          viewportWidth - label.width - margin,
        );
        label.y = clamp(
          box.y + box.height + gap,
          margin,
          viewportHeight - label.height - margin,
        );
        anchorX = label.x + label.width / 2;
        anchorY = label.y;
      } else {
        label.x = clamp(
          box.x + box.width + gap,
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
      highlight.style.left = `${box.x}px`;
      highlight.style.top = `${box.y}px`;
      highlight.style.width = `${box.width}px`;
      highlight.style.height = `${box.height}px`;
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

async function ensureServerActionCardVisible(page) {
  const actionable = page
    .getByRole("button", { name: /Approve & stage for kitchen|Send to kitchen/i })
    .first();
  if ((await actionable.count()) > 0) return true;

  const tabs = page.locator(".server-tab");
  const count = await tabs.count();
  for (let i = 0; i < count; i += 1) {
    await tabs.nth(i).click();
    await pause(page, 250);
    if ((await actionable.count()) > 0) return true;
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
      if (nextPath) localCopies.push(nextPath);
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
    if (await continueButton.isEnabled()) break;
    await pause(page, 500);
  }
  if (!(await continueButton.isEnabled())) return false;

  await continueButton.click();
  await pause(page, 500);
  return true;
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

async function openFirstBrandItem(page) {
  const moreButton = page.locator(".brand-item-more").first();
  if ((await moreButton.count()) < 1) return false;
  await moreButton.click();
  await pause(page, 250);
  return true;
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
    await pause(page, 1000);
  }

  const currentUrl = page.url();
  const bodyText = await page.locator("body").innerText().catch(() => "");
  throw new Error(
    `Editor did not load at ${currentUrl}. Body started with: ${String(bodyText).slice(0, 220)}`,
  );
}

async function captureAccessWorkflow(page) {
  await gotoStable(page, "/account?mode=signin");
  await captureStep(page, {
    fileName: "01-sign-in-email.png",
    instruction: "Type the manager email here.",
    target: { selector: "input[placeholder='Email']" },
    placement: "right",
  });
  await captureStep(page, {
    fileName: "02-sign-in-password.png",
    instruction: "Type the password here.",
    target: { selector: "input[placeholder='Password']" },
    placement: "right",
  });
  await captureStep(page, {
    fileName: "03-sign-in-submit.png",
    instruction: "Click Sign in to enter the manager workspace.",
    target: { role: "button", name: /^sign in$/i },
    placement: "right",
  });
}

async function captureFoundationWorkflow(page) {
  await setManagerMode(page, "editor");
  await gotoStable(page, "/manager-dashboard");

  await captureStep(page, {
    fileName: "04-dashboard-open-editor.png",
    instruction: "Click Webpage editor to start building the new restaurant.",
    target: { role: "link", name: /Webpage editor/i },
    placement: "left",
  });

  await openWebpageEditorFromDashboard(page);

  await captureStep(page, {
    fileName: "05-editor-open-settings.png",
    instruction: "Click Restaurant settings to enter the core restaurant details.",
    target: { selector: ".editorRestaurantSettingsBtn" },
    placement: "left",
  });
  await page.locator(".editorRestaurantSettingsBtn").first().click();
  await page.waitForSelector("[role='dialog']", { timeout: 10000 });
  await page.locator("label:has-text('Website') input").first().fill("https://demo-menu.example");
  await captureStep(page, {
    fileName: "06-settings-website-field.png",
    instruction: "Enter the restaurant website in this field.",
    target: { selector: "label:has-text('Website') input" },
    placement: "right",
  });
  await captureStep(page, {
    fileName: "07-settings-save.png",
    instruction: "Click Save after the restaurant details are filled in.",
    target: { role: "button", name: /^save$/i },
    placement: "left",
  });
  await closeModalByButton(page, /cancel|close/i);

  await captureStep(page, {
    fileName: "08-editor-open-menu-images.png",
    instruction: "Click Edit menu images when you need to add, replace, or reorder menu pages.",
    target: { role: "button", name: /edit menu images/i },
    placement: "left",
  });
  await page.getByRole("button", { name: /edit menu images/i }).first().click();
  await page.waitForSelector("[role='dialog']", { timeout: 10000 });
  await captureStep(page, {
    fileName: "09-menu-images-add-page.png",
    instruction: "Click Add Page to upload another menu page image.",
    target: { role: "button", name: /Add Page/i },
    placement: "right",
  });
  await captureStep(page, {
    fileName: "10-menu-images-save.png",
    instruction: "Click Save after the menu page list is ready.",
    target: { role: "button", name: /^save$/i },
    placement: "left",
  });
  await closeModalByButton(page, /cancel|close/i);

  await captureStep(page, {
    fileName: "11-editor-add-overlay.png",
    instruction: "Click Add overlay to start mapping a dish on the menu image.",
    target: { role: "button", name: /Add overlay/i },
    placement: "left",
  });
  await createFoundationOverlay(page);
  await captureStep(page, {
    fileName: "12-editor-place-overlay.png",
    instruction: "Drag on the menu image until the orange box matches the dish area.",
    target: { selector: ".editBox" },
    placement: "right",
  });
  await captureStep(page, {
    fileName: "13-editor-open-dish.png",
    instruction: "Click the pencil icon on the overlay to open the dish editor.",
    target: { selector: ".editBadge" },
    placement: "left",
  });

  await openFirstEditorDish(page);
  await page.locator(".restaurant-editor-dish-name-input").first().fill("Citrus Tofu Bowl");
  await page
    .locator(".restaurant-editor-dish-textarea")
    .first()
    .fill("Tofu, citrus glaze, sesame crunch, scallions, jasmine rice.");
  await captureStep(page, {
    fileName: "14-dish-name-field.png",
    instruction: "Type the menu item name in the Dish name field.",
    target: { selector: ".restaurant-editor-dish-name-input" },
    placement: "right",
  });
  await captureStep(page, {
    fileName: "15-dish-recipe-text.png",
    instruction: "Add recipe text or ingredient notes in this text box.",
    target: { selector: ".restaurant-editor-dish-textarea" },
    placement: "right",
  });
  await captureStep(page, {
    fileName: "16-dish-process-input.png",
    instruction: "Click Process Input to turn the recipe text or photo into ingredient rows.",
    target: { selector: ".restaurant-editor-dish-process-btn" },
    placement: "left",
  });
  await closeDishEditor(page);
}

async function captureFinalEditorWorkflow(page) {
  await openWebpageEditorFromDashboard(page);

  await captureStep(page, {
    fileName: "17-editor-open-change-log.png",
    instruction: "Click View log of changes to review what has already been published.",
    target: { role: "button", name: /view log of changes/i },
    placement: "left",
  });

  await openFirstEditorDish(page);
  await captureStep(page, {
    fileName: "18-dish-add-ingredient.png",
    instruction: "Click Add ingredient when you need to add another row manually.",
    target: { role: "button", name: /Add ingredient/i },
    placement: "left",
  });
  await captureStep(page, {
    fileName: "19-dish-ingredient-name.png",
    instruction: "Edit the ingredient name in this row.",
    target: { selector: ".restaurant-editor-dish-ingredient-name-input" },
    placement: "right",
  });
  await captureStep(page, {
    fileName: "20-dish-mark-confirmed.png",
    instruction: "Click Mark confirmed after the ingredient row is fully reviewed.",
    target: { role: "button", name: /Mark confirmed|Confirmed/i },
    placement: "left",
  });
  await captureStep(page, {
    fileName: "21-dish-done.png",
    instruction: "Click Done to close the dish editor and return to the menu canvas.",
    target: { role: "button", name: /^Done$/i, nth: 1 },
    placement: "left",
  });
  await closeDishEditor(page);

  await createTemporaryEditorChange(page);
  await captureStep(page, {
    fileName: "22-editor-save-to-site.png",
    instruction: "Click Save to site when you are ready to review a publish batch.",
    target: { role: "button", name: /Save to site/i },
    placement: "left",
  });
  if (await openSaveReviewModal(page)) {
    await captureStep(page, {
      fileName: "23-editor-confirm-save.png",
      instruction: "Click Confirm & Save to publish the reviewed changes.",
      target: { role: "button", name: /Confirm & Save/i },
      placement: "left",
    });
    await closeSaveReviewModal(page);
    await gotoStable(page, editorPath());
    await page.waitForSelector(".restaurant-editor", { timeout: 25000 });
  }

  await captureStep(page, {
    fileName: "24-editor-open-confirmation.png",
    instruction: "Click Confirm information is up-to-date to start the monthly confirmation workflow.",
    target: { role: "button", name: /Confirm information is up-to-date/i },
    placement: "left",
  });
  if (await openEditorConfirmationModal(page)) {
    await prepareConfirmationMenuCards(page);
    await captureStep(page, {
      fileName: "25-confirmation-continue-brand.png",
      instruction: "Click Continue to brand items after the current menu photos are ready.",
      target: { role: "button", name: /Continue to brand items/i },
      placement: "left",
    });
    if (await moveEditorConfirmationToBrandStep(page)) {
      await captureStep(page, {
        fileName: "26-confirmation-final-submit.png",
        instruction: "Click Confirm information is up-to-date to finish the monthly confirmation.",
        target: { role: "button", name: /Confirm information is up-to-date/i },
        placement: "left",
      });
    }
    await page.keyboard.press("Escape").catch(() => {});
    await pause(page, 250);
  }
}

async function captureViewerWorkflow(page) {
  await setManagerMode(page, "customer");
  await gotoStable(page, viewerPath());
  await page.waitForSelector(".restaurant-viewer", { timeout: 20000 });

  await captureStep(page, {
    fileName: "27-viewer-acknowledge-banner.png",
    instruction: "Click I understand to unlock the restaurant viewer.",
    target: { role: "button", name: /I understand/i },
    placement: "left",
  });
  await dismissViewerReferenceBanner(page);

  await captureStep(page, {
    fileName: "28-viewer-open-dish.png",
    instruction: "Click a colored overlay to open that dish.",
    target: { selector: ".restaurant-overlay" },
    placement: "right",
  });

  const firstOverlay = page.locator(".restaurant-overlay").first();
  await firstOverlay.click({ timeout: 8000 });
  await page.waitForSelector(".restaurant-dish-popover", { timeout: 10000 });

  await captureStep(page, {
    fileName: "29-viewer-add-to-order.png",
    instruction: "Click Add to order to add this dish to the notice workflow.",
    target: { role: "button", name: /Add to order/i },
    placement: "left",
  });
  await page.getByRole("button", { name: /Add to order/i }).first().click();
  await pause(page, 600);

  await captureStep(page, {
    fileName: "30-viewer-proceed-confirmation.png",
    instruction: "Click Proceed to confirmation after the dish list is correct.",
    target: { role: "button", name: /Proceed to confirmation/i },
    placement: "left",
  });
  await page.getByRole("button", { name: /Proceed to confirmation/i }).first().click();
  await page.waitForSelector(".restaurant-order-confirm-drawer.show", { timeout: 10000 });
  await pause(page, 250);

  await captureStep(page, {
    fileName: "31-viewer-submit-notice.png",
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

async function captureDashboardWorkflow(page) {
  await setManagerMode(page, "editor");
  await gotoStable(page, "/manager-dashboard");
  await ensureChatOpen(page);

  await captureStep(page, {
    fileName: "32-dashboard-acknowledge-message.png",
    instruction: "Click Acknowledge message(s) after you finish reviewing the latest admin messages.",
    target: { role: "button", name: /Acknowledge message/i },
    placement: "left",
  });
  await page.locator("input[placeholder='Message Clarivore']").first().fill(
    "Checked the pending accommodation items and opened the confirmation flow.",
  );
  await captureStep(page, {
    fileName: "33-dashboard-compose-message.png",
    instruction: "Type your response to Clarivore in this message field.",
    target: { selector: "input[placeholder='Message Clarivore']" },
    placement: "right",
  });
  await captureStep(page, {
    fileName: "34-dashboard-send-message.png",
    instruction: "Click Send to post the reply into the manager-admin thread.",
    target: { role: "button", name: /^Send$/i },
    placement: "left",
  });

  await openRequestsPendingTab(page);
  await captureStep(page, {
    fileName: "35-dashboard-mark-request.png",
    instruction: "Click a request action to update the status of that accommodation request.",
    target: { role: "button", name: /Mark Implemented/i },
    placement: "left",
  });
  if (await openFirstRequestActionModal(page)) {
    await captureStep(page, {
      fileName: "36-dashboard-submit-request-update.png",
      instruction: "Click the action button to save the request decision.",
      target: { selector: "#modal-implement" },
      placement: "left",
    });
    await closeRequestActionModal(page);
  }

  await openRequestsHistoryTab(page);
  await captureStep(page, {
    fileName: "37-dashboard-open-history.png",
    instruction: "Click All to review the full request history, not just pending items.",
    target: { text: /^All$/i, nth: 0 },
    placement: "right",
  });

  await captureStep(page, {
    fileName: "38-dashboard-open-confirmation-card.png",
    instruction: "Click Confirm now from the dashboard when you need to start monthly confirmation.",
    target: { selector: "#confirmNowBtn" },
    placement: "left",
  });

  await captureStep(page, {
    fileName: "39-dashboard-brand-search.png",
    instruction: "Use this search box to find a brand item by dish, ingredient, or brand name.",
    target: { selector: "#brand-items-search" },
    placement: "right",
  });
  if (await openFirstBrandItem(page)) {
    await captureStep(page, {
      fileName: "40-dashboard-replace-brand.png",
      instruction: "Click Replace item when the current brand item needs to be swapped.",
      target: { role: "button", name: /Replace item/i },
      placement: "left",
    });
  }

  await captureStep(page, {
    fileName: "41-dashboard-open-analytics.png",
    instruction: "Click a heatmap overlay to drill into dish-level statistics.",
    target: { selector: ".heatmap-overlay" },
    placement: "right",
  });
  if (await openDishAnalyticsModal(page)) {
    await captureStep(page, {
      fileName: "42-dashboard-analytics-details.png",
      instruction: "Review the conflict and view counts here to understand why the dish is receiving attention.",
      target: { selector: "#conflict-breakdown-section" },
      placement: "right",
    });
    await closeDishAnalyticsModal(page);
  }
}

async function captureTabletWorkflow(page) {
  await setManagerMode(page, "editor");
  await gotoStable(page, "/manager-dashboard");

  if (await openTabletPagesDropdown(page)) {
    await captureStep(page, {
      fileName: "43-nav-open-server-tablet.png",
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
  await page
    .getByRole("button", { name: /Approve & stage for kitchen|Send to kitchen/i })
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  await captureStep(page, {
    fileName: "44-server-send-to-kitchen.png",
    instruction: "Click Send to kitchen when the notice is ready for kitchen review.",
    target: { role: "button", name: /Approve & stage for kitchen|Send to kitchen/i },
    placement: "left",
  });
  if (await openServerRejectModal(page)) {
    await captureStep(page, {
      fileName: "45-server-confirm-rejection.png",
      instruction: "Click Confirm rejection only when the diner notice must be sent back.",
      target: { role: "button", name: /Confirm rejection/i },
      placement: "left",
    });
    await closeServerRejectModal(page);
  }

  await gotoStable(page, "/manager-dashboard");
  if (await openTabletPagesDropdown(page)) {
    await captureStep(page, {
      fileName: "46-nav-open-kitchen-tablet.png",
      instruction: "Click Kitchen tablet to open the kitchen-side notice queue.",
      target: { role: "link", name: /Kitchen tablet/i },
      placement: "left",
    });
    await page.getByRole("link", { name: /Kitchen tablet/i }).first().click();
  } else {
    await gotoStable(page, "/kitchen-tablet");
  }
  await page.getByRole("heading", { name: /Kitchen monitor/i }).first().waitFor({ timeout: 15000 });
  await page
    .getByRole("button", { name: /Send follow-up question/i })
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  await captureStep(page, {
    fileName: "47-kitchen-open-follow-up.png",
    instruction: "Click Send follow-up question when the kitchen needs a yes-or-no answer from the diner.",
    target: { role: "button", name: /Send follow-up question/i },
    placement: "left",
  });
  if (await openKitchenPromptModal(page)) {
    await captureStep(page, {
      fileName: "48-kitchen-send-question.png",
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
    fileName: "49-help-ask.png",
    instruction: "Click Ask to send the current help question to Clarivore.",
    target: { role: "button", name: /^Ask$/i },
    placement: "left",
  });

  await gotoStable(page, "/account");
  await page.getByRole("heading", { name: /Your information/i }).first().waitFor({ timeout: 15000 });
  await captureStep(page, {
    fileName: "50-account-sign-out.png",
    instruction: "Click Sign out to end the current manager session.",
    target: { role: "button", name: /Sign out/i },
    placement: "left",
  });
}

async function main() {
  await clearOutputDir();
  runSetupScenario("foundation");

  const browser = await chromium.launch({ headless: true });
  let context = await browser.newContext({ viewport: DESKTOP });
  let page = await context.newPage();

  try {
    await captureAccessWorkflow(page);
    await loginAsManager(page);
    await captureFoundationWorkflow(page);

    await context.close();
    runSetupScenario("final");

    context = await browser.newContext({ viewport: DESKTOP });
    page = await context.newPage();
    await loginAsManager(page);

    await captureFinalEditorWorkflow(page);
    await captureViewerWorkflow(page);
    await captureDashboardWorkflow(page);
    await captureTabletWorkflow(page);
    await captureHelpAndAccountWorkflow(page);
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
