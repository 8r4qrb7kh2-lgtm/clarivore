import { getSupabaseClient } from "./runtimeSessionState.js";
import {
  consumeEditorAutoOpenMenuUpload,
  setEditorAutoOpenMenuUpload,
} from "./restaurantRuntimeBridge.js";

export function initMenuImageEditor(deps = {}) {
  const state = deps.state || {};
  const rs = deps.rs || {};
  const overlays = Array.isArray(deps.overlays) ? deps.overlays : [];
  const menuImages = Array.isArray(deps.menuImages) ? deps.menuImages : [];
  const pendingChanges = Array.isArray(deps.pendingChanges)
    ? deps.pendingChanges
    : [];
  const setDirty = typeof deps.setDirty === "function" ? deps.setDirty : () => {};
  const updateMenuNavigationUI =
    typeof deps.updateMenuNavigationUI === "function"
      ? deps.updateMenuNavigationUI
      : () => {};
  const applyPendingMenuIndexRemap =
    typeof deps.applyPendingMenuIndexRemap === "function"
      ? deps.applyPendingMenuIndexRemap
      : () => {};
  const syncEditorMenuImages =
    typeof deps.syncEditorMenuImages === "function"
      ? deps.syncEditorMenuImages
      : () => false;
  const switchMenuPage =
    typeof deps.switchMenuPage === "function" ? deps.switchMenuPage : () => {};
  const analyzeBoxSizes =
    typeof deps.analyzeBoxSizes === "function"
      ? deps.analyzeBoxSizes
      : () => ({ needsSplit: false, scaleNeeded: 1, stripCount: 1 });
  const splitImageIntoSections =
    typeof deps.splitImageIntoSections === "function"
      ? deps.splitImageIntoSections
      : async () => [];
  const getCurrentPageIndex =
    typeof deps.getCurrentPageIndex === "function"
      ? deps.getCurrentPageIndex
      : () => 0;
  const setCurrentPageIndex =
    typeof deps.setCurrentPageIndex === "function"
      ? deps.setCurrentPageIndex
      : () => {};

  // Track images being uploaded (initialize with current images)
  let pendingMenuImages = [...menuImages];
  let pendingMenuImageIndices = menuImages.map((_, idx) => idx);
  let currentUploadIndex = -1; // -1 means not uploading, >= 0 means uploading page at that index
  let lastUploadedIndex = -1; // Track the most recently uploaded/touched page index
  let menuImagesEditMode = false;

  async function invokeSupabaseFunction(name, body) {
    const client = getSupabaseClient();
    if (!client || !client.functions) {
      throw new Error("Supabase client is unavailable");
    }
    return client.functions.invoke(name, { body });
  }

  // --- Document Scanner Logic ---

  async function detectCorners(imageData, width, height) {
    try {
      const result = await invokeSupabaseFunction("detect-corners", {
        image: imageData,
        width,
        height,
      });
      if (result.error) throw result.error;

      let c = result.data;
      // CLAMP coordinates to 0-1000 to prevent off-screen handles
      const clamp = (v) => Math.max(0, Math.min(1000, v));
      if (c && c.topLeft) {
        c.topLeft.x = clamp(c.topLeft.x);
        c.topLeft.y = clamp(c.topLeft.y);
        c.topRight.x = clamp(c.topRight.x);
        c.topRight.y = clamp(c.topRight.y);
        c.bottomRight.x = clamp(c.bottomRight.x);
        c.bottomRight.y = clamp(c.bottomRight.y);
        c.bottomLeft.x = clamp(c.bottomLeft.x);
        c.bottomLeft.y = clamp(c.bottomLeft.y);
      }
      return c;
    } catch (e) {
      console.error("Corner detection failed:", e);
      // Fallback: return corners matching the image bounds
      return null;
    }
  }

  function warpImage(img, corners) {
    return new Promise((resolve) => {
      // Ensure OpenCV is loaded
      if (typeof cv === "undefined") {
        console.error("OpenCV not loaded");
        resolve(null);
        return;
      }

      try {
        const src = cv.imread(img);
        const dst = new cv.Mat();

        // Corners are 0-1000 scale. Map to image dimensions.
        const w = img.width;
        const h = img.height;
        const map = (pt) => ({ x: (pt.x / 1000) * w, y: (pt.y / 1000) * h });

        const tl = map(corners.topLeft);
        const tr = map(corners.topRight);
        const br = map(corners.bottomRight);
        const bl = map(corners.bottomLeft);

        // Calculate destination dimensions (max width/height)
        const widthA = Math.sqrt((br.x - bl.x) ** 2 + (br.y - bl.y) ** 2);
        const widthB = Math.sqrt((tr.x - tl.x) ** 2 + (tr.y - tl.y) ** 2);
        const maxWidth = Math.max(widthA, widthB);

        const heightA = Math.sqrt((tr.x - br.x) ** 2 + (tr.y - br.y) ** 2);
        const heightB = Math.sqrt((tl.x - bl.x) ** 2 + (tl.y - bl.y) ** 2);
        const maxHeight = Math.max(heightA, heightB);

        const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
          tl.x,
          tl.y,
          tr.x,
          tr.y,
          br.x,
          br.y,
          bl.x,
          bl.y,
        ]);
        const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
          0,
          0,
          maxWidth,
          0,
          maxWidth,
          maxHeight,
          0,
          maxHeight,
        ]);

        const M = cv.getPerspectiveTransform(srcTri, dstTri);
        cv.warpPerspective(src, dst, M, new cv.Size(maxWidth, maxHeight));

        // Convert back to canvas/dataURL
        const outCanvas = document.createElement("canvas");
        cv.imshow(outCanvas, dst);
        const outData = outCanvas.toDataURL("image/jpeg", 0.9);

        // Cleanup
        src.delete();
        dst.delete();
        M.delete();
        srcTri.delete();
        dstTri.delete();

        resolve(outData);
      } catch (e) {
        console.error("Warp failed:", e);
        resolve(null);
      }
    });
  }

  function showCornerEditor(imageData, initialCorners, options = {}) {
    const debugMeta = options.debugMeta || null;
    const mapForWarp = options.mapForWarp || null;
    const warpImageData = options.warpImageData || imageData;
    return new Promise((resolve) => {
      // Create UI
      const modal = document.createElement("div");
      modal.className = "modalBack";
      modal.style.cssText =
        "display:flex;z-index:10002;background:rgba(0,0,0,0.9);align-items:center;justify-content:center;";

      const container = document.createElement("div");
      container.style.cssText =
        "position:relative;max-width:90vw;max-height:80vh;background:#111;padding:20px;border-radius:12px;text-align:center;box-shadow:0 0 20px rgba(0,0,0,0.5);";

      const title = document.createElement("h3");
      title.innerText = "Adjust Crop";
      title.style.color = "#fff";
      container.appendChild(title);

      const instr = document.createElement("p");
      instr.innerText = "Drag green corners to fit the menu borders.";
      instr.style.color = "#ccc";
      container.appendChild(instr);

      // Canvas container
      const canvasBox = document.createElement("div");
      canvasBox.style.cssText =
        "position:relative;display:inline-block;margin:10px 0;border:1px solid #333;max-width:100%;";
      container.appendChild(canvasBox);

      const canvas = document.createElement("canvas");
      canvas.style.maxWidth = "100%"; // Ensure it fits in the modal
      canvas.style.height = "auto";
      canvasBox.appendChild(canvas);
      const ctx = canvas.getContext("2d");

      const img = new Image();
      let teardownPointerHandlers = () => {};
      let corners = initialCorners || {
        topLeft: { x: 100, y: 100 },
        topRight: { x: 900, y: 100 },
        bottomRight: { x: 900, y: 900 },
        bottomLeft: { x: 100, y: 900 },
      };

      // Load image and setup canvas
      img.onload = () => {
        // Shrink for display if huge
        const maxDisp = 800;
        const scale = Math.min(1, maxDisp / img.width, maxDisp / img.height);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;

        // Draw loop
        const draw = () => {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          // Draw lines
          ctx.beginPath();
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#00ff00";
          const pt = (c) => ({
            x: (c.x / 1000) * canvas.width,
            y: (c.y / 1000) * canvas.height,
          });
          const tl = pt(corners.topLeft);
          const tr = pt(corners.topRight);
          const br = pt(corners.bottomRight);
          const bl = pt(corners.bottomLeft);

          ctx.moveTo(tl.x, tl.y);
          ctx.lineTo(tr.x, tr.y);
          ctx.lineTo(br.x, br.y);
          ctx.lineTo(bl.x, bl.y);
          ctx.lineTo(tl.x, tl.y);
          ctx.stroke();

          // Draw handles
          [tl, tr, br, bl].forEach((p) => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 8, 0, 2 * Math.PI);
            ctx.fillStyle = "#00ff00";
            ctx.fill();
            ctx.stroke();
          });
        };
        draw();

        // Interaction
        let dragging = null;

        // Use consistent mouse/touch handling logic
        const getPos = (e) => {
          const rect = canvas.getBoundingClientRect(); // Visual dimensions
          const clientX = e.touches ? e.touches[0].clientX : e.clientX;
          const clientY = e.touches ? e.touches[0].clientY : e.clientY;

          // Map visual pixels to 0-1000 scale
          const x = ((clientX - rect.left) / rect.width) * 1000;
          const y = ((clientY - rect.top) / rect.height) * 1000;
          return { x, y };
        };

        const handleStart = (e) => {
          const { x, y } = getPos(e);
          const dist = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);

          // Hit test radius in 0-1000 scale (approx 30 units = ~3%)
          if (dist({ x, y }, corners.topLeft) < 50) dragging = "topLeft";
          else if (dist({ x, y }, corners.topRight) < 50)
            dragging = "topRight";
          else if (dist({ x, y }, corners.bottomRight) < 50)
            dragging = "bottomRight";
          else if (dist({ x, y }, corners.bottomLeft) < 50)
            dragging = "bottomLeft";
        };

        const handleMove = (e) => {
          if (!dragging) return;
          e.preventDefault(); // Stop scrolling while dragging
          let { x, y } = getPos(e);
          // Clamp
          x = Math.max(0, Math.min(1000, x));
          y = Math.max(0, Math.min(1000, y));

          corners[dragging] = { x, y };
          draw();
        };

        const handleEnd = () => (dragging = null);

        canvas.addEventListener("mousedown", handleStart);
        addEventListener("mousemove", handleMove);
        addEventListener("mouseup", handleEnd);

        canvas.addEventListener("touchstart", handleStart, { passive: true });
        addEventListener("touchmove", handleMove, { passive: false });
        addEventListener("touchend", handleEnd);

        teardownPointerHandlers = () => {
          canvas.removeEventListener("mousedown", handleStart);
          removeEventListener("mousemove", handleMove);
          removeEventListener("mouseup", handleEnd);
          canvas.removeEventListener("touchstart", handleStart);
          removeEventListener("touchmove", handleMove);
          removeEventListener("touchend", handleEnd);
        };
      };
      img.src = imageData;

      // Buttons
      const btnRow = document.createElement("div");
      btnRow.style.marginTop = "15px";

      const confirmBtn = document.createElement("button");
      confirmBtn.innerText = "Confirm & Crop";
      confirmBtn.className = "confirm-btn"; // styling from existing css
      confirmBtn.style.cssText =
        "background:#22c55e;color:white;padding:10px 20px;border:none;border-radius:6px;cursor:pointer;font-weight:bold;margin-left:10px;";

      const skipBtn = document.createElement("button");
      skipBtn.innerText = "Skip (Use Original)";
      skipBtn.style.cssText =
        "background:#334;color:#ccc;padding:10px 20px;border:none;border-radius:6px;cursor:pointer;";

      skipBtn.onclick = () => {
        teardownPointerHandlers();
        document.body.removeChild(modal);
        resolve(null); // Return null to indicate no-warp
      };

      const resetBtn = document.createElement("button");
      resetBtn.innerText = "Reset to Full";
      resetBtn.style.cssText =
        "background:#4c5ad4;color:white;padding:10px 20px;border:none;border-radius:6px;cursor:pointer;margin-left:10px;";
      resetBtn.onclick = () => {
        corners.topLeft = { x: 50, y: 50 };
        corners.topRight = { x: 950, y: 50 };
        corners.bottomRight = { x: 950, y: 950 };
        corners.bottomLeft = { x: 50, y: 950 };
        draw();
      };

      confirmBtn.onclick = () => {
        const cornerImg = document.createElement("img");
        cornerImg.src = warpImageData;
        cornerImg.onload = async () => {
          teardownPointerHandlers();
          document.body.removeChild(modal);
          // Optionally map corners before warping (e.g., from letterboxed square to original image)
          const cornersToUse = mapForWarp ? mapForWarp(corners) : corners;
          const warped = await warpImage(cornerImg, cornersToUse);
          resolve(warped);
        };
      };

      btnRow.appendChild(skipBtn);
      btnRow.appendChild(resetBtn); // Add Reset option
      btnRow.appendChild(confirmBtn);
      container.appendChild(btnRow);

      modal.appendChild(container);
      document.body.appendChild(modal);
    });
  }

  // Helper to resize image for Claude API - EXACTLY like getNormalizedImage used for dish detection
  // Creates a 1000x1000 letterboxed image so AI's 0-1000 scale maps directly to pixels
  function resizeImageForAI(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        // CRITICAL: Use exactly 1000x1000 so AI's 0-1000 scale = actual pixels
        canvas.width = 1000;
        canvas.height = 1000;
        const ctx = canvas.getContext("2d");

        // Fill black (same as dish detection)
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, 1000, 1000);

        // Calculate scale to fit (same as dish detection)
        const scale = Math.min(1000 / img.width, 1000 / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const x = (1000 - w) / 2;
        const y = (1000 - h) / 2;

        ctx.drawImage(img, x, y, w, h);

        // Return metrics in pixels on the 1000x1000 canvas (same as dish detection)
        resolve({
          data: canvas.toDataURL("image/jpeg", 0.85),
          width: 1000,
          height: 1000,
          // Metrics for coordinate transformation (pixel values on 1000px canvas)
          scaledW: w,
          scaledH: h,
          offsetX: x,
          offsetY: y,
        });
      };
      img.src = dataUrl;
    });
  }

  // Function to process a single image file (Modified for Scanner Flow)
  function processImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const originalData = ev.target.result;

        console.log("Detecting corners...");

        // Resize specifically for the AI detection step
        const aiInfo = await resizeImageForAI(originalData);
        const aiResult = await detectCorners(
          aiInfo.data,
          aiInfo.width,
          aiInfo.height,
        );

        if (aiResult) {
          // Transform AI corners from 1000x1000 letterboxed canvas to original image (0-1000 scale)
          // Same approach as dish detection's mapCoord but returning 0-1000 instead of 0-100
          const mapCoord = (val, padding, dim) => {
            // val: 0-1000 from AI (pixel position on 1000px canvas)
            // padding: pixel offset where image content starts
            // dim: pixel dimension of image content on canvas
            // Returns: 0-1000 position on original image
            const relativePos = (val - padding) / dim; // 0-1 relative position
            return Math.max(0, Math.min(1000, relativePos * 1000));
          };

          const unmapCorner = (p) => ({
            x: mapCoord(p.x, aiInfo.offsetX, aiInfo.scaledW),
            y: mapCoord(p.y, aiInfo.offsetY, aiInfo.scaledH),
          });

          const mappedCorners = {
            topLeft: unmapCorner(aiResult.topLeft || { x: 0, y: 0 }),
            topRight: unmapCorner(aiResult.topRight || { x: 1000, y: 0 }),
            bottomRight: unmapCorner(
              aiResult.bottomRight || { x: 1000, y: 1000 },
            ),
            bottomLeft: unmapCorner(aiResult.bottomLeft || { x: 0, y: 1000 }),
            description: aiResult.description,
          };

          console.log("CornerDetect Debug:", {
            aiInfo,
            rawCorners: aiResult,
            mappedCorners,
          });

          // Show corners on the ORIGINAL image using the raw AI corners; keep raw AI dots for debug
          const warpedData = await showCornerEditor(
            originalData,
            mappedCorners,
            {
              debugMeta: { aiInfo, aiCornersRaw: aiResult },
            },
          );
          if (warpedData) {
            resolve(warpedData);
            return;
          }
        }

        // Fallback
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");

          // Resize image to max 1200px wide while maintaining aspect ratio
          const maxWidth = 1200;
          const scale = Math.min(1, maxWidth / img.width);
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;

          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const imageData = canvas.toDataURL("image/jpeg", 0.85);
          resolve(imageData);
        };
        img.onerror = reject;
        img.src = originalData;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Function to show preview modal
  function showMenuPreviewModal(imageData, pageNumber, options = {}) {
    const mode = options.mode || (menuImagesEditMode ? "edit" : "upload");
    const initialIndex = Number.isFinite(options.initialIndex)
      ? options.initialIndex
      : null;
    const hasImage = typeof imageData === "string" && imageData.length > 0;
    const skipAdd = options.skipAdd === true;
    const shouldUpdatePending = hasImage && !skipAdd;
    if (options.mode) {
      menuImagesEditMode = mode === "edit";
    }

    // Add or replace image if we're in upload mode
    if (shouldUpdatePending) {
      if (
        currentUploadIndex >= 0 &&
        currentUploadIndex < pendingMenuImages.length
      ) {
        pendingMenuImages[currentUploadIndex] = imageData;
        lastUploadedIndex = currentUploadIndex;
      } else {
        pendingMenuImages.push(imageData);
        pendingMenuImageIndices.push(null);
        lastUploadedIndex = pendingMenuImages.length - 1;
      }
    }

    const modal = document.createElement("div");
    modal.className = "modalBack";
    modal.style.display = "flex";
    modal.style.zIndex = "10000";

    const modalContent = document.createElement("div");
    modalContent.className = "modal";
    modalContent.style.cssText =
      "max-width:90vw;max-height:90vh;overflow:auto;background:#0f1534;border:1px solid #2a3466;border-radius:14px;padding:24px";

    // Current image index (the one being previewed)
    let currentImageIndex =
      currentUploadIndex >= 0
        ? currentUploadIndex
        : pendingMenuImages.length - 1;
    if (initialIndex !== null) {
      currentImageIndex = Math.min(
        Math.max(initialIndex, 0),
        Math.max(0, pendingMenuImages.length - 1),
      );
    }

    // Create thumbnails for all pending images
    const thumbnailsHTML = pendingMenuImages
      .map(
        (img, idx) => `
  <div class="preview-thumbnail" data-index="${idx}" style="
    position: relative;
    cursor: pointer;
    border: 3px solid ${idx === currentImageIndex ? "#4c5ad4" : "rgba(76,90,212,0.3)"};
    border-radius: 8px;
    overflow: hidden;
    background: rgba(76,90,212,0.1);
    transition: all 0.2s;
    ${idx === currentImageIndex ? "box-shadow: 0 0 0 2px rgba(76,90,212,0.5);" : ""}
  ">
    <button type="button" class="preview-remove-thumbnail" data-index="${idx}" style="
      position: absolute;
      top: 4px;
      right: 4px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: rgba(220, 38, 38, 0.9);
      border: 2px solid white;
      color: white;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10;
      transition: all 0.2s;
      padding: 0;
    " title="Remove page ${idx + 1}">×</button>
    <img src="${img}" alt="Page ${idx + 1}" style="
      width: 100px;
      height: 100px;
      object-fit: cover;
      display: block;
    ">
    <div style="
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: ${idx === currentImageIndex ? "rgba(76,90,212,0.9)" : "rgba(0,0,0,0.7)"};
      color: white;
      text-align: center;
      padding: 4px;
      font-size: 0.75rem;
      font-weight: 600;
    ">Page ${idx + 1}</div>
  </div>
`,
      )
      .join("");

    modalContent.innerHTML = `
  <div style="text-align:center;margin-bottom:20px">
    <h3 style="margin:0 0 12px 0;color:#e9ecff;font-size:1.3rem">${mode === "edit" ? "Edit menu images" : "Menu Pages Preview"}</h3>
    <p style="margin:0;color:#a8b2d6;font-size:0.95rem">${mode === "edit" ? "Review, replace, or remove pages before saving." : `Review all pages before saving (${pendingMenuImages.length} ${pendingMenuImages.length === 1 ? "page" : "pages"})`}</p>
  </div>

  ${
    pendingMenuImages.length > 1
      ? `
    <div style="margin-bottom:20px;padding:16px;background:rgba(76,90,212,0.1);border-radius:8px">
      <div style="color:#a8b2d6;font-size:0.9rem;margin-bottom:12px;text-align:center">All Menu Pages (click to view)</div>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap" id="previewThumbnails">
        ${thumbnailsHTML}
      </div>
    </div>
  `
      : ""
  }

  <div style="text-align:center;margin-bottom:24px;position:relative">

    <img id="previewMainImage" src="${pendingMenuImages[currentImageIndex]}" alt="Menu page preview" style="max-width:100%;max-height:60vh;border-radius:8px;border:2px solid rgba(76,90,212,0.5);box-shadow:0 4px 12px rgba(0,0,0,0.3)">
    ${
      pendingMenuImages.length > 1
        ? `
      <div style="display:flex;justify-content:center;align-items:center;gap:16px;margin-top:16px">
        <button id="previewPrevBtn" style="
          padding: 10px 20px;
          background: ${currentImageIndex === 0 ? "rgba(76,90,212,0.2)" : "#4c5ad4"};
          border: 2px solid ${currentImageIndex === 0 ? "rgba(76,90,212,0.4)" : "#4c5ad4"};
          border-radius: 8px;
          color: white;
          font-size: 1rem;
          font-weight: 600;
          cursor: ${currentImageIndex === 0 ? "not-allowed" : "pointer"};
          transition: all 0.2s;
          opacity: ${currentImageIndex === 0 ? 0.5 : 1};
        " ${currentImageIndex === 0 ? "disabled" : ""}>← Previous</button>
        <div id="previewPageIndicator" style="color:#a8b2d6;font-size:1rem;font-weight:600;min-width:120px">Page ${currentImageIndex + 1} of ${pendingMenuImages.length}</div>
        <button id="previewNextBtn" style="
          padding: 10px 20px;
          background: ${currentImageIndex >= pendingMenuImages.length - 1 ? "rgba(76,90,212,0.2)" : "#4c5ad4"};
          border: 2px solid ${currentImageIndex >= pendingMenuImages.length - 1 ? "rgba(76,90,212,0.4)" : "#4c5ad4"};
          border-radius: 8px;
          color: white;
          font-size: 1rem;
          font-weight: 600;
          cursor: ${currentImageIndex >= pendingMenuImages.length - 1 ? "not-allowed" : "pointer"};
          transition: all 0.2s;
          opacity: ${currentImageIndex >= pendingMenuImages.length - 1 ? 0.5 : 1};
        " ${currentImageIndex >= pendingMenuImages.length - 1 ? "disabled" : ""}>Next →</button>
      </div>
    `
        : `
      <div id="previewPageIndicator" style="margin-top:12px;color:#a8b2d6;font-size:0.95rem">Page ${currentImageIndex + 1} of ${pendingMenuImages.length}</div>
    `
    }
  </div>
  <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
    <button class="btn" id="previewReplaceBtn" style="padding:12px 24px;background:rgba(14,116,144,0.2);border-color:rgba(14,116,144,0.4)">♻️ Replace This Page</button>
    <button class="btn" id="previewAddAnotherBtn" style="padding:12px 24px;background:rgba(76,90,212,0.2);border-color:rgba(76,90,212,0.4)">📷 Add New Page</button>
    <button class="btn btnPrimary" id="previewSaveBtn" style="padding:12px 24px">✓ Save ${pendingMenuImages.length} ${pendingMenuImages.length === 1 ? "Page" : "Pages"}</button>
  </div>
  `;

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Function to remove a page and refresh the modal
    const removePage = (pageIndex) => {
      if (pendingMenuImages.length <= 1) {
        alert(
          "Cannot remove the last page. Please add another page first or cancel the upload.",
        );
        return;
      }

      // Remove the page from pending images
      pendingMenuImages.splice(pageIndex, 1);
      pendingMenuImageIndices.splice(pageIndex, 1);

      // Calculate new current index after removal
      let newCurrentIndex = currentImageIndex;
      if (currentImageIndex >= pendingMenuImages.length) {
        newCurrentIndex = pendingMenuImages.length - 1;
      } else if (currentImageIndex > pageIndex) {
        newCurrentIndex = currentImageIndex - 1;
      } else if (currentImageIndex === pageIndex) {
        // If we removed the current page, show the previous one (or first if it was the first)
        newCurrentIndex = Math.max(0, pageIndex - 1);
      }

      // Update currentUploadIndex
      if (currentUploadIndex === pageIndex) {
        currentUploadIndex = -1;
      } else if (currentUploadIndex > pageIndex) {
        currentUploadIndex--;
      }
      if (lastUploadedIndex === pageIndex) {
        lastUploadedIndex = -1;
      } else if (lastUploadedIndex > pageIndex) {
        lastUploadedIndex--;
      }

      // Re-render the modal with updated data
      cleanupKeyboardHandler();
      document.body.removeChild(modal);
      // Set currentUploadIndex to the new index so the modal shows the correct page
      const savedCurrentUploadIndex = currentUploadIndex;
      currentUploadIndex = newCurrentIndex;
      showMenuPreviewModal(
        pendingMenuImages[newCurrentIndex] || pendingMenuImages[0],
        newCurrentIndex + 1,
        { mode, initialIndex: newCurrentIndex, skipAdd: true },
      );
      currentUploadIndex = savedCurrentUploadIndex; // Restore original value
    };

    // Function to switch to a different page
    const switchPage = (newIndex) => {
      if (newIndex < 0 || newIndex >= pendingMenuImages.length) return;

      currentImageIndex = newIndex;
      currentUploadIndex = newIndex;

      // Update main image
      const mainImage = modalContent.querySelector("#previewMainImage");
      if (mainImage) {
        mainImage.src = pendingMenuImages[newIndex];
      }

      // Update page indicator
      const pageIndicator = modalContent.querySelector("#previewPageIndicator");
      if (pageIndicator) {
        pageIndicator.textContent = `Page ${newIndex + 1} of ${pendingMenuImages.length} `;
      }

      // Update thumbnail borders
      const thumbnails = modalContent.querySelectorAll(".preview-thumbnail");
      thumbnails.forEach((thumb, idx) => {
        if (idx === newIndex) {
          thumb.style.border = "3px solid #4c5ad4";
          thumb.style.boxShadow = "0 0 0 2px rgba(76,90,212,0.5)";
        } else {
          thumb.style.border = "3px solid rgba(76,90,212,0.3)";
          thumb.style.boxShadow = "none";
        }
      });

      // Update navigation buttons
      const prevBtn = modalContent.querySelector("#previewPrevBtn");
      const nextBtn = modalContent.querySelector("#previewNextBtn");

      if (prevBtn) {
        const isFirst = newIndex === 0;
        prevBtn.disabled = isFirst;
        prevBtn.style.background = isFirst ? "rgba(76,90,212,0.2)" : "#4c5ad4";
        prevBtn.style.borderColor = isFirst
          ? "rgba(76,90,212,0.4)"
          : "#4c5ad4";
        prevBtn.style.cursor = isFirst ? "not-allowed" : "pointer";
        prevBtn.style.opacity = isFirst ? "0.5" : "1";
      }

      if (nextBtn) {
        const isLast = newIndex >= pendingMenuImages.length - 1;
        nextBtn.disabled = isLast;
        nextBtn.style.background = isLast ? "rgba(76,90,212,0.2)" : "#4c5ad4";
        nextBtn.style.borderColor = isLast
          ? "rgba(76,90,212,0.4)"
          : "#4c5ad4";
        nextBtn.style.cursor = isLast ? "not-allowed" : "pointer";
        nextBtn.style.opacity = isLast ? "0.5" : "1";
      }
    };

    // Handle thumbnail clicks to switch preview image
    const thumbnails = modalContent.querySelectorAll(".preview-thumbnail");
    thumbnails.forEach((thumb, idx) => {
      thumb.onclick = (e) => {
        // Don't switch if clicking the remove button
        if (e.target.classList.contains("preview-remove-thumbnail")) {
          return;
        }

        switchPage(idx);
      };
    });

    // Handle Previous button
    const prevBtn = modalContent.querySelector("#previewPrevBtn");
    if (prevBtn) {
      prevBtn.onclick = () => {
        if (currentImageIndex > 0) {
          switchPage(currentImageIndex - 1);
        }
      };
    }

    // Handle Next button
    const nextBtn = modalContent.querySelector("#previewNextBtn");
    if (nextBtn) {
      nextBtn.onclick = () => {
        if (currentImageIndex < pendingMenuImages.length - 1) {
          switchPage(currentImageIndex + 1);
        }
      };
    }

    // Handle remove buttons on thumbnails
    const removeThumbnailBtns = modalContent.querySelectorAll(
      ".preview-remove-thumbnail",
    );
    removeThumbnailBtns.forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const pageIndex = parseInt(btn.dataset.index);
        removePage(pageIndex);
      };
    });

    // Handle remove button on main preview
    const removeCurrentBtn = modalContent.querySelector(
      "#previewRemoveCurrentBtn",
    );
    if (removeCurrentBtn) {
      removeCurrentBtn.onclick = () => {
        removePage(currentImageIndex);
      };
    }

    // Handle keyboard navigation (arrow keys)
    const handleKeyDown = (e) => {
      if (e.key === "ArrowLeft" && currentImageIndex > 0) {
        e.preventDefault();
        switchPage(currentImageIndex - 1);
      } else if (
        e.key === "ArrowRight" &&
        currentImageIndex < pendingMenuImages.length - 1
      ) {
        e.preventDefault();
        switchPage(currentImageIndex + 1);
      }
    };

    // Clean up keyboard listener when closing
    const cleanupKeyboardHandler = () => {
      document.removeEventListener("keydown", handleKeyDown);
    };

    document.addEventListener("keydown", handleKeyDown);

    // Handle save button
    const saveBtn = modalContent.querySelector("#previewSaveBtn");
    saveBtn.onclick = async () => {
      // Change button text to indicate loading
      const originalBtnText = saveBtn.textContent;
      saveBtn.textContent = "Processing...";
      saveBtn.disabled = true;
      const oldMenuImages = [...menuImages];
      const pageIndexMap =
        Array.isArray(pendingMenuImageIndices) &&
        pendingMenuImageIndices.length === pendingMenuImages.length
          ? [...pendingMenuImageIndices]
          : pendingMenuImages.map((_, idx) => idx);

      try {
        // Capture old images before update to detect changes
        const pagesToProcess = [];

        // Create a 1000x1000 normalized version of the image (Letterboxed) for consistent AI analysis without distortion
        // Defined at higher scope so it's accessible during auto-split processing
        const getNormalizedImage = (src) =>
          new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";

            img.onload = () => {
              const canvas = document.createElement("canvas");
              canvas.width = 1000;
              canvas.height = 1000;
              const ctx = canvas.getContext("2d");

              ctx.fillStyle = "#000000";
              ctx.fillRect(0, 0, 1000, 1000);
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = "high";

              const scale = Math.min(1000 / img.width, 1000 / img.height);
              const w = img.width * scale;
              const h = img.height * scale;
              const x = (1000 - w) / 2;
              const y = (1000 - h) / 2;

              try {
                ctx.drawImage(img, x, y, w, h);
                resolve({
                  dataUrl: canvas.toDataURL("image/jpeg", 0.92),
                  metrics: { x, y, w, h, scale },
                });
              } catch (e) {
                console.error("Canvas export failed (likely CORS):", e);
                reject(e);
              }
            };
            img.onerror = (e) =>
              reject(new Error("Failed to load image for normalization"));
            img.src = src;
          });

        // Detect changed or new pages
        // We iterate over pendingMenuImages because that's the desired final state
        for (let i = 0; i < pendingMenuImages.length; i++) {
          const sourceIndex = Number.isInteger(pageIndexMap[i])
            ? pageIndexMap[i]
            : i;
          const oldImg =
            sourceIndex < oldMenuImages.length
              ? oldMenuImages[sourceIndex]
              : null;
          const newImg = pendingMenuImages[i];

          if (oldImg !== newImg || i === lastUploadedIndex) {
            // Image changed, is new, OR was explicitly just uploaded (force re-scan)
            const pageOverlays = overlays.filter((o) => {
              const pIdx = o.pageIndex !== undefined ? o.pageIndex : 0;
              return pIdx === sourceIndex;
            });

            // Get original dimensions (for reference, though metrics covers what we need)
            const getImageDims = (src) =>
              new Promise((resolve) => {
                const img = new Image();
                img.onload = () => resolve({ w: img.width, h: img.height });
                img.onerror = () => resolve({ w: 1000, h: 1000 }); // Fallback
                img.src = src;
              });

            // Prepare promises
            const promises = [getNormalizedImage(newImg), getImageDims(newImg)];

            // If there's an old image, we must normalize it too to ensure "Dual Letterboxing" consistency
            // We wrap this in a catch so we don't crash if the old image has CORS issues
            let oldImagePromise = Promise.resolve(null);
            if (oldImg) {
              oldImagePromise = getNormalizedImage(oldImg).catch((err) => {
                console.warn(
                  "Failed to normalize old image (CORS?), falling back to Discovery Mode:",
                  err,
                );
                return null;
              });
            }
            promises.push(oldImagePromise);

            const results = await Promise.all(promises);
            const normResultNew = results[0];
            const dims = results[1];
            const normResultOld = results[2]; // Can be null if failed or didn't exist

            // Transform existing overlays to the 1000x1000 letterboxed space of the OLD image
            // If normResultOld is null (load failed), we send EMPTY overlays to force clean discovery
            let transformedOverlays = [];
            if (normResultOld && pageOverlays && pageOverlays.length > 0) {
              const m = normResultOld.metrics;
              // Helper: (valPct / 100) * dim + padding
              const toCanvas = (pct, padding, dim) =>
                (pct / 100) * dim + padding;

              transformedOverlays = pageOverlays.map((o) => ({
                ...o,
                x: toCanvas(o.x, m.x, m.w),
                y: toCanvas(o.y, m.y, m.h),
                w: (o.w / 100) * m.w,
                h: (o.h / 100) * m.h,
              }));
            } else if (oldImg && !normResultOld) {
              console.log(
                "Skipping overlay transformation due to old image load failure. Starting fresh.",
              );
            }

            // Always process if image changed (send normalization version to AI)
            // If normResultOld is null, we send 'oldImage: null' to backend, effectively acting as "New Image Only" mode
            pagesToProcess.push({
              pageIndex: i,
              sourceIndex,
              oldImage: normResultOld ? normResultOld.dataUrl : null,
              newImage: normResultNew.dataUrl, // Send letterboxed new image
              originalNewImage: newImg,
              overlays: transformedOverlays, // Transformed OR Empty (if fallback)
              imageWidth: 1000,
              imageHeight: 1000,
              transformMetrics: normResultNew.metrics, // Pass metrics for result re-mapping (New Image)
            });
          }
        }

        // Show loading state
        if (pagesToProcess.length > 0) {
          const originalBtnText = saveBtn.textContent;
          saveBtn.textContent = "AI Processing...";

          // Helper to map AI coordinates (0-1000 on square canvas) back to original image (0-100 on content area)
          const mapCoord = (val1000, padding, dim) => {
            return ((val1000 - padding) / dim) * 100;
          };

          // Safety padding disabled per user request.
          const INFLATION_PCT = 0;
          const applyBalancedPadding = (rawX, rawY, rawW, rawH, paddingPct) => {
            if (![rawX, rawY, rawW, rawH].every(Number.isFinite)) {
              return null;
            }
            const baseX = rawX;
            const baseY = rawY;
            const baseW = rawW;
            const baseH = rawH;
            const baseRight = baseX + baseW;
            const baseBottom = baseY + baseH;

            const paddedLeft = baseX - paddingPct;
            const paddedTop = baseY - paddingPct;
            const paddedRight = baseRight + paddingPct;
            const paddedBottom = baseBottom + paddingPct;

            const clampedLeft = Math.max(0, paddedLeft);
            const clampedTop = Math.max(0, paddedTop);
            const clampedRight = Math.min(100, paddedRight);
            const clampedBottom = Math.min(100, paddedBottom);

            const leftPad = baseX - clampedLeft;
            const rightPad = clampedRight - baseRight;
            const topPad = baseY - clampedTop;
            const bottomPad = clampedBottom - baseBottom;

            const balancedPadX = Math.max(0, Math.min(leftPad, rightPad));
            const balancedPadY = Math.max(0, Math.min(topPad, bottomPad));

            let finalX = baseX - balancedPadX;
            let finalY = baseY - balancedPadY;
            let finalW = baseW + balancedPadX * 2;
            let finalH = baseH + balancedPadY * 2;

            finalX = Math.max(0, Math.min(100, finalX));
            finalY = Math.max(0, Math.min(100, finalY));
            finalW = Math.max(0, Math.min(100 - finalX, finalW));
            finalH = Math.max(0, Math.min(100 - finalY, finalH));

            return { x: finalX, y: finalY, w: finalW, h: finalH };
          };

          // Process each page (may expand into multiple pages if auto-split is triggered)
          let pageIndexOffset = 0; // Track offset when pages are split into multiple

          for (let pIdx = 0; pIdx < pagesToProcess.length; pIdx++) {
            const p = pagesToProcess[pIdx];
            const effectivePageIndex = p.pageIndex + pageIndexOffset;
            const sourcePageIndex = Number.isInteger(p.sourceIndex)
              ? p.sourceIndex
              : p.pageIndex;
            const effectiveSourceIndex = sourcePageIndex + pageIndexOffset;

            try {
              console.log(`Processing page ${p.pageIndex + 1}...`);
              saveBtn.textContent = `Analyzing page ${p.pageIndex + 1}...`;

              // First AI pass on full image
              const result = await invokeSupabaseFunction("reposition-overlays", {
                oldImageUrl: p.oldImage,
                newImageUrl: p.newImage, // 1000x1000 letterboxed
                overlays: p.overlays,
                imageWidth: 1000,
                imageHeight: 1000,
              });

              // Handle successful result
              if (result.data) {
                const { updatedOverlays, newOverlays } = result.data;
                const allDetectedOverlays = [
                  ...(updatedOverlays || []),
                  ...(newOverlays || []),
                ];

                // Analyze box sizes for recommended zoom (but no longer split images)
                const tm = p.transformMetrics;
                const analysis = analyzeBoxSizes(
                  allDetectedOverlays,
                  tm,
                  25,
                  375,
                );

                // Store recommended zoom for customer view (if boxes are small)
                // This will be used to set initial zoom instead of splitting
                if (analysis.needsSplit && analysis.scaleNeeded > 1) {
                  console.log(
                    `[ZoomRecommendation] Page ${p.pageIndex + 1}: Boxes small, recommend ${Math.round(analysis.scaleNeeded * 100)}% zoom`,
                  );
                }

                // DISABLED: No longer split images - we use zoom instead
                const needsSplitting = false;

                if (needsSplitting) {
                  // SMART SPLIT: Use column detection + horizontal strips
                  const horizontalStrips = hasMultipleColumns
                    ? Math.max(
                        1,
                        Math.ceil(
                          analysis.stripCount / columnDetection.columnCount,
                        ),
                      )
                    : analysis.stripCount;

                  console.log(
                    `[SmartSplit] Page ${p.pageIndex + 1}: ${columnDetection.columnCount} columns, ${horizontalStrips} horizontal strips`,
                  );
                  saveBtn.textContent = `Splitting into ${columnDetection.columnCount * horizontalStrips} sections...`;

                  try {
                    // Split image into sections (columns x rows)
                    const sections = await splitImageIntoSections(
                      p.originalNewImage,
                      columnDetection.splitPoints,
                      horizontalStrips,
                    );

                    // Remove overlays for this page (we'll re-detect on each section)
                    const overlaysToRemove = overlays.filter(
                      (o) => (o.pageIndex || 0) === effectiveSourceIndex,
                    );
                    overlaysToRemove.forEach((o) => {
                      const idx = overlays.indexOf(o);
                      if (idx !== -1) overlays.splice(idx, 1);
                    });

                    // Process each section through AI
                    const sectionImages = [];
                    const sectionOverlaysAll = [];

                    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
                      const section = sections[sIdx];
                      saveBtn.textContent = `Processing section ${sIdx + 1} of ${sections.length}...`;

                      // Normalize section to 1000x1000 letterbox for AI
                      const sectionNormalized = await getNormalizedImage(
                        section.dataUrl,
                      );

                      // Run AI on section (discovery mode - no old image)
                      const sectionResult = await invokeSupabaseFunction(
                        "reposition-overlays",
                        {
                          oldImageUrl: null,
                          newImageUrl: sectionNormalized.dataUrl,
                          overlays: [],
                          imageWidth: 1000,
                          imageHeight: 1000,
                        },
                      );

                      if (
                        sectionResult.data &&
                        sectionResult.data.newOverlays
                      ) {
                        const sectionTm = sectionNormalized.metrics;
                        const sectionPageIndex = effectivePageIndex + sIdx;

                        // Map coordinates from letterbox to section percentage space
                        sectionResult.data.newOverlays.forEach((newItem) => {
                          if (
                            !sectionTm.w ||
                            !sectionTm.h ||
                            sectionTm.w <= 0 ||
                            sectionTm.h <= 0
                          ) {
                            console.warn(
                              "Invalid section metrics, skipping:",
                              newItem.id,
                            );
                            return;
                          }

                          const rawX = mapCoord(
                            newItem.x,
                            sectionTm.x,
                            sectionTm.w,
                          );
                          const rawY = mapCoord(
                            newItem.y,
                            sectionTm.y,
                            sectionTm.h,
                          );
                          const rawW = (newItem.w / sectionTm.w) * 100;
                          const rawH = (newItem.h / sectionTm.h) * 100;

                          const balanced = applyBalancedPadding(
                            rawX,
                            rawY,
                            rawW,
                            rawH,
                            INFLATION_PCT,
                          );
                          let finalX = balanced ? balanced.x : NaN;
                          let finalY = balanced ? balanced.y : NaN;
                          let finalW = balanced ? balanced.w : NaN;
                          let finalH = balanced ? balanced.h : NaN;

                          if (
                            !Number.isFinite(finalX) ||
                            !Number.isFinite(finalY) ||
                            !Number.isFinite(finalW) ||
                            !Number.isFinite(finalH)
                          ) {
                            finalX = 0;
                            finalY = 0;
                            finalW = 10;
                            finalH = 5;
                          }

                          sectionOverlaysAll.push({
                            id: newItem.id,
                            text: newItem.id,
                            x: finalX,
                            y: finalY,
                            w: finalW,
                            h: finalH,
                            pageIndex: sectionPageIndex,
                            sectionIndex: sIdx,
                            sectionBounds: section.bounds,
                            allergens: [],
                            diets: [],
                            details: {},
                          });
                        });

                        console.log(
                          `[SmartSplit] Section ${sIdx + 1} (col ${section.col}, row ${section.row}): Found ${sectionResult.data.newOverlays.length} items`,
                        );
                      }

                      sectionImages.push(section.dataUrl);
                    }

                    // Replace original image with section images in pendingMenuImages
                    pendingMenuImages.splice(p.pageIndex, 1, ...sectionImages);

                    // Add all section overlays
                    overlays.push(...sectionOverlaysAll);

                    // Update page index offset for subsequent pages
                    pageIndexOffset += sections.length - 1;

                    // Shift pageIndex for any existing overlays on later pages
                    overlays.forEach((o) => {
                      if (
                        (o.pageIndex || 0) > effectiveSourceIndex &&
                        !sectionOverlaysAll.includes(o)
                      ) {
                        o.pageIndex =
                          (o.pageIndex || 0) + (sections.length - 1);
                      }
                    });

                    const colInfo = hasMultipleColumns
                      ? `${columnDetection.columnCount} columns × `
                      : "";
                    pendingChanges.push(
                      `Smart-split page ${effectivePageIndex + 1} into ${colInfo}${sections.length} sections (${sectionOverlaysAll.length} items detected)`,
                    );
                    setTimeout(
                      () =>
                        alert(
                          `Menu split into ${sections.length} sections for better readability (${sectionOverlaysAll.length} items detected)`,
                        ),
                      500,
                    );
                  } catch (splitErr) {
                    console.error(
                      "Smart-split failed, falling back to original:",
                      splitErr,
                    );
                    await processOverlaysNormally();
                  }
                } else {
                  await processOverlaysNormally();
                }

                // Helper function for normal overlay processing (extracted to avoid duplication)
                async function processOverlaysNormally() {
                  // NO SPLIT NEEDED - Process normally
                  let updateCount = 0;
                  let newCount = 0;

                  if (updatedOverlays && updatedOverlays.length) {
                    console.log(
                      `AI: Received ${updatedOverlays.length} updated overlays.`,
                    );
                    updatedOverlays.forEach((updated) => {
                      const existing = overlays.find(
                        (o) => o.id === updated.id,
                      );
                      if (existing) {
                        const rawX = mapCoord(updated.x, tm.x, tm.w);
                        const rawY = mapCoord(updated.y, tm.y, tm.h);
                        const rawW = (updated.w / tm.w) * 100;
                        const rawH = (updated.h / tm.h) * 100;

                        const balanced = applyBalancedPadding(
                          rawX,
                          rawY,
                          rawW,
                          rawH,
                          INFLATION_PCT,
                        );
                        if (balanced) {
                          existing.x = balanced.x;
                          existing.y = balanced.y;
                          existing.w = balanced.w;
                          existing.h = balanced.h;
                        }

                        updateCount++;
                      }
                    });
                  } else if (newOverlays && newOverlays.length) {
                    console.log(
                      "AI: No updates found but new items detected. Clearing old overlays.",
                    );
                    // Clear overlays for this page
                    for (let i = overlays.length - 1; i >= 0; i--) {
                      if ((overlays[i].pageIndex || 0) === effectiveSourceIndex) {
                        overlays.splice(i, 1);
                      }
                    }
                  }

                  if (newOverlays && newOverlays.length) {
                    console.log(
                      `AI: Discovered ${newOverlays.length} new dishes.`,
                    );
                    newOverlays.forEach((newItem) => {
                      if (!tm.w || !tm.h || tm.w <= 0 || tm.h <= 0) {
                        console.warn(
                          "Invalid transform metrics, skipping overlay:",
                          newItem.id,
                          tm,
                        );
                        return;
                      }

                      const rawX = mapCoord(newItem.x, tm.x, tm.w);
                      const rawY = mapCoord(newItem.y, tm.y, tm.h);
                      const rawW = (newItem.w / tm.w) * 100;
                      const rawH = (newItem.h / tm.h) * 100;

                      const balanced = applyBalancedPadding(
                        rawX,
                        rawY,
                        rawW,
                        rawH,
                        INFLATION_PCT,
                      );
                      let finalX = balanced ? balanced.x : NaN;
                      let finalY = balanced ? balanced.y : NaN;
                      let finalW = balanced ? balanced.w : NaN;
                      let finalH = balanced ? balanced.h : NaN;

                      if (
                        !Number.isFinite(finalX) ||
                        !Number.isFinite(finalY) ||
                        !Number.isFinite(finalW) ||
                        !Number.isFinite(finalH)
                      ) {
                        console.warn(
                          "Invalid overlay coordinates, using defaults:",
                          newItem.id,
                          { rawX, rawY, rawW, rawH },
                        );
                        finalX = 0;
                        finalY = 0;
                        finalW = 10;
                        finalH = 5;
                      }

                      overlays.push({
                        id: newItem.id,
                        text: newItem.id,
                        x: finalX,
                        y: finalY,
                        w: finalW,
                        h: finalH,
                        pageIndex: effectivePageIndex,
                        allergens: [],
                        diets: [],
                        details: {},
                      });
                      newCount++;
                    });
                  }

                  if (updateCount > 0 || newCount > 0) {
                    pendingChanges.push(
                      `AI repositioned ${updateCount} items and added ${newCount} new items on page ${effectivePageIndex + 1}`,
                    );
                    if (newCount > 0) {
                      setTimeout(
                        () =>
                          alert(
                            `AI Discovered ${newCount} new dishes on Page ${effectivePageIndex + 1}!`,
                          ),
                        500,
                      );
                    }
                  }
                } // end processOverlaysNormally
              } else {
                console.warn("AI: No updated overlays returned", result);
              }
            } catch (err) {
              console.error(
                "AI repositioning failed for page " + p.pageIndex,
                err,
              );
              alert(`AI Error: ${err.message}`);
              pendingChanges.push(
                `AI skipped for page ${p.pageIndex + 1} (error)`,
              );
            }
          }
        }
      } catch (e) {
        console.error("Error in save handler:", e);
      }

      applyPendingMenuIndexRemap(oldMenuImages, pageIndexMap);

      // All images are already in pendingMenuImages (added when modal opens)
      // Update menu images (sync with pendingMenuImages)
      menuImages.length = 0;
      menuImages.push(...pendingMenuImages);
      rs.menuImages = menuImages;
      rs.menuImage = menuImages[0] || "";
      if (state.restaurant) {
        state.restaurant.menuImages = menuImages;
        state.restaurant.menuImage = menuImages[0] || "";
      }

      // Update pendingMenuImages to match (so next upload has correct page number)
      pendingMenuImages = [...menuImages];
      pendingMenuImageIndices = menuImages.map((_, idx) => idx);

      // Reset to first page if this was the first image, otherwise switch to newly added page
      if (menuImages.length === 1) {
        setCurrentPageIndex(0);
      } else {
        // Switch to the newly added page
        setCurrentPageIndex(menuImages.length - 1);
      }

      // Mark as dirty
      pendingChanges.push(`Uploaded menu page ${menuImages.length} `);
      setDirty(true);

      // Close modal
      cleanupKeyboardHandler();
      document.body.removeChild(modal);
      currentUploadIndex = -1;
      lastUploadedIndex = -1;

      menuImagesEditMode = false;
      const didRebuild = syncEditorMenuImages();

      if (!didRebuild) {
        // Hide page navigation UI - we use scrollable sections now
        const pageNav = document.querySelector("#prevPageBtn")?.parentElement;
        if (pageNav) {
          pageNav.style.display = "none";
        }

        // Update page navigation UI (bottom) - REMOVED
        switchMenuPage(getCurrentPageIndex());
      }

      // Show confirmation
      setTimeout(() => {
        alert(
          `✓ ${menuImages.length} menu ${menuImages.length === 1 ? "page" : "pages"} saved successfully.\n\nYou can add more pages or save your changes.`,
        );
      }, 100);
    };

    // Handle replace current page
    const replaceBtn = modalContent.querySelector("#previewReplaceBtn");
    if (replaceBtn) {
      replaceBtn.onclick = () => {
        menuImagesEditMode = true;
        currentUploadIndex = currentImageIndex;
        cleanupKeyboardHandler();
        document.body.removeChild(modal);
        openMenuUploadModal();
      };
    }

    // Handle add another button
    const addAnotherBtn = modalContent.querySelector("#previewAddAnotherBtn");
    addAnotherBtn.onclick = () => {
      // All images are already in pendingMenuImages (added when modal opens)
      // Reset current upload index for new upload
      currentUploadIndex = -1;
      menuImagesEditMode = true;

      // Close modal
      cleanupKeyboardHandler();
      document.body.removeChild(modal);

      // Update menu images temporarily so UI reflects the new page
      const oldMenuImages = [...menuImages];
      const pageIndexMap =
        Array.isArray(pendingMenuImageIndices) &&
        pendingMenuImageIndices.length === pendingMenuImages.length
          ? [...pendingMenuImageIndices]
          : pendingMenuImages.map((_, idx) => idx);
      applyPendingMenuIndexRemap(oldMenuImages, pageIndexMap);
      menuImages.length = 0;
      menuImages.push(...pendingMenuImages);
      rs.menuImages = menuImages;
      rs.menuImage = menuImages[0] || "";
      if (state.restaurant) {
        state.restaurant.menuImages = menuImages;
        state.restaurant.menuImage = menuImages[0] || "";
      }
      pendingMenuImageIndices = menuImages.map((_, idx) => idx);

      // Update navigation UI
      updateMenuNavigationUI();

      // Mark as dirty
      pendingChanges.push(
        `Added menu page ${pendingMenuImages.length} (pending save)`,
      );
      setDirty(true);

      // Update bottom navigation button states
      const nextPageIndex = Math.min(
        getCurrentPageIndex(),
        Math.max(0, menuImages.length - 1),
      );
      setCurrentPageIndex(nextPageIndex);
      setEditorAutoOpenMenuUpload(true);
      const didRebuild = syncEditorMenuImages();
      if (didRebuild) {
        return;
      }
      setEditorAutoOpenMenuUpload(false);
      switchMenuPage(getCurrentPageIndex());

      // Open upload modal again
      setTimeout(() => {
        openMenuUploadModal();
      }, 100);
    };

    // Close on backdrop click
    const backdropHandler = (e) => {
      if (e.target === modal) {
        cleanupKeyboardHandler();
        document.body.removeChild(modal);
        currentUploadIndex = -1;
      }
    };
    modal.onclick = backdropHandler;
  }

  // Menu upload modal elements
  let menuUploadModal = null;
  let menuUploadVideo = null;
  let menuUploadMediaStream = null;
  let menuUploadFileInput = null;
  let menuUploadCameraBtn = null;
  let menuUploadUploadBtn = null;
  let menuUploadCaptureBtn = null;
  let menuUploadCancelBtn = null;
  let menuUploadCloseBtn = null;

  // Function to create menu upload modal
  function createMenuUploadModal() {
    if (menuUploadModal) return menuUploadModal;

    const modal = document.createElement("div");
    modal.className = "aiAssistBackdrop";
    modal.id = "menuUploadModal";
    modal.setAttribute("aria-hidden", "true");
    modal.style.display = "none";

    modal.innerHTML = `
    <div class="aiAssistPanel" style="max-width:500px" role="dialog" aria-modal="true" aria-labelledby="menuUploadTitle">
    <div class="aiAssistHead">
      <h2 id="menuUploadTitle">Upload menu page</h2>
      <button type="button" class="aiAssistClose" id="menuUploadClose" aria-label="Close">×</button>
    </div>

    <div class="aiAssistMedia" id="menuUploadMedia" style="display:flex;gap:12px;margin:20px 0">
      <button type="button" class="btn" id="menuUploadUploadBtn" style="flex:1;padding:14px;font-size:1rem">📁 Upload photo</button>
      <button type="button" class="btn" id="menuUploadCameraBtn" style="flex:1;padding:14px;font-size:1rem">📷 Take photo</button>
      <input type="file" id="menuUploadFileInput" class="aiAssistHidden" accept="image/*">
    </div>

    <div class="aiAssistMediaPreview" id="menuUploadMediaPreview" style="display:none">
      <video id="menuUploadVideo" class="aiAssistHidden" playsinline muted style="width:100%;max-height:400px;border-radius:8px"></video>
      <div class="aiAssistPhotoControls" style="display:flex;gap:12px;margin-top:12px">
        <button type="button" class="btn" id="menuUploadCaptureBtn" style="flex:1;padding:12px">Capture photo</button>
        <button type="button" class="btn" id="menuUploadCancelBtn" style="flex:1;padding:12px;background:rgba(76,90,212,0.2);border-color:rgba(76,90,212,0.4)">Cancel camera</button>
      </div>
    </div>
  </div >
    `;

    document.body.appendChild(modal);
    menuUploadModal = modal;
    menuUploadVideo = modal.querySelector("#menuUploadVideo");
    menuUploadFileInput = modal.querySelector("#menuUploadFileInput");
    menuUploadCameraBtn = modal.querySelector("#menuUploadCameraBtn");
    menuUploadUploadBtn = modal.querySelector("#menuUploadUploadBtn");
    menuUploadCaptureBtn = modal.querySelector("#menuUploadCaptureBtn");
    menuUploadCancelBtn = modal.querySelector("#menuUploadCancelBtn");
    menuUploadCloseBtn = modal.querySelector("#menuUploadClose");

    // Bind event handlers
    menuUploadUploadBtn.onclick = () => {
      menuUploadFileInput.value = "";
      menuUploadFileInput.click();
    };

    menuUploadFileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await handleMenuImageFile(file);
    };

    menuUploadCameraBtn.onclick = () => startMenuCamera();
    menuUploadCaptureBtn.onclick = () => captureMenuPhoto();
    menuUploadCancelBtn.onclick = () => stopMenuCamera();
    menuUploadCloseBtn.onclick = () => closeMenuUploadModal();

    modal.onclick = (e) => {
      if (e.target === modal) {
        closeMenuUploadModal();
      }
    };

    return modal;
  }

  // Function to open menu upload modal
  function openMenuUploadModal() {
    const modal = createMenuUploadModal();
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
    stopMenuCamera(); // Ensure camera is stopped when opening
    updateMenuUploadPreview();
  }

  // Function to close menu upload modal
  function closeMenuUploadModal() {
    if (menuUploadModal) {
      stopMenuCamera();
      menuUploadModal.style.display = "none";
      menuUploadModal.setAttribute("aria-hidden", "true");
    }
  }

  // Function to update menu upload preview
  function updateMenuUploadPreview() {
    if (!menuUploadModal) return;
    const mediaPreview = menuUploadModal.querySelector(
      "#menuUploadMediaPreview",
    );
    const media = menuUploadModal.querySelector("#menuUploadMedia");

    if (menuUploadMediaStream && menuUploadVideo) {
      // Camera is active
      media.style.display = "none";
      mediaPreview.style.display = "block";
      menuUploadVideo.style.display = "block";
      menuUploadVideo.srcObject = menuUploadMediaStream;
      menuUploadVideo.play();
    } else {
      // No camera
      media.style.display = "flex";
      mediaPreview.style.display = "none";
      if (menuUploadVideo) {
        menuUploadVideo.srcObject = null;
        menuUploadVideo.style.display = "none";
      }
    }
  }

  // Function to start menu camera
  async function startMenuCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Camera capture is not supported in this browser.");
      return;
    }
    try {
      if (menuUploadMediaStream) {
        stopMenuCamera();
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      menuUploadMediaStream = stream;
      updateMenuUploadPreview();
    } catch (err) {
      console.error("Camera error", err);
      alert("Could not access the camera: " + (err.message || err));
    }
  }

  // Function to stop menu camera
  function stopMenuCamera() {
    if (menuUploadMediaStream) {
      try {
        menuUploadMediaStream.getTracks().forEach((track) => track.stop());
      } catch (_) {}
    }
    menuUploadMediaStream = null;
    if (menuUploadVideo) {
      try {
        menuUploadVideo.pause();
      } catch (_) {}
      menuUploadVideo.srcObject = null;
    }
    updateMenuUploadPreview();
  }

  // Function to capture menu photo
  async function captureMenuPhoto() {
    if (!menuUploadVideo || !menuUploadMediaStream) {
      alert("Start the camera before capturing a photo.");
      return;
    }
    try {
      const canvas = document.createElement("canvas");
      canvas.width = menuUploadVideo.videoWidth;
      canvas.height = menuUploadVideo.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(menuUploadVideo, 0, 0);

      // Resize image to max 1200px wide while maintaining aspect ratio
      const maxWidth = 1200;
      const scale = Math.min(1, maxWidth / canvas.width);
      const resizedCanvas = document.createElement("canvas");
      resizedCanvas.width = canvas.width * scale;
      resizedCanvas.height = canvas.height * scale;
      const resizedCtx = resizedCanvas.getContext("2d");
      resizedCtx.drawImage(
        canvas,
        0,
        0,
        resizedCanvas.width,
        resizedCanvas.height,
      );

      const imageData = resizedCanvas.toDataURL("image/jpeg", 0.85);
      stopMenuCamera();
      closeMenuUploadModal();
      await handleMenuImageData(imageData);
    } catch (err) {
      console.error("Capture error", err);
      alert("Could not capture photo: " + (err.message || err));
    }
  }

  // Function to handle menu image file
  async function handleMenuImageFile(file) {
    try {
      const imageData = await processImageFile(file);
      closeMenuUploadModal();
      await handleMenuImageData(imageData);
    } catch (err) {
      console.error("Error processing image:", err);
      alert("Error processing image. Please try again.");
    }
  }

  // Function to handle menu image data (show preview modal)
  async function handleMenuImageData(imageData) {
    const pageNumber = pendingMenuImages.length + 1;
    showMenuPreviewModal(imageData, pageNumber);
  }

  // Edit menu images (view, replace, delete, add)
  const uploadMenuBtn = document.getElementById("uploadMenuBtn");
  if (uploadMenuBtn) {
    uploadMenuBtn.onclick = () => {
      if (!menuImages.length) {
        menuImagesEditMode = true;
        openMenuUploadModal();
        return;
      }
      pendingMenuImages = [...menuImages];
      pendingMenuImageIndices = menuImages.map((_, idx) => idx);
      currentUploadIndex = -1;
      lastUploadedIndex = -1;
      menuImagesEditMode = true;
      showMenuPreviewModal(pendingMenuImages[0], 1, {
        mode: "edit",
        initialIndex: getCurrentPageIndex(),
        skipAdd: true,
      });
    };
  }
  if (consumeEditorAutoOpenMenuUpload()) {
    menuImagesEditMode = true;
    setTimeout(() => openMenuUploadModal(), 100);
  }

  return {
    openMenuUploadModal,
    showMenuPreviewModal,
  };
}
