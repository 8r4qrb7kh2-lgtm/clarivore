export function initUnsavedChangesGuard({
  collectAiTableData,
  getAiAssistBackdrop,
  getAiAssistState,
  getNameInput,
  getEditorDirty,
  onClearDirty,
} = {}) {
  function hasUnsavedChanges() {
    if (typeof getEditorDirty === "function" && getEditorDirty()) {
      return true;
    }

    const backdrop =
      typeof getAiAssistBackdrop === "function" ? getAiAssistBackdrop() : null;
    const aiState =
      typeof getAiAssistState === "function" ? getAiAssistState() : null;

    const modalIsOpen = !!(
      backdrop &&
      backdrop.classList &&
      backdrop.classList.contains("show")
    );

    if (modalIsOpen && aiState) {
      const dishNameModified = aiState.dishNameModified === true;
      const nameInput =
        typeof getNameInput === "function"
          ? getNameInput()
          : document.getElementById("aiAssistNameInput");

      let dishNameHasUnsavedChanges = false;
      if (nameInput && aiState.originalDishName !== null) {
        const currentDishName = nameInput.value?.trim() || "";
        dishNameHasUnsavedChanges =
          currentDishName !== aiState.originalDishName &&
          currentDishName.length > 0;
      }

      const dataChanged =
        aiState.savedToDish === false &&
        typeof collectAiTableData === "function" &&
        collectAiTableData().length > 0;

      if (dishNameModified || dishNameHasUnsavedChanges || dataChanged) {
        return true;
      }
    }

    return false;
  }

  function showUnsavedChangesModal(onLeave, onCancel) {
    const existingModal = document.getElementById("unsavedChangesModal");
    if (existingModal) existingModal.remove();

    const modal = document.createElement("div");
    modal.id = "unsavedChangesModal";
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100000;
      animation: fadeIn 0.15s ease-out;
    `;

    modal.innerHTML = `
      <div style="
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        border-radius: 16px;
        padding: 32px;
        max-width: 420px;
        width: 90%;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        border: 1px solid rgba(148, 163, 184, 0.1);
        text-align: center;
      ">
        <div style="
          width: 64px;
          height: 64px;
          background: rgba(251, 191, 36, 0.15);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
        ">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </div>
        <h3 style="margin: 0 0 12px; color: #fff; font-size: 1.25rem; font-weight: 600;">Unsaved Changes</h3>
        <p style="margin: 0 0 24px; color: #94a3b8; font-size: 0.95rem; line-height: 1.5;">
          You have unsaved changes that will be lost if you leave this page.
        </p>
        <div style="display: flex; gap: 12px; justify-content: center;">
          <button type="button" id="unsavedChangesCancel" style="
            padding: 12px 24px;
            background: transparent;
            border: 1px solid rgba(148, 163, 184, 0.3);
            border-radius: 8px;
            color: #94a3b8;
            font-weight: 600;
            font-size: 0.95rem;
            cursor: pointer;
            transition: all 0.2s;
          ">Stay on Page</button>
          <button type="button" id="unsavedChangesLeave" style="
            padding: 12px 24px;
            background: #dc2626;
            border: 1px solid #dc2626;
            border-radius: 8px;
            color: #fff;
            font-weight: 600;
            font-size: 0.95rem;
            cursor: pointer;
            transition: all 0.2s;
          ">Leave Anyway</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const cancelBtn = modal.querySelector("#unsavedChangesCancel");
    const leaveBtn = modal.querySelector("#unsavedChangesLeave");

    cancelBtn.addEventListener("mouseenter", () => {
      cancelBtn.style.background = "rgba(148, 163, 184, 0.1)";
      cancelBtn.style.borderColor = "rgba(148, 163, 184, 0.5)";
    });
    cancelBtn.addEventListener("mouseleave", () => {
      cancelBtn.style.background = "transparent";
      cancelBtn.style.borderColor = "rgba(148, 163, 184, 0.3)";
    });

    leaveBtn.addEventListener("mouseenter", () => {
      leaveBtn.style.background = "#b91c1c";
    });
    leaveBtn.addEventListener("mouseleave", () => {
      leaveBtn.style.background = "#dc2626";
    });

    cancelBtn.addEventListener("click", () => {
      modal.remove();
      if (onCancel) onCancel();
    });

    leaveBtn.addEventListener("click", () => {
      modal.remove();
      if (onLeave) onLeave();
    });

    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        modal.remove();
        if (onCancel) onCancel();
      }
    });

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        modal.remove();
        document.removeEventListener("keydown", handleEscape);
        if (onCancel) onCancel();
      }
    };
    document.addEventListener("keydown", handleEscape);
  }

  function clearDirtyFlags() {
    if (typeof onClearDirty === "function") {
      onClearDirty();
    }
  }

  function navigateWithCheck(url) {
    if (hasUnsavedChanges()) {
      showUnsavedChangesModal(() => {
        clearDirtyFlags();
        window.location.href = url;
      });
    } else {
      window.location.href = url;
    }
  }

  window.addEventListener("beforeunload", (event) => {
    if (hasUnsavedChanges()) {
      event.preventDefault();
      event.returnValue = "";
      return "";
    }
  });

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link) return;
    const href = link.getAttribute("href");
    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("javascript:") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.includes("://")
    ) {
      return;
    }

    if (hasUnsavedChanges()) {
      event.preventDefault();
      showUnsavedChangesModal(() => {
        clearDirtyFlags();
        window.location.href = href;
      });
    }
  });

  return {
    hasUnsavedChanges,
    showUnsavedChangesModal,
    navigateWithCheck,
  };
}
