export function initDishEditorPhotos(deps = {}) {
  const ensureAiAssistElements =
    typeof deps.ensureAiAssistElements === "function"
      ? deps.ensureAiAssistElements
      : () => {};
  const aiAssistState = deps.aiAssistState || {};
  const compressImage =
    typeof deps.compressImage === "function"
      ? deps.compressImage
      : async (dataUrl) => dataUrl;
  const aiAssistSetStatus =
    typeof deps.aiAssistSetStatus === "function" ? deps.aiAssistSetStatus : () => {};
  const updateAiAssistMediaPreview =
    typeof deps.updateAiAssistMediaPreview === "function"
      ? deps.updateAiAssistMediaPreview
      : () => {};
  const getVideoEl =
    typeof deps.getVideoEl === "function" ? deps.getVideoEl : () => null;

  function renderPhotoPreviews() {
    const container = document.getElementById("aiAssistPhotosContainer");
    const photosList = document.getElementById("aiAssistPhotosList");
    if (!container || !photosList) return;

    if (!window.aiAssistPhotos || window.aiAssistPhotos.length === 0) {
      container.style.display = "none";
      return;
    }

    container.style.display = "block";
    photosList.innerHTML = "";

    window.aiAssistPhotos.forEach((photoData, idx) => {
      const photoDiv = document.createElement("div");
      photoDiv.style.cssText =
        "position:relative;width:100px;height:100px;border:1px solid rgba(76,90,212,0.3);border-radius:4px;overflow:hidden;";
      photoDiv.innerHTML = `
    <img src="${photoData}" style="width:100%;height:100%;object-fit:cover;cursor:pointer;" onclick="openImageModal('${photoData}')" alt="Recipe photo ${idx + 1}">
    <button type="button" onclick="removePhotoAtIndex(${idx})" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.7);color:white;border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;font-size:16px;line-height:1;">&times;</button>
  `;
      photosList.appendChild(photoDiv);
    });
  }

  function removePhotoAtIndex(idx) {
    if (window.aiAssistPhotos && idx >= 0 && idx < window.aiAssistPhotos.length) {
      window.aiAssistPhotos.splice(idx, 1);
      renderPhotoPreviews();
    }
  }

  if (typeof window !== "undefined") {
    window.removePhotoAtIndex = removePhotoAtIndex;
  }

  async function handleMultipleRecipePhotoUpload(files) {
    ensureAiAssistElements();
    if (!window.aiAssistPhotos) window.aiAssistPhotos = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const reader = new FileReader();
        reader.onload = async (e) => {
          const compressed = await compressImage(e.target.result);
          window.aiAssistPhotos.push(compressed);
          renderPhotoPreviews();
        };
        reader.readAsDataURL(file);
      } catch (err) {
        console.error("Failed to read file", err);
      }
    }
  }

  async function handleRecipePhotoCamera() {
    ensureAiAssistElements();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      aiAssistState.mediaStream = stream;
      const video = getVideoEl();
      if (video) {
        video.srcObject = stream;
        video.play();
      }
      updateAiAssistMediaPreview();
      aiAssistSetStatus("Position recipe in view and click Capture photo");
    } catch (err) {
      console.error("Camera access failed", err);
      aiAssistSetStatus(
        "Could not access camera: " + (err.message || err),
        "error",
      );
    }
  }

  return {
    renderPhotoPreviews,
    handleMultipleRecipePhotoUpload,
    handleRecipePhotoCamera,
  };
}
