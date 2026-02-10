export function bindDetectDishesButton(options = {}) {
  const {
    buttonId = "detectDishesBtn",
    detectDishesOnMenu,
    menuImage,
    menu,
    img,
    inner,
    overlays,
    addPendingChange,
    drawAll,
    setDirty,
    pushHistory,
    getCurrentPageIndex,
  } = options;

  const detectDishesBtn = document.getElementById(buttonId);
  if (!detectDishesBtn) return;

  detectDishesBtn.onclick = async () => {
    const btn = document.getElementById(buttonId);
    if (!btn) return;

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "🔍 Detecting dishes...";

    try {
      const result = await detectDishesOnMenu(menuImage);
      if (!result.success || !result.dishes || result.dishes.length === 0) {
        alert(
          "Could not detect any dishes on the menu. Please try adding overlays manually.",
        );
        btn.disabled = false;
        btn.textContent = originalText;
        return;
      }

      const panel = document.getElementById("detectedDishesPanel");
      const currentDishNameEl = document.getElementById("currentDishName");
      const dishProgressEl = document.getElementById("dishProgress");
      const prevBtn = document.getElementById("prevDishBtn");
      const nextBtn = document.getElementById("nextDishBtn");
      const finishBtn = document.getElementById("finishMappingBtn");

      let detectedDishes = result.dishes;
      let currentDishIndex = 0;
      let dragMode = true;
      let dragStart = null;
      let dragPreview = null;

      function showCurrentDish() {
        const mapped = detectedDishes.filter((d) => d.mapped).length;
        const total = detectedDishes.length;

        if (mapped >= total) {
          currentDishNameEl.textContent = "All items mapped!";
          dishProgressEl.textContent = `${mapped} of ${total} items mapped`;
          prevBtn.style.display = "none";
          nextBtn.style.display = "none";
          finishBtn.style.display = "inline-flex";
          menu.style.cursor = "";
          dragMode = false;
          return;
        }

        const dish = detectedDishes[currentDishIndex];
        currentDishNameEl.textContent = dish.name;
        dishProgressEl.textContent = `Item ${currentDishIndex + 1} of ${total} (${mapped} mapped)`;

        prevBtn.disabled = currentDishIndex <= 0;
        nextBtn.disabled = currentDishIndex >= total - 1;
        finishBtn.style.display = mapped > 0 ? "inline-flex" : "none";

        menu.style.cursor = "crosshair";
        panel.style.display = "block";
        dragMode = true;
      }

      prevBtn.onclick = () => {
        if (currentDishIndex > 0) {
          currentDishIndex--;
          showCurrentDish();
        }
      };

      nextBtn.onclick = () => {
        if (currentDishIndex < detectedDishes.length - 1) {
          currentDishIndex++;
          showCurrentDish();
        }
      };

      finishBtn.onclick = () => {
        panel.style.display = "none";
        menu.style.cursor = "";
        dragMode = false;
        drawAll();
      };

      showCurrentDish();

      function handleDragStart(e) {
        if (!dragMode) return;

        const rect = img.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        dragStart = { x, y };

        dragPreview = document.createElement("div");
        dragPreview.style.cssText =
          "position:absolute;border:2px dashed #4CAF50;background:rgba(76,175,80,0.2);pointer-events:none;z-index:1000";
        inner.appendChild(dragPreview);

        e.preventDefault();
      }

      function handleDragMove(e) {
        if (!dragStart || !dragPreview) return;

        const rect = img.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        const minX = Math.min(dragStart.x, x);
        const minY = Math.min(dragStart.y, y);
        const maxX = Math.max(dragStart.x, x);
        const maxY = Math.max(dragStart.y, y);

        dragPreview.style.left = `${minX}%`;
        dragPreview.style.top = `${minY}%`;
        dragPreview.style.width = `${maxX - minX}%`;
        dragPreview.style.height = `${maxY - minY}%`;

        e.preventDefault();
      }

      function handleDragEnd(e) {
        if (!dragStart || !dragPreview) return;

        const rect = img.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        const minX = Math.min(dragStart.x, x);
        const minY = Math.min(dragStart.y, y);
        const maxX = Math.max(dragStart.x, x);
        const maxY = Math.max(dragStart.y, y);

        const w = maxX - minX;
        const h = maxY - minY;

        if (w > 1 && h > 1) {
          const dish = detectedDishes[currentDishIndex];
          const newOverlay = {
            id: dish.name,
            x: minX,
            y: minY,
            w,
            h,
            allergens: [],
            removable: [],
            crossContamination: [],
            diets: [],
            details: {},
            pageIndex: getCurrentPageIndex(),
          };

          overlays.push(newOverlay);
          addPendingChange(`${newOverlay.id}: Added overlay manually`);
          dish.mapped = true;

          drawAll();
          setDirty(true);
          pushHistory();
          showCurrentDish();
        }

        if (dragPreview && dragPreview.parentNode) {
          dragPreview.parentNode.removeChild(dragPreview);
        }
        dragPreview = null;
        dragStart = null;

        e.preventDefault();
      }

      img.addEventListener("mousedown", handleDragStart);
      img.addEventListener("mousemove", handleDragMove);
      img.addEventListener("mouseup", handleDragEnd);
      img.addEventListener("mouseleave", handleDragEnd);

      btn.textContent = "✓ Dishes Detected";
    } catch (err) {
      console.error("Detect dishes error:", err);
      alert(`Failed to detect dishes: ${err.message}`);
      btn.disabled = false;
      btn.textContent = originalText;
    }
  };
}
