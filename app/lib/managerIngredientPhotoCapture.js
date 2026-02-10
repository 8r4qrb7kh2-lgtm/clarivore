import { initIngredientPhotoAnalysis } from "./ingredientPhotoAnalysis.js";
import { loadScript } from "../runtime/scriptLoader";
import { buildAllergenDietConfig } from "./allergenConfig";
import { supabaseAnonKey, supabaseClient as supabase } from "./supabase";

const OPENCV_URL = "https://docs.opencv.org/4.5.2/opencv.js";

let ingredientCaptureApiPromise = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function compressImage(dataUrl, maxWidth = 1200, quality = 0.92) {
  if (!dataUrl) return "";

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      let width = image.width;
      let height = image.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(dataUrl);
        return;
      }

      context.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };

    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

function getIssueReportMeta() {
  if (typeof window === "undefined") {
    return {
      userEmail: "",
      reporterName: "",
      accountName: "",
      accountId: "",
      pageUrl: "",
    };
  }

  return {
    userEmail: "",
    reporterName: "",
    accountName: "",
    accountId: "",
    pageUrl: window.location.href,
  };
}

async function createIngredientCaptureApi() {
  if (typeof window === "undefined") {
    throw new Error("Ingredient capture is only available in the browser.");
  }

  if (supabase) {
    window.supabaseClient = supabase;
  }

  try {
    await loadScript(OPENCV_URL);
  } catch (error) {
    console.warn("[manager-dashboard-next] OpenCV runtime unavailable", error);
  }

  const config = buildAllergenDietConfig();

  return initIngredientPhotoAnalysis({
    esc: escapeHtml,
    ALLERGENS: config.ALLERGENS || [],
    DIETS: config.DIETS || [],
    normalizeAllergen: config.normalizeAllergen,
    normalizeDietLabel: config.normalizeDietLabel,
    formatAllergenLabel: config.formatAllergenLabel,
    getDietAllergenConflicts: config.getDietAllergenConflicts,
    compressImage,
    getIssueReportMeta,
    ensureAiAssistElements: () => {},
    SUPABASE_KEY: supabaseAnonKey,
    supabaseClient: supabase,
  });
}

export async function ensureManagerIngredientPhotoCapture() {
  if (!ingredientCaptureApiPromise) {
    ingredientCaptureApiPromise = createIngredientCaptureApi().catch((error) => {
      ingredientCaptureApiPromise = null;
      throw error;
    });
  }

  return ingredientCaptureApiPromise;
}

export async function showManagerIngredientPhotoUploadModal(
  ingredientName,
  options = {},
) {
  const label = String(ingredientName || "").trim();
  if (!label) {
    throw new Error("Missing ingredient label.");
  }

  const api = await ensureManagerIngredientPhotoCapture();
  return api.showIngredientPhotoUploadModal(-1, label, null, null, options);
}
