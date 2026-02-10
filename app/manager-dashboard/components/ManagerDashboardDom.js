"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageShell from "../../components/PageShell";
import SimpleTopbar, { ManagerModeSwitch } from "../../components/SimpleTopbar";
import ChatMessageText from "../../components/chat/ChatMessageText";
import { notifyManagerChat } from "../../lib/chatNotifications";
import { getActiveAllergenDietConfig } from "../../lib/allergenConfigRuntime";
import { formatChatTimestamp, resolveChatLink } from "../../lib/chatMessage";
import { supabaseClient as supabase } from "../../lib/supabase";
import { resolveManagerDisplayName } from "../../lib/userIdentity";

const ADMIN_DISPLAY_NAME = "Matt D (clarivore administrator)";
const AUTO_ALERT_SENDER = "Automated alert system";
const CONFIRM_REMINDER_DAYS = new Set([7, 3, 2, 1]);
const REQUEST_ACTION_CONFIG = {
  implemented: {
    title: "Mark as Implemented",
    buttonLabel: "Mark Implemented",
    buttonClass: "success",
  },
  reviewed: {
    title: "Mark as Reviewed",
    buttonLabel: "Mark Reviewed",
    buttonClass: "primary",
  },
  declined: {
    title: "Decline Request",
    buttonLabel: "Decline Request",
    buttonClass: "decline",
  },
};

const PIE_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#22c55e",
  "#f59e0b",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#f97316",
  "#14b8a6",
  "#6b7280",
];

function normalizeDishKey(value) {
  return String(value || "").trim().toLowerCase();
}

function getOverlayDishName(overlay, fallbackIndex = 0) {
  return (
    overlay?.id ||
    overlay?.dish_name ||
    overlay?.label ||
    overlay?.name ||
    `Dish ${fallbackIndex + 1}`
  );
}

function getChangeText(change) {
  if (typeof change === "string") return change;
  if (!change || typeof change !== "object") return "";

  if (typeof change.text === "string") return change.text;
  if (change.text && typeof change.text.text === "string") return change.text.text;
  if (typeof change.label === "string") return change.label;
  if (typeof change.message === "string") return change.message;
  if (change.details && typeof change.details.ingredient === "string") {
    return `Ingredient update: ${change.details.ingredient}`;
  }

  return "";
}

function parseChangeLogEntry(log) {
  const parsedChanges = (() => {
    if (!log?.changes) return null;
    if (typeof log.changes === "object") return log.changes;
    try {
      return JSON.parse(log.changes);
    } catch {
      return null;
    }
  })();

  const author = parsedChanges?.author || "Unknown";
  const timestamp = log?.timestamp
    ? new Date(log.timestamp).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  const dishChanges = [];
  const dishItems = parsedChanges?.items && typeof parsedChanges.items === "object"
    ? parsedChanges.items
    : {};

  Object.entries(dishItems).forEach(([dishName, changes]) => {
    const lines = (Array.isArray(changes) ? changes : [])
      .map(getChangeText)
      .filter(Boolean);
    dishChanges.push({ dishName, lines });
  });

  const generalChanges = (Array.isArray(parsedChanges?.general) ? parsedChanges.general : [])
    .map(getChangeText)
    .filter(Boolean);

  return {
    id: log?.id || `${log?.timestamp || ""}-${author}`,
    author,
    timestamp,
    dishChanges,
    generalChanges,
    hasDetails: dishChanges.length > 0 || generalChanges.length > 0,
  };
}

function normalizeBrandKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeTagList(list, normalizer) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map((value) => String(value ?? "").trim())
    .map((value) => (typeof normalizer === "function" ? normalizer(value) : value))
    .filter(Boolean)
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function collectBrandItemsFromOverlays(overlays) {
  const items = new Map();

  (Array.isArray(overlays) ? overlays : []).forEach((overlay, overlayIndex) => {
    const dishName = getOverlayDishName(overlay, overlayIndex);

    let ingredients = [];
    if (overlay?.aiIngredients) {
      try {
        ingredients = JSON.parse(overlay.aiIngredients);
      } catch {
        ingredients = [];
      }
    }
    if (!ingredients.length && Array.isArray(overlay?.ingredients)) {
      ingredients = overlay.ingredients;
    }

    ingredients.forEach((ingredient) => {
      if (!ingredient?.name || !Array.isArray(ingredient.brands)) return;

      ingredient.brands.forEach((brand) => {
        if (!brand?.name) return;

        const barcodeKey = normalizeBrandKey(brand.barcode);
        const nameKey = normalizeBrandKey(brand.name);
        const key = barcodeKey ? `barcode:${barcodeKey}` : `name:${nameKey}`;
        if (!key) return;

        if (!items.has(key)) {
          items.set(key, {
            key,
            brandName: brand.name,
            barcode: brand.barcode || "",
            brandImage: brand.brandImage || brand.image || "",
            ingredientsList: Array.isArray(brand.ingredientsList)
              ? [...brand.ingredientsList]
              : brand.ingredientList
                ? [brand.ingredientList]
                : [],
            allergens: new Set(Array.isArray(brand.allergens) ? brand.allergens : []),
            diets: new Set(Array.isArray(brand.diets) ? brand.diets : []),
            ingredientNames: new Set(),
            dishIngredients: new Map(),
            dishes: new Set(),
            overlayIndices: new Set(),
          });
        }

        const item = items.get(key);
        item.ingredientNames.add(ingredient.name);
        if (dishName) item.dishes.add(dishName);
        if (dishName && ingredient.name) {
          if (!item.dishIngredients.has(dishName)) {
            item.dishIngredients.set(dishName, new Set());
          }
          item.dishIngredients.get(dishName).add(ingredient.name);
        }
        item.overlayIndices.add(overlayIndex);

        if (!item.brandImage && (brand.brandImage || brand.image)) {
          item.brandImage = brand.brandImage || brand.image;
        }

        if (Array.isArray(brand.allergens)) {
          brand.allergens.forEach((entry) => item.allergens.add(entry));
        }
        if (Array.isArray(brand.diets)) {
          brand.diets.forEach((entry) => item.diets.add(entry));
        }
        if (Array.isArray(brand.ingredientsList)) {
          brand.ingredientsList.forEach((entry) => {
            if (entry && !item.ingredientsList.includes(entry)) {
              item.ingredientsList.push(entry);
            }
          });
        } else if (brand.ingredientList && !item.ingredientsList.includes(brand.ingredientList)) {
          item.ingredientsList.push(brand.ingredientList);
        }
      });
    });
  });

  return Array.from(items.values())
    .map((item) => ({
      ...item,
      allergens: Array.from(item.allergens),
      diets: Array.from(item.diets),
      ingredientNames: Array.from(item.ingredientNames),
      dishIngredients: Array.from(item.dishIngredients.entries()).reduce(
        (accumulator, [dishName, ingredientSet]) => ({
          ...accumulator,
          [dishName]: Array.from(ingredientSet),
        }),
        {},
      ),
      dishes: Array.from(item.dishes),
      overlayIndices: Array.from(item.overlayIndices),
    }))
    .sort((a, b) => a.brandName.localeCompare(b.brandName));
}

function applyBrandDetections(ingredient, newBrand, normalizeAllergen, normalizeDietLabel) {
  const allergens = normalizeTagList(newBrand?.allergens, normalizeAllergen);
  const diets = normalizeTagList(newBrand?.diets, normalizeDietLabel);
  const crossContamination = normalizeTagList(
    newBrand?.crossContamination,
    normalizeAllergen,
  );
  const crossContaminationDiets = normalizeTagList(
    newBrand?.crossContaminationDiets,
    normalizeDietLabel,
  );

  ingredient.allergens = allergens.slice();
  ingredient.diets = diets.slice();
  ingredient.crossContamination = crossContamination.slice();
  ingredient.crossContaminationDiets = crossContaminationDiets.slice();
  ingredient.aiDetectedAllergens = allergens.slice();
  ingredient.aiDetectedDiets = diets.slice();
  ingredient.aiDetectedCrossContamination = crossContamination.slice();
  ingredient.aiDetectedCrossContaminationDiets = crossContaminationDiets.slice();
}

function replaceBrandInOverlays(
  overlays,
  oldItem,
  newBrand,
  normalizeAllergen,
  normalizeDietLabel,
) {
  const updated = JSON.parse(JSON.stringify(Array.isArray(overlays) ? overlays : []));
  const oldBarcode = normalizeBrandKey(oldItem?.barcode);
  const oldName = normalizeBrandKey(oldItem?.brandName);

  updated.forEach((overlay) => {
    let ingredients = [];
    let hasAiIngredients = false;

    if (overlay?.aiIngredients) {
      try {
        ingredients = JSON.parse(overlay.aiIngredients);
        hasAiIngredients = true;
      } catch {
        ingredients = [];
      }
    }

    if (!ingredients.length && Array.isArray(overlay?.ingredients)) {
      ingredients = overlay.ingredients;
    }

    if (!ingredients.length) return;

    let changed = false;
    ingredients.forEach((ingredient) => {
      if (!Array.isArray(ingredient.brands)) return;

      let ingredientChanged = false;
      ingredient.brands = ingredient.brands.map((brand) => {
        const brandBarcode = normalizeBrandKey(brand?.barcode);
        const brandName = normalizeBrandKey(brand?.name);
        const matches = oldBarcode
          ? brandBarcode === oldBarcode
          : Boolean(brandName && brandName === oldName);

        if (matches) {
          changed = true;
          ingredientChanged = true;
          return { ...newBrand };
        }
        return brand;
      });

      if (ingredientChanged) {
        applyBrandDetections(ingredient, newBrand, normalizeAllergen, normalizeDietLabel);
      }
    });

    if (!changed) return;

    if (hasAiIngredients || overlay?.aiIngredients) {
      overlay.aiIngredients = JSON.stringify(ingredients);
    }
    if (Array.isArray(overlay?.ingredients)) {
      overlay.ingredients = ingredients;
    }
  });

  return updated;
}

function getHeatmapColor(value) {
  let red;
  let green;
  let blue;

  if (value < 0.5) {
    const t = value * 2;
    red = 239;
    green = Math.round(68 + (204 - 68) * t);
    blue = Math.round(68 + (21 - 68) * t);
  } else {
    const t = (value - 0.5) * 2;
    red = Math.round(250 + (34 - 250) * t);
    green = Math.round(204 + (197 - 204) * t);
    blue = Math.round(21 + (94 - 21) * t);
  }

  return `rgba(${red}, ${green}, ${blue}, 0.5)`;
}

function computeDishStatusForUser(
  dishOverlay,
  userAllergens,
  userDiets,
  normalizeAllergen,
  normalizeDietLabel,
) {
  if (!dishOverlay) return "neutral";

  const dishAllergens = (dishOverlay.allergens || [])
    .map(normalizeAllergen)
    .filter(Boolean);
  const removableAllergens = (dishOverlay.removable || [])
    .map((entry) => normalizeAllergen(entry?.allergen || ""))
    .filter(Boolean);
  const dishDiets = new Set((dishOverlay.diets || []).map(normalizeDietLabel).filter(Boolean));

  const normalizedUserAllergens = (userAllergens || [])
    .map(normalizeAllergen)
    .filter(Boolean);
  const normalizedUserDiets = (userDiets || [])
    .map(normalizeDietLabel)
    .filter(Boolean);

  const conflictingAllergens = normalizedUserAllergens.filter((allergen) =>
    dishAllergens.includes(allergen),
  );
  const unsafeAllergens = conflictingAllergens.filter(
    (allergen) => !removableAllergens.includes(allergen),
  );
  const removableConflicts = conflictingAllergens.filter((allergen) =>
    removableAllergens.includes(allergen),
  );
  const unmetDiets = normalizedUserDiets.filter((diet) => !dishDiets.has(diet));

  if (unsafeAllergens.length > 0 || unmetDiets.length > 0) {
    return "unsafe";
  }
  if (removableConflicts.length > 0) {
    return "removable";
  }
  return "safe";
}

function resolveManagerChatLink(url) {
  return resolveChatLink(url, { internalHostSuffixes: ["clarivore.org"] });
}

function resolveAllergenMetricKeys(row, normalizeAllergen) {
  const keys = {};
  if (!row || typeof row !== "object") return keys;

  const prefix = "users_with_";
  const suffix = "_allergy";

  Object.keys(row).forEach((key) => {
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) return;
    const raw = key.slice(prefix.length, -suffix.length).replace(/_/g, " ");
    const normalized = normalizeAllergen(raw);
    if (normalized && !keys[normalized]) {
      keys[normalized] = key;
    }
  });

  return keys;
}

function toRequestDateLabel(value) {
  if (!value) return "Unknown date";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown date";
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function polarToCartesian(cx, cy, radius, angleInDegrees) {
  const radians = (angleInDegrees * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function describePieSegment(cx, cy, radius, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, radius, startAngle);
  const end = polarToCartesian(cx, cy, radius, endAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
}

function SegmentedBar({ safe, accommodated, cannot, total }) {
  const safePercent = total > 0 ? (safe / total) * 100 : 0;
  const accommodatedPercent = total > 0 ? (accommodated / total) * 100 : 0;
  const cannotPercent = total > 0 ? (cannot / total) * 100 : 0;

  if (total <= 0) {
    return (
      <div
        style={{
          flex: 1,
          height: 18,
          display: "flex",
          borderRadius: 4,
          overflow: "hidden",
          background: "#e5e7eb",
        }}
      />
    );
  }

  return (
    <div
      style={{
        flex: 1,
        height: 18,
        display: "flex",
        borderRadius: 4,
        overflow: "hidden",
        background: "#e5e7eb",
      }}
      title={`Safe: ${Math.round(safe)} | Needs accommodation: ${Math.round(
        accommodated,
      )} | Cannot accommodate: ${Math.round(cannot)}`}
    >
      {safePercent > 0 ? (
        <div
          style={{
            width: `${safePercent}%`,
            background: "#22c55e",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.6rem",
            color: "#fff",
            fontWeight: 600,
          }}
        >
          {safePercent >= 5 ? `${Math.round(safePercent)}%` : ""}
        </div>
      ) : null}
      {accommodatedPercent > 0 ? (
        <div
          style={{
            width: `${accommodatedPercent}%`,
            background: "#facc15",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.6rem",
            color: "#000",
            fontWeight: 600,
          }}
        >
          {accommodatedPercent >= 5 ? `${Math.round(accommodatedPercent)}%` : ""}
        </div>
      ) : null}
      {cannotPercent > 0 ? (
        <div
          style={{
            width: `${cannotPercent}%`,
            background: "#ef4444",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.6rem",
            color: "#fff",
            fontWeight: 600,
          }}
        >
          {cannotPercent >= 5 ? `${Math.round(cannotPercent)}%` : ""}
        </div>
      ) : null}
    </div>
  );
}

function StatusDistributionRow({ label, safe, removable, unsafe, total, isAverage = false }) {
  const safePercent = total > 0 ? Math.round((safe / total) * 100) : 0;
  const removablePercent = total > 0 ? Math.round((removable / total) * 100) : 0;
  const unsafePercent = total > 0 ? Math.round((unsafe / total) * 100) : 0;

  return (
    <div className="stacked-bar-row" style={isAverage ? { opacity: 0.6 } : undefined}>
      <span className="stacked-bar-row-label">{label}</span>
      <div className="stacked-bar-wrapper">
        {total > 0 ? (
          <>
            {safePercent > 0 ? (
              <div className="stacked-bar-segment safe" style={{ width: `${safePercent}%` }}>
                <span className="segment-percent">{safePercent}%</span>
              </div>
            ) : null}
            {removablePercent > 0 ? (
              <div
                className="stacked-bar-segment removable"
                style={{ width: `${removablePercent}%` }}
              >
                <span className="segment-percent">{removablePercent}%</span>
              </div>
            ) : null}
            {unsafePercent > 0 ? (
              <div className="stacked-bar-segment unsafe" style={{ width: `${unsafePercent}%` }}>
                <span className="segment-percent">{unsafePercent}%</span>
              </div>
            ) : null}
          </>
        ) : (
          <div className="stacked-bar-segment neutral" style={{ width: "100%" }} />
        )}
      </div>
    </div>
  );
}

function ViewsDistributionRow({ label, value, maxValue, isAverage = false }) {
  const width = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <div className="stacked-bar-row" style={isAverage ? { opacity: 0.6 } : undefined}>
      <span className="stacked-bar-row-label">{label}</span>
      <div className="stacked-bar-wrapper">
        <div className="stacked-bar-segment views" style={{ width: `${width}%` }} />
      </div>
      <span className="stacked-bar-value">{Math.round(value)}</span>
    </div>
  );
}

function PieChartPanel({ title, data, uniqueUserCount }) {
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", textAlign: "center" }}>
        No {title.toLowerCase()} data available
      </p>
    );
  }

  const total = data.reduce((sum, item) => sum + item.count, 0);
  const size = 200;
  const radius = size / 2 - 10;
  const center = size / 2;
  const labelRadius = radius * 0.65;

  let currentAngle = -90;

  const segments = data.map((item, index) => {
    const angle = total > 0 ? (item.count / total) * 360 : 0;
    const start = currentAngle;
    const end = currentAngle + angle;
    currentAngle = end;

    const color = PIE_COLORS[index % PIE_COLORS.length];

    if (data.length === 1) {
      return {
        key: `${item.name || item.label}-${index}`,
        type: "circle",
        color,
        percentage: 100,
        textPosition: { x: center, y: center },
      };
    }

    const midAngle = start + angle / 2;
    const textPoint = polarToCartesian(center, center, labelRadius, midAngle);

    return {
      key: `${item.name || item.label}-${index}`,
      type: "path",
      color,
      path: describePieSegment(center, center, radius, start, end),
      percentage: total > 0 ? (item.count / total) * 100 : 0,
      textPosition: textPoint,
    };
  });

  return (
    <div style={{ textAlign: "center" }}>
      <h4 style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--ink)", marginBottom: 12 }}>
        {title}
      </h4>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ marginBottom: 8 }}>
        {segments.map((segment) =>
          segment.type === "circle" ? (
            <circle
              key={segment.key}
              cx={center}
              cy={center}
              r={radius}
              fill={segment.color}
              stroke="#1a1a2e"
              strokeWidth="2"
            />
          ) : (
            <path
              key={segment.key}
              d={segment.path}
              fill={segment.color}
              stroke="#1a1a2e"
              strokeWidth="2"
            />
          ),
        )}
        {segments.map((segment) => {
          if (!segment.textPosition || segment.percentage < 5) return null;
          return (
            <text
              key={`${segment.key}-label`}
              x={segment.textPosition.x}
              y={segment.textPosition.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#fff"
              fontSize="11"
              fontWeight="600"
              style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
            >
              {Math.round(segment.percentage)}%
            </text>
          );
        })}
      </svg>
      <p style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: 12 }}>
        Total unique users: {uniqueUserCount || total}
      </p>
      <div style={{ textAlign: "left", padding: "0 8px" }}>
        {data.map((item, index) => {
          const percentage = total > 0 ? ((item.count / total) * 100).toFixed(1) : "0.0";
          const color = PIE_COLORS[index % PIE_COLORS.length];
          const label = item.label || item.name;

          return (
            <div
              key={`${item.name || item.label}-${index}`}
              style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 12,
                  background: color,
                  borderRadius: 2,
                  flexShrink: 0,
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
              />
              <span style={{ fontSize: "0.75rem", color: "var(--ink)" }}>
                {item.emoji || ""} {label}
              </span>
              <span style={{ fontSize: "0.7rem", color: "var(--muted)", marginLeft: "auto" }}>
                {item.count} ({percentage}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ManagerDashboardDom({
  user,
  isOwner = false,
  isManagerOrOwner = false,
  managerRestaurants = [],
  managerMode = "editor",
  isBooting = false,
  onModeChange,
  onSignOut,
}) {
  const runtimeConfig = getActiveAllergenDietConfig();

  const ALLERGENS = Array.isArray(runtimeConfig.ALLERGENS)
    ? runtimeConfig.ALLERGENS
    : [];
  const DIETS = Array.isArray(runtimeConfig.DIETS) ? runtimeConfig.DIETS : [];
  const ALLERGEN_EMOJI = runtimeConfig.ALLERGEN_EMOJI || {};
  const DIET_EMOJI = runtimeConfig.DIET_EMOJI || {};

  const normalizeAllergen =
    typeof runtimeConfig.normalizeAllergen === "function"
      ? runtimeConfig.normalizeAllergen
      : (value) => {
          const raw = String(value ?? "").trim();
          if (!raw) return "";
          if (!ALLERGENS.length) return raw;
          return ALLERGENS.includes(raw) ? raw : "";
        };

  const normalizeDietLabel =
    typeof runtimeConfig.normalizeDietLabel === "function"
      ? runtimeConfig.normalizeDietLabel
      : (value) => {
          const raw = String(value ?? "").trim();
          if (!raw) return "";
          if (!DIETS.length) return raw;
          return DIETS.includes(raw) ? raw : "";
        };

  const formatAllergenLabel =
    typeof runtimeConfig.formatAllergenLabel === "function"
      ? runtimeConfig.formatAllergenLabel
      : (value) => String(value || "");

  const [selectedRestaurantId, setSelectedRestaurantId] = useState("");
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);
  const [dashboardError, setDashboardError] = useState("");

  const [statusMessage, setStatusMessage] = useState({ text: "", tone: "" });
  const statusTimerRef = useRef(null);

  const [currentRestaurantData, setCurrentRestaurantData] = useState(null);
  const [recentChangeLogs, setRecentChangeLogs] = useState([]);
  const [dishAnalytics, setDishAnalytics] = useState([]);
  const [accommodationRequests, setAccommodationRequests] = useState([]);
  const [rawInteractions, setRawInteractions] = useState([]);
  const [rawLoves, setRawLoves] = useState([]);
  const [dishOrders, setDishOrders] = useState({});
  const [requestFilter, setRequestFilter] = useState("pending");
  const [activeRequestAction, setActiveRequestAction] = useState(null);
  const [requestResponseText, setRequestResponseText] = useState("");
  const [isUpdatingRequest, setIsUpdatingRequest] = useState(false);

  const [chatMessages, setChatMessages] = useState([]);
  const [chatReadState, setChatReadState] = useState({ admin: null, restaurant: null });
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);

  const [brandSearchQuery, setBrandSearchQuery] = useState("");
  const [expandedBrandKeys, setExpandedBrandKeys] = useState({});
  const [isReplacingBrand, setIsReplacingBrand] = useState(false);

  const [heatmapMetric, setHeatmapMetric] = useState("views");
  const [heatmapPage, setHeatmapPage] = useState(0);

  const [activeDishName, setActiveDishName] = useState("");
  const [activeTooltipId, setActiveTooltipId] = useState("");

  const chatListRef = useRef(null);
  const sentReminderKeysRef = useRef(new Set());

  const managerDisplayName = useMemo(() => resolveManagerDisplayName(user), [user]);
  const hasManagerAccess = Boolean(
    user && isManagerOrOwner && Array.isArray(managerRestaurants) && managerRestaurants.length > 0,
  );

  const selectedRestaurant = useMemo(
    () =>
      managerRestaurants.find((restaurant) => restaurant.id === selectedRestaurantId) || null,
    [managerRestaurants, selectedRestaurantId],
  );

  const webpageEditorHref = selectedRestaurant?.slug
    ? `/restaurant?slug=${encodeURIComponent(selectedRestaurant.slug)}&edit=1`
    : managerRestaurants[0]?.slug
      ? `/restaurant?slug=${encodeURIComponent(managerRestaurants[0].slug)}&edit=1`
      : "";

  const showRestaurantSelector = isOwner;

  const setStatus = useCallback((text, tone = "success") => {
    setStatusMessage({ text, tone });
    if (statusTimerRef.current) {
      window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
    if (!text) return;
    statusTimerRef.current = window.setTimeout(() => {
      setStatusMessage((current) =>
        current.text === text ? { text: "", tone: "" } : current,
      );
      statusTimerRef.current = null;
    }, 5000);
  }, []);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) {
        window.clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!managerRestaurants.length) {
      setSelectedRestaurantId("");
      return;
    }

    setSelectedRestaurantId((current) => {
      if (current && managerRestaurants.some((restaurant) => restaurant.id === current)) {
        return current;
      }
      return managerRestaurants[0].id;
    });
  }, [managerRestaurants]);

  useEffect(() => {
    setHeatmapPage(0);
    setActiveDishName("");
    setActiveTooltipId("");
    setRequestFilter("pending");
    setActiveRequestAction(null);
    setRequestResponseText("");
  }, [selectedRestaurantId]);

  useEffect(() => {
    if (!activeTooltipId) return undefined;

    const closeTooltip = (event) => {
      if (event.target.closest(".info-tooltip-container")) return;
      setActiveTooltipId("");
    };

    document.addEventListener("click", closeTooltip);
    return () => document.removeEventListener("click", closeTooltip);
  }, [activeTooltipId]);

  const loadChatState = useCallback(
    async (restaurantId) => {
      if (!supabase || !restaurantId) {
        setChatMessages([]);
        setChatReadState({ admin: null, restaurant: null });
        setChatUnreadCount(0);
        return;
      }

      try {
        const [messagesResult, readsResult] = await Promise.all([
          supabase
            .from("restaurant_direct_messages")
            .select("id, message, sender_role, sender_name, created_at")
            .eq("restaurant_id", restaurantId)
            .order("created_at", { ascending: false })
            .limit(6),
          supabase
            .from("restaurant_direct_message_reads")
            .select("restaurant_id, reader_role, last_read_at, acknowledged_at")
            .eq("restaurant_id", restaurantId)
            .in("reader_role", ["admin", "restaurant"]),
        ]);

        if (messagesResult.error) throw messagesResult.error;
        if (readsResult.error) throw readsResult.error;

        const nextReadState = { admin: null, restaurant: null };
        (readsResult.data || []).forEach((row) => {
          if (row.reader_role === "admin") nextReadState.admin = row;
          if (row.reader_role === "restaurant") nextReadState.restaurant = row;
        });

        let unreadQuery = supabase
          .from("restaurant_direct_messages")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", restaurantId)
          .eq("sender_role", "admin");

        if (nextReadState.restaurant?.last_read_at) {
          unreadQuery = unreadQuery.gt(
            "created_at",
            nextReadState.restaurant.last_read_at,
          );
        }

        const unreadResult = await unreadQuery;
        if (unreadResult.error) throw unreadResult.error;

        setChatMessages((messagesResult.data || []).slice().reverse());
        setChatReadState(nextReadState);
        setChatUnreadCount(unreadResult.count || 0);
      } catch (error) {
        console.error("[manager-dashboard-next] failed to load chat", error);
        setChatMessages([]);
        setChatReadState({ admin: null, restaurant: null });
        setChatUnreadCount(0);
      }
    },
    [],
  );

  const loadDashboardData = useCallback(
    async (restaurantId) => {
      if (!supabase || !restaurantId) return;

      setIsLoadingDashboard(true);
      setDashboardError("");

      try {
        const [restaurantResult, changeLogsResult, analyticsResult, requestsResult, interactionsResult, lovesResult, ordersResult] =
          await Promise.all([
            supabase
              .from("restaurants")
              .select("id, name, slug, menu_images, menu_image, overlays, last_confirmed")
              .eq("id", restaurantId)
              .single(),
            supabase
              .from("change_logs")
              .select("id, timestamp, changes")
              .eq("restaurant_id", restaurantId)
              .order("timestamp", { ascending: false })
              .limit(3),
            supabase
              .from("dish_analytics")
              .select("*")
              .eq("restaurant_id", restaurantId),
            supabase
              .from("accommodation_requests")
              .select("*")
              .eq("restaurant_id", restaurantId)
              .order("created_at", { ascending: false }),
            supabase
              .from("dish_interactions")
              .select("user_id, user_allergens, user_diets, dish_name")
              .eq("restaurant_id", restaurantId),
            supabase
              .from("user_loved_dishes")
              .select("user_id, dish_name")
              .eq("restaurant_id", restaurantId),
            supabase
              .from("tablet_orders")
              .select("payload")
              .eq("restaurant_id", restaurantId),
          ]);

        if (restaurantResult.error) throw restaurantResult.error;
        if (changeLogsResult.error) throw changeLogsResult.error;
        if (analyticsResult.error) throw analyticsResult.error;
        if (requestsResult.error) throw requestsResult.error;
        if (interactionsResult.error) throw interactionsResult.error;

        const restaurant = restaurantResult.data || null;
        const changeLogs = Array.isArray(changeLogsResult.data) ? changeLogsResult.data : [];
        const analytics = Array.isArray(analyticsResult.data) ? analyticsResult.data : [];
        const requests = Array.isArray(requestsResult.data) ? requestsResult.data : [];
        const interactions = Array.isArray(interactionsResult.data)
          ? interactionsResult.data
          : [];
        const loves = Array.isArray(lovesResult.data) ? lovesResult.data : [];
        const orders = Array.isArray(ordersResult.data) ? ordersResult.data : [];

        const nextDishOrders = {};
        orders.forEach((row) => {
          const payload = row?.payload || {};
          const dishes = Array.isArray(payload.dishes)
            ? payload.dishes
            : Array.isArray(payload.items)
              ? payload.items
              : [];

          dishes.forEach((entry) => {
            const dishName =
              typeof entry === "string"
                ? entry
                : entry?.name || entry?.dish_name || entry?.id || "";
            if (!dishName) return;
            const key = normalizeDishKey(dishName);
            nextDishOrders[key] = (nextDishOrders[key] || 0) + 1;
          });

          if (payload.dish_name) {
            const key = normalizeDishKey(payload.dish_name);
            nextDishOrders[key] = (nextDishOrders[key] || 0) + 1;
          }
        });

        setCurrentRestaurantData(restaurant);
        setRecentChangeLogs(changeLogs);
        setDishAnalytics(analytics);
        setAccommodationRequests(requests);
        setRawInteractions(interactions);
        setRawLoves(loves);
        setDishOrders(nextDishOrders);
        setChatInput("");

        await loadChatState(restaurantId);
      } catch (error) {
        console.error("[manager-dashboard-next] failed to load dashboard data", error);
        setDashboardError(error?.message || "Failed to load manager dashboard data.");
        setCurrentRestaurantData(null);
        setRecentChangeLogs([]);
        setDishAnalytics([]);
        setAccommodationRequests([]);
        setRawInteractions([]);
        setRawLoves([]);
        setDishOrders({});
        setChatMessages([]);
        setChatReadState({ admin: null, restaurant: null });
        setChatUnreadCount(0);
      } finally {
        setIsLoadingDashboard(false);
      }
    },
    [loadChatState],
  );

  useEffect(() => {
    if (!hasManagerAccess || !selectedRestaurantId) return;
    loadDashboardData(selectedRestaurantId);
  }, [hasManagerAccess, loadDashboardData, selectedRestaurantId]);

  const maybeSendConfirmReminder = useCallback(
    async (restaurant) => {
      if (!supabase || !restaurant?.id || !restaurant?.slug) return;
      if (!restaurant.last_confirmed) return;

      const lastConfirmed = new Date(restaurant.last_confirmed);
      if (Number.isNaN(lastConfirmed.getTime())) return;

      const nextDueDate = new Date(lastConfirmed);
      nextDueDate.setMonth(nextDueDate.getMonth() + 1);
      const daysUntilDue = Math.ceil((nextDueDate - new Date()) / (24 * 60 * 60 * 1000));

      if (!CONFIRM_REMINDER_DAYS.has(daysUntilDue) || daysUntilDue <= 0) {
        return;
      }

      const dueLabel = nextDueDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const reminderTag = `Reminder: you have ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`;
      const reminderKey = `${restaurant.id}|${dueLabel}|${daysUntilDue}`;
      if (sentReminderKeysRef.current.has(reminderKey)) return;

      try {
        const existing = await supabase
          .from("restaurant_direct_messages")
          .select("id")
          .eq("restaurant_id", restaurant.id)
          .eq("sender_name", AUTO_ALERT_SENDER)
          .ilike("message", `%${reminderTag}%`)
          .limit(1);

        if (existing.error) throw existing.error;

        if (existing.data && existing.data.length > 0) {
          sentReminderKeysRef.current.add(reminderKey);
          return;
        }

        const message = `${reminderTag} to confirm that your information is up-to-date or your restaurant will be temporarily suspended from Clarivore.`;
        const inserted = await supabase
          .from("restaurant_direct_messages")
          .insert({
            restaurant_id: restaurant.id,
            message,
            sender_role: "admin",
            sender_name: AUTO_ALERT_SENDER,
            sender_id: null,
          })
          .select("id")
          .single();

        if (inserted.error) throw inserted.error;

        sentReminderKeysRef.current.add(reminderKey);
        if (inserted.data?.id) {
          notifyManagerChat({ messageId: inserted.data.id, client: supabase });
        }

        if (restaurant.id === selectedRestaurantId) {
          await loadChatState(restaurant.id);
        }
      } catch (error) {
        console.error("[manager-dashboard-next] failed to send confirmation reminder", error);
      }
    },
    [loadChatState, selectedRestaurantId],
  );

  useEffect(() => {
    if (!currentRestaurantData || !selectedRestaurantId) return;
    maybeSendConfirmReminder(currentRestaurantData);
  }, [currentRestaurantData, maybeSendConfirmReminder, selectedRestaurantId]);

  useEffect(() => {
    if (!chatListRef.current) return;
    chatListRef.current.scrollTop = chatListRef.current.scrollHeight;
  }, [chatMessages]);

  const onSendChatMessage = useCallback(async () => {
    if (!supabase || !selectedRestaurantId) return;
    const message = String(chatInput || "").trim();
    if (!message) return;

    setChatSending(true);
    try {
      const { error } = await supabase.from("restaurant_direct_messages").insert({
        restaurant_id: selectedRestaurantId,
        message,
        sender_role: "restaurant",
        sender_name: managerDisplayName,
        sender_id: user?.id || null,
      });
      if (error) throw error;

      setChatInput("");
      await loadChatState(selectedRestaurantId);
    } catch (error) {
      console.error("[manager-dashboard-next] failed to send chat message", error);
      setStatus("Failed to send message. Please try again.", "error");
    } finally {
      setChatSending(false);
    }
  }, [chatInput, loadChatState, managerDisplayName, selectedRestaurantId, setStatus, user?.id]);

  const onAcknowledgeChat = useCallback(async () => {
    if (!supabase || !selectedRestaurantId) return;

    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("restaurant_direct_message_reads")
        .upsert(
          {
            restaurant_id: selectedRestaurantId,
            reader_role: "restaurant",
            last_read_at: now,
            acknowledged_at: now,
          },
          { onConflict: "restaurant_id,reader_role" },
        );
      if (error) throw error;

      await loadChatState(selectedRestaurantId);
    } catch (error) {
      console.error("[manager-dashboard-next] failed to acknowledge chat", error);
      setStatus("Failed to acknowledge messages. Please try again.", "error");
    }
  }, [loadChatState, selectedRestaurantId, setStatus]);

  const confirmationInfo = useMemo(() => {
    if (!currentRestaurantData) {
      return {
        dueDateClass: "overdue",
        dueText: "Never confirmed",
        lastConfirmedText: "Never confirmed",
      };
    }

    const lastConfirmed = currentRestaurantData.last_confirmed
      ? new Date(currentRestaurantData.last_confirmed)
      : null;

    if (!lastConfirmed || Number.isNaN(lastConfirmed.getTime())) {
      return {
        dueDateClass: "overdue",
        dueText: "Never confirmed",
        lastConfirmedText: "Never confirmed",
      };
    }

    const now = new Date();
    const nextDue = new Date(lastConfirmed);
    nextDue.setMonth(nextDue.getMonth() + 1);
    const daysUntilDue = Math.ceil((nextDue - now) / (24 * 60 * 60 * 1000));

    let dueDateClass = "ok";
    let dueText = `Due in ${daysUntilDue} days`;

    if (daysUntilDue < 0) {
      dueDateClass = "overdue";
      dueText = `${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) > 1 ? "s" : ""} overdue`;
    } else if (daysUntilDue <= 7) {
      dueDateClass = "soon";
      dueText = daysUntilDue === 0 ? "Due today" : `Due in ${daysUntilDue} day${daysUntilDue > 1 ? "s" : ""}`;
    }

    return {
      dueDateClass,
      dueText,
      lastConfirmedText: `Last confirmed: ${lastConfirmed.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}`,
    };
  }, [currentRestaurantData]);

  const onConfirmNow = useCallback(() => {
    const slug = currentRestaurantData?.slug;
    if (!slug) return;
    const params = new URLSearchParams({
      slug,
      edit: "1",
      openConfirm: "1",
    });
    window.location.href = `/restaurant?${params.toString()}`;
  }, [currentRestaurantData]);

  const onViewFullLog = useCallback(() => {
    const slug = currentRestaurantData?.slug;
    if (!slug) return;
    window.location.href = `/restaurant?slug=${encodeURIComponent(slug)}&edit=1&openLog=1`;
  }, [currentRestaurantData]);

  const parsedChangeLogs = useMemo(
    () => recentChangeLogs.map(parseChangeLogEntry),
    [recentChangeLogs],
  );

  const pendingRequestCount = useMemo(
    () =>
      accommodationRequests.filter(
        (request) => String(request?.status || "pending").toLowerCase() === "pending",
      ).length,
    [accommodationRequests],
  );

  const filteredRequests = useMemo(() => {
    if (requestFilter === "all") return accommodationRequests;
    return accommodationRequests.filter(
      (request) => String(request?.status || "pending").toLowerCase() === "pending",
    );
  }, [accommodationRequests, requestFilter]);

  const requestSuggestions = useMemo(() => {
    const suggestions = [];
    const requestsByDish = {};

    accommodationRequests.forEach((request) => {
      const dishName = String(request?.dish_name || "").trim();
      if (!dishName) return;

      if (!requestsByDish[dishName]) {
        requestsByDish[dishName] = { count: 0, allergens: {}, diets: {} };
      }

      requestsByDish[dishName].count += 1;

      (request.requested_allergens || []).forEach((allergen) => {
        const normalized = normalizeAllergen(allergen);
        if (!normalized) return;
        requestsByDish[dishName].allergens[normalized] =
          (requestsByDish[dishName].allergens[normalized] || 0) + 1;
      });

      (request.requested_diets || []).forEach((diet) => {
        const normalized = normalizeDietLabel(diet);
        if (!normalized) return;
        requestsByDish[dishName].diets[normalized] =
          (requestsByDish[dishName].diets[normalized] || 0) + 1;
      });
    });

    Object.entries(requestsByDish).forEach(([dishName, details]) => {
      if (details.count < 2) return;

      const topAllergen = Object.entries(details.allergens).sort((a, b) => b[1] - a[1])[0];
      const topDiet = Object.entries(details.diets).sort((a, b) => b[1] - a[1])[0];

      if (topAllergen && topAllergen[1] >= 2) {
        suggestions.push({
          title: `Add ${formatAllergenLabel(topAllergen[0])}-free option for "${dishName}"`,
          description: `${topAllergen[1]} users requested a ${formatAllergenLabel(
            topAllergen[0],
          )}-free version. Consider adding a substitution path.`,
          potentialUsers: topAllergen[1] * 5,
          priority: topAllergen[1] >= 5 ? "high" : topAllergen[1] >= 3 ? "medium" : "low",
        });
      }

      if (topDiet && topDiet[1] >= 2) {
        suggestions.push({
          title: `Make "${dishName}" available for ${topDiet[0]} diners`,
          description: `${topDiet[1]} ${topDiet[0]} users requested this dish. Consider creating a ${topDiet[0]} variant.`,
          potentialUsers: topDiet[1] * 5,
          priority: topDiet[1] >= 5 ? "high" : topDiet[1] >= 3 ? "medium" : "low",
        });
      }
    });

    dishAnalytics.forEach((dish) => {
      const total = Number(dish?.total_interactions || 0);
      const unsafe = Number(dish?.unsafe_interactions || 0);
      if (total < 10 || unsafe / total <= 0.5) return;

      const metricKeys = resolveAllergenMetricKeys(dish, normalizeAllergen);
      const topAllergen = ALLERGENS.map((allergen) => ({
        allergen,
        count: Number(dish?.[metricKeys[allergen]] || 0),
      }))
        .filter((entry) => entry.count > 0)
        .sort((a, b) => b.count - a.count)[0];

      if (!topAllergen) return;

      suggestions.push({
        title: `High demand for allergen-friendly "${dish?.dish_name || "dish"}"`,
        description: `${unsafe} users viewed this dish but it was unsafe. ${
          topAllergen.count
        } users with ${formatAllergenLabel(topAllergen.allergen)} restrictions showed interest.`,
        potentialUsers: unsafe,
        priority: unsafe >= 20 ? "high" : unsafe >= 10 ? "medium" : "low",
      });
    });

    const priorityOrder = { high: 0, medium: 1, low: 2 };
    suggestions.sort((a, b) => {
      const rankDelta = (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99);
      if (rankDelta !== 0) return rankDelta;
      return (b.potentialUsers || 0) - (a.potentialUsers || 0);
    });

    return suggestions.slice(0, 5);
  }, [
    ALLERGENS,
    accommodationRequests,
    dishAnalytics,
    formatAllergenLabel,
    normalizeAllergen,
    normalizeDietLabel,
  ]);

  const openRequestActionModal = useCallback((request, action) => {
    if (!request?.id || !REQUEST_ACTION_CONFIG[action]) return;
    setActiveRequestAction({
      requestId: request.id,
      dishName: request.dish_name || "Unknown dish",
      action,
    });
    setRequestResponseText("");
  }, []);

  const closeRequestActionModal = useCallback(() => {
    if (isUpdatingRequest) return;
    setActiveRequestAction(null);
    setRequestResponseText("");
  }, [isUpdatingRequest]);

  const submitRequestAction = useCallback(async () => {
    if (!supabase || !activeRequestAction?.requestId || !selectedRestaurantId) return;
    const config = REQUEST_ACTION_CONFIG[activeRequestAction.action];
    if (!config) return;

    const now = new Date().toISOString();
    const trimmedResponse = String(requestResponseText || "").trim();

    setIsUpdatingRequest(true);
    try {
      const updates = {
        status: activeRequestAction.action,
        manager_response: trimmedResponse || null,
        manager_reviewed_at: now,
        manager_reviewed_by: user?.id || null,
        updated_at: now,
      };

      const { error } = await supabase
        .from("accommodation_requests")
        .update(updates)
        .eq("id", activeRequestAction.requestId)
        .eq("restaurant_id", selectedRestaurantId);

      if (error) throw error;

      setAccommodationRequests((current) =>
        current.map((request) =>
          request.id === activeRequestAction.requestId
            ? {
                ...request,
                ...updates,
              }
            : request,
        ),
      );

      setStatus(`${config.title} complete.`, "success");
      setActiveRequestAction(null);
      setRequestResponseText("");
    } catch (error) {
      console.error("[manager-dashboard-next] failed to update request", error);
      setStatus("Failed to update request. Please try again.", "error");
    } finally {
      setIsUpdatingRequest(false);
    }
  }, [activeRequestAction, requestResponseText, selectedRestaurantId, setStatus, user?.id]);

  const activeRequestActionConfig = activeRequestAction
    ? REQUEST_ACTION_CONFIG[activeRequestAction.action] || null
    : null;

  const brandItems = useMemo(
    () => collectBrandItemsFromOverlays(currentRestaurantData?.overlays || []),
    [currentRestaurantData?.overlays],
  );

  const filteredBrandItems = useMemo(() => {
    const query = String(brandSearchQuery || "").trim().toLowerCase();
    if (!query) return brandItems;

    return brandItems.filter((item) => {
      const haystack = [item.brandName, ...(item.ingredientNames || []), ...(item.dishes || [])]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [brandItems, brandSearchQuery]);

  const onToggleBrandItem = useCallback((itemKey) => {
    setExpandedBrandKeys((current) => ({
      ...current,
      [itemKey]: !current[itemKey],
    }));
  }, []);

  const onOpenDishEditor = useCallback(
    (dishName, ingredientName) => {
      const slug = currentRestaurantData?.slug || "";
      if (!slug || !dishName) return;

      const params = new URLSearchParams({
        slug,
        edit: "1",
        openAI: "true",
        dishName,
      });
      if (ingredientName) {
        params.set("ingredientName", ingredientName);
      }

      window.location.href = `/restaurant?${params.toString()}`;
    },
    [currentRestaurantData],
  );

  const onApplyBrandReplacement = useCallback(
    async (result, brandItem) => {
      if (!supabase || !selectedRestaurantId || !brandItem) return;

      const ingredientText = String(result?.ingredientText || "").trim();
      const newBrandName =
        String(result?.productName || "").trim() || brandItem.brandName || "New brand item";

      const newBrand = {
        name: newBrandName,
        barcode: "",
        brandImage: result?.brandImage || "",
        image: "",
        ingredientsImage: result?.ingredientsImage || "",
        ingredientsList: ingredientText ? [ingredientText] : [],
        ingredientList: ingredientText,
        allergens: Array.isArray(result?.allergens) ? result.allergens : [],
        crossContamination: Array.isArray(result?.crossContamination)
          ? result.crossContamination
          : [],
        diets: Array.isArray(result?.diets) ? result.diets : [],
        crossContaminationDiets: Array.isArray(result?.crossContaminationDiets)
          ? result.crossContaminationDiets
          : [],
      };

      try {
        setIsReplacingBrand(true);
        const updatedOverlays = replaceBrandInOverlays(
          currentRestaurantData?.overlays || [],
          brandItem,
          newBrand,
          normalizeAllergen,
          normalizeDietLabel,
        );

        const { error } = await supabase
          .from("restaurants")
          .update({ overlays: updatedOverlays })
          .eq("id", selectedRestaurantId);
        if (error) throw error;

        setCurrentRestaurantData((current) =>
          current ? { ...current, overlays: updatedOverlays } : current,
        );
        setStatus("Brand item replaced successfully.", "success");
      } catch (error) {
        console.error("[manager-dashboard-next] failed to replace brand", error);
        setStatus("Failed to replace brand item. Please try again.", "error");
      } finally {
        setIsReplacingBrand(false);
      }
    },
    [
      currentRestaurantData?.overlays,
      normalizeAllergen,
      normalizeDietLabel,
      selectedRestaurantId,
      setStatus,
    ],
  );

  const onReplaceBrand = useCallback(
    async (brandItem) => {
      if (!brandItem) return;

      const ingredientLabel =
        (brandItem.ingredientNames || []).filter(Boolean)[0] ||
        brandItem.brandName ||
        "Brand item";

      try {
        const { showManagerIngredientPhotoUploadModal } = await import(
          "../../lib/managerIngredientPhotoCapture"
        );
        await showManagerIngredientPhotoUploadModal(ingredientLabel, {
          inlineResults: true,
          skipRowUpdates: true,
          onApplyResults: (result) => onApplyBrandReplacement(result, brandItem),
        });
      } catch (error) {
        console.error("[manager-dashboard-next] ingredient capture unavailable", error);
        setStatus("Failed to load ingredient capture. Please try again.", "error");
      }
    },
    [onApplyBrandReplacement, setStatus],
  );

  const allOverlays = useMemo(
    () => (Array.isArray(currentRestaurantData?.overlays) ? currentRestaurantData.overlays : []),
    [currentRestaurantData?.overlays],
  );

  const menuImages = useMemo(() => {
    const list = Array.isArray(currentRestaurantData?.menu_images)
      ? [...currentRestaurantData.menu_images]
      : [];
    if (!list.length && currentRestaurantData?.menu_image) {
      list.push(currentRestaurantData.menu_image);
    }
    return list.filter(Boolean);
  }, [currentRestaurantData]);

  useEffect(() => {
    if (heatmapPage < menuImages.length) return;
    setHeatmapPage(0);
  }, [heatmapPage, menuImages.length]);

  const pageOverlays = useMemo(() => {
    return allOverlays.filter((overlay) => {
      const page = overlay?.pageIndex ?? overlay?.page ?? 0;
      return page === heatmapPage;
    });
  }, [allOverlays, heatmapPage]);

  const userProfilesById = useMemo(() => {
    const map = {};
    rawInteractions.forEach((interaction) => {
      const userId = interaction?.user_id;
      if (!userId || map[userId]) return;
      map[userId] = {
        allergens: (interaction.user_allergens || []).map(normalizeAllergen).filter(Boolean),
        diets: (interaction.user_diets || []).map(normalizeDietLabel).filter(Boolean),
      };
    });
    return map;
  }, [normalizeAllergen, normalizeDietLabel, rawInteractions]);

  const metricByDish = useMemo(() => {
    const metrics = {};

    if (heatmapMetric === "views") {
      rawInteractions.forEach((interaction) => {
        const key = normalizeDishKey(interaction?.dish_name);
        if (!key) return;
        metrics[key] = (metrics[key] || 0) + 1;
      });
      return metrics;
    }

    if (heatmapMetric === "loves") {
      rawLoves.forEach((love) => {
        const key = normalizeDishKey(love?.dish_name);
        if (!key) return;
        metrics[key] = (metrics[key] || 0) + 1;
      });
      return metrics;
    }

    if (heatmapMetric === "orders") {
      return { ...dishOrders };
    }

    if (heatmapMetric === "requests") {
      accommodationRequests.forEach((request) => {
        const key = normalizeDishKey(request?.dish_name);
        if (!key) return;
        metrics[key] = (metrics[key] || 0) + 1;
      });
      return metrics;
    }

    if (heatmapMetric === "accommodation") {
      const dishOverlayMap = {};
      allOverlays.forEach((overlay, index) => {
        const dishName = getOverlayDishName(overlay, index);
        const key = normalizeDishKey(dishName);
        if (key && !dishOverlayMap[key]) {
          dishOverlayMap[key] = overlay;
        }
      });

      const dishViewCounts = {};
      const dishAccommodated = {};

      rawInteractions.forEach((interaction) => {
        const key = normalizeDishKey(interaction?.dish_name);
        if (!key) return;
        const overlay = dishOverlayMap[key];
        if (!overlay) return;

        dishViewCounts[key] = (dishViewCounts[key] || 0) + 1;

        const status = computeDishStatusForUser(
          overlay,
          interaction?.user_allergens || [],
          interaction?.user_diets || [],
          normalizeAllergen,
          normalizeDietLabel,
        );

        if (status !== "unsafe") {
          dishAccommodated[key] = (dishAccommodated[key] || 0) + 1;
        }
      });

      Object.keys(dishViewCounts).forEach((key) => {
        const total = dishViewCounts[key];
        const accommodated = dishAccommodated[key] || 0;
        metrics[key] = total > 0 ? Math.round((accommodated / total) * 100) : 0;
      });

      return metrics;
    }

    return metrics;
  }, [
    accommodationRequests,
    allOverlays,
    dishOrders,
    heatmapMetric,
    normalizeAllergen,
    normalizeDietLabel,
    rawInteractions,
    rawLoves,
  ]);

  const metricBounds = useMemo(() => {
    const values = Object.values(metricByDish);
    return {
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 1,
    };
  }, [metricByDish]);

  const heatmapMetricLabel = useMemo(() => {
    switch (heatmapMetric) {
      case "views":
        return "views";
      case "loves":
        return "loves";
      case "orders":
        return "orders";
      case "requests":
        return "requests";
      case "accommodation":
        return "% accommodated";
      default:
        return "views";
    }
  }, [heatmapMetric]);

  const accommodationBreakdown = useMemo(() => {
    if (!allOverlays.length) return null;

    const dishOverlayMap = {};
    allOverlays.forEach((overlay, index) => {
      const dishName = getOverlayDishName(overlay, index);
      const key = normalizeDishKey(dishName);
      if (key && !dishOverlayMap[key]) {
        dishOverlayMap[key] = overlay;
      }
    });

    const allergenDishStats = {};
    ALLERGENS.forEach((allergen) => {
      allergenDishStats[allergen] = { safe: 0, accommodated: 0, cannot: 0 };
    });

    const dietDishStats = {};
    DIETS.forEach((diet) => {
      dietDishStats[diet] = { safe: 0, cannot: 0 };
    });

    const totalDishes = allOverlays.length;

    allOverlays.forEach((overlay) => {
      const dishAllergens = (overlay.allergens || []).map(normalizeAllergen).filter(Boolean);
      const removableAllergens = (overlay.removable || [])
        .map((entry) => normalizeAllergen(entry?.allergen || ""))
        .filter(Boolean);
      const dishDiets = new Set((overlay.diets || []).map(normalizeDietLabel).filter(Boolean));

      ALLERGENS.forEach((allergen) => {
        if (!dishAllergens.includes(allergen)) {
          allergenDishStats[allergen].safe += 1;
        } else if (removableAllergens.includes(allergen)) {
          allergenDishStats[allergen].accommodated += 1;
        } else {
          allergenDishStats[allergen].cannot += 1;
        }
      });

      DIETS.forEach((diet) => {
        if (dishDiets.has(diet)) {
          dietDishStats[diet].safe += 1;
        } else {
          dietDishStats[diet].cannot += 1;
        }
      });
    });

    const allergenViewStats = {};
    ALLERGENS.forEach((allergen) => {
      allergenViewStats[allergen] = { noConflict: 0, accommodated: 0, cannot: 0 };
    });

    const dietViewStats = {};
    DIETS.forEach((diet) => {
      dietViewStats[diet] = { noConflict: 0, cannot: 0 };
    });

    let totalViews = 0;

    rawInteractions.forEach((interaction) => {
      const key = normalizeDishKey(interaction?.dish_name);
      if (!key) return;
      const overlay = dishOverlayMap[key];
      if (!overlay) return;

      totalViews += 1;

      const userAllergens = (interaction.user_allergens || [])
        .map(normalizeAllergen)
        .filter(Boolean);
      const userDiets = (interaction.user_diets || [])
        .map(normalizeDietLabel)
        .filter(Boolean);

      const dishAllergens = (overlay.allergens || []).map(normalizeAllergen).filter(Boolean);
      const removableAllergens = (overlay.removable || [])
        .map((entry) => normalizeAllergen(entry?.allergen || ""))
        .filter(Boolean);
      const dishDietSet = new Set((overlay.diets || []).map(normalizeDietLabel).filter(Boolean));

      ALLERGENS.forEach((allergen) => {
        const userHasAllergen = userAllergens.includes(allergen);
        const dishHasAllergen = dishAllergens.includes(allergen);

        if (!userHasAllergen) {
          allergenViewStats[allergen].noConflict += 1;
        } else if (dishHasAllergen && removableAllergens.includes(allergen)) {
          allergenViewStats[allergen].accommodated += 1;
        } else if (dishHasAllergen) {
          allergenViewStats[allergen].cannot += 1;
        } else {
          allergenViewStats[allergen].noConflict += 1;
        }
      });

      DIETS.forEach((diet) => {
        const userHasDiet = userDiets.includes(diet);
        if (!userHasDiet || dishDietSet.has(diet)) {
          dietViewStats[diet].noConflict += 1;
        } else {
          dietViewStats[diet].cannot += 1;
        }
      });
    });

    const relevantAllergens = ALLERGENS.filter(
      (allergen) =>
        allergenDishStats[allergen].accommodated > 0 ||
        allergenDishStats[allergen].cannot > 0,
    );

    const relevantDiets = DIETS.filter((diet) => dietDishStats[diet].cannot > 0);

    return {
      totalDishes,
      totalViews,
      allergenDishStats,
      allergenViewStats,
      dietDishStats,
      dietViewStats,
      relevantAllergens,
      relevantDiets,
    };
  }, [
    ALLERGENS,
    DIETS,
    allOverlays,
    normalizeAllergen,
    normalizeDietLabel,
    rawInteractions,
  ]);

  const userDietaryBreakdown = useMemo(() => {
    if (!rawInteractions.length) return null;

    const allergenUserSets = {};
    ALLERGENS.forEach((allergen) => {
      allergenUserSets[allergen] = new Set();
    });

    const dietUserSets = {};
    DIETS.forEach((diet) => {
      dietUserSets[diet] = new Set();
    });

    const usersWithNoAllergens = new Set();
    const usersWithNoDiets = new Set();
    const allUsers = new Set();

    rawInteractions.forEach((interaction) => {
      const userId = interaction?.user_id;
      if (!userId) return;

      allUsers.add(userId);

      const userAllergens = (interaction.user_allergens || [])
        .map(normalizeAllergen)
        .filter(Boolean);
      const userDiets = (interaction.user_diets || []).map(normalizeDietLabel).filter(Boolean);

      if (!userAllergens.length) {
        usersWithNoAllergens.add(userId);
      }
      if (!userDiets.length) {
        usersWithNoDiets.add(userId);
      }

      userAllergens.forEach((allergen) => {
        if (allergenUserSets[allergen]) {
          allergenUserSets[allergen].add(userId);
        }
      });

      userDiets.forEach((diet) => {
        if (dietUserSets[diet]) {
          dietUserSets[diet].add(userId);
        }
      });
    });

    const allergenData = ALLERGENS.map((allergen) => ({
      name: allergen,
      label: formatAllergenLabel(allergen),
      count: allergenUserSets[allergen].size,
      emoji: ALLERGEN_EMOJI[allergen] || "",
    }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count);

    if (usersWithNoAllergens.size > 0) {
      allergenData.push({
        name: "No allergies",
        label: "No allergies",
        count: usersWithNoAllergens.size,
        emoji: "✓",
      });
    }

    const dietData = DIETS.map((diet) => ({
      name: diet,
      label: diet,
      count: dietUserSets[diet].size,
      emoji: DIET_EMOJI[diet] || "",
    }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count);

    if (usersWithNoDiets.size > 0) {
      dietData.push({
        name: "No diets",
        label: "No diets",
        count: usersWithNoDiets.size,
        emoji: "✓",
      });
    }

    return {
      uniqueUserCount: allUsers.size,
      allergenData,
      dietData,
    };
  }, [
    ALLERGENS,
    ALLERGEN_EMOJI,
    DIETS,
    DIET_EMOJI,
    formatAllergenLabel,
    normalizeAllergen,
    normalizeDietLabel,
    rawInteractions,
  ]);

  const dishModalData = useMemo(() => {
    if (!activeDishName) return null;

    const dishKey = normalizeDishKey(activeDishName);

    const overlay = allOverlays.find((entry, index) => {
      const name = getOverlayDishName(entry, index);
      return normalizeDishKey(name) === dishKey;
    });

    if (!overlay) return null;

    const dishAllergens = (overlay.allergens || []).map(normalizeAllergen).filter(Boolean);
    const removableAllergens = (overlay.removable || [])
      .map((entry) => normalizeAllergen(entry?.allergen || ""))
      .filter(Boolean);

    const canAccommodateAllergens = dishAllergens.filter((allergen) =>
      removableAllergens.includes(allergen),
    );
    const cannotAccommodateAllergens = dishAllergens.filter(
      (allergen) => !removableAllergens.includes(allergen),
    );

    const dishDietSet = new Set((overlay.diets || []).map(normalizeDietLabel).filter(Boolean));
    const cannotAccommodateDiets = DIETS.filter((diet) => !dishDietSet.has(diet));

    const dishInteractions = rawInteractions.filter(
      (interaction) => normalizeDishKey(interaction?.dish_name) === dishKey,
    );

    let viewsSafe = 0;
    let viewsRemovable = 0;
    let viewsUnsafe = 0;

    dishInteractions.forEach((interaction) => {
      const status = computeDishStatusForUser(
        overlay,
        interaction?.user_allergens || [],
        interaction?.user_diets || [],
        normalizeAllergen,
        normalizeDietLabel,
      );

      if (status === "safe") viewsSafe += 1;
      else if (status === "removable") viewsRemovable += 1;
      else if (status === "unsafe") viewsUnsafe += 1;
    });

    const viewsTotal = viewsSafe + viewsRemovable + viewsUnsafe;

    const seenUsers = new Set();
    let uniqueSafe = 0;
    let uniqueRemovable = 0;
    let uniqueUnsafe = 0;

    dishInteractions.forEach((interaction) => {
      const userId = interaction?.user_id;
      if (!userId || seenUsers.has(userId)) return;
      seenUsers.add(userId);

      const profile = userProfilesById[userId];
      const status = computeDishStatusForUser(
        overlay,
        profile?.allergens || [],
        profile?.diets || [],
        normalizeAllergen,
        normalizeDietLabel,
      );

      if (status === "safe") uniqueSafe += 1;
      else if (status === "removable") uniqueRemovable += 1;
      else if (status === "unsafe") uniqueUnsafe += 1;
    });

    let lovesSafe = 0;
    let lovesRemovable = 0;
    let lovesUnsafe = 0;

    rawLoves
      .filter((entry) => normalizeDishKey(entry?.dish_name) === dishKey)
      .forEach((entry) => {
        const profile = userProfilesById[entry?.user_id];
        const status = computeDishStatusForUser(
          overlay,
          profile?.allergens || [],
          profile?.diets || [],
          normalizeAllergen,
          normalizeDietLabel,
        );

        if (status === "safe") lovesSafe += 1;
        else if (status === "removable") lovesRemovable += 1;
        else if (status === "unsafe") lovesUnsafe += 1;
      });

    const lovesTotal = lovesSafe + lovesRemovable + lovesUnsafe;
    const ordersTotal = dishOrders[dishKey] || 0;

    const allDishKeys = [...new Set(rawInteractions.map((interaction) => normalizeDishKey(interaction?.dish_name)).filter(Boolean))];
    const numberOfDishes = allDishKeys.length || 1;

    let totalViewsAcrossMenu = 0;
    let totalSafeAcrossMenu = 0;
    let totalRemovableAcrossMenu = 0;
    let totalUnsafeAcrossMenu = 0;

    allDishKeys.forEach((candidateKey) => {
      const candidateOverlay = allOverlays.find((entry, index) => {
        const name = getOverlayDishName(entry, index);
        return normalizeDishKey(name) === candidateKey;
      });

      rawInteractions
        .filter((interaction) => normalizeDishKey(interaction?.dish_name) === candidateKey)
        .forEach((interaction) => {
          totalViewsAcrossMenu += 1;
          const status = computeDishStatusForUser(
            candidateOverlay,
            interaction?.user_allergens || [],
            interaction?.user_diets || [],
            normalizeAllergen,
            normalizeDietLabel,
          );

          if (status === "safe") totalSafeAcrossMenu += 1;
          else if (status === "removable") totalRemovableAcrossMenu += 1;
          else totalUnsafeAcrossMenu += 1;
        });
    });

    const averageViews = Math.round(totalViewsAcrossMenu / numberOfDishes);
    const averageSafe = totalSafeAcrossMenu / numberOfDishes;
    const averageRemovable = totalRemovableAcrossMenu / numberOfDishes;
    const averageUnsafe = totalUnsafeAcrossMenu / numberOfDishes;
    const averageTotal = averageSafe + averageRemovable + averageUnsafe;

    const allergenConflictCounts = {};
    cannotAccommodateAllergens.concat(canAccommodateAllergens).forEach((allergen) => {
      allergenConflictCounts[allergen] = 0;
    });

    const dietConflictCounts = {};
    cannotAccommodateDiets.forEach((diet) => {
      dietConflictCounts[diet] = 0;
    });

    dishInteractions.forEach((interaction) => {
      const userAllergens = (interaction.user_allergens || [])
        .map(normalizeAllergen)
        .filter(Boolean);
      const userDiets = (interaction.user_diets || []).map(normalizeDietLabel).filter(Boolean);

      userAllergens.forEach((allergen) => {
        if (Object.prototype.hasOwnProperty.call(allergenConflictCounts, allergen)) {
          allergenConflictCounts[allergen] += 1;
        }
      });

      userDiets.forEach((diet) => {
        if (Object.prototype.hasOwnProperty.call(dietConflictCounts, diet)) {
          dietConflictCounts[diet] += 1;
        }
      });
    });

    const maxConflict = Math.max(
      1,
      ...Object.values(allergenConflictCounts),
      ...Object.values(dietConflictCounts),
    );

    return {
      dishName: activeDishName,
      canAccommodateAllergens,
      cannotAccommodateAllergens,
      cannotAccommodateDiets,
      requestsCount: accommodationRequests.filter(
        (request) => normalizeDishKey(request?.dish_name) === dishKey,
      ).length,
      views: { safe: viewsSafe, removable: viewsRemovable, unsafe: viewsUnsafe, total: viewsTotal },
      unique: {
        safe: uniqueSafe,
        removable: uniqueRemovable,
        unsafe: uniqueUnsafe,
        total: uniqueSafe + uniqueRemovable + uniqueUnsafe,
      },
      loves: { safe: lovesSafe, removable: lovesRemovable, unsafe: lovesUnsafe, total: lovesTotal },
      ordersTotal,
      averages: {
        views: averageViews,
        safe: averageSafe,
        removable: averageRemovable,
        unsafe: averageUnsafe,
        total: averageTotal,
      },
      allergenConflictCounts,
      dietConflictCounts,
      maxConflict,
    };
  }, [
    DIETS,
    accommodationRequests,
    activeDishName,
    allOverlays,
    dishOrders,
    normalizeAllergen,
    normalizeDietLabel,
    rawInteractions,
    rawLoves,
    userProfilesById,
  ]);

  const recentChangesLoading = isLoadingDashboard && !recentChangeLogs.length && !dashboardError;
  const dashboardVisible = hasManagerAccess && !isLoadingDashboard;

  return (
    <PageShell
      contentClassName="dashboard-container"
      topbar={
        <SimpleTopbar
          brandHref="/manager-dashboard"
          links={[
            { href: "/manager-dashboard", label: "Dashboard" },
            {
              href: webpageEditorHref || "/manager-dashboard",
              label: "Webpage editor",
              visible: Boolean(webpageEditorHref),
            },
            { href: "/server-tablet", label: "Server monitor" },
            { href: "/kitchen-tablet", label: "Kitchen monitor" },
            { href: "/help-contact", label: "Help" },
          ]}
          showAuthAction
          signedIn={Boolean(user)}
          onSignOut={onSignOut}
          rightContent={
            isManagerOrOwner ? (
              <ManagerModeSwitch mode={managerMode} onChange={onModeChange} />
            ) : null
          }
        />
      }
    >
          <div className="dashboard-header">
            <h1>Restaurant Manager Dashboard</h1>
            <p>View customer dietary analytics and accommodation requests</p>
          </div>

          {showRestaurantSelector ? (
            <div className="restaurant-selector" id="restaurant-selector-container">
              <label style={{ display: "block", marginBottom: 8, color: "var(--muted)" }}>
                Select Restaurant
              </label>
              <select
                id="restaurant-select"
                value={selectedRestaurantId}
                onChange={(event) => setSelectedRestaurantId(event.target.value)}
              >
                {managerRestaurants.map((restaurant) => (
                  <option key={restaurant.id} value={restaurant.id}>
                    {restaurant.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {!user ? (
            <div id="auth-required" className="section">
              <div className="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <h3>Sign in Required</h3>
                <p>Please sign in to access the manager dashboard.</p>
                <a
                  href="/account"
                  className="action-btn primary"
                  style={{ display: "inline-block", marginTop: 16, textDecoration: "none" }}
                >
                  Sign In
                </a>
              </div>
            </div>
          ) : null}

          {user && !hasManagerAccess && !isBooting ? (
            <div id="not-manager" className="section">
              <div className="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <h3>Manager Access Required</h3>
                <p>You don't have manager access to any restaurants yet.</p>
              </div>
            </div>
          ) : null}

          {isBooting || (hasManagerAccess && isLoadingDashboard) ? (
            <div id="loading-state" className="section">
              <div className="loading-state">
                <div className="spinner" />
                <p>Loading dashboard...</p>
              </div>
            </div>
          ) : null}

          {dashboardError ? (
            <p className="status-text error" style={{ marginBottom: 16 }}>
              {dashboardError}
            </p>
          ) : null}

          {statusMessage.text ? (
            <p
              className={`status-text ${statusMessage.tone === "error" ? "error" : "success"}`}
              style={{ marginBottom: 16 }}
            >
              {statusMessage.text}
            </p>
          ) : null}

          {dashboardVisible ? (
            <div id="dashboard-content">
              <div className="section quick-actions-section">
                <div className="quick-actions-grid">
                  <div className="quick-actions-panel">
                    <div className="chat-header-row">
                      <div className="chat-title-wrap">
                        <h3 className="quick-actions-title" style={{ margin: 0 }}>
                          Direct Messages
                        </h3>
                        <span
                          className="chat-badge"
                          id="chat-unread-badge"
                          style={{ display: chatUnreadCount > 0 ? "inline-flex" : "none" }}
                        >
                          {chatUnreadCount}
                        </span>
                      </div>
                      <button
                        className="btn btnWarning"
                        id="chat-ack-btn"
                        style={{ display: chatUnreadCount > 0 ? "inline-flex" : "none" }}
                        onClick={onAcknowledgeChat}
                      >
                        Acknowledge message(s)
                      </button>
                    </div>

                    <div id="chat-preview-list" className="chat-preview-list" ref={chatListRef}>
                      {chatMessages.length === 0 ? (
                        <div className="chat-preview-empty">No messages yet</div>
                      ) : (
                        chatMessages.map((message, index) => {
                          const isOutgoing = message.sender_role === "restaurant";
                          const senderName = String(message.sender_name || "").trim();
                          const senderLabel = isOutgoing
                            ? senderName && senderName.toLowerCase() !== "you"
                              ? senderName
                              : managerDisplayName
                            : senderName || ADMIN_DISPLAY_NAME;
                          const timestamp = formatChatTimestamp(message.created_at);

                          const acknowledgements = [];
                          if (chatReadState.admin?.acknowledged_at) {
                            const adminAckTime = new Date(
                              chatReadState.admin.acknowledged_at,
                            ).getTime();
                            const messageTime = new Date(message.created_at).getTime();
                            if (
                              !Number.isNaN(adminAckTime) &&
                              !Number.isNaN(messageTime) &&
                              message.sender_role === "restaurant" &&
                              messageTime <= adminAckTime
                            ) {
                              const next = chatMessages[index + 1];
                              const nextTime = next?.created_at
                                ? new Date(next.created_at).getTime()
                                : NaN;
                              if (
                                !next ||
                                Number.isNaN(nextTime) ||
                                next.sender_role !== "restaurant" ||
                                nextTime > adminAckTime
                              ) {
                                acknowledgements.push({
                                  name: ADMIN_DISPLAY_NAME,
                                  at: chatReadState.admin.acknowledged_at,
                                });
                              }
                            }
                          }

                          if (chatReadState.restaurant?.acknowledged_at) {
                            const managerAckTime = new Date(
                              chatReadState.restaurant.acknowledged_at,
                            ).getTime();
                            const messageTime = new Date(message.created_at).getTime();
                            if (
                              !Number.isNaN(managerAckTime) &&
                              !Number.isNaN(messageTime) &&
                              message.sender_role === "admin" &&
                              messageTime <= managerAckTime
                            ) {
                              const next = chatMessages[index + 1];
                              const nextTime = next?.created_at
                                ? new Date(next.created_at).getTime()
                                : NaN;
                              if (
                                !next ||
                                Number.isNaN(nextTime) ||
                                next.sender_role !== "admin" ||
                                nextTime > managerAckTime
                              ) {
                                acknowledgements.push({
                                  name: managerDisplayName,
                                  at: chatReadState.restaurant.acknowledged_at,
                                });
                              }
                            }
                          }

                          return (
                            <div key={message.id || `${message.created_at}-${index}`}>
                              <div
                                className={`chat-preview-item${
                                  isOutgoing ? " outgoing" : " incoming"
                                }`}
                              >
                                <div>
                                  <ChatMessageText
                                    text={message.message}
                                    resolveLink={resolveManagerChatLink}
                                  />
                                </div>
                                <div className="chat-preview-meta">
                                  {senderLabel}
                                  {timestamp ? ` · ${timestamp}` : ""}
                                </div>
                              </div>
                              {acknowledgements.map((entry) => (
                                <div
                                  className="chat-ack"
                                  key={`${entry.name}-${entry.at}-${message.id}`}
                                >
                                  {entry.name} acknowledged · {formatChatTimestamp(entry.at)}
                                </div>
                              ))}
                            </div>
                          );
                        })
                      )}
                    </div>

                    <div className="chat-preview-compose">
                      <input
                        id="chat-message-input"
                        className="chat-preview-input"
                        type="text"
                        placeholder="Message Clarivore"
                        value={chatInput}
                        disabled={chatSending}
                        onChange={(event) => setChatInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            onSendChatMessage();
                          }
                        }}
                      />
                      <button className="btn" id="chat-send-btn" onClick={onSendChatMessage} disabled={chatSending}>
                        {chatSending ? "Sending..." : "Send"}
                      </button>
                    </div>
                  </div>

                  <div className="quick-actions-panel">
                    <h3 className="quick-actions-title">Menu Confirmation</h3>
                    <div id="confirmation-status" className="confirmation-status">
                      <div className="confirmation-info">
                        <div className="confirmation-due-label">Next confirmation due</div>
                        <div className={`confirmation-due-date ${confirmationInfo.dueDateClass}`}>
                          {confirmationInfo.dueText}
                        </div>
                        <div className="confirmation-last">{confirmationInfo.lastConfirmedText}</div>
                        <button className="btn btnPrimary" id="confirmNowBtn" onClick={onConfirmNow}>
                          Confirm information is up-to-date
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="section">
                <div className="dashboard-split">
                  <div className="dashboard-panel">
                    <div className="section-header">
                      <h2 className="section-title">Accommodation Requests</h2>
                      <span className="request-count">{pendingRequestCount} pending</span>
                    </div>
                    <div className="tabs">
                      <button
                        type="button"
                        className={`tab-btn${requestFilter === "pending" ? " active" : ""}`}
                        onClick={() => setRequestFilter("pending")}
                      >
                        Pending
                      </button>
                      <button
                        type="button"
                        className={`tab-btn${requestFilter === "all" ? " active" : ""}`}
                        onClick={() => setRequestFilter("all")}
                      >
                        All
                      </button>
                    </div>
                    <div id="requests-list">
                      {filteredRequests.length === 0 ? (
                        <div className="empty-state">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M9 12l2 2 4-4" />
                            <circle cx="12" cy="12" r="10" />
                          </svg>
                          <p>
                            {requestFilter === "pending"
                              ? "No pending accommodation requests"
                              : "No accommodation requests yet"}
                          </p>
                        </div>
                      ) : (
                        filteredRequests.map((request) => {
                          const requestedAllergens = (request.requested_allergens || [])
                            .map(normalizeAllergen)
                            .filter(Boolean);
                          const requestedDiets = (request.requested_diets || [])
                            .map(normalizeDietLabel)
                            .filter(Boolean);
                          const status = String(request.status || "pending").toLowerCase();
                          const isPending = status === "pending";

                          return (
                            <div className="request-card" data-request-id={request.id} key={request.id}>
                              <div className="request-header">
                                <div>
                                  <div className="request-dish">{request.dish_name || "Unknown dish"}</div>
                                  <div className="request-date">{toRequestDateLabel(request.created_at)}</div>
                                </div>
                                <span className={`status-badge ${status}`}>{status}</span>
                              </div>
                              <div className="request-details">
                                <div className="request-needs">
                                  {requestedAllergens.length ? (
                                    <div className="request-needs-group">
                                      <span className="request-needs-label">
                                        Allergen accommodations needed
                                      </span>
                                      <div>
                                        {requestedAllergens.map((allergen) => (
                                          <span className="allergen-badge" key={`${request.id}-${allergen}`}>
                                            {ALLERGEN_EMOJI[allergen] || "⚠️"}{" "}
                                            {formatAllergenLabel(allergen)}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                  {requestedDiets.length ? (
                                    <div className="request-needs-group">
                                      <span className="request-needs-label">
                                        Dietary accommodations needed
                                      </span>
                                      <div>
                                        {requestedDiets.map((diet) => (
                                          <span
                                            className={`diet-badge ${diet.toLowerCase()}`}
                                            key={`${request.id}-${diet}`}
                                          >
                                            {DIET_EMOJI[diet] || "🍽️"} {diet}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              </div>

                              {request.manager_response ? (
                                <div
                                  style={{
                                    background: "rgba(255,255,255,0.05)",
                                    padding: 12,
                                    borderRadius: 8,
                                    marginBottom: 12,
                                  }}
                                >
                                  <div
                                    style={{
                                      color: "var(--muted)",
                                      fontSize: "0.8rem",
                                      marginBottom: 4,
                                    }}
                                  >
                                    Manager Response
                                  </div>
                                  <div>{request.manager_response}</div>
                                </div>
                              ) : null}

                              {isPending ? (
                                <div className="request-actions">
                                  <button
                                    type="button"
                                    className="action-btn success"
                                    onClick={() => openRequestActionModal(request, "implemented")}
                                  >
                                    Mark Implemented
                                  </button>
                                  <button
                                    type="button"
                                    className="action-btn"
                                    onClick={() => openRequestActionModal(request, "reviewed")}
                                  >
                                    Mark Reviewed
                                  </button>
                                  <button
                                    type="button"
                                    className="action-btn decline"
                                    onClick={() => openRequestActionModal(request, "declined")}
                                  >
                                    Decline
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className="dashboard-panel">
                    <div className="section-header">
                      <h2 className="section-title">Improvement Suggestions</h2>
                    </div>
                    <div id="suggestions-list">
                      {requestSuggestions.length === 0 ? (
                        <div className="empty-state">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 16v-4" />
                            <path d="M12 8h.01" />
                          </svg>
                          <p>More request and interaction data is needed to generate suggestions.</p>
                        </div>
                      ) : (
                        requestSuggestions.map((suggestion, index) => (
                          <div className="suggestion-card" key={`${suggestion.title}-${index}`}>
                            <div className="suggestion-icon">
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                width="24"
                                height="24"
                              >
                                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                                <path d="M2 17l10 5 10-5" />
                                <path d="M2 12l10 5 10-5" />
                              </svg>
                            </div>
                            <div className="suggestion-title">{suggestion.title}</div>
                            <div className="suggestion-description">{suggestion.description}</div>
                            <div className="suggestion-impact">
                              <div className="impact-item">
                                <span className="positive">+{suggestion.potentialUsers}</span>
                                <span style={{ color: "var(--muted)" }}>potential users</span>
                              </div>
                              <div className="impact-item">
                                <span style={{ color: "var(--muted)" }}>Priority:</span>
                                <span
                                  style={{
                                    color:
                                      suggestion.priority === "high"
                                        ? "#ef4444"
                                        : suggestion.priority === "medium"
                                          ? "#facc15"
                                          : "var(--muted)",
                                  }}
                                >
                                  {suggestion.priority}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="section">
                <div className="dashboard-split">
                  <div className="dashboard-panel">
                    <div className="section-header">
                      <h2 className="section-title">Recent changes</h2>
                      <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
                        Review the latest edits to your menu.
                      </p>
                    </div>
                    <div id="recent-changes-list" className="recent-changes-list">
                      {recentChangesLoading ? (
                        <div className="loading-state" style={{ padding: 20, textAlign: "center" }}>
                          <div className="spinner" style={{ width: 24, height: 24, margin: "0 auto 8px" }} />
                          <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
                            Loading...
                          </p>
                        </div>
                      ) : parsedChangeLogs.length === 0 ? (
                        <div className="no-changes-message">No changes recorded yet</div>
                      ) : (
                        parsedChangeLogs.map((entry) => (
                          <div className="recent-change-item" key={entry.id}>
                            <div className="recent-change-header">
                              <span className="recent-change-author">{entry.author}</span>
                              <span className="recent-change-time">{entry.timestamp}</span>
                            </div>
                            <div className="recent-change-details">
                              {entry.hasDetails ? (
                                <>
                                  {entry.dishChanges.map((dish) => (
                                    <div key={`${entry.id}-${dish.dishName}`}>
                                      <div className="recent-change-dish">{dish.dishName}</div>
                                      {dish.lines.length ? (
                                        <ul className="recent-change-list">
                                          {dish.lines.map((line, index) => (
                                            <li key={`${entry.id}-${dish.dishName}-${index}`}>{line}</li>
                                          ))}
                                        </ul>
                                      ) : null}
                                    </div>
                                  ))}
                                  {entry.generalChanges.length ? (
                                    <div className="recent-change-general">
                                      <ul className="recent-change-list">
                                        {entry.generalChanges.map((line, index) => (
                                          <li key={`${entry.id}-general-${index}`}>{line}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                </>
                              ) : (
                                <span style={{ color: "var(--muted)" }}>Menu updated</span>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    <button
                      className="btn"
                      id="viewFullLogBtn"
                      style={{ width: "100%", marginTop: 16 }}
                      onClick={onViewFullLog}
                    >
                      View full change log
                    </button>
                  </div>

                  <div className="dashboard-panel">
                    <div className="section-header">
                      <h2 className="section-title brand-items-title">Brand items in use</h2>
                    </div>
                    <div className="brand-items-search">
                      <input
                        id="brand-items-search"
                        className="brand-search-input"
                        type="search"
                        placeholder="Search brand items..."
                        value={brandSearchQuery}
                        onChange={(event) => setBrandSearchQuery(event.target.value)}
                      />
                    </div>
                    <div id="brand-items-list" className="brand-items-list">
                      {!currentRestaurantData ? (
                        <div className="chat-preview-empty">Select a restaurant to view brand items.</div>
                      ) : !brandItems.length ? (
                        <div className="chat-preview-empty">No brand items found yet.</div>
                      ) : !filteredBrandItems.length ? (
                        <div className="chat-preview-empty">No brand items match your search.</div>
                      ) : (
                        filteredBrandItems.map((item) => {
                          const isExpanded = Boolean(expandedBrandKeys[item.key]);
                          return (
                            <div
                              key={item.key}
                              className="brand-item-card"
                              data-expanded={isExpanded ? "true" : "false"}
                            >
                              <div className="brand-item-summary">
                                <img
                                  className="brand-item-thumb"
                                  src={
                                    item.brandImage ||
                                    "https://static.wixstatic.com/media/945e9d_2b97098295d341d493e4a07d80d6b57c~mv2.png"
                                  }
                                  alt={item.brandName}
                                />
                                <div className="brand-item-meta">
                                  <p className="brand-item-name">{item.brandName}</p>
                                  <div className="brand-item-subtitle">
                                    {item.ingredientNames.length
                                      ? `Ingredients: ${item.ingredientNames.join(", ")}`
                                      : "Ingredient details unavailable"}
                                  </div>
                                  <div className="brand-item-subtitle">
                                    {item.dishes.length} dish{item.dishes.length === 1 ? "" : "es"}
                                  </div>
                                </div>
                              </div>

                              <div className="brand-item-details">
                                <div className="brand-item-details-row">
                                  <div>
                                    <div className="brand-item-subtitle" style={{ marginBottom: 6 }}>
                                      Allergens
                                    </div>
                                    <div className="brand-item-tags">
                                      {item.allergens.length ? (
                                        item.allergens.map((allergen) => (
                                          <span className="brand-tag" key={`${item.key}-allergen-${allergen}`}>
                                            {allergen}
                                          </span>
                                        ))
                                      ) : (
                                        <span className="brand-tag" style={{ opacity: 0.7 }}>
                                          No allergens listed
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="brand-item-subtitle" style={{ marginBottom: 6 }}>
                                      Diets
                                    </div>
                                    <div className="brand-item-tags">
                                      {item.diets.length ? (
                                        item.diets.map((diet) => (
                                          <span className="brand-tag" key={`${item.key}-diet-${diet}`}>
                                            {diet}
                                          </span>
                                        ))
                                      ) : (
                                        <span className="brand-tag" style={{ opacity: 0.7 }}>
                                          No diets listed
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <div>
                                  <div className="brand-item-subtitle" style={{ marginBottom: 6 }}>
                                    Dishes using this item
                                  </div>
                                  <div className="brand-item-dish-list">
                                    {item.dishes.length ? (
                                      item.dishes.map((dishName) => {
                                        const ingredientForDish =
                                          item.dishIngredients?.[dishName]?.[0] || "";
                                        return (
                                          <div className="brand-item-dish-entry" key={`${item.key}-${dishName}`}>
                                            <span className="brand-tag brand-item-dish-name">
                                              {dishName}
                                            </span>
                                            <button
                                              className="btn brand-item-dish-link"
                                              type="button"
                                              onClick={() =>
                                                onOpenDishEditor(dishName, ingredientForDish)
                                              }
                                            >
                                              Open ↗
                                            </button>
                                          </div>
                                        );
                                      })
                                    ) : (
                                      <div className="brand-item-empty">No dishes listed</div>
                                    )}
                                  </div>
                                </div>
                                <div className="brand-item-actions">
                                  <button
                                    className="btn btnPrimary"
                                    type="button"
                                    disabled={isReplacingBrand}
                                    onClick={() => onReplaceBrand(item)}
                                  >
                                    {isReplacingBrand ? "Working..." : "Replace item"}
                                  </button>
                                </div>
                              </div>

                              <button
                                className="btn brand-item-more"
                                type="button"
                                onClick={() => onToggleBrandItem(item.key)}
                              >
                                {isExpanded ? "Minimize" : "More options"}
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="section">
                <div className="section-header">
                  <h2 className="section-title">Menu Interest Heatmap</h2>
                  <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
                    Click on a dish to see detailed analytics
                  </p>
                </div>

                <div className="heatmap-controls">
                  <div className="heatmap-metric-toggle">
                    <span className="heatmap-metric-label">Categorize interest by:</span>
                    <div className="heatmap-metric-buttons">
                      {[
                        { id: "views", label: "Total views" },
                        { id: "loves", label: "Total loves" },
                        { id: "orders", label: "Total orders" },
                        { id: "requests", label: "Total requests" },
                        {
                          id: "accommodation",
                          label: "Proportion of views safe/accommodable",
                        },
                      ].map((metric) => (
                        <button
                          key={metric.id}
                          className={`heatmap-metric-btn${
                            heatmapMetric === metric.id ? " active" : ""
                          }`}
                          type="button"
                          onClick={() => setHeatmapMetric(metric.id)}
                        >
                          {metric.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="heatmap-legend">
                    <div className="heatmap-legend-gradient">
                      <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Low</span>
                      <div className="heatmap-gradient-bar" />
                      <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>High</span>
                    </div>
                  </div>
                </div>

                <div className="menu-heatmap-container" id="menu-heatmap-container">
                  {!menuImages.length || !allOverlays.length ? (
                    <div id="menu-heatmap-empty" className="no-menu-image">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                      <p>No menu image available for this restaurant</p>
                    </div>
                  ) : (
                    <div id="menu-heatmap-content" style={{ display: "flex" }}>
                      <div className="menu-heatmap-inner" id="menu-heatmap-inner">
                        <img
                          id="menu-heatmap-img"
                          className="menu-heatmap-img"
                          src={menuImages[heatmapPage]}
                          alt="Menu"
                        />
                        <div className="menu-heatmap-overlays" id="menu-heatmap-overlays">
                          {pageOverlays.map((overlay, index) => {
                            const dishName = getOverlayDishName(overlay, index);
                            const dishKey = normalizeDishKey(dishName);
                            const metricValue = metricByDish[dishKey] || 0;

                            const normalizedValue =
                              metricBounds.max > metricBounds.min
                                ? (metricValue - metricBounds.min) /
                                  (metricBounds.max - metricBounds.min)
                                : 0.5;

                            const color = getHeatmapColor(normalizedValue);
                            const width = overlay.w ?? overlay.width ?? 10;
                            const height = overlay.h ?? overlay.height ?? 10;

                            return (
                              <button
                                key={`${dishName}-${index}`}
                                type="button"
                                className="heatmap-overlay"
                                style={{
                                  left: `${overlay.x || 0}%`,
                                  top: `${overlay.y || 0}%`,
                                  width: `${width}%`,
                                  height: `${height}%`,
                                  background: color,
                                  borderColor: color,
                                }}
                                onClick={() => setActiveDishName(dishName)}
                              >
                                <span className="view-count">
                                  {metricValue} {heatmapMetricLabel}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div
                        className="heatmap-page-nav"
                        id="heatmap-page-nav"
                        style={{ display: menuImages.length > 1 ? "flex" : "none" }}
                      >
                        <button
                          className="heatmap-page-btn"
                          id="heatmap-prev-btn"
                          disabled={heatmapPage <= 0}
                          type="button"
                          onClick={() => setHeatmapPage((current) => Math.max(0, current - 1))}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M15 18l-6-6 6-6" />
                          </svg>
                        </button>
                        <span className="heatmap-page-indicator" id="heatmap-page-indicator">
                          Page {heatmapPage + 1} of {menuImages.length}
                        </span>
                        <button
                          className="heatmap-page-btn"
                          id="heatmap-next-btn"
                          disabled={heatmapPage >= menuImages.length - 1}
                          type="button"
                          onClick={() =>
                            setHeatmapPage((current) =>
                              Math.min(menuImages.length - 1, current + 1),
                            )
                          }
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M9 18l6-6-6-6" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {accommodationBreakdown ? (
                  <div
                    className="menu-accommodation-breakdown"
                    id="menu-accommodation-breakdown"
                    style={{ display: "block" }}
                  >
                    <h3
                      style={{
                        fontSize: "1rem",
                        fontWeight: 600,
                        color: "var(--ink)",
                        margin: "16px 0 8px 0",
                      }}
                    >
                      Menu Accommodation Breakdown
                    </h3>
                    <div className="menu-accommodation-legend">
                      <span className="legend-item">
                        <span className="legend-color" style={{ background: "#22c55e" }} /> Safe
                      </span>
                      <span className="legend-item">
                        <span className="legend-color" style={{ background: "#facc15" }} /> Needs accommodation
                      </span>
                      <span className="legend-item">
                        <span className="legend-color" style={{ background: "#ef4444" }} /> Cannot accommodate
                      </span>
                    </div>

                    <div id="menu-allergen-breakdown" style={{ marginBottom: 16 }}>
                      {accommodationBreakdown.relevantAllergens.length ? (
                        <>
                          <div className="menu-accommodation-header">
                            <span className="menu-accommodation-label">Allergens</span>
                            <div className="menu-accommodation-header-col">
                              <div className="info-tooltip-container" style={{ justifyContent: "center" }}>
                                <span className="menu-accommodation-title">Menu Coverage</span>
                                <button
                                  className="info-tooltip-btn"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setActiveTooltipId((current) =>
                                      current === "menu-coverage" ? "" : "menu-coverage",
                                    );
                                  }}
                                >
                                  ?
                                </button>
                                <div
                                  className={`info-tooltip-popup${
                                    activeTooltipId === "menu-coverage" ? " active" : ""
                                  }`}
                                >
                                  Proportion of dishes not containing the allergen 🟢,
                                  containing but can be accommodated 🟡, or containing and can't be
                                  accommodated 🔴.
                                </div>
                              </div>
                              <div className="menu-accommodation-subtitle">Share of dishes</div>
                            </div>
                            <div className="menu-accommodation-header-col">
                              <div className="info-tooltip-container" style={{ justifyContent: "center" }}>
                                <span className="menu-accommodation-title">Viewer Restrictions</span>
                                <button
                                  className="info-tooltip-btn"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setActiveTooltipId((current) =>
                                      current === "viewer-restrictions" ? "" : "viewer-restrictions",
                                    );
                                  }}
                                >
                                  ?
                                </button>
                                <div
                                  className={`info-tooltip-popup${
                                    activeTooltipId === "viewer-restrictions" ? " active" : ""
                                  }`}
                                >
                                  Proportion of views where the allergen/diet is safe 🟢,
                                  conflicts but can be accommodated 🟡, or conflicts and cannot be
                                  accommodated 🔴 for that user.
                                </div>
                              </div>
                              <div className="menu-accommodation-subtitle">Share of views</div>
                            </div>
                          </div>
                          <div className="menu-accommodation-divider" />
                          {accommodationBreakdown.relevantAllergens.map((allergen) => (
                            <div
                              key={`allergen-${allergen}`}
                              style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}
                            >
                              <span
                                style={{
                                  fontSize: "0.75rem",
                                  width: 90,
                                  minWidth: 90,
                                  textAlign: "right",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {ALLERGEN_EMOJI[allergen] || "⚠️"} {formatAllergenLabel(allergen)}
                              </span>
                              <div style={{ flex: 1, display: "flex", gap: 8 }}>
                                <SegmentedBar
                                  safe={accommodationBreakdown.allergenDishStats[allergen].safe}
                                  accommodated={accommodationBreakdown.allergenDishStats[allergen].accommodated}
                                  cannot={accommodationBreakdown.allergenDishStats[allergen].cannot}
                                  total={accommodationBreakdown.totalDishes}
                                />
                              </div>
                              <div style={{ flex: 1, display: "flex", gap: 8 }}>
                                <SegmentedBar
                                  safe={accommodationBreakdown.allergenViewStats[allergen].noConflict}
                                  accommodated={accommodationBreakdown.allergenViewStats[allergen].accommodated}
                                  cannot={accommodationBreakdown.allergenViewStats[allergen].cannot}
                                  total={accommodationBreakdown.totalViews}
                                />
                              </div>
                            </div>
                          ))}
                        </>
                      ) : (
                        <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                          No allergen data available.
                        </p>
                      )}
                    </div>

                    <div id="menu-diet-breakdown">
                      {accommodationBreakdown.relevantDiets.length ? (
                        <>
                          <div className="menu-accommodation-header spaced">
                            <span className="menu-accommodation-label">Diets</span>
                            <div className="menu-accommodation-header-col" />
                            <div className="menu-accommodation-header-col" />
                          </div>
                          <div className="menu-accommodation-divider" />
                          {accommodationBreakdown.relevantDiets.map((diet) => (
                            <div
                              key={`diet-${diet}`}
                              style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}
                            >
                              <span
                                style={{
                                  fontSize: "0.75rem",
                                  width: 90,
                                  minWidth: 90,
                                  textAlign: "right",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {DIET_EMOJI[diet] || "🍽️"} {diet}
                              </span>
                              <div style={{ flex: 1, display: "flex", gap: 8 }}>
                                <SegmentedBar
                                  safe={accommodationBreakdown.dietDishStats[diet].safe}
                                  accommodated={0}
                                  cannot={accommodationBreakdown.dietDishStats[diet].cannot}
                                  total={accommodationBreakdown.totalDishes}
                                />
                              </div>
                              <div style={{ flex: 1, display: "flex", gap: 8 }}>
                                <SegmentedBar
                                  safe={accommodationBreakdown.dietViewStats[diet].noConflict}
                                  accommodated={0}
                                  cannot={accommodationBreakdown.dietViewStats[diet].cannot}
                                  total={accommodationBreakdown.totalViews}
                                />
                              </div>
                            </div>
                          ))}
                        </>
                      ) : (
                        <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                          No diet data available.
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              {userDietaryBreakdown ? (
                <div className="section" id="user-dietary-profile-section" style={{ display: "block" }}>
                  <div className="section-header">
                    <h2 className="section-title">User Dietary Profile Breakdown</h2>
                  </div>
                  <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: 16 }}>
                    Distribution of allergens and diets among users who viewed this menu.
                  </p>
                  <div
                    style={{
                      display: "flex",
                      gap: 32,
                      flexWrap: "wrap",
                      justifyContent: "center",
                    }}
                  >
                    <div id="user-allergen-pie" style={{ flex: 1, minWidth: 280, maxWidth: 400 }}>
                      <PieChartPanel
                        title="User Allergens"
                        data={userDietaryBreakdown.allergenData}
                        uniqueUserCount={userDietaryBreakdown.uniqueUserCount}
                      />
                    </div>
                    <div id="user-diet-pie" style={{ flex: 1, minWidth: 280, maxWidth: 400 }}>
                      <PieChartPanel
                        title="User Diets"
                        data={userDietaryBreakdown.dietData}
                        uniqueUserCount={userDietaryBreakdown.uniqueUserCount}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
      <div
        className={`response-modal${activeRequestAction ? " show" : ""}`}
        id="response-modal"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            closeRequestActionModal();
          }
        }}
      >
        {activeRequestAction ? (
          <div className="response-modal-content">
            <h3 id="modal-title">{activeRequestActionConfig?.title || "Respond to Request"}</h3>
            <p id="modal-dish" style={{ color: "var(--muted)", marginBottom: 16 }}>
              Dish: {activeRequestAction.dishName}
            </p>
            <textarea
              id="response-text"
              placeholder="Add a response message (optional)..."
              value={requestResponseText}
              onChange={(event) => setRequestResponseText(event.target.value)}
              disabled={isUpdatingRequest}
            />
            <div className="modal-actions">
              <button
                className="action-btn"
                id="modal-cancel"
                type="button"
                onClick={closeRequestActionModal}
                disabled={isUpdatingRequest}
              >
                Cancel
              </button>
              <button
                className={`action-btn ${activeRequestActionConfig?.buttonClass || "primary"}`}
                id="modal-implement"
                type="button"
                onClick={submitRequestAction}
                disabled={isUpdatingRequest}
              >
                {isUpdatingRequest
                  ? "Updating..."
                  : activeRequestActionConfig?.buttonLabel || "Submit"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div
        className={`dish-analytics-modal${dishModalData ? " show" : ""}`}
        id="dish-analytics-modal"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setActiveDishName("");
          }
        }}
      >
        {dishModalData ? (
          <div className="dish-analytics-content">
            <div className="dish-analytics-header">
              <h3 id="dish-analytics-title">{dishModalData.dishName}</h3>
              <button
                className="dish-analytics-close"
                id="dish-analytics-close"
                type="button"
                onClick={() => setActiveDishName("")}
              >
                &times;
              </button>
            </div>

            {dishModalData.cannotAccommodateAllergens.length ||
            dishModalData.cannotAccommodateDiets.length ? (
              <div id="cannot-accommodate-row" className="accommodation-row cannot">
                <span className="accommodation-label">Cannot be accommodated:</span>
                <div id="cannot-accommodate-tags" className="accommodation-tags">
                  {dishModalData.cannotAccommodateAllergens.map((allergen) => (
                    <span className="accommodation-tag" key={`cannot-allergen-${allergen}`}>
                      {ALLERGEN_EMOJI[allergen] || "⚠️"} {formatAllergenLabel(allergen)}
                    </span>
                  ))}
                  {dishModalData.cannotAccommodateDiets.map((diet) => (
                    <span className="accommodation-tag" key={`cannot-diet-${diet}`}>
                      {DIET_EMOJI[diet] || "🍽️"} {diet}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {dishModalData.canAccommodateAllergens.length ? (
              <div id="can-accommodate-row" className="accommodation-row can">
                <span className="accommodation-label">Can be accommodated:</span>
                <div id="can-accommodate-tags" className="accommodation-tags">
                  {dishModalData.canAccommodateAllergens.map((allergen) => (
                    <span className="accommodation-tag" key={`can-allergen-${allergen}`}>
                      {ALLERGEN_EMOJI[allergen] || "⚠️"} {formatAllergenLabel(allergen)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="analytics-section" style={{ marginTop: 16 }}>
              <div className="analytics-section-title">Dish Interest Summary</div>
              <div className="stacked-bar-chart" id="analytics-stacked-chart">
                <div className="chart-comparison-group">
                  <div className="chart-group-title">Total Views</div>
                  <div className="chart-group-bars">
                    <ViewsDistributionRow
                      label="This Dish"
                      value={dishModalData.views.total}
                      maxValue={Math.max(
                        dishModalData.views.total,
                        dishModalData.averages.views,
                        1,
                      )}
                    />
                    <ViewsDistributionRow
                      label="Menu Avg"
                      value={dishModalData.averages.views}
                      maxValue={Math.max(
                        dishModalData.views.total,
                        dishModalData.averages.views,
                        1,
                      )}
                      isAverage
                    />
                  </div>
                </div>
                <div className="chart-comparison-group">
                  <div className="chart-group-title">Status Distribution</div>
                  <div className="chart-group-bars">
                    <StatusDistributionRow
                      label="This Dish"
                      safe={dishModalData.views.safe}
                      removable={dishModalData.views.removable}
                      unsafe={dishModalData.views.unsafe}
                      total={dishModalData.views.total}
                    />
                    <StatusDistributionRow
                      label="Menu Avg"
                      safe={dishModalData.averages.safe}
                      removable={dishModalData.averages.removable}
                      unsafe={dishModalData.averages.unsafe}
                      total={dishModalData.averages.total}
                      isAverage
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="analytics-section" style={{ marginTop: 16 }} id="conflict-breakdown-section">
              <div className="analytics-section-title">Views by Conflicting Restriction</div>
              <div className="conflict-charts-container">
                <div className="conflict-chart">
                  <div className="conflict-chart-title">Allergens</div>
                  <div className="conflict-bars" id="conflict-allergen-bars">
                    {Object.keys(dishModalData.allergenConflictCounts).length ? (
                      Object.entries(dishModalData.allergenConflictCounts)
                        .sort((a, b) => b[1] - a[1])
                        .map(([allergen, count]) => {
                          const width = (count / dishModalData.maxConflict) * 100;
                          const fillColor = dishModalData.canAccommodateAllergens.includes(allergen)
                            ? "#facc15"
                            : "#ef4444";
                          return (
                            <div className="conflict-bar-row" key={`allergen-conflict-${allergen}`}>
                              <span className="conflict-bar-label">
                                {ALLERGEN_EMOJI[allergen] || "⚠️"} {formatAllergenLabel(allergen)}
                              </span>
                              <div className="conflict-bar-track">
                                <div
                                  className="conflict-bar-fill"
                                  style={{ width: `${width}%`, background: fillColor }}
                                />
                              </div>
                              <span className="conflict-bar-value">{count}</span>
                            </div>
                          );
                        })
                    ) : (
                      <div className="conflict-no-data">No allergen conflicts</div>
                    )}
                  </div>
                </div>

                <div className="conflict-chart">
                  <div className="conflict-chart-title">Diets</div>
                  <div className="conflict-bars" id="conflict-diet-bars">
                    {Object.keys(dishModalData.dietConflictCounts).length ? (
                      Object.entries(dishModalData.dietConflictCounts)
                        .sort((a, b) => b[1] - a[1])
                        .map(([diet, count]) => (
                          <div className="conflict-bar-row" key={`diet-conflict-${diet}`}>
                            <span className="conflict-bar-label">
                              {DIET_EMOJI[diet] || "🍽️"} {diet}
                            </span>
                            <div className="conflict-bar-track">
                              <div
                                className="conflict-bar-fill"
                                style={{ width: `${(count / dishModalData.maxConflict) * 100}%` }}
                              />
                            </div>
                            <span className="conflict-bar-value">{count}</span>
                          </div>
                        ))
                    ) : (
                      <div className="conflict-no-data">No diet conflicts</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="stacked-bar-legend" style={{ marginTop: 12 }}>
                <span className="legend-item">
                  <span className="legend-color" style={{ background: "#22c55e" }} /> Safe
                </span>
                <span className="legend-item">
                  <span className="legend-color" style={{ background: "#facc15" }} /> Can be accommodated
                </span>
                <span className="legend-item">
                  <span className="legend-color" style={{ background: "#ef4444" }} /> Cannot be accommodated
                </span>
              </div>
            </div>

            <div className="analytics-section" style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
                  Accommodation Requests:
                </span>
                <span id="analytics-requests" style={{ fontWeight: 600, color: "var(--ink)" }}>
                  {dishModalData.requestsCount}
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
