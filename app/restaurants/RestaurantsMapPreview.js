"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMapsApi } from "./googleMapsLocation";

function sortByDistance(locations) {
  return [...locations].sort((a, b) => {
    const aDistance = Number.isFinite(a?.distanceMiles)
      ? Number(a.distanceMiles)
      : Number.POSITIVE_INFINITY;
    const bDistance = Number.isFinite(b?.distanceMiles)
      ? Number(b.distanceMiles)
      : Number.POSITIVE_INFINITY;
    return aDistance - bDistance;
  });
}

export default function RestaurantsMapPreview({
  apiKey = "",
  zipCode = "",
  locations = [],
  isLoading = false,
}) {
  const mapRef = useRef(null);
  const [mapError, setMapError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const markers = [];
    const points = sortByDistance(
      (Array.isArray(locations) ? locations : []).filter(
        (item) =>
          Number.isFinite(Number(item?.position?.lat)) &&
          Number.isFinite(Number(item?.position?.lng)),
      ),
    );

    async function renderMap() {
      if (!apiKey || !mapRef.current || !points.length) return;
      try {
        setMapError("");
        await loadGoogleMapsApi(apiKey);
        if (cancelled || !mapRef.current || !window.google?.maps) return;

        const map = new window.google.maps.Map(mapRef.current, {
          center: points[0].position,
          zoom: 11,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
          gestureHandling: "cooperative",
        });
        const bounds = new window.google.maps.LatLngBounds();

        points.forEach((location, index) => {
          markers.push(
            new window.google.maps.Marker({
              map,
              position: location.position,
              title: location.name || "Restaurant",
              label: String(index + 1),
            }),
          );
          bounds.extend(location.position);
        });

        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, 44);
          if (points.length === 1) {
            map.setZoom(12);
          }
        }
      } catch (error) {
        if (cancelled) return;
        console.error("[restaurants] failed to render map preview", error);
        setMapError("Map preview is unavailable right now.");
      }
    }

    renderMap();

    return () => {
      cancelled = true;
      markers.forEach((marker) => marker.setMap(null));
    };
  }, [apiKey, locations]);

  const hasLocations = Array.isArray(locations) && locations.length > 0;
  if (!hasLocations && !isLoading) return null;

  return (
    <section className="restaurants-map-preview" aria-label="Restaurant map preview">
      <div className="restaurants-map-preview-header">
        <h2>Map preview</h2>
        <p>
          {isLoading
            ? "Finding restaurant locations..."
            : `${locations.length} result${locations.length === 1 ? "" : "s"} near ZIP ${zipCode}`}
        </p>
      </div>
      {mapError ? (
        <p className="restaurants-map-preview-error">{mapError}</p>
      ) : hasLocations ? (
        <div className="restaurants-map-preview-canvas" ref={mapRef} />
      ) : (
        <div className="restaurants-map-preview-loading">
          Finding restaurant locations...
        </div>
      )}
    </section>
  );
}
