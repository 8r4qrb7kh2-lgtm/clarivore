"use client";

import { useEffect, useRef, useState } from "react";
import { formatDistanceMiles, loadGoogleMapsApi } from "./googleMapsLocation";

const SINGLE_LOCATION_PREVIEW_ZOOM = 13;
const MAX_FIT_BOUNDS_ZOOM = 14;
const PLACE_LOOKUP_TIMEOUT_MS = 8_000;

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

function asText(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  const text = asText(value);
  if (!text) return "";
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildMapInfoWindowHtml(location, placePreview = null, options = {}) {
  const loading = Boolean(options?.loading);
  const title = asText(placePreview?.name) || asText(location?.name) || "Restaurant";
  const address =
    asText(placePreview?.formattedAddress) || asText(location?.formattedAddress);
  const photoUrl = asText(placePreview?.photoUrl);
  const mapsUrl = asText(placePreview?.mapsUrl);
  const rating = Number(placePreview?.rating);
  const userRatingsTotal = Number(placePreview?.userRatingsTotal);
  const distanceLabel = formatDistanceMiles(location?.distanceMiles);

  const hasRating = Number.isFinite(rating);
  const hasRatingsTotal = Number.isFinite(userRatingsTotal) && userRatingsTotal >= 0;
  const ratingLabel = hasRating
    ? `Google rating: ${rating.toFixed(1)}${
        hasRatingsTotal ? ` (${Math.round(userRatingsTotal).toLocaleString()} reviews)` : ""
      }`
    : "Google rating unavailable";

  return `
    <div style="max-width:260px;font-family:Arial,sans-serif;color:#111827;">
      ${
        photoUrl
          ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(title)}" style="display:block;width:100%;height:120px;object-fit:cover;border-radius:8px;margin-bottom:8px;" />`
          : ""
      }
      <div style="font-size:15px;font-weight:700;line-height:1.3;margin-bottom:4px;">${escapeHtml(title)}</div>
      ${
        address
          ? `<div style="font-size:12px;line-height:1.4;color:#4b5563;margin-bottom:4px;">${escapeHtml(address)}</div>`
          : ""
      }
      ${
        distanceLabel
          ? `<div style="font-size:12px;line-height:1.4;color:#111827;margin-bottom:4px;">Distance: ${escapeHtml(distanceLabel)}</div>`
          : ""
      }
      <div style="font-size:12px;line-height:1.4;color:#111827;">${escapeHtml(ratingLabel)}</div>
      ${
        loading
          ? '<div style="font-size:11px;line-height:1.4;color:#6b7280;margin-top:6px;">Loading Google details...</div>'
          : ""
      }
      ${
        mapsUrl
          ? `<a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:8px;font-size:12px;color:#2563eb;text-decoration:none;">Open in Google Maps</a>`
          : ""
      }
    </div>
  `;
}

function runPlacesRequestWithTimeout(operationLabel, execute, timeoutMs = PLACE_LOOKUP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = null;

    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      if (timeoutId != null) {
        clearTimeout(timeoutId);
      }
      handler(value);
    };

    timeoutId = setTimeout(
      () => finish(reject, new Error(`${operationLabel} timed out.`)),
      timeoutMs,
    );

    try {
      execute(
        (value) => finish(resolve, value),
        (error) =>
          finish(
            reject,
            error instanceof Error ? error : new Error(asText(error) || operationLabel),
          ),
      );
    } catch (error) {
      finish(
        reject,
        error instanceof Error ? error : new Error(asText(error) || operationLabel),
      );
    }
  });
}

async function findPlaceIdForLocation(placesService, location) {
  const explicitPlaceId = asText(location?.placeId);
  if (explicitPlaceId) return explicitPlaceId;

  const query = [asText(location?.name), asText(location?.formattedAddress)]
    .filter(Boolean)
    .join(" ");
  if (!query) return "";

  const lat = Number(location?.position?.lat);
  const lng = Number(location?.position?.lng);
  const request = {
    query,
    fields: ["place_id"],
  };
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    request.locationBias = { center: { lat, lng }, radius: 15_000 };
  }

  const place = await runPlacesRequestWithTimeout(
    "Google Maps place id lookup",
    (resolve, reject) => {
      placesService.findPlaceFromQuery(request, (results, status) => {
        const safeStatus = asText(status).toUpperCase();
        if (safeStatus === "OK" && Array.isArray(results) && results.length) {
          resolve(results[0]);
          return;
        }
        if (safeStatus === "REQUEST_DENIED" || safeStatus === "INVALID_REQUEST") {
          reject(new Error(`Google Maps place id lookup failed (${safeStatus || "unknown"}).`));
          return;
        }
        resolve(null);
      });
    },
  );

  return asText(place?.place_id);
}

async function getGooglePlacePreview(placesService, location, previewCache) {
  const existingPlaceId = asText(location?.placeId);
  const queryFallbackKey = [asText(location?.name), asText(location?.formattedAddress)]
    .filter(Boolean)
    .join("|");
  const cacheKey = existingPlaceId ? `place:${existingPlaceId}` : `query:${queryFallbackKey}`;
  if (previewCache.has(cacheKey)) {
    return previewCache.get(cacheKey);
  }

  const resolvedPlaceId = await findPlaceIdForLocation(placesService, location);
  if (!resolvedPlaceId) {
    previewCache.set(cacheKey, null);
    return null;
  }

  const detailsCacheKey = `place:${resolvedPlaceId}`;
  if (previewCache.has(detailsCacheKey)) {
    return previewCache.get(detailsCacheKey);
  }

  const place = await runPlacesRequestWithTimeout(
    "Google Maps place details lookup",
    (resolve, reject) => {
      placesService.getDetails(
        {
          placeId: resolvedPlaceId,
          fields: [
            "name",
            "formatted_address",
            "place_id",
            "photos",
            "rating",
            "user_ratings_total",
            "url",
          ],
        },
        (result, status) => {
          const safeStatus = asText(status).toUpperCase();
          if (safeStatus === "OK" && result) {
            resolve(result);
            return;
          }
          if (safeStatus === "REQUEST_DENIED" || safeStatus === "INVALID_REQUEST") {
            reject(new Error(`Google Maps place details lookup failed (${safeStatus || "unknown"}).`));
            return;
          }
          resolve(null);
        },
      );
    },
  );

  if (!place) {
    previewCache.set(detailsCacheKey, null);
    if (cacheKey !== detailsCacheKey) {
      previewCache.set(cacheKey, null);
    }
    return null;
  }

  const firstPhoto =
    Array.isArray(place.photos) && typeof place.photos[0]?.getUrl === "function"
      ? place.photos[0]
      : null;

  const preview = {
    name: asText(place.name) || asText(location?.name),
    formattedAddress: asText(place.formatted_address) || asText(location?.formattedAddress),
    rating: Number.isFinite(Number(place.rating)) ? Number(place.rating) : null,
    userRatingsTotal: Number.isFinite(Number(place.user_ratings_total))
      ? Number(place.user_ratings_total)
      : null,
    photoUrl: firstPhoto
      ? asText(
          firstPhoto.getUrl({
            maxWidth: 320,
            maxHeight: 180,
          }),
        )
      : "",
    mapsUrl: asText(place.url),
  };

  previewCache.set(detailsCacheKey, preview);
  if (cacheKey !== detailsCacheKey) {
    previewCache.set(cacheKey, preview);
  }
  return preview;
}

export default function RestaurantsMapPreview({
  apiKey = "",
  zipCode = "",
  locations = [],
  isLoading = false,
}) {
  const mapRef = useRef(null);
  const placePreviewCacheRef = useRef(new Map());
  const [mapError, setMapError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const markers = [];
    const listeners = [];
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
        const placesService = new window.google.maps.places.PlacesService(map);
        const infoWindow = new window.google.maps.InfoWindow();
        let hoverToken = 0;
        const bounds = new window.google.maps.LatLngBounds();

        async function openMarkerPreview(marker, location) {
          hoverToken += 1;
          const token = hoverToken;

          infoWindow.setContent(buildMapInfoWindowHtml(location, null, { loading: true }));
          infoWindow.open({
            map,
            anchor: marker,
            shouldFocus: false,
          });

          try {
            const preview = await getGooglePlacePreview(
              placesService,
              location,
              placePreviewCacheRef.current,
            );
            if (cancelled || token !== hoverToken) return;
            infoWindow.setContent(buildMapInfoWindowHtml(location, preview));
          } catch (error) {
            if (cancelled || token !== hoverToken) return;
            console.warn("[restaurants] failed to load marker preview", error);
            infoWindow.setContent(buildMapInfoWindowHtml(location));
          }
        }

        points.forEach((location, index) => {
          const marker = new window.google.maps.Marker({
            map,
            position: location.position,
            title: location.name || "Restaurant",
            label: String(index + 1),
          });

          markers.push(marker);
          listeners.push(
            marker.addListener("mouseover", () => {
              void openMarkerPreview(marker, location);
            }),
          );
          listeners.push(
            marker.addListener("click", () => {
              void openMarkerPreview(marker, location);
            }),
          );
          listeners.push(
            marker.addListener("mouseout", () => {
              hoverToken += 1;
              infoWindow.close();
            }),
          );
          bounds.extend(location.position);
        });

        if (!bounds.isEmpty()) {
          if (points.length === 1) {
            map.setCenter(points[0].position);
            map.setZoom(SINGLE_LOCATION_PREVIEW_ZOOM);
            return;
          }

          map.fitBounds(bounds, 44);
          window.google.maps.event.addListenerOnce(map, "idle", () => {
            if (cancelled) return;
            const zoom = map.getZoom();
            if (Number.isFinite(zoom) && zoom > MAX_FIT_BOUNDS_ZOOM) {
              map.setZoom(MAX_FIT_BOUNDS_ZOOM);
            }
          });
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
      listeners.forEach((listener) => listener.remove());
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
