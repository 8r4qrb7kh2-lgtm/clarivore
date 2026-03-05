import { chromium } from "@playwright/test";

import { asText } from "./benchmarkShared.mjs";

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
}

async function withPage(fn) {
  const browser = await getBrowser();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1200, deviceScaleFactor: 1 },
  });
  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}

export async function closeImageToolBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser.close();
}

export async function cropImageDataUrl(imageDataUrl, crop) {
  return await withPage(async (page) => {
    const payload = await page.evaluate(
      async ({ source, cropRect }) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.src = source;
        await image.decode();

        const mode = String(cropRect?.coordSpace || "").trim().toLowerCase();
        const scaleX = mode === "thousand"
          ? image.naturalWidth / 1000
          : mode === "ratio"
            ? image.naturalWidth
            : 1;
        const scaleY = mode === "thousand"
          ? image.naturalHeight / 1000
          : mode === "ratio"
            ? image.naturalHeight
            : 1;

        const sx = Math.max(0, (Number(cropRect?.x) || 0) * scaleX);
        const sy = Math.max(0, (Number(cropRect?.y) || 0) * scaleY);
        const sw = Math.max(1, (Number(cropRect?.w) || image.naturalWidth) * scaleX);
        const sh = Math.max(1, (Number(cropRect?.h) || image.naturalHeight) * scaleY);
        const targetWidth = Math.max(1, Number(cropRect?.outputWidth) || sw);
        const targetHeight = Math.max(1, Number(cropRect?.outputHeight) || sh);

        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext("2d");
        context.drawImage(image, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);

        return {
          imageDataUrl: canvas.toDataURL("image/png"),
          width: targetWidth,
          height: targetHeight,
          sourceWidth: image.naturalWidth,
          sourceHeight: image.naturalHeight,
        };
      },
      { source: asText(imageDataUrl), cropRect: crop || {} },
    );

    return payload;
  });
}

export async function createPerspectiveVariant(imageDataUrl, options = {}) {
  return await withPage(async (page) => {
    const imageWidth = Math.max(280, Math.min(900, Number(options.width) || 640));
    const imageHeight = Math.max(280, Math.min(900, Number(options.height) || 900));
    const rotateX = Number(options.rotateX) || 0;
    const rotateY = Number(options.rotateY) || 0;
    const rotateZ = Number(options.rotateZ) || 0;
    const scale = Number(options.scale) || 1;
    const skewX = Number(options.skewX) || 0;
    const skewY = Number(options.skewY) || 0;
    const perspective = Math.max(600, Number(options.perspective) || 1200);

    await page.setContent(
      `<!doctype html>
      <html>
        <body style="margin:0;background:#f5f1e8;">
          <div id="frame" style="position:relative;width:1200px;height:1100px;overflow:hidden;background:linear-gradient(180deg,#f7f3ea,#ebe5d8);">
            <div id="stage" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;perspective:${perspective}px;">
              <img id="target" src="${asText(imageDataUrl)}" style="width:${imageWidth}px;height:${imageHeight}px;object-fit:cover;transform-origin:center center;transform:rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotateZ(${rotateZ}deg) skew(${skewX}deg, ${skewY}deg) scale(${scale});box-shadow:0 32px 80px rgba(0,0,0,0.18);" />
            </div>
          </div>
        </body>
      </html>`,
    );

    const frame = page.locator("#frame");
    const target = page.locator("#target");
    await target.waitFor();

    const geometry = await page.evaluate(() => {
      const frame = document.getElementById("frame");
      const target = document.getElementById("target");
      if (!frame || !target) return null;

      const frameRect = frame.getBoundingClientRect();
      const quad = typeof target.getBoxQuads === "function" ? target.getBoxQuads()[0] : null;
      if (quad) {
        const mapPoint = (point) => ({
          x: point.x - frameRect.left,
          y: point.y - frameRect.top,
        });

        return {
          topLeft: mapPoint(quad.p1),
          topRight: mapPoint(quad.p2),
          bottomRight: mapPoint(quad.p3),
          bottomLeft: mapPoint(quad.p4),
        };
      }

      const rect = target.getBoundingClientRect();
      return {
        topLeft: { x: rect.left - frameRect.left, y: rect.top - frameRect.top },
        topRight: { x: rect.right - frameRect.left, y: rect.top - frameRect.top },
        bottomRight: { x: rect.right - frameRect.left, y: rect.bottom - frameRect.top },
        bottomLeft: { x: rect.left - frameRect.left, y: rect.bottom - frameRect.top },
      };
    });

    const screenshot = await frame.screenshot({ type: "png" });
    return {
      imageDataUrl: `data:image/png;base64,${screenshot.toString("base64")}`,
      width: 1200,
      height: 1100,
      corners: geometry,
    };
  });
}
