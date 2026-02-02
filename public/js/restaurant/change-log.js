export function initChangeLog(deps = {}) {
  const esc =
    typeof deps.esc === "function"
      ? deps.esc
      : (value) => String(value ?? "");
  const fmtDateTime =
    typeof deps.fmtDateTime === "function"
      ? deps.fmtDateTime
      : (value) => String(value ?? "");
  const configureModalClose =
    typeof deps.configureModalClose === "function" ? deps.configureModalClose : () => {};
  const send = typeof deps.send === "function" ? deps.send : () => {};
  const state = deps.state || {};
  const rs = deps.rs || {};
  const overlays = Array.isArray(deps.overlays) ? deps.overlays : [];
  const pendingChanges = Array.isArray(deps.pendingChanges)
    ? deps.pendingChanges
    : null;
  const setDirty = typeof deps.setDirty === "function" ? deps.setDirty : () => {};
  const drawAll = typeof deps.drawAll === "function" ? deps.drawAll : () => {};
  const pushHistory =
    typeof deps.pushHistory === "function" ? deps.pushHistory : () => {};
  function openChangeLog() {
      const mb = document.getElementById("modalBack");
      const body = document.getElementById("modalBody");
      document.getElementById("modalTitle").textContent =
        "Change Log - " + esc(rs.name || "Restaurant");
      configureModalClose({
        visible: true,
        onClick: () => {
          mb.style.display = "none";
          mb.onclick = null;
        },
      });

      send({ type: "getChangeLog", restaurantId: rs._id || rs.id || null });

      body.innerHTML = `
    <div class="note" style="margin-bottom:12px">Loading change log...</div>
  `;

      mb.style.display = "flex";

      // Add click handler to close modal when clicking outside
      mb.onclick = (e) => {
        if (e.target === mb) {
          mb.style.display = "none";
          mb.onclick = null;
        }
      };
    }

    // Helper function to render change log entries with optional expandable details
    function renderChangeLogEntry(entry) {
      const normalizeEntry = (value) => {
        if (typeof value === "string") {
          return { text: value, details: null };
        }
        if (!value || typeof value !== "object") {
          return { text: String(value ?? ""), details: null };
        }
        if (typeof value.text === "string") {
          return { text: value.text, details: value.details || null };
        }
        if (value.text && typeof value.text.text === "string") {
          return {
            text: value.text.text,
            details: value.details || value.text.details || null,
          };
        }
        if (typeof value.label === "string") {
          return { text: value.label, details: value.details || null };
        }
        return {
          text: "",
          details: value.details || null,
          raw: value,
        };
      };

      const normalized = normalizeEntry(entry);
      const details = normalized.details;
      const text =
        typeof normalized.text === "string" ? normalized.text.trim() : "";
      const safeText = text ? esc(text) : "";

      if (!details || !details.before || !details.after) {
        if (safeText) {
          return `<li>${safeText}</li>`;
        }
        const fallback =
          normalized.raw && Object.keys(normalized.raw).length
            ? esc(JSON.stringify(normalized.raw))
            : "Update recorded";
        return `<li>${fallback}</li>`;
      }

      const detailsId = "logDetails_" + Math.random().toString(36).substr(2, 9);
      const displayText = safeText
        ? safeText
        : details.ingredient
          ? esc(`Ingredient update: ${details.ingredient}`)
          : "Ingredient update";

      const formatData = (data) => {
        const parts = [];
        if (data.allergens && data.allergens.length) {
          parts.push(
            `<span style="color:#ef4444">Allergens: ${data.allergens.map((a) => esc(a)).join(", ")}</span>`,
          );
        }
        if (data.mayContainAllergens && data.mayContainAllergens.length) {
          parts.push(
            `<span style="color:#f59e0b">Cross-contam allergens: ${data.mayContainAllergens.map((a) => esc(a)).join(", ")}</span>`,
          );
        }
        if (data.diets && data.diets.length) {
          parts.push(
            `<span style="color:#22c55e">Diets: ${data.diets.join(", ")}</span>`,
          );
        }
        if (data.mayContainDiets && data.mayContainDiets.length) {
          parts.push(
            `<span style="color:#3b82f6">Cross-contam diets: ${data.mayContainDiets.join(", ")}</span>`,
          );
        }
        return parts.length > 0
          ? parts.join("<br>")
          : '<em style="color:#6b7280">None</em>';
      };

      return `<li style="position:relative">
          <span>${displayText}</span>
          <button type="button" class="logDetailsBtn" onclick="document.getElementById('${detailsId}').classList.toggle('show')" style="margin-left:8px;background:none;border:1px solid #4b5563;color:#9ca3af;padding:2px 6px;border-radius:4px;font-size:11px;cursor:pointer;vertical-align:middle" title="Show before/after details">ℹ️</button>
          <ul id="${detailsId}" class="logDetailsExpanded" style="display:none;margin-top:8px;margin-left:0;padding:10px;background:rgba(0,0,0,0.3);border-radius:6px;font-size:12px;list-style:none">
            <li style="margin-bottom:8px"><strong style="color:#9ca3af">Before:</strong><br>${formatData(details.before)}</li>
            <li><strong style="color:#9ca3af">After:</strong><br>${formatData(details.after)}</li>
          </ul>
        </li>`;
    }

    const displayChangeLog = (logs, errorMsg) => {
      const body = document.getElementById("modalBody");
      if (errorMsg) {
        body.innerHTML = `
      <div class="note" style="color:var(--bad);">${esc(errorMsg)}</div>
      <div style="margin-top:12px;text-align:center">
        <button class="btn" onclick="document.getElementById('modalBack').style.display='none'">Close</button>
      </div>`;
        return;
      }
      const restaurantId = state.restaurant?._id || state.restaurant?.id || null;
      if (Array.isArray(logs) && restaurantId) {
        logs = logs.filter(
          (log) =>
            log.restaurantId === restaurantId ||
            log.restaurant_id === restaurantId,
        );
      }
      if (!logs || !logs.length) {
        body.innerHTML = `
      <div class="note">No changes recorded yet.</div>
      <div style="margin-top:12px;text-align:center">
        <button class="btn" onclick="document.getElementById('modalBack').style.display='none'">Close</button>
      </div>`;
        return;
      }

      let html = "";
      logs.forEach((log) => {
        html += `<div class="logEntry">
      <div class="logHeader">
        <span class="logTimestamp">${esc(fmtDateTime(log.timestamp))}</span>
      </div>`;
        const parsedChanges = (() => {
          if (!log.changes) return null;
          if (typeof log.changes === "object") return log.changes;
          if (typeof log.changes === "string") {
            try {
              return JSON.parse(log.changes);
            } catch (_) {
              return null;
            }
          }
          return null;
        })();

        if (
          parsedChanges &&
          (Object.keys(parsedChanges.items || {}).length ||
            (parsedChanges.general || []).length)
        ) {
          let authorName = parsedChanges.author || log.description || "";
          if (authorName.includes(":")) authorName = authorName.split(":")[0];
          if (authorName) {
            html += `<div class="logAuthor">${esc(authorName)}</div>`;
          }
          if (
            Array.isArray(parsedChanges.general) &&
            parsedChanges.general.length
          ) {
            html += `<ul class="logList">${parsedChanges.general.map((item) => renderChangeLogEntry(item)).join("")}</ul>`;
          }
          Object.entries(parsedChanges.items || {}).forEach(
            ([itemName, entries]) => {
              html += `<div class="logItem">${esc(itemName)}</div>`;
              if (Array.isArray(entries) && entries.length) {
                html += `<ul class="logList">${entries.map((entry) => renderChangeLogEntry(entry)).join("")}</ul>`;
              }
            },
          );
        } else {
          let authorLine =
            log.description || (parsedChanges && parsedChanges.author);
          if (authorLine && authorLine.includes(":"))
            authorLine = authorLine.split(":")[0];
          if (authorLine) {
            html += `<div class="logAuthor">${esc(authorLine)}</div>`;
          }
          if (log.changes) {
            let changesHtml = esc(
              typeof log.changes === "string"
                ? log.changes
                : JSON.stringify(log.changes),
            );
            changesHtml = changesHtml.replace(
              /\*\*([^*]+)\*\*/g,
              "<strong>$1</strong>",
            );
            changesHtml = changesHtml.replace(/\n/g, "<br>");
            html += `<div class="note" style="margin-top:8px;font-size:13px;line-height:1.6">${changesHtml}</div>`;
          }
        }
        // Display photos if present (stored as array in database)
        const photos = log.photos || [];
        if (Array.isArray(photos) && photos.length > 0) {
          photos.forEach((photoUrl) => {
            const photoEsc = esc(photoUrl).replace(/'/g, "&#39;");
            html += `<img src="${esc(photoUrl)}" class="logThumbnail" onclick="window.showPhotoPreview('${photoEsc}')" alt="Confirmation photo">`;
          });
        }
        // Add restore button if this log entry has overlays data and is an update
        if (log.type === "update" && log.overlays) {
          const logDataEsc = esc(
            JSON.stringify({
              overlays: log.overlays,
              menuImage: log.menu_image || log.menuImage,
            }),
          ).replace(/'/g, "&#39;");
          html += `<div style="margin-top:12px;text-align:right">
        <button class="btn btnPrimary" onclick="window.restoreFromLog('${logDataEsc}')" style="font-size:0.9rem;padding:6px 12px">↶ Restore this version</button>
      </div>`;
        }
        html += `</div>`;
      });

      html += `<div style="margin-top:12px;text-align:center">
    <button class="btn" onclick="document.getElementById('modalBack').style.display='none'">Close</button>
  </div>`;

      body.innerHTML = html;
    };

    const showPhotoPreview = (photoUrl) => {
      const modal = document.getElementById("photoModal");
      const img = document.getElementById("photoModalImage");
      img.src = photoUrl;
      modal.style.display = "flex";
    };

    const restoreFromLog = (logDataStr) => {
      try {
        const logData = JSON.parse(logDataStr);
        if (!logData.overlays) {
          alert("This log entry does not contain overlay data.");
          return;
        }

        if (
          !confirm(
            "Restore overlays from this version? This will replace your current overlays and cannot be undone (but you can use Undo after restoring).",
          )
        ) {
          return;
        }

        // Clear current overlays and load from log
        overlays.splice(
          0,
          overlays.length,
          ...JSON.parse(JSON.stringify(logData.overlays)),
        );

        // Update menu image if it's different
        if (logData.menuImage && logData.menuImage !== rs.menuImage) {
          rs.menuImage = logData.menuImage;
          const img = document.querySelector(".menuImg");
          if (img) img.src = logData.menuImage;
        }

        // Add to pending changes
        if (Array.isArray(pendingChanges)) {
          pendingChanges.push("Restored overlays from previous version");
        }

        // Redraw and mark dirty
        drawAll();
        setDirty(true);
        pushHistory();

        // Close the change log modal
        const modalBack = document.getElementById("modalBack");
        if (modalBack) modalBack.style.display = "none";

        alert("Overlays restored successfully! You can use Undo if needed.");
      } catch (err) {
        console.error("Failed to restore from log:", err);
        alert(
          "Failed to restore from this version. The log data may be corrupted.",
        );
      }
    };

  function bindPhotoModalHandlers() {
    const closeBtn = document.getElementById("photoModalClose");
    const modal = document.getElementById("photoModal");
    if (closeBtn && modal) {
      closeBtn.onclick = () => {
        modal.style.display = "none";
      };
    }
    if (modal) {
      modal.onclick = (e) => {
        if (e.target.id === "photoModal") {
          modal.style.display = "none";
        }
      };
    }
  }
  if (typeof window !== "undefined") {
    window.displayChangeLog = displayChangeLog;
    window.showPhotoPreview = showPhotoPreview;
    window.restoreFromLog = restoreFromLog;
  }

  bindPhotoModalHandlers();

  return { openChangeLog, displayChangeLog, showPhotoPreview, restoreFromLog };
}
