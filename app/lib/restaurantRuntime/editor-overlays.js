export function initEditorOverlays(deps = {}) {
  const overlays = Array.isArray(deps.overlays) ? deps.overlays : [];
  const editorSections = Array.isArray(deps.editorSections) ? deps.editorSections : [];
  const getInner = typeof deps.getInner === "function" ? deps.getInner : () => null;
  const getImg = typeof deps.getImg === "function" ? deps.getImg : () => null;
  const setDirty = typeof deps.setDirty === "function" ? deps.setDirty : () => {};
  const pushHistory = typeof deps.pushHistory === "function" ? deps.pushHistory : () => {};
  const openItemEditor =
    typeof deps.openItemEditor === "function" ? deps.openItemEditor : () => {};
  const scrollLockState = {
    count: 0,
    bodyOverflow: "",
    htmlOverflow: "",
    bodyTouchAction: "",
    htmlTouchAction: "",
  };
  const touchMoveBlocker = (event) => {
    event.preventDefault();
  };
  const lockScroll = () => {
    if (!document?.body || !document?.documentElement) return;
    if (scrollLockState.count === 0) {
      scrollLockState.bodyOverflow = document.body.style.overflow;
      scrollLockState.htmlOverflow = document.documentElement.style.overflow;
      scrollLockState.bodyTouchAction = document.body.style.touchAction;
      scrollLockState.htmlTouchAction = document.documentElement.style.touchAction;
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
      document.body.style.touchAction = "none";
      document.documentElement.style.touchAction = "none";
      document.addEventListener("touchmove", touchMoveBlocker, {
        passive: false,
      });
    }
    scrollLockState.count += 1;
  };
  const unlockScroll = () => {
    if (scrollLockState.count === 0) return;
    scrollLockState.count -= 1;
    if (scrollLockState.count > 0) return;
    if (!document?.body || !document?.documentElement) return;
    document.body.style.overflow = scrollLockState.bodyOverflow;
    document.documentElement.style.overflow = scrollLockState.htmlOverflow;
    document.body.style.touchAction = scrollLockState.bodyTouchAction;
    document.documentElement.style.touchAction = scrollLockState.htmlTouchAction;
    document.removeEventListener("touchmove", touchMoveBlocker);
  };
  function drawAll() {
      const inner = getInner();
      const img = getImg();
      // Helper function to render a single overlay box
      function renderEditBox(it, targetInner, targetImg, sectionOverlays) {
        const originalIdx = overlays.findIndex((o) => o === it);
        const idx = sectionOverlays.indexOf(it);
        const iw = targetImg.clientWidth,
          ih = targetImg.clientHeight;

        const box = document.createElement("div");
        box.className = "editBox";
        Object.assign(box.style, {
          left: +it.x + "%",
          top: +it.y + "%",
          width: +it.w + "%",
          height: +it.h + "%",
        });

        ["nw", "ne", "sw", "se"].forEach((c) => {
          const h = document.createElement("div");
          h.className = "handle " + c;
          box.appendChild(h);
          h.addEventListener("pointerdown", (e) => startResize(e, c));
        });

        const eb = document.createElement("div");
        eb.className = "editBadge";
        eb.title = "Edit this item";
        eb.innerHTML = "✏️";
        eb.addEventListener("click", (e) => {
          e.stopPropagation();
          openItemEditor(it, originalIdx >= 0 ? originalIdx : idx);
        });
        box.appendChild(eb);

        let dragging = false,
          start = {};
        box.addEventListener("pointerdown", (e) => {
          if (e.target.classList.contains("handle") || e.target === eb) return;
          e.preventDefault();
          // Set this box as active, remove active from all sections
          document
            .querySelectorAll(".editBox")
            .forEach((b) => b.classList.remove("active"));
          box.classList.add("active");
          dragging = true;
          lockScroll();
          box.setPointerCapture(e.pointerId);
          start = {
            x: e.clientX,
            y: e.clientY,
            l: box.offsetLeft,
            t: box.offsetTop,
            w: box.offsetWidth,
            h: box.offsetHeight,
          };
        });
        box.addEventListener("pointermove", (e) => {
          if (!dragging) return;
          const nx = Math.max(
            0,
            Math.min(iw - start.w, start.l + (e.clientX - start.x)),
          );
          const ny = Math.max(
            0,
            Math.min(ih - start.h, start.t + (e.clientY - start.y)),
          );
          const xPct = (nx / iw) * 100,
            yPct = (ny / ih) * 100;
          it.x = xPct;
          it.y = yPct;
          box.style.left = xPct + "%";
          box.style.top = yPct + "%";
        });
        const endDrag = (e) => {
          if (!dragging) return;
          dragging = false;
          if (e && typeof e.pointerId !== "undefined") {
            try {
              box.releasePointerCapture(e.pointerId);
            } catch (err) {
              // Ignore release errors from stale pointers.
            }
          }
          unlockScroll();
          setDirty(true);
          pushHistory();
        };
        box.addEventListener("pointerup", endDrag);
        box.addEventListener("pointercancel", endDrag);

        function startResize(e, corner) {
          e.stopPropagation();
          e.preventDefault();
          lockScroll();
          box.setPointerCapture(e.pointerId);
          document
            .querySelectorAll(".editBox")
            .forEach((b) => b.classList.remove("active"));
          box.classList.add("active");
          const rect = targetInner.getBoundingClientRect();
          const safeNum = (v, fallback) => {
            const n = +v;
            return isFinite(n) ? n : fallback;
          };
          const st = {
            x: e.clientX,
            y: e.clientY,
            left: safeNum(it.x, 0),
            top: safeNum(it.y, 0),
            w: safeNum(it.w, 10),
            h: safeNum(it.h, 5),
          };
          const snapThreshold = 0.3;

          function getSnapTargets() {
            const targets = { xEdges: [], yEdges: [] };
            sectionOverlays.forEach((other, otherIdx) => {
              if (otherIdx === idx) return;
              targets.xEdges.push(+other.x);
              targets.xEdges.push(+other.x + +other.w);
              targets.yEdges.push(+other.y);
              targets.yEdges.push(+other.y + +other.h);
            });
            return targets;
          }

          function snapValue(val, edges, threshold) {
            for (const edge of edges) {
              if (Math.abs(val - edge) < threshold) return edge;
            }
            return val;
          }

          function onMove(ev) {
            const dx = ((ev.clientX - st.x) / rect.width) * 100,
              dy = ((ev.clientY - st.y) / rect.height) * 100;
            let x = st.left,
              y = st.top,
              w = st.w,
              h = st.h;

            if (corner === "se") {
              w = st.w + dx;
              h = st.h + dy;
            }
            if (corner === "ne") {
              w = st.w + dx;
              h = st.h - dy;
              y = st.top + dy;
            }
            if (corner === "sw") {
              w = st.w - dx;
              h = st.h + dy;
              x = st.left + dx;
            }
            if (corner === "nw") {
              w = st.w - dx;
              h = st.h - dy;
              x = st.left + dx;
              y = st.top + dy;
            }

            w = Math.max(1, Math.min(100, w));
            h = Math.max(0.5, Math.min(100, h));
            x = Math.max(0, Math.min(100 - w, x));
            y = Math.max(0, Math.min(100 - h, y));

            const snapTargets = getSnapTargets();
            const right = x + w;
            const bottom = y + h;

            if (corner === "se") {
              const snappedRight = snapValue(
                right,
                snapTargets.xEdges,
                snapThreshold,
              );
              const snappedBottom = snapValue(
                bottom,
                snapTargets.yEdges,
                snapThreshold,
              );
              if (snappedRight !== right) w = Math.max(1, snappedRight - x);
              if (snappedBottom !== bottom) h = Math.max(0.5, snappedBottom - y);
            } else if (corner === "ne") {
              const snappedRight = snapValue(
                right,
                snapTargets.xEdges,
                snapThreshold,
              );
              const snappedTop = snapValue(y, snapTargets.yEdges, snapThreshold);
              if (snappedRight !== right) w = Math.max(1, snappedRight - x);
              if (snappedTop !== y) {
                const oldBottom = y + h;
                y = snappedTop;
                h = Math.max(0.5, oldBottom - y);
              }
            } else if (corner === "sw") {
              const snappedLeft = snapValue(x, snapTargets.xEdges, snapThreshold);
              const snappedBottom = snapValue(
                bottom,
                snapTargets.yEdges,
                snapThreshold,
              );
              if (snappedLeft !== x) {
                const oldRight = x + w;
                x = snappedLeft;
                w = Math.max(1, oldRight - x);
              }
              if (snappedBottom !== bottom) h = Math.max(0.5, snappedBottom - y);
            } else if (corner === "nw") {
              const snappedLeft = snapValue(x, snapTargets.xEdges, snapThreshold);
              const snappedTop = snapValue(y, snapTargets.yEdges, snapThreshold);
              if (snappedLeft !== x) {
                const oldRight = x + w;
                x = snappedLeft;
                w = Math.max(1, oldRight - x);
              }
              if (snappedTop !== y) {
                const oldBottom = y + h;
                y = snappedTop;
                h = Math.max(0.5, oldBottom - y);
              }
            }

            w = Math.max(1, Math.min(100, w));
            h = Math.max(0.5, Math.min(100, h));
            x = Math.max(0, Math.min(100 - w, x));
            y = Math.max(0, Math.min(100 - h, y));

            it.x = x;
            it.y = y;
            it.w = w;
            it.h = h;
            box.style.left = x + "%";
            box.style.top = y + "%";
            box.style.width = w + "%";
            box.style.height = h + "%";
          }
          function onUp(ev) {
            try {
              box.releasePointerCapture(ev.pointerId);
            } catch (err) {
              // Ignore release errors from stale pointers.
            }
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
            document.removeEventListener("pointercancel", onUp);
            unlockScroll();
            setDirty(true);
            pushHistory();
          }
          document.addEventListener("pointermove", onMove);
          document.addEventListener("pointerup", onUp);
          document.addEventListener("pointercancel", onUp);
        }

        box.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        targetInner.appendChild(box);
      }

      // Multi-section mode: render to all sections
      if (editorSections.length > 0) {
        // Clear all edit boxes from all sections
        editorSections.forEach((section) => {
          [...section.inner.querySelectorAll(".editBox")].forEach((n) =>
            n.remove(),
          );
        });

        // Group overlays by pageIndex and render to corresponding section
        editorSections.forEach((section, sectionIdx) => {
          const sectionOverlays = overlays.filter((o) => {
            const overlayPageIndex = o.pageIndex !== undefined ? o.pageIndex : 0;
            return overlayPageIndex === sectionIdx;
          });

          sectionOverlays.forEach((it) => {
            renderEditBox(it, section.inner, section.img, sectionOverlays);
          });
        });
      } else {
        // Single image mode: render to the single inner
        if (!inner || !img) return;
        [...inner.querySelectorAll(".editBox")].forEach((n) => n.remove());

        const sectionOverlays = overlays.filter((o) => {
          const overlayPageIndex = o.pageIndex !== undefined ? o.pageIndex : 0;
          return overlayPageIndex === 0;
        });

        sectionOverlays.forEach((it) => {
          renderEditBox(it, inner, img, sectionOverlays);
        });
      }
    }
  return { drawAll };
}
