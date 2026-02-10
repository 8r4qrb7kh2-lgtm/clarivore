import {
  getAiAssistPhotos,
  setAiAssistPhotos,
} from "./runtimeSessionState.js";

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
  const openImageModal =
    typeof deps.openImageModal === "function" ? deps.openImageModal : () => {};

  function renderPhotoPreviews() {
    const container = document.getElementById("aiAssistPhotosContainer");
    const photosList = document.getElementById("aiAssistPhotosList");
    if (!container || !photosList) return;

    const photos = getAiAssistPhotos();
    if (!photos.length) {
      container.style.display = "none";
      return;
    }

    container.style.display = "block";
    photosList.innerHTML = "";

    photos.forEach((photoData, idx) => {
      const photoDiv = document.createElement("div");
      photoDiv.style.cssText =
        "position:relative;width:100px;height:100px;border:1px solid rgba(76,90,212,0.3);border-radius:4px;overflow:hidden;";

      const img = document.createElement("img");
      img.src = photoData;
      img.alt = `Recipe photo ${idx + 1}`;
      img.style.cssText = "width:100%;height:100%;object-fit:cover;cursor:pointer;";
      img.addEventListener("click", () => {
        openImageModal(photoData);
      });

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.textContent = "×";
      removeButton.style.cssText =
        "position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.7);color:white;border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;font-size:16px;line-height:1;";
      removeButton.addEventListener("click", () => {
        removePhotoAtIndex(idx);
      });

      photoDiv.appendChild(img);
      photoDiv.appendChild(removeButton);
      photosList.appendChild(photoDiv);
    });
  }

  function removePhotoAtIndex(idx) {
    const photos = getAiAssistPhotos();
    if (idx >= 0 && idx < photos.length) {
      photos.splice(idx, 1);
      setAiAssistPhotos(photos);
      renderPhotoPreviews();
    }
  }

  async function handleMultipleRecipePhotoUpload(files) {
    ensureAiAssistElements();
    const photos = getAiAssistPhotos();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const reader = new FileReader();
        reader.onload = async (e) => {
          const compressed = await compressImage(e.target.result);
          photos.push(compressed);
          setAiAssistPhotos(photos);
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
