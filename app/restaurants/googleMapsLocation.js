import { loadScript } from "../runtime/scriptLoader";

const GOOGLE_MAPS_JS_URL = "https://maps.googleapis.com/maps/api/js";
const GOOGLE_OK_STATUS = "OK";
const FATAL_GOOGLE_STATUSES = new Set(["REQUEST_DENIED", "INVALID_REQUEST"]);
const EARTH_RADIUS_MILES = 3958.7613;

let mapsApiPromise = null;

function asText(value) {
  return String(value ?? "").trim();
}

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function isFatalGoogleStatus(status) {
  return FATAL_GOOGLE_STATUSES.has(String(status || "").trim().toUpperCase());
}

function toLatLngLiteral(value) {
  if (!value) return null;
  const latValue =
    typeof value.lat === "function" ? Number(value.lat()) : Number(value.lat);
  const lngValue =
    typeof value.lng === "function" ? Number(value.lng()) : Number(value.lng);
  if (!Number.isFinite(latValue) || !Number.isFinite(lngValue)) {
    return null;
  }
  return { lat: latValue, lng: lngValue };
}

function extractWebsiteDomain(value) {
  const text = asText(value);
  if (!text) return "";

  const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    return new URL(withProtocol).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function getUniqueStrings(values) {
  const seen = new Set();
  const output = [];
  (Array.isArray(values) ? values : []).forEach((item) => {
    const value = asText(item);
    if (!value || seen.has(value)) return;
    seen.add(value);
    output.push(value);
  });
  return output;
}

function buildRestaurantSearchQueries(restaurant, zipCode) {
  const restaurantName = asText(restaurant?.name);
  if (!restaurantName) return [];
  const domain = extractWebsiteDomain(restaurant?.website);

  return getUniqueStrings([
    `${restaurantName} restaurant ${zipCode}`,
    domain ? `${restaurantName} ${domain} ${zipCode}` : "",
    `${restaurantName} ${zipCode}`,
    domain ? `${restaurantName} ${domain}` : "",
    `${restaurantName} restaurant`,
  ]);
}

function haversineMiles(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;

  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const step =
    sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  const angle = 2 * Math.atan2(Math.sqrt(step), Math.sqrt(1 - step));

  return EARTH_RADIUS_MILES * angle;
}

async function geocodeRequest(geocoder, request, options = {}) {
  const required = Boolean(options?.required);
  return new Promise((resolve, reject) => {
    geocoder.geocode(request, (results, status) => {
      const safeStatus = String(status || "").trim();
      if (safeStatus === GOOGLE_OK_STATUS && Array.isArray(results) && results.length) {
        resolve(results[0]);
        return;
      }

      if (isFatalGoogleStatus(safeStatus) || required) {
        reject(new Error(`Google Maps geocoding failed (${safeStatus || "unknown"}).`));
        return;
      }

      resolve(null);
    });
  });
}

async function findPlaceFromQuery(placesService, request) {
  return new Promise((resolve, reject) => {
    placesService.findPlaceFromQuery(request, (results, status) => {
      const safeStatus = String(status || "").trim();
      if (safeStatus === GOOGLE_OK_STATUS && Array.isArray(results) && results.length) {
        resolve(results[0]);
        return;
      }

      if (isFatalGoogleStatus(safeStatus)) {
        reject(new Error(`Google Maps place lookup failed (${safeStatus || "unknown"}).`));
        return;
      }

      resolve(null);
    });
  });
}

async function resolveRestaurantLocation({
  restaurant,
  zipCode,
  zipCenter,
  placesService,
  geocoder,
}) {
  const queries = buildRestaurantSearchQueries(restaurant, zipCode);

  for (const query of queries) {
    const place = await findPlaceFromQuery(placesService, {
      query,
      fields: ["name", "formatted_address", "geometry"],
      locationBias: { center: zipCenter, radius: 100_000 },
    });
    const position = toLatLngLiteral(place?.geometry?.location);
    if (!position) continue;
    return {
      name: asText(place?.name) || asText(restaurant?.name) || "Restaurant",
      formattedAddress: asText(place?.formatted_address),
      position,
    };
  }

  const fallback = await geocodeRequest(
    geocoder,
    {
      address: `${asText(restaurant?.name)} restaurant ${zipCode}`,
      componentRestrictions: { country: "US" },
    },
    { required: false },
  );
  const fallbackPosition = toLatLngLiteral(fallback?.geometry?.location);
  if (!fallbackPosition) return null;

  return {
    name: asText(restaurant?.name) || "Restaurant",
    formattedAddress: asText(fallback?.formatted_address),
    position: fallbackPosition,
  };
}

export function sanitizeUsZipInput(value) {
  const digits = asText(value).replace(/\D/g, "").slice(0, 9);
  if (!digits) return "";
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function normalizeUsZip(value) {
  return sanitizeUsZipInput(value);
}

export function isValidUsZip(value) {
  return /^\d{5}(-\d{4})?$/.test(asText(value));
}

export function formatDistanceMiles(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  if (numeric < 0.1) return "<0.1 mi";
  if (numeric < 10) return `${numeric.toFixed(1)} mi`;
  return `${Math.round(numeric)} mi`;
}

export async function loadGoogleMapsApi(apiKey) {
  const safeApiKey = asText(apiKey);
  if (!safeApiKey) {
    throw new Error(
      "Google Maps is not configured. Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.",
    );
  }

  if (typeof window === "undefined") {
    throw new Error("Google Maps is only available in the browser.");
  }

  if (window.google?.maps?.places) {
    return window.google.maps;
  }

  if (!mapsApiPromise) {
    const params = new URLSearchParams({
      key: safeApiKey,
      libraries: "places",
      v: "weekly",
    });
    const src = `${GOOGLE_MAPS_JS_URL}?${params.toString()}`;

    mapsApiPromise = loadScript(src, {
      async: true,
      defer: true,
      timeoutMs: 25_000,
    })
      .then(() => {
        if (!window.google?.maps?.places) {
          mapsApiPromise = null;
          throw new Error("Google Maps loaded but Places API is unavailable.");
        }
        return window.google.maps;
      })
      .catch((error) => {
        mapsApiPromise = null;
        throw error;
      });
  }

  return mapsApiPromise;
}

export async function resolveRestaurantDistanceData({
  restaurants,
  zipCode,
  apiKey,
}) {
  const list = Array.isArray(restaurants) ? restaurants : [];
  const normalizedZip = normalizeUsZip(zipCode);

  if (!isValidUsZip(normalizedZip)) {
    throw new Error("Enter a valid US ZIP code to sort by distance.");
  }

  if (!list.length) {
    return {
      zipCode: normalizedZip,
      zipCenter: null,
      locations: [],
      byRestaurantId: {},
    };
  }

  const maps = await loadGoogleMapsApi(apiKey);
  const geocoder = new maps.Geocoder();
  const placesService = new maps.places.PlacesService(document.createElement("div"));

  const zipGeocode = await geocodeRequest(
    geocoder,
    {
      address: normalizedZip,
      componentRestrictions: { country: "US" },
    },
    { required: true },
  );
  const zipCenter = toLatLngLiteral(zipGeocode?.geometry?.location);

  if (!zipCenter) {
    throw new Error("Could not resolve that ZIP code.");
  }

  const locations = [];

  for (const restaurant of list) {
    const restaurantId = asText(restaurant?.id);
    if (!restaurantId) continue;

    const location = await resolveRestaurantLocation({
      restaurant,
      zipCode: normalizedZip,
      zipCenter,
      placesService,
      geocoder,
    });
    if (!location?.position) continue;

    locations.push({
      restaurantId,
      name: asText(location?.name) || asText(restaurant?.name) || "Restaurant",
      formattedAddress: asText(location?.formattedAddress),
      position: location.position,
      distanceMiles: haversineMiles(zipCenter, location.position),
    });
  }

  const byRestaurantId = {};
  locations.forEach((item) => {
    byRestaurantId[item.restaurantId] = item;
  });

  return {
    zipCode: normalizedZip,
    zipCenter,
    locations,
    byRestaurantId,
  };
}
