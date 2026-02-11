import { readFile } from "node:fs/promises";
import path from "node:path";

const LEGACY_RESTAURANT_PATH = path.join(
  process.cwd(),
  "public.backup-20260107-130533",
  "restaurant.html",
);
const LEGACY_REPORT_MODAL_PATH = path.join(
  process.cwd(),
  "public.backup-20260107-130533",
  "js",
  "report-modal.js",
);
const REPORT_MODAL_SCRIPT_TAG =
  '<script type="module" src="js/report-modal.js"></script>';

let legacyHtmlCache = null;

export async function getLegacyRestaurantHtml() {
  if (legacyHtmlCache) return legacyHtmlCache;

  const [legacyHtml, reportModalScript] = await Promise.all([
    readFile(LEGACY_RESTAURANT_PATH, "utf8"),
    readFile(LEGACY_REPORT_MODAL_PATH, "utf8"),
  ]);

  const htmlWithRootBase = legacyHtml.includes("<base href=\"/\">")
    ? legacyHtml
    : legacyHtml.replace("<head>", "<head>\n  <base href=\"/\">");

  const inlinedReportModalScript = [
    "<script type=\"module\">",
    reportModalScript,
    "</script>",
  ].join("\n");

  legacyHtmlCache = htmlWithRootBase.replace(
    REPORT_MODAL_SCRIPT_TAG,
    inlinedReportModalScript,
  );

  return legacyHtmlCache;
}
