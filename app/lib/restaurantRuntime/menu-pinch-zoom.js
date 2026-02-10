export function setupMenuPinchZoom({ container, menuState }) {
  let pinchScale = 1;
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let isPinching = false;
  let panStartX = 0;
  let panStartY = 0;
  let translateX = 0;
  let translateY = 0;
  let startTranslateX = 0;
  let startTranslateY = 0;

  let zoomWrapper = container.querySelector(".pinchZoomWrapper");
  if (!zoomWrapper) {
    zoomWrapper = document.createElement("div");
    zoomWrapper.className = "pinchZoomWrapper";
    zoomWrapper.style.cssText = "transform-origin:0 0;width:100%;";
    while (container.firstChild) {
      zoomWrapper.appendChild(container.firstChild);
    }
    container.appendChild(zoomWrapper);
  }

  const getDistance = (touch1, touch2) => {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const applyTransform = () => {
    zoomWrapper.style.transform = `translate(${translateX}px, ${translateY}px) scale(${pinchScale})`;
    menuState.pinchZoomState = { scale: pinchScale, translateX, translateY };
    if (typeof menuState.updateMiniMapViewport === "function") {
      menuState.updateMiniMapViewport();
    }
  };

  const resetZoom = () => {
    pinchScale = 1;
    translateX = 0;
    translateY = 0;
    zoomWrapper.style.transform = "";
    menuState.pinchZoomState = { scale: 1, translateX: 0, translateY: 0 };
    if (typeof menuState.updateMiniMapViewport === "function") {
      menuState.updateMiniMapViewport();
    }
  };

  container.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length === 2) {
        event.preventDefault();
        isPinching = true;
        pinchStartDist = getDistance(event.touches[0], event.touches[1]);
        pinchStartScale = pinchScale;
        const cx = (event.touches[0].clientX + event.touches[1].clientX) / 2;
        const cy = (event.touches[0].clientY + event.touches[1].clientY) / 2;
        panStartX = cx;
        panStartY = cy;
        startTranslateX = translateX;
        startTranslateY = translateY;
      } else if (event.touches.length === 1 && pinchScale > 1) {
        panStartX = event.touches[0].clientX;
        panStartY = event.touches[0].clientY;
        startTranslateX = translateX;
        startTranslateY = translateY;
      }
    },
    { passive: false },
  );

  container.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length === 2 && isPinching) {
        event.preventDefault();
        const dist = getDistance(event.touches[0], event.touches[1]);
        const newScale = Math.min(
          Math.max(pinchStartScale * (dist / pinchStartDist), 1),
          4,
        );

        const cx = (event.touches[0].clientX + event.touches[1].clientX) / 2;
        const cy = (event.touches[0].clientY + event.touches[1].clientY) / 2;

        if (newScale !== pinchScale) {
          const containerRect = container.getBoundingClientRect();
          const localCx = cx - containerRect.left;
          const localCy = cy - containerRect.top;

          const scaleChange = newScale / pinchScale;
          translateX = localCx - (localCx - translateX) * scaleChange;
          translateY = localCy - (localCy - translateY) * scaleChange;
        }

        pinchScale = newScale;
        applyTransform();
      } else if (event.touches.length === 1 && pinchScale > 1) {
        event.preventDefault();
        const dx = event.touches[0].clientX - panStartX;
        const dy = event.touches[0].clientY - panStartY;
        translateX = startTranslateX + dx;
        translateY = startTranslateY + dy;
        applyTransform();
      }
    },
    { passive: false },
  );

  container.addEventListener(
    "touchend",
    (event) => {
      if (event.touches.length < 2) {
        isPinching = false;
      }
      if (pinchScale <= 1.05) {
        resetZoom();
      }
      if (event.touches.length === 1 && pinchScale > 1) {
        panStartX = event.touches[0].clientX;
        panStartY = event.touches[0].clientY;
        startTranslateX = translateX;
        startTranslateY = translateY;
      }
    },
    { passive: true },
  );

  let lastTap = 0;
  container.addEventListener(
    "touchend",
    (event) => {
      if (event.touches.length === 0) {
        const now = Date.now();
        if (now - lastTap < 300 && pinchScale > 1) {
          resetZoom();
        }
        lastTap = now;
      }
    },
    { passive: true },
  );

  menuState.resetPinchZoom = resetZoom;
  menuState.pinchZoomState = { scale: 1, translateX: 0, translateY: 0 };
}
