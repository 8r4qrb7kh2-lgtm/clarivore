"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SimpleTopbar from "../../components/SimpleTopbar";
import { notifyManagerChat } from "../../lib/chatNotifications";
import { loadScript } from "../../runtime/scriptLoader";
import { supabaseClient as supabase } from "../../lib/supabase";

const CHAT_PREVIEW_LIMIT = 3;
const CHAT_THREAD_LIMIT = 50;
const APPEALS_CACHE_WINDOW_MS = 30_000;
const ADMIN_DISPLAY_NAME = "Matt D (clarivore administrator)";

const TAB_ROUTES = [
  { id: "restaurants", label: "Restaurants" },
  { id: "managers", label: "Managers" },
  { id: "appeals", label: "Appeals Review" },
  { id: "feedback", label: "Anonymous Feedback" },
  { id: "product-reports", label: "📋 Issue Reports" },
];

function slugifyName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function toDateLabel(value) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleString();
}

function generateToken(length = 32) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const cryptoApi = typeof window !== "undefined" ? window.crypto : null;

  if (cryptoApi?.getRandomValues) {
    let token = "";
    const randomValues = new Uint32Array(length);
    cryptoApi.getRandomValues(randomValues);
    for (let index = 0; index < length; index += 1) {
      token += chars[randomValues[index] % chars.length];
    }
    return token;
  }

  let fallbackToken = "";
  for (let index = 0; index < length; index += 1) {
    fallbackToken += chars[Math.floor(Math.random() * chars.length)];
  }
  return fallbackToken;
}

function getInviteUrl(token, entryPage) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  if (entryPage?.startsWith("restaurant:")) {
    const slug = entryPage.replace("restaurant:", "");
    return `${origin}/restaurant?slug=${encodeURIComponent(slug)}&qr=1&invite=${token}`;
  }
  return `${origin}/account?invite=${token}`;
}

function parseChatMessage(text) {
  const raw = String(text || "");
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)/g;
  const tokens = [];
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", value: raw.slice(lastIndex, match.index) });
    }
    if (match[1] && match[2]) {
      tokens.push({ type: "link", value: match[2], label: match[1] });
    } else if (match[3]) {
      tokens.push({ type: "link", value: match[3], label: match[3] });
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < raw.length) {
    tokens.push({ type: "text", value: raw.slice(lastIndex) });
  }

  if (!tokens.length) {
    return [{ type: "text", value: raw }];
  }
  return tokens;
}

function buildAppealDetailsLink(appeal) {
  const slug = appeal?.restaurants?.slug || "";
  if (!slug) return "";

  try {
    const url = new URL("/restaurant", window.location.origin);
    url.searchParams.set("slug", slug);
    url.searchParams.set("edit", "1");

    const dishName = String(appeal?.dish_name || "").trim();
    if (dishName) {
      url.searchParams.set("openAI", "true");
      url.searchParams.set("dishName", dishName);
    }

    const ingredientName = String(appeal?.ingredient_name || "").trim();
    if (ingredientName) {
      url.searchParams.set("ingredientName", ingredientName);
    }

    return url.toString();
  } catch {
    return `/restaurant?slug=${encodeURIComponent(slug)}&edit=1`;
  }
}

async function compressImage(dataUrl, maxWidth = 1200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      let width = image.width;
      let height = image.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Unable to create image context."));
        return;
      }

      context.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };

    image.onerror = () => reject(new Error("Failed to load selected image."));
    image.src = dataUrl;
  });
}

async function readAndCompressImage(file) {
  if (!file) return "";
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(String(event?.target?.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });

  if (!dataUrl) return "";
  return compressImage(dataUrl);
}

function getRestaurantAcknowledgementName(messages, restaurantName) {
  const lastRestaurant = [...messages]
    .reverse()
    .find((message) => message.sender_role === "restaurant" && message.sender_name);
  return lastRestaurant?.sender_name || restaurantName || "Restaurant";
}

function resolveAckIndex(messages, targetRole, acknowledgedAt) {
  if (!acknowledgedAt) return -1;
  const acknowledgedMs = new Date(acknowledgedAt).getTime();
  if (Number.isNaN(acknowledgedMs)) return -1;

  let index = -1;
  messages.forEach((message, messageIndex) => {
    if (message.sender_role !== targetRole) return;
    const messageMs = new Date(message.created_at).getTime();
    if (!Number.isNaN(messageMs) && messageMs <= acknowledgedMs) {
      index = messageIndex;
    }
  });

  return index;
}

function MessageText({ text }) {
  const tokens = useMemo(() => parseChatMessage(text), [text]);

  return (
    <>
      {tokens.map((token, index) => {
        if (token.type === "link") {
          return (
            <a
              key={`${token.value}-${index}`}
              href={token.value}
              target="_blank"
              rel="noopener noreferrer"
            >
              {token.label}
            </a>
          );
        }
        return <span key={`${token.value}-${index}`}>{token.value}</span>;
      })}
    </>
  );
}

function ChatThread({
  restaurantId,
  restaurantName,
  messages,
  unreadCount,
  isOpen,
  loading,
  sending,
  inputValue,
  readState,
  onToggle,
  onInputChange,
  onSend,
  onAcknowledge,
}) {
  const ackEntries = useMemo(() => {
    if (!messages?.length) return [];

    const entries = [];
    if (readState?.admin?.acknowledged_at) {
      const index = resolveAckIndex(messages, "restaurant", readState.admin.acknowledged_at);
      if (index >= 0) {
        entries.push({
          index,
          name: ADMIN_DISPLAY_NAME,
          acknowledgedAt: readState.admin.acknowledged_at,
        });
      }
    }

    if (readState?.restaurant?.acknowledged_at) {
      const index = resolveAckIndex(messages, "admin", readState.restaurant.acknowledged_at);
      if (index >= 0) {
        entries.push({
          index,
          name: getRestaurantAcknowledgementName(messages, restaurantName),
          acknowledgedAt: readState.restaurant.acknowledged_at,
        });
      }
    }

    return entries;
  }, [messages, readState, restaurantName]);

  const hasMessages = Array.isArray(messages) && messages.length > 0;
  if (!hasMessages && unreadCount <= 0) return null;

  return (
    <details className="restaurant-chat-preview" open={isOpen}>
      <summary
        onClick={(event) => {
          event.preventDefault();
          onToggle?.(!isOpen);
        }}
      >
        Direct chat preview
      </summary>
      <div className="restaurant-chat-body">
        <div className="restaurant-chat-messages">
          {loading ? (
            <div className="restaurant-chat-empty">Loading chat...</div>
          ) : !hasMessages ? (
            <div className="restaurant-chat-empty">No messages yet.</div>
          ) : (
            messages.map((message, index) => {
              const isOutgoing = message.sender_role === "admin";
              const sender =
                message.sender_name ||
                (isOutgoing ? ADMIN_DISPLAY_NAME : restaurantName || "Restaurant");
              const createdAt = message.created_at
                ? new Date(message.created_at).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : "";
              const messageAcks = ackEntries.filter((entry) => entry.index === index);

              return (
                <div key={message.id || `${restaurantId}-${index}`}>
                  <div
                    className={`restaurant-chat-message ${
                      isOutgoing ? "chat-outgoing" : "chat-incoming"
                    }`}
                  >
                    <div className="restaurant-chat-bubble">
                      <div className="restaurant-chat-text">
                        <MessageText text={message.message} />
                      </div>
                      <div className="restaurant-chat-meta">
                        {sender}
                        {createdAt ? ` · ${createdAt}` : ""}
                      </div>
                    </div>
                  </div>
                  {messageAcks.map((entry) => (
                    <div
                      key={`${entry.name}-${entry.acknowledgedAt}`}
                      className="chat-ack"
                    >
                      {entry.name} acknowledged ·{" "}
                      {new Date(entry.acknowledgedAt).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>

        <div className="restaurant-chat-compose">
          <input
            className="restaurant-chat-input"
            type="text"
            placeholder={`Message ${restaurantName}`}
            value={inputValue}
            onChange={(event) => onInputChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend?.();
              }
            }}
            disabled={sending}
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={onSend}
            disabled={sending}
          >
            {sending ? "Sending..." : "Send"}
          </button>
          <button
            type="button"
            className="btn-warning acknowledge-btn"
            onClick={onAcknowledge}
            style={{ display: unreadCount > 0 ? "inline-flex" : "none" }}
          >
            Acknowledge
          </button>
        </div>
      </div>
    </details>
  );
}

export default function AdminDashboardDom({
  user,
  isAdmin = false,
  isBooting = false,
  onSignOut,
}) {
  const [activeTab, setActiveTab] = useState("restaurants");

  const [allRestaurants, setAllRestaurants] = useState([]);
  const [restaurantsLoading, setRestaurantsLoading] = useState(false);
  const [selectedRestaurantId, setSelectedRestaurantId] = useState("all");

  const [statusMessage, setStatusMessage] = useState({ text: "", tone: "" });
  const statusTimeoutRef = useRef(null);

  const [restaurantName, setRestaurantName] = useState("");
  const [restaurantWebsite, setRestaurantWebsite] = useState("");
  const [restaurantDescription, setRestaurantDescription] = useState("");
  const [menuImagePreview, setMenuImagePreview] = useState("");
  const [imageProcessing, setImageProcessing] = useState(false);
  const [creatingRestaurant, setCreatingRestaurant] = useState(false);

  const [chatThreadsByRestaurant, setChatThreadsByRestaurant] = useState({});
  const [chatUnreadByRestaurant, setChatUnreadByRestaurant] = useState({});
  const [chatReadStatesByRestaurant, setChatReadStatesByRestaurant] = useState({});
  const [chatOpenByRestaurant, setChatOpenByRestaurant] = useState({});
  const [chatInputsByRestaurant, setChatInputsByRestaurant] = useState({});
  const [chatLoadingByRestaurant, setChatLoadingByRestaurant] = useState({});
  const [chatSendingByRestaurant, setChatSendingByRestaurant] = useState({});

  const [managerAccessRestaurants, setManagerAccessRestaurants] = useState([]);
  const [managerAccessLoaded, setManagerAccessLoaded] = useState(false);
  const [managerAccessLoading, setManagerAccessLoading] = useState(false);
  const [managerInviteLinks, setManagerInviteLinks] = useState({});
  const [inviteBusyByRestaurant, setInviteBusyByRestaurant] = useState({});

  const [allAppeals, setAllAppeals] = useState([]);
  const [appealsLoadedAt, setAppealsLoadedAt] = useState(0);
  const [appealFilter, setAppealFilter] = useState("all");
  const [appealsLoading, setAppealsLoading] = useState(false);
  const [appealNotesById, setAppealNotesById] = useState({});
  const [appealBusyId, setAppealBusyId] = useState("");

  const [allFeedback, setAllFeedback] = useState([]);
  const [feedbackLoaded, setFeedbackLoaded] = useState(false);
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  const [allReports, setAllReports] = useState([]);
  const [reportsLoaded, setReportsLoaded] = useState(false);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportFilter, setReportFilter] = useState("all");
  const [reportNotesById, setReportNotesById] = useState({});
  const [reportBusyId, setReportBusyId] = useState("");

  const [photoModalUrl, setPhotoModalUrl] = useState("");
  const currentUser = user || null;

  const showStatus = useCallback((text, tone = "success") => {
    setStatusMessage({ text, tone });
    if (statusTimeoutRef.current) {
      window.clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = null;
    }
    if (!text) return;
    statusTimeoutRef.current = window.setTimeout(() => {
      setStatusMessage((current) =>
        current.text === text ? { text: "", tone: "" } : current,
      );
      statusTimeoutRef.current = null;
    }, 5000);
  }, []);

  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) {
        window.clearTimeout(statusTimeoutRef.current);
      }
    };
  }, []);

  const selectedRestaurant = useMemo(() => {
    if (!selectedRestaurantId || selectedRestaurantId === "all") return null;
    return allRestaurants.find((restaurant) => restaurant.id === selectedRestaurantId) || null;
  }, [allRestaurants, selectedRestaurantId]);

  const restaurantsForView = useMemo(() => {
    if (selectedRestaurant) {
      return allRestaurants.filter((restaurant) => restaurant.id === selectedRestaurant.id);
    }
    return allRestaurants;
  }, [allRestaurants, selectedRestaurant]);

  const loadRestaurants = useCallback(async () => {
    if (!supabase || !isAdmin) return;
    setRestaurantsLoading(true);
    try {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name, slug")
        .order("name");
      if (error) throw error;
      const list = Array.isArray(data) ? data : [];
      setAllRestaurants(list);
      setSelectedRestaurantId((current) => {
        if (current === "all") return "all";
        if (list.some((restaurant) => restaurant.id === current)) return current;
        return "all";
      });
    } catch (error) {
      console.error("[admin-dashboard-next] failed to load restaurants", error);
      showStatus(`Error loading restaurants: ${error.message}`, "error");
      setAllRestaurants([]);
    } finally {
      setRestaurantsLoading(false);
    }
  }, [isAdmin, showStatus]);

  const ensureQrLibrary = useCallback(async () => {
    if (typeof window === "undefined") return false;
    if (window.QRCode?.toCanvas) return true;
    await loadScript("https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js", {
      defer: true,
    });
    return Boolean(window.QRCode?.toCanvas);
  }, []);

  const generateAndDownloadQRCode = useCallback(async (slug) => {
    if (!slug) return;
    const hasQr = await ensureQrLibrary();
    if (!hasQr) return;

    const targetUrl = `https://clarivore.org/restaurant?slug=${encodeURIComponent(slug)}`;
    const canvas = document.createElement("canvas");
    await window.QRCode.toCanvas(canvas, targetUrl, {
      width: 512,
      margin: 2,
      color: {
        dark: "#1e3a5f",
        light: "#ffffff",
      },
    });

    await new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve();
          return;
        }

        const downloadUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = downloadUrl;
        anchor.download = `${slug}-qr-code.png`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(downloadUrl);
        resolve();
      }, "image/png");
    });
  }, [ensureQrLibrary]);

  const onMenuImageChange = useCallback(async (event) => {
    const file = event.target.files?.[0] || null;
    if (!file) {
      setMenuImagePreview("");
      return;
    }

    setImageProcessing(true);
    try {
      const compressed = await readAndCompressImage(file);
      setMenuImagePreview(compressed);
    } catch (error) {
      console.error("[admin-dashboard-next] image processing failed", error);
      showStatus(error.message || "Unable to process this image.", "error");
      setMenuImagePreview("");
    } finally {
      setImageProcessing(false);
    }
  }, [showStatus]);

  const onCreateRestaurant = useCallback(
    async (event) => {
      event.preventDefault();
      if (!supabase) return;

      const name = String(restaurantName || "").trim();
      if (!name) {
        showStatus("Restaurant name is required.", "error");
        return;
      }

      if (!menuImagePreview) {
        showStatus("Please select a menu image.", "error");
        return;
      }

      setCreatingRestaurant(true);
      try {
        const slug = slugifyName(name);
        const { data, error } = await supabase
          .from("restaurants")
          .insert({
            name,
            slug,
            menu_image: menuImagePreview,
            overlays: [],
            last_confirmed: null,
          })
          .select("id, slug")
          .single();

        if (error) throw error;

        const createdSlug = data?.slug || slug;
        showStatus(`Added ${name}. Downloading QR code...`, "success");

        try {
          await generateAndDownloadQRCode(createdSlug);
        } catch (qrError) {
          console.warn("[admin-dashboard-next] failed to generate QR code", qrError);
        }

        setRestaurantName("");
        setRestaurantWebsite("");
        setRestaurantDescription("");
        setMenuImagePreview("");
        await loadRestaurants();
      } catch (error) {
        console.error("[admin-dashboard-next] create restaurant failed", error);
        showStatus(`Error adding restaurant: ${error.message}`, "error");
      } finally {
        setCreatingRestaurant(false);
      }
    },
    [
      generateAndDownloadQRCode,
      loadRestaurants,
      menuImagePreview,
      restaurantName,
      showStatus,
    ],
  );

  const deleteRestaurant = useCallback(
    async (restaurantId, restaurantNameValue) => {
      if (!supabase || !restaurantId) return;
      const confirmed = window.confirm(
        `Delete "${restaurantNameValue}" from the website? This cannot be undone.`,
      );
      if (!confirmed) return;

      try {
        const { data, error } = await supabase
          .from("restaurants")
          .delete()
          .eq("id", restaurantId)
          .select("id");

        if (error) throw error;

        if (!data || data.length === 0) {
          showStatus(
            `Unable to delete ${restaurantNameValue}. Check permissions and try again.`,
            "error",
          );
          return;
        }

        showStatus(`Deleted ${restaurantNameValue}.`, "success");
        await loadRestaurants();
      } catch (error) {
        console.error("[admin-dashboard-next] delete restaurant failed", error);
        showStatus(`Error deleting restaurant: ${error.message}`, "error");
      }
    },
    [loadRestaurants, showStatus],
  );

  const getUnreadCount = useCallback(async (restaurantId, lastReadAt) => {
    if (!supabase || !restaurantId) return 0;

    try {
      let query = supabase
        .from("restaurant_direct_messages")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurantId)
        .eq("sender_role", "restaurant");

      if (lastReadAt) {
        query = query.gt("created_at", lastReadAt);
      }

      const { count, error } = await query;
      if (error) throw error;
      return count || 0;
    } catch (error) {
      console.error("[admin-dashboard-next] unread count failed", error);
      return 0;
    }
  }, []);

  const loadChatReadStates = useCallback(async (restaurantIds) => {
    if (!supabase || !Array.isArray(restaurantIds) || !restaurantIds.length) {
      return {};
    }

    const next = {};
    restaurantIds.forEach((id) => {
      next[id] = { admin: null, restaurant: null };
    });

    try {
      const { data, error } = await supabase
        .from("restaurant_direct_message_reads")
        .select("restaurant_id, reader_role, last_read_at, acknowledged_at")
        .in("reader_role", ["admin", "restaurant"])
        .in("restaurant_id", restaurantIds);
      if (error) throw error;

      (data || []).forEach((row) => {
        if (!next[row.restaurant_id]) {
          next[row.restaurant_id] = { admin: null, restaurant: null };
        }
        if (row.reader_role === "admin") {
          next[row.restaurant_id].admin = row;
        }
        if (row.reader_role === "restaurant") {
          next[row.restaurant_id].restaurant = row;
        }
      });
    } catch (error) {
      console.error("[admin-dashboard-next] failed to load chat read states", error);
    }

    return next;
  }, []);

  const loadChatThread = useCallback(
    async (restaurantId, restaurantName) => {
      if (!supabase || !restaurantId) return;
      setChatLoadingByRestaurant((current) => ({ ...current, [restaurantId]: true }));

      try {
        const { data, error } = await supabase
          .from("restaurant_direct_messages")
          .select("id, restaurant_id, message, sender_role, sender_name, created_at")
          .eq("restaurant_id", restaurantId)
          .order("created_at", { ascending: false })
          .limit(CHAT_THREAD_LIMIT);

        if (error) throw error;

        const messages = (Array.isArray(data) ? data : []).slice().reverse();
        const states = await loadChatReadStates([restaurantId]);
        const unread = await getUnreadCount(
          restaurantId,
          states[restaurantId]?.admin?.last_read_at,
        );

        setChatThreadsByRestaurant((current) => ({ ...current, [restaurantId]: messages }));
        setChatReadStatesByRestaurant((current) => ({
          ...current,
          [restaurantId]: states[restaurantId] || { admin: null, restaurant: null },
        }));
        setChatUnreadByRestaurant((current) => ({ ...current, [restaurantId]: unread }));
        setChatOpenByRestaurant((current) => ({ ...current, [restaurantId]: true }));
      } catch (error) {
        console.error("[admin-dashboard-next] failed to load chat thread", error);
        showStatus(`Unable to load chat for ${restaurantName}.`, "error");
        setChatThreadsByRestaurant((current) => ({ ...current, [restaurantId]: [] }));
      } finally {
        setChatLoadingByRestaurant((current) => ({ ...current, [restaurantId]: false }));
      }
    },
    [getUnreadCount, loadChatReadStates, showStatus],
  );

  const loadChatPreviews = useCallback(
    async (restaurants) => {
      if (!supabase || !Array.isArray(restaurants) || !restaurants.length) return;

      const restaurantIds = restaurants.map((restaurant) => restaurant.id).filter(Boolean);
      if (!restaurantIds.length) return;

      try {
        const { data, error } = await supabase
          .from("restaurant_direct_messages")
          .select("id, restaurant_id, message, sender_role, sender_name, created_at")
          .in("restaurant_id", restaurantIds)
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) throw error;

        const grouped = {};
        (Array.isArray(data) ? data : []).forEach((message) => {
          const restaurantId = message.restaurant_id;
          if (!restaurantId) return;
          if (!grouped[restaurantId]) grouped[restaurantId] = [];
          if (grouped[restaurantId].length < CHAT_PREVIEW_LIMIT) {
            grouped[restaurantId].push(message);
          }
        });

        const readStates = await loadChatReadStates(restaurantIds);
        const unreadEntries = await Promise.all(
          restaurantIds.map(async (restaurantId) => {
            const unreadCount = await getUnreadCount(
              restaurantId,
              readStates[restaurantId]?.admin?.last_read_at,
            );
            return [restaurantId, unreadCount];
          }),
        );

        setChatReadStatesByRestaurant((current) => ({ ...current, ...readStates }));
        setChatThreadsByRestaurant((current) => {
          const next = { ...current };
          restaurantIds.forEach((restaurantId) => {
            const preview = (grouped[restaurantId] || []).slice().reverse();
            if (!next[restaurantId] || !chatOpenByRestaurant[restaurantId]) {
              next[restaurantId] = preview;
            }
          });
          return next;
        });
        setChatUnreadByRestaurant((current) => {
          const next = { ...current };
          unreadEntries.forEach(([restaurantId, unreadCount]) => {
            next[restaurantId] = unreadCount;
          });
          return next;
        });
      } catch (error) {
        console.error("[admin-dashboard-next] failed to load chat previews", error);
      }
    },
    [chatOpenByRestaurant, getUnreadCount, loadChatReadStates],
  );

  const sendChatMessage = useCallback(
    async (restaurantId, restaurantName) => {
      if (!supabase || !restaurantId) return;
      const message = String(chatInputsByRestaurant[restaurantId] || "").trim();
      if (!message) return;

      setChatSendingByRestaurant((current) => ({ ...current, [restaurantId]: true }));
      try {
        const { data, error } = await supabase
          .from("restaurant_direct_messages")
          .insert({
            restaurant_id: restaurantId,
            message,
            sender_role: "admin",
            sender_name: ADMIN_DISPLAY_NAME,
            sender_id: user?.id || null,
          })
          .select("id")
          .single();

        if (error) throw error;

        setChatInputsByRestaurant((current) => ({ ...current, [restaurantId]: "" }));
        if (data?.id) {
          notifyManagerChat({ messageId: data.id, client: supabase });
        }
        await loadChatThread(restaurantId, restaurantName);
      } catch (error) {
        console.error("[admin-dashboard-next] failed to send chat", error);
        showStatus(`Error sending message: ${error.message}`, "error");
      } finally {
        setChatSendingByRestaurant((current) => ({ ...current, [restaurantId]: false }));
      }
    },
    [chatInputsByRestaurant, currentUser?.id, loadChatThread, showStatus],
  );

  const acknowledgeChat = useCallback(
    async (restaurantId, restaurantName) => {
      if (!supabase || !restaurantId) return;

      try {
        const now = new Date().toISOString();
        const { error } = await supabase
          .from("restaurant_direct_message_reads")
          .upsert(
            {
              restaurant_id: restaurantId,
              reader_role: "admin",
              last_read_at: now,
              acknowledged_at: now,
            },
            { onConflict: "restaurant_id,reader_role" },
          );

        if (error) throw error;

        setChatReadStatesByRestaurant((current) => ({
          ...current,
          [restaurantId]: {
            ...(current[restaurantId] || { admin: null, restaurant: null }),
            admin: {
              restaurant_id: restaurantId,
              reader_role: "admin",
              last_read_at: now,
              acknowledged_at: now,
            },
          },
        }));
        setChatUnreadByRestaurant((current) => ({ ...current, [restaurantId]: 0 }));
        await loadChatThread(restaurantId, restaurantName);
      } catch (error) {
        console.error("[admin-dashboard-next] failed to acknowledge chat", error);
        showStatus(`Error acknowledging chat: ${error.message}`, "error");
      }
    },
    [loadChatThread, showStatus],
  );

  const loadManagerAccess = useCallback(async () => {
    if (!supabase || !isAdmin) return;

    setManagerAccessLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-managers", {
        body: { action: "list" },
      });
      if (error) throw error;

      setManagerAccessRestaurants(data?.restaurants || []);
      setManagerAccessLoaded(true);
    } catch (error) {
      console.error("[admin-dashboard-next] failed to load manager access", error);
      showStatus(`Error loading manager access: ${error.message || error}`, "error");
      setManagerAccessRestaurants([]);
      setManagerAccessLoaded(true);
    } finally {
      setManagerAccessLoading(false);
    }
  }, [isAdmin, showStatus]);

  const createManagerInviteLink = useCallback(
    async (restaurantId) => {
      if (!supabase || !currentUser || !restaurantId) return;

      setInviteBusyByRestaurant((current) => ({ ...current, [restaurantId]: true }));
      try {
        const token = generateToken();
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
        const entryPage = "dashboard";

        const { error } = await supabase
          .from("manager_invites")
          .insert({
            token,
            restaurant_ids: [restaurantId],
            entry_page: entryPage,
            expires_at: expiresAt,
            created_by: currentUser.id,
          })
          .select("token")
          .single();

        if (error) throw error;

        const url = getInviteUrl(token, entryPage);
        setManagerInviteLinks((current) => ({ ...current, [restaurantId]: url }));
      } catch (error) {
        console.error("[admin-dashboard-next] failed to generate invite link", error);
        showStatus(`Error generating invite link: ${error.message || error}`, "error");
      } finally {
        setInviteBusyByRestaurant((current) => ({ ...current, [restaurantId]: false }));
      }
    },
    [currentUser, showStatus],
  );

  const copyManagerInviteLink = useCallback(async (restaurantId) => {
    const link = managerInviteLinks[restaurantId];
    if (!link) return;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(link);
        showStatus("Invite link copied.", "success");
        return;
      }

      const textarea = document.createElement("textarea");
      textarea.value = link;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);

      if (copied) {
        showStatus("Invite link copied.", "success");
      } else {
        showStatus("Unable to copy invite link.", "error");
      }
    } catch (error) {
      console.error("[admin-dashboard-next] failed to copy invite", error);
      showStatus("Unable to copy invite link.", "error");
    }
  }, [managerInviteLinks, showStatus]);

  const removeManagerAccess = useCallback(
    async (restaurantId, userId, label) => {
      if (!supabase || !restaurantId || !userId) return;

      const confirmed = window.confirm(`Remove manager access for ${label}?`);
      if (!confirmed) return;

      try {
        const { error } = await supabase.functions.invoke("admin-managers", {
          body: { action: "revoke", restaurantId, userId },
        });
        if (error) throw error;
        await loadManagerAccess();
      } catch (error) {
        console.error("[admin-dashboard-next] failed to remove manager access", error);
        showStatus(`Error removing manager access: ${error.message || error}`, "error");
      }
    },
    [loadManagerAccess, showStatus],
  );

  const loadAppeals = useCallback(
    async ({ force = false } = {}) => {
      if (!supabase || !isAdmin) return;

      if (!force && allAppeals.length && Date.now() - appealsLoadedAt < APPEALS_CACHE_WINDOW_MS) {
        return;
      }

      setAppealsLoading(true);
      try {
        const { data, error } = await supabase
          .from("ingredient_scan_appeals")
          .select(
            "id, ingredient_name, restaurant_id, dish_name, submitted_at, review_status, reviewed_at, manager_message, photo_url, review_notes",
          )
          .order("submitted_at", { ascending: false })
          .limit(200);
        if (error) throw error;

        const appeals = Array.isArray(data) ? data : [];
        const restaurantIds = [...new Set(appeals.map((appeal) => appeal.restaurant_id).filter(Boolean))];

        const restaurantLookup = {};
        if (restaurantIds.length) {
          const { data: restaurantsData, error: restaurantError } = await supabase
            .from("restaurants")
            .select("id, name, slug")
            .in("id", restaurantIds);

          if (!restaurantError) {
            (restaurantsData || []).forEach((restaurant) => {
              restaurantLookup[restaurant.id] = restaurant;
            });
          }
        }

        const enriched = appeals.map((appeal) => ({
          ...appeal,
          restaurants: restaurantLookup[appeal.restaurant_id] || null,
        }));

        setAllAppeals(enriched);
        setAppealsLoadedAt(Date.now());
      } catch (error) {
        console.error("[admin-dashboard-next] failed to load appeals", error);
        showStatus(`Error loading appeals: ${error.message}`, "error");
      } finally {
        setAppealsLoading(false);
      }
    },
    [allAppeals.length, appealsLoadedAt, isAdmin, showStatus],
  );

  const reviewAppeal = useCallback(
    async (appeal, status) => {
      if (!supabase || !appeal?.id) return;

      const confirmed = window.confirm(
        `Are you sure you want to ${status === "approved" ? "approve" : "deny"} this appeal?`,
      );
      if (!confirmed) return;

      const notes = String(appealNotesById[appeal.id] || "").trim();
      setAppealBusyId(appeal.id);

      try {
        const { error } = await supabase
          .from("ingredient_scan_appeals")
          .update({
            review_status: status,
            reviewed_at: new Date().toISOString(),
            review_notes: notes || null,
          })
          .eq("id", appeal.id);

        if (error) throw error;

        if (appeal.restaurant_id) {
          try {
            const dishLabel = appeal.dish_name || appeal.ingredient_name || "this dish";
            const decisionLabel = status === "approved" ? "approved" : "denied";
            const detailsLink = buildAppealDetailsLink(appeal);
            const suffix = detailsLink
              ? ` Click [here](${detailsLink}) to see details.`
              : " Please check your dashboard for details.";

            const { data, error: messageError } = await supabase
              .from("restaurant_direct_messages")
              .insert({
                restaurant_id: appeal.restaurant_id,
                message: `Your ingredient list scanning appeal for ${dishLabel} has been ${decisionLabel}.${suffix}`,
                sender_role: "admin",
                sender_name: "Automated alert system",
                sender_id: currentUser?.id || null,
              })
              .select("id")
              .single();

            if (!messageError && data?.id) {
              notifyManagerChat({ messageId: data.id, client: supabase });
            }
          } catch (notifyError) {
            console.warn("[admin-dashboard-next] failed appeal decision chat notification", notifyError);
          }
        }

        setAppealNotesById((current) => ({ ...current, [appeal.id]: "" }));
        await loadAppeals({ force: true });
        showStatus(
          `Appeal ${status === "approved" ? "approved" : "denied"} successfully.`,
          "success",
        );
      } catch (error) {
        console.error("[admin-dashboard-next] review appeal failed", error);
        showStatus(
          `Error ${status === "approved" ? "approving" : "denying"} appeal: ${error.message}`,
          "error",
        );
      } finally {
        setAppealBusyId("");
      }
    },
    [appealNotesById, currentUser?.id, loadAppeals, showStatus],
  );

  const loadAnonymousFeedback = useCallback(async () => {
    if (!supabase || !isAdmin) return;
    setFeedbackLoading(true);
    try {
      const { data, error } = await supabase
        .from("order_feedback")
        .select("id, restaurant_feedback, website_feedback, created_at, restaurant_id, restaurants(name)")
        .is("user_email", null)
        .order("created_at", { ascending: false });
      if (error) throw error;

      setAllFeedback(Array.isArray(data) ? data : []);
      setFeedbackLoaded(true);
    } catch (error) {
      console.error("[admin-dashboard-next] failed to load feedback", error);
      showStatus(`Error loading feedback: ${error.message}`, "error");
      setAllFeedback([]);
      setFeedbackLoaded(true);
    } finally {
      setFeedbackLoading(false);
    }
  }, [isAdmin, showStatus]);

  const loadProductReports = useCallback(async () => {
    if (!supabase || !isAdmin) return;
    setReportsLoading(true);
    try {
      const { data, error } = await supabase
        .from("product_issue_reports")
        .select("*")
        .order("submitted_at", { ascending: false });

      if (error) throw error;
      setAllReports(Array.isArray(data) ? data : []);
      setReportsLoaded(true);
    } catch (error) {
      console.error("[admin-dashboard-next] failed to load reports", error);
      showStatus(`Error loading reports: ${error.message}`, "error");
      setAllReports([]);
      setReportsLoaded(true);
    } finally {
      setReportsLoading(false);
    }
  }, [isAdmin, showStatus]);

  const resolveReport = useCallback(
    async (report, status) => {
      if (!supabase || !report?.id) return;
      const confirmed = window.confirm(
        `Are you sure you want to mark this report as ${status}?`,
      );
      if (!confirmed) return;

      const notes = String(reportNotesById[report.id] || "").trim();
      setReportBusyId(report.id);
      try {
        const { error } = await supabase
          .from("product_issue_reports")
          .update({
            status,
            resolved_at: new Date().toISOString(),
            resolution_notes: notes || null,
            resolved_by: currentUser?.id || null,
          })
          .eq("id", report.id);

        if (error) throw error;

        setReportNotesById((current) => ({ ...current, [report.id]: "" }));
        await loadProductReports();
        showStatus(`Report marked as ${status} successfully.`, "success");
      } catch (error) {
        console.error("[admin-dashboard-next] failed to resolve report", error);
        showStatus(`Error resolving report: ${error.message}`, "error");
      } finally {
        setReportBusyId("");
      }
    },
    [currentUser?.id, loadProductReports, reportNotesById, showStatus],
  );

  useEffect(() => {
    if (!isAdmin || !supabase) return;
    loadRestaurants();
  }, [isAdmin, loadRestaurants]);

  useEffect(() => {
    if (!isAdmin) return;

    if (activeTab === "managers" && !managerAccessLoaded && !managerAccessLoading) {
      loadManagerAccess();
      return;
    }
    if (activeTab === "appeals" && !appealsLoading) {
      loadAppeals({ force: true });
      return;
    }
    if (activeTab === "feedback" && !feedbackLoaded && !feedbackLoading) {
      loadAnonymousFeedback();
      return;
    }
    if (activeTab === "product-reports" && !reportsLoaded && !reportsLoading) {
      loadProductReports();
    }
  }, [
    activeTab,
    appealsLoading,
    feedbackLoaded,
    feedbackLoading,
    isAdmin,
    loadAnonymousFeedback,
    loadAppeals,
    loadManagerAccess,
    loadProductReports,
    managerAccessLoaded,
    managerAccessLoading,
    reportsLoaded,
    reportsLoading,
  ]);

  useEffect(() => {
    if (!isAdmin || activeTab !== "restaurants" || !restaurantsForView.length) return;
    loadChatPreviews(restaurantsForView);
  }, [activeTab, isAdmin, loadChatPreviews, restaurantsForView]);

  const filteredAppeals = useMemo(() => {
    const byRestaurant = selectedRestaurant
      ? allAppeals.filter((appeal) => appeal.restaurant_id === selectedRestaurant.id)
      : allAppeals;

    if (appealFilter === "all") return byRestaurant;

    return byRestaurant.filter((appeal) => {
      if (appealFilter === "pending") {
        return !appeal.review_status || appeal.review_status === "pending";
      }
      return appeal.review_status === appealFilter;
    });
  }, [allAppeals, appealFilter, selectedRestaurant]);

  const filteredFeedback = useMemo(() => {
    if (!selectedRestaurant) return allFeedback;
    return allFeedback.filter((entry) => entry.restaurant_id === selectedRestaurant.id);
  }, [allFeedback, selectedRestaurant]);

  const filteredReports = useMemo(() => {
    const byRestaurant = selectedRestaurant
      ? allReports.filter((report) => {
          if (report.restaurant_id && report.restaurant_id === selectedRestaurant.id) {
            return true;
          }

          const analysisMeta = report.analysis_details?._report_meta || {};
          const reportSlug =
            report.restaurant_slug ||
            report.restaurantSlug ||
            report.slug ||
            analysisMeta.restaurant_slug ||
            analysisMeta.restaurantSlug;
          if (reportSlug && selectedRestaurant.slug && reportSlug === selectedRestaurant.slug) {
            return true;
          }

          const reportName =
            report.restaurant_name ||
            analysisMeta.restaurant_name ||
            analysisMeta.restaurantName;
          if (reportName && selectedRestaurant.name) {
            return reportName.toLowerCase().trim() === selectedRestaurant.name.toLowerCase().trim();
          }

          return false;
        })
      : allReports;

    if (reportFilter === "all") return byRestaurant;
    return byRestaurant.filter((report) => report.status === reportFilter);
  }, [allReports, reportFilter, selectedRestaurant]);

  const managerRestaurantForSelection = useMemo(() => {
    if (!selectedRestaurant) return null;
    return managerAccessRestaurants.find((restaurant) => restaurant.id === selectedRestaurant.id) || null;
  }, [managerAccessRestaurants, selectedRestaurant]);

  return (
    <div className="page-shell">
      <SimpleTopbar
        brandHref="/home"
        links={[
          { href: "/manager-dashboard", label: "Dashboard" },
          { href: "/restaurants", label: "Restaurants" },
          { href: "/help-contact", label: "Help" },
        ]}
        showAuthAction
        signedIn={Boolean(currentUser)}
        onSignOut={onSignOut}
      />

      <main className="admin-container">
        {!isBooting && !isAdmin ? (
          <div className="access-denied">
            <h1>🔒 Access Denied</h1>
            <p>You must be logged in as an administrator to access this page.</p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                window.location.href = "/account";
              }}
            >
              Go to Account
            </button>
          </div>
        ) : null}

        {isBooting ? (
          <div className="admin-card admin-card-full">
            <div className="loading">
              <p>Loading admin dashboard...</p>
            </div>
          </div>
        ) : null}

        {isAdmin ? (
          <>
            <div className="admin-header">
              <h1>🛡️ Admin Dashboard</h1>
              <p>Manage restaurants and review appeals</p>
            </div>

            <div className="tab-buttons">
              {TAB_ROUTES.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`tab-btn${activeTab === tab.id ? " active" : ""}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="tab-toolbar">
              <div className="restaurant-selector">
                <label htmlFor="admin-restaurant-select">Restaurant</label>
                <select
                  id="admin-restaurant-select"
                  value={selectedRestaurantId}
                  onChange={(event) => setSelectedRestaurantId(event.target.value)}
                  disabled={!allRestaurants.length}
                >
                  <option value="all">All restaurants</option>
                  {allRestaurants.map((restaurant) => (
                    <option key={restaurant.id} value={restaurant.id}>
                      {restaurant.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {statusMessage.text && activeTab !== "restaurants" ? (
              <p
                className={`status-text ${
                  statusMessage.tone === "error" ? "error" : "success"
                }`}
                style={{ marginBottom: 16 }}
              >
                {statusMessage.text}
              </p>
            ) : null}

            {activeTab === "restaurants" ? (
              <div className="tab-content active">
                <div className="admin-grid">
                  <div className="admin-card">
                    <h2>Add New Restaurant</h2>
                    <form onSubmit={onCreateRestaurant}>
                      <div className="form-group">
                        <label htmlFor="restaurant-name">Restaurant Name *</label>
                        <input
                          type="text"
                          id="restaurant-name"
                          required
                          placeholder="e.g., Falafel Café"
                          value={restaurantName}
                          onChange={(event) => setRestaurantName(event.target.value)}
                        />
                      </div>

                      <div className="form-group">
                        <label htmlFor="restaurant-website">Website</label>
                        <input
                          type="url"
                          id="restaurant-website"
                          placeholder="https://example.com"
                          value={restaurantWebsite}
                          onChange={(event) => setRestaurantWebsite(event.target.value)}
                        />
                      </div>

                      <div className="form-group">
                        <label htmlFor="restaurant-description">Description</label>
                        <textarea
                          id="restaurant-description"
                          placeholder="Brief description of the restaurant"
                          value={restaurantDescription}
                          onChange={(event) => setRestaurantDescription(event.target.value)}
                        />
                      </div>

                      <div className="form-group">
                        <label htmlFor="menu-image">Menu Image *</label>
                        <input
                          type="file"
                          id="menu-image"
                          accept="image/*"
                          required={!menuImagePreview}
                          onChange={onMenuImageChange}
                        />
                        <img
                          id="image-preview"
                          className={`image-preview${menuImagePreview ? " show" : ""}`}
                          alt="Menu preview"
                          src={menuImagePreview || ""}
                        />
                      </div>

                      <button
                        type="submit"
                        className="btn-primary"
                        id="submit-btn"
                        disabled={creatingRestaurant || imageProcessing}
                      >
                        {creatingRestaurant
                          ? "Adding restaurant..."
                          : imageProcessing
                            ? "Processing image..."
                            : "Add Restaurant"}
                      </button>

                      <div
                        id="status-message"
                        className={`status-message${
                          statusMessage.text ? " show" : ""
                        } ${statusMessage.tone}`}
                      >
                        {statusMessage.text}
                      </div>
                    </form>
                  </div>

                  <div className="admin-card">
                    <h2>Existing Restaurants</h2>
                    <div id="restaurants-list" className="restaurants-list">
                      {restaurantsLoading ? (
                        <p style={{ color: "#718096" }}>Loading restaurants...</p>
                      ) : restaurantsForView.length ? (
                        restaurantsForView.map((restaurant) => {
                          const unreadCount = chatUnreadByRestaurant[restaurant.id] || 0;
                          const chatMessages = chatThreadsByRestaurant[restaurant.id] || [];
                          const isChatOpen = Boolean(chatOpenByRestaurant[restaurant.id]);

                          return (
                            <div key={restaurant.id} className="restaurant-item">
                              <div className="restaurant-item-header">
                                <div>
                                  <div className="restaurant-title-row">
                                    <div className="restaurant-title-left">
                                      <h3>
                                        {restaurant.name}{" "}
                                        <span
                                          className="chat-badge"
                                          style={{
                                            display: unreadCount > 0 ? "inline-flex" : "none",
                                          }}
                                        >
                                          {unreadCount}
                                        </span>
                                      </h3>
                                      <button
                                        type="button"
                                        className="btn-warning acknowledge-btn"
                                        style={{
                                          display: unreadCount > 0 ? "inline-flex" : "none",
                                        }}
                                        onClick={() =>
                                          acknowledgeChat(restaurant.id, restaurant.name)
                                        }
                                      >
                                        Acknowledge message(s)
                                      </button>
                                    </div>
                                  </div>
                                  <p>{restaurant.slug || "no-slug"}</p>
                                </div>
                                <div className="restaurant-actions">
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() =>
                                      loadChatThread(restaurant.id, restaurant.name)
                                    }
                                  >
                                    Direct chat
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-danger"
                                    onClick={() =>
                                      deleteRestaurant(restaurant.id, restaurant.name)
                                    }
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>

                              <ChatThread
                                restaurantId={restaurant.id}
                                restaurantName={restaurant.name}
                                messages={chatMessages}
                                unreadCount={unreadCount}
                                isOpen={isChatOpen}
                                loading={Boolean(chatLoadingByRestaurant[restaurant.id])}
                                sending={Boolean(chatSendingByRestaurant[restaurant.id])}
                                inputValue={chatInputsByRestaurant[restaurant.id] || ""}
                                readState={chatReadStatesByRestaurant[restaurant.id]}
                                onToggle={(nextOpen) => {
                                  setChatOpenByRestaurant((current) => ({
                                    ...current,
                                    [restaurant.id]: nextOpen,
                                  }));
                                  if (nextOpen) {
                                    loadChatThread(restaurant.id, restaurant.name);
                                  }
                                }}
                                onInputChange={(nextValue) => {
                                  setChatInputsByRestaurant((current) => ({
                                    ...current,
                                    [restaurant.id]: nextValue,
                                  }));
                                }}
                                onSend={() => sendChatMessage(restaurant.id, restaurant.name)}
                                onAcknowledge={() =>
                                  acknowledgeChat(restaurant.id, restaurant.name)
                                }
                              />
                            </div>
                          );
                        })
                      ) : (
                        <p style={{ color: "#718096" }}>
                          No restaurants found for the selected filter.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === "managers" ? (
              <div className="tab-content active">
                <div className="admin-card admin-card-full">
                  <h2>👥 Restaurant Managers</h2>
                  <p style={{ color: "#718096", marginBottom: 20 }}>
                    View current manager access for the selected restaurant, revoke
                    access, and generate invite links.
                  </p>

                  <div id="manager-access-list" className="manager-access-list">
                    {managerAccessLoading ? (
                      <p style={{ color: "#718096" }}>Loading manager access...</p>
                    ) : !managerAccessLoaded ? (
                      <p style={{ color: "#718096" }}>Load manager access to continue.</p>
                    ) : !managerAccessRestaurants.length ? (
                      <p style={{ color: "#718096" }}>No restaurants found.</p>
                    ) : !selectedRestaurant ? (
                      <p style={{ color: "#718096" }}>
                        Select a restaurant above to view managers.
                      </p>
                    ) : !managerRestaurantForSelection ? (
                      <p style={{ color: "#718096" }}>
                        No manager data found for this restaurant.
                      </p>
                    ) : (
                      <div className="manager-access-card">
                        <div className="manager-access-header">
                          <h3>{managerRestaurantForSelection.name || "Restaurant"}</h3>
                          <span style={{ color: "#64748b", fontSize: "0.85rem" }}>
                            {managerRestaurantForSelection.slug || ""}
                          </span>
                        </div>

                        {Array.isArray(managerRestaurantForSelection.managers) &&
                        managerRestaurantForSelection.managers.length ? (
                          <table className="manager-table">
                            <thead>
                              <tr>
                                <th>Name</th>
                                <th>Email</th>
                                <th>User ID</th>
                                <th>Added</th>
                                <th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {managerRestaurantForSelection.managers.map((manager) => {
                                const label =
                                  manager.name || manager.email || manager.user_id || "Manager";
                                return (
                                  <tr key={`${manager.user_id}-${manager.created_at || ""}`}>
                                    <td>{manager.name || "—"}</td>
                                    <td>{manager.email || "—"}</td>
                                    <td>
                                      <span style={{ fontFamily: "monospace" }}>
                                        {manager.user_id || "—"}
                                      </span>
                                    </td>
                                    <td>{toDateLabel(manager.created_at)}</td>
                                    <td>
                                      <button
                                        type="button"
                                        className="btn-danger"
                                        onClick={() =>
                                          removeManagerAccess(
                                            managerRestaurantForSelection.id,
                                            manager.user_id,
                                            label,
                                          )
                                        }
                                      >
                                        Remove
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        ) : (
                          <div className="manager-empty">No managers assigned yet.</div>
                        )}

                        <div className="manager-invite-actions">
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={() =>
                              createManagerInviteLink(managerRestaurantForSelection.id)
                            }
                            disabled={Boolean(
                              inviteBusyByRestaurant[managerRestaurantForSelection.id],
                            )}
                          >
                            {inviteBusyByRestaurant[managerRestaurantForSelection.id]
                              ? "Generating..."
                              : "+ Create Manager Invite Link"}
                          </button>
                          <div className="manager-invite-note">
                            Invite links expire after 48 hours and send users to the
                            dashboard.
                          </div>
                          <div
                            className={`manager-invite-output${
                              managerInviteLinks[managerRestaurantForSelection.id]
                                ? " show"
                                : ""
                            }`}
                          >
                            <input
                              type="text"
                              readOnly
                              value={
                                managerInviteLinks[managerRestaurantForSelection.id] || ""
                              }
                            />
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() =>
                                copyManagerInviteLink(managerRestaurantForSelection.id)
                              }
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === "appeals" ? (
              <div className="tab-content active">
                <div className="admin-card admin-card-full">
                  <h2>📷 Ingredient Scan Appeals</h2>
                  <p style={{ color: "#718096", marginBottom: 24 }}>
                    Review and approve or deny manager appeals for ingredient scanning
                    requirements
                  </p>

                  <div className="appeals-filters">
                    <button
                      type="button"
                      className={`filter-btn${appealFilter === "all" ? " active" : ""}`}
                      onClick={() => setAppealFilter("all")}
                    >
                      All Appeals
                    </button>
                    <button
                      type="button"
                      className={`filter-btn${appealFilter === "pending" ? " active" : ""}`}
                      onClick={() => setAppealFilter("pending")}
                    >
                      Pending
                    </button>
                    <button
                      type="button"
                      className={`filter-btn${appealFilter === "approved" ? " active" : ""}`}
                      onClick={() => setAppealFilter("approved")}
                    >
                      Approved
                    </button>
                    <button
                      type="button"
                      className={`filter-btn${appealFilter === "rejected" ? " active" : ""}`}
                      onClick={() => setAppealFilter("rejected")}
                    >
                      Rejected
                    </button>
                  </div>

                  {appealsLoading ? (
                    <div id="loading-appeals" className="loading">
                      <p>Loading appeals...</p>
                    </div>
                  ) : filteredAppeals.length === 0 ? (
                    <div id="no-appeals" className="no-appeals">
                      <h3>No appeals found</h3>
                      <p>There are no appeals matching your current filter.</p>
                    </div>
                  ) : (
                    <div id="appeals-list" className="appeals-list">
                      {filteredAppeals.map((appeal) => {
                        const status = appeal.review_status || "pending";
                        const restaurant = appeal.restaurants || {};
                        return (
                          <div key={appeal.id} className={`appeal-card ${status}`}>
                            <div className="appeal-header">
                              <div className="appeal-info">
                                <h3>{appeal.ingredient_name}</h3>
                                <div className="appeal-meta">
                                  <span>
                                    <strong>Restaurant:</strong> {restaurant.name || "Unknown"}
                                  </span>
                                  {appeal.dish_name ? (
                                    <span>
                                      <strong>Dish:</strong> {appeal.dish_name}
                                    </span>
                                  ) : null}
                                  <span>
                                    <strong>Submitted:</strong>{" "}
                                    {toDateLabel(appeal.submitted_at)}
                                  </span>
                                  {appeal.reviewed_at ? (
                                    <span>
                                      <strong>Reviewed:</strong>{" "}
                                      {toDateLabel(appeal.reviewed_at)}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              <span className={`appeal-status ${status}`}>{status}</span>
                            </div>

                            {appeal.manager_message ? (
                              <div className="appeal-message">
                                <strong>Manager Message:</strong> {appeal.manager_message}
                              </div>
                            ) : null}

                            {appeal.photo_url ? (
                              <div style={{ margin: "16px 0" }}>
                                <strong
                                  style={{
                                    color: "#1e3a5f",
                                    display: "block",
                                    marginBottom: 8,
                                  }}
                                >
                                  Photo submitted:
                                </strong>
                                <img
                                  src={appeal.photo_url}
                                  alt="Appeal"
                                  className="appeal-photo"
                                  loading="lazy"
                                  decoding="async"
                                  onClick={() => setPhotoModalUrl(appeal.photo_url)}
                                />
                              </div>
                            ) : null}

                            {status === "pending" ? (
                              <>
                                <div className="review-notes">
                                  <label
                                    style={{
                                      color: "#1e3a5f",
                                      display: "block",
                                      marginBottom: 8,
                                      fontWeight: 600,
                                    }}
                                  >
                                    <strong>Review Notes (optional):</strong>
                                  </label>
                                  <textarea
                                    value={appealNotesById[appeal.id] || ""}
                                    placeholder="Add any notes about your decision..."
                                    onChange={(event) =>
                                      setAppealNotesById((current) => ({
                                        ...current,
                                        [appeal.id]: event.target.value,
                                      }))
                                    }
                                  />
                                </div>
                                <div className="appeal-actions">
                                  <button
                                    type="button"
                                    className="btn-approve"
                                    onClick={() => reviewAppeal(appeal, "approved")}
                                    disabled={appealBusyId === appeal.id}
                                  >
                                    ✓ Approve
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-deny"
                                    onClick={() => reviewAppeal(appeal, "rejected")}
                                    disabled={appealBusyId === appeal.id}
                                  >
                                    ✗ Deny
                                  </button>
                                  {restaurant.slug ? (
                                    <a
                                      href={`/restaurant?slug=${restaurant.slug}`}
                                      className="btn-view-restaurant"
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      View Restaurant
                                    </a>
                                  ) : null}
                                </div>
                              </>
                            ) : (
                              <div className="appeal-actions">
                                {appeal.review_notes ? (
                                  <p style={{ color: "#1e3a5f" }}>
                                    <strong style={{ color: "#1e3a5f" }}>
                                      Review Notes:
                                    </strong>{" "}
                                    {appeal.review_notes}
                                  </p>
                                ) : null}
                                {restaurant.slug ? (
                                  <a
                                    href={`/restaurant?slug=${restaurant.slug}`}
                                    className="btn-view-restaurant"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    View Restaurant
                                  </a>
                                ) : null}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {activeTab === "feedback" ? (
              <div className="tab-content active">
                <div className="admin-card admin-card-full">
                  <h2>🗣️ Anonymous Feedback</h2>
                  <p style={{ color: "#718096", marginBottom: 24 }}>
                    Feedback submitted without an email address.
                  </p>

                  <div id="feedback-list" className="feedback-list">
                    {feedbackLoading ? (
                      <p style={{ color: "#718096" }}>Loading feedback...</p>
                    ) : !feedbackLoaded ? (
                      <p style={{ color: "#718096" }}>Load feedback to continue.</p>
                    ) : !filteredFeedback.length ? (
                      <p style={{ color: "#718096" }}>
                        {selectedRestaurant
                          ? "No anonymous feedback for the selected restaurant."
                          : "No anonymous feedback yet."}
                      </p>
                    ) : (
                      filteredFeedback.map((entry) => {
                        const restaurantName = entry.restaurants?.name || "Unknown restaurant";
                        const restaurantFeedback = String(entry.restaurant_feedback || "").trim();
                        const websiteFeedback = String(entry.website_feedback || "").trim();

                        return (
                          <div className="feedback-card" key={entry.id}>
                            <div className="feedback-meta">
                              <span>{restaurantName}</span>
                              <span>{toDateLabel(entry.created_at)}</span>
                            </div>
                            {restaurantFeedback ? (
                              <div className="feedback-text">
                                <strong>Restaurant:</strong> {restaurantFeedback}
                              </div>
                            ) : null}
                            {websiteFeedback ? (
                              <div
                                className="feedback-text"
                                style={{ marginTop: restaurantFeedback ? 8 : 0 }}
                              >
                                <strong>Clarivore:</strong> {websiteFeedback}
                              </div>
                            ) : null}
                            {!restaurantFeedback && !websiteFeedback ? (
                              <div className="feedback-text">
                                No written feedback provided.
                              </div>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === "product-reports" ? (
              <div className="tab-content active">
                <div className="admin-card admin-card-full">
                  <h2>📋 Issue Reports</h2>
                  <p style={{ color: "#718096", marginBottom: 24 }}>
                    Review user-reported issues with menu issues, brand verification,
                    and product analysis.
                  </p>

                  <div className="appeals-filters">
                    <button
                      type="button"
                      className={`filter-btn-reports filter-btn${
                        reportFilter === "all" ? " active" : ""
                      }`}
                      onClick={() => setReportFilter("all")}
                    >
                      All Reports
                    </button>
                    <button
                      type="button"
                      className={`filter-btn-reports filter-btn${
                        reportFilter === "pending" ? " active" : ""
                      }`}
                      onClick={() => setReportFilter("pending")}
                    >
                      Pending
                    </button>
                    <button
                      type="button"
                      className={`filter-btn-reports filter-btn${
                        reportFilter === "resolved" ? " active" : ""
                      }`}
                      onClick={() => setReportFilter("resolved")}
                    >
                      Resolved
                    </button>
                    <button
                      type="button"
                      className={`filter-btn-reports filter-btn${
                        reportFilter === "dismissed" ? " active" : ""
                      }`}
                      onClick={() => setReportFilter("dismissed")}
                    >
                      Dismissed
                    </button>
                  </div>

                  {reportsLoading ? (
                    <div id="loading-reports" className="loading">
                      <p>Loading reports...</p>
                    </div>
                  ) : !filteredReports.length ? (
                    <div id="no-reports" className="no-appeals">
                      <h3>No reports found</h3>
                      <p>There are no product issue reports matching your current filter.</p>
                    </div>
                  ) : (
                    <div id="reports-list" className="appeals-list">
                      {filteredReports.map((report) => {
                        const status = report.status || "pending";
                        const details = report.analysis_details || {};
                        const metadata = details._report_meta || {};
                        const reportTypeRaw = String(report.report_type || "");
                        const reportTypeLabel = reportTypeRaw
                          ? reportTypeRaw.replace(/Menu Verification/gi, "Menu Issue")
                          : "";
                        const pageUrl =
                          report.page_url || metadata.page_url || metadata.pageUrl || "";
                        const accountName =
                          report.account_name || metadata.account_name || metadata.accountName || "";
                        const reporterName =
                          report.reporter_name || metadata.reporter_name || metadata.reporterName || "";
                        const reporterEmail =
                          report.user_email ||
                          report.reporter_email ||
                          metadata.reporter_email ||
                          metadata.reporterEmail ||
                          "";

                        return (
                          <div
                            key={report.id}
                            className={`appeal-card ${status}`}
                            style={{ borderLeftColor: "#f59e0b" }}
                          >
                            <div className="appeal-header">
                              <div className="appeal-info">
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 12,
                                    marginBottom: 4,
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <h3 style={{ margin: 0 }}>
                                    {report.product_name ||
                                      report.restaurant_name ||
                                      "Unknown"}
                                  </h3>
                                  {reportTypeLabel ? (
                                    <span
                                      style={{
                                        background: "#e0e7ff",
                                        color: "#3730a3",
                                        padding: "2px 8px",
                                        borderRadius: 4,
                                        fontSize: "0.75rem",
                                        fontWeight: 600,
                                      }}
                                    >
                                      {reportTypeLabel}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="appeal-meta">
                                  {report.restaurant_name ? (
                                    <span>
                                      <strong>Restaurant:</strong> {report.restaurant_name}
                                    </span>
                                  ) : null}
                                  {reporterEmail ? (
                                    <span>
                                      <strong>Submitted by:</strong> {reporterEmail}
                                    </span>
                                  ) : null}
                                  {accountName || reporterName ? (
                                    <span>
                                      <strong>Account name:</strong>{" "}
                                      {accountName || reporterName}
                                    </span>
                                  ) : null}
                                  {reporterName && reporterName !== accountName ? (
                                    <span>
                                      <strong>Reporter name:</strong> {reporterName}
                                    </span>
                                  ) : null}
                                  {pageUrl ? (
                                    <span>
                                      <strong>Page:</strong>{" "}
                                      <a
                                        href={pageUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ color: "#4c5ad4" }}
                                      >
                                        {pageUrl}
                                      </a>
                                    </span>
                                  ) : null}
                                  <span>
                                    <strong>Submitted:</strong>{" "}
                                    {toDateLabel(report.submitted_at)}
                                  </span>
                                  {report.resolved_at ? (
                                    <span>
                                      <strong>Resolved:</strong>{" "}
                                      {toDateLabel(report.resolved_at)}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              <span className={`appeal-status ${status}`}>{status}</span>
                            </div>

                            <div style={{ margin: "16px 0" }}>
                              <strong
                                style={{
                                  color: "#1e3a5f",
                                  display: "block",
                                  marginBottom: 8,
                                }}
                              >
                                User Message:
                              </strong>
                              <p
                                style={{
                                  background: "#fff3cd",
                                  padding: 12,
                                  borderRadius: 8,
                                  marginTop: 8,
                                  color: "#856404",
                                  whiteSpace: "pre-wrap",
                                  lineHeight: 1.5,
                                }}
                              >
                                {report.message}
                              </p>
                            </div>

                            {details.ingredientList ? (
                              <div style={{ margin: "16px 0" }}>
                                <strong
                                  style={{
                                    color: "#1e3a5f",
                                    display: "block",
                                    marginBottom: 8,
                                  }}
                                >
                                  Ingredient List:
                                </strong>
                                <div
                                  style={{
                                    background: "#f5f5f5",
                                    padding: 12,
                                    borderRadius: 8,
                                    marginTop: 8,
                                    fontFamily: "monospace",
                                    fontSize: "0.9rem",
                                    whiteSpace: "pre-wrap",
                                    color: "#1e3a5f",
                                    lineHeight: 1.5,
                                  }}
                                >
                                  {details.ingredientList}
                                </div>
                              </div>
                            ) : null}

                            {Array.isArray(details.allergens) && details.allergens.length ? (
                              <div style={{ margin: "16px 0" }}>
                                <strong
                                  style={{
                                    color: "#1e3a5f",
                                    display: "block",
                                    marginBottom: 4,
                                  }}
                                >
                                  Detected Allergens:
                                </strong>
                                <span style={{ color: "#1e3a5f" }}>
                                  {details.allergens
                                    .map((allergen) =>
                                      typeof allergen === "object" ? allergen.name : allergen,
                                    )
                                    .filter(Boolean)
                                    .join(", ")}
                                </span>
                              </div>
                            ) : null}

                            {Array.isArray(details.diets) && details.diets.length ? (
                              <div style={{ margin: "16px 0" }}>
                                <strong
                                  style={{
                                    color: "#1e3a5f",
                                    display: "block",
                                    marginBottom: 4,
                                  }}
                                >
                                  Detected Diets:
                                </strong>
                                <span style={{ color: "#1e3a5f" }}>
                                  {details.diets.join(", ")}
                                </span>
                              </div>
                            ) : null}

                            {Array.isArray(details.sources) && details.sources.length ? (
                              <div style={{ margin: "16px 0" }}>
                                <strong
                                  style={{
                                    color: "#1e3a5f",
                                    display: "block",
                                    marginBottom: 8,
                                  }}
                                >
                                  Sources Used:
                                </strong>
                                <div style={{ fontSize: "0.9rem", color: "#718096" }}>
                                  {details.sources.map((source, index) => {
                                    const url = source?.url || source;
                                    const title = source?.title || source?.url || source;
                                    return (
                                      <div key={`${url}-${index}`} style={{ marginBottom: 4 }}>
                                        •{" "}
                                        <a
                                          href={url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          style={{ color: "#4c5ad4" }}
                                        >
                                          {title}
                                        </a>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}

                            {status === "pending" ? (
                              <>
                                <div className="review-notes">
                                  <label
                                    style={{
                                      color: "#1e3a5f",
                                      display: "block",
                                      marginBottom: 8,
                                      fontWeight: 600,
                                    }}
                                  >
                                    <strong>Resolution Notes (optional):</strong>
                                  </label>
                                  <textarea
                                    value={reportNotesById[report.id] || ""}
                                    placeholder="Add notes about how you resolved this report..."
                                    onChange={(event) =>
                                      setReportNotesById((current) => ({
                                        ...current,
                                        [report.id]: event.target.value,
                                      }))
                                    }
                                  />
                                </div>
                                <div className="appeal-actions">
                                  <button
                                    type="button"
                                    className="btn-approve"
                                    onClick={() => resolveReport(report, "resolved")}
                                    disabled={reportBusyId === report.id}
                                  >
                                    ✓ Mark Resolved
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-deny"
                                    onClick={() => resolveReport(report, "dismissed")}
                                    disabled={reportBusyId === report.id}
                                  >
                                    ✗ Dismiss
                                  </button>
                                </div>
                              </>
                            ) : (
                              <div className="appeal-actions">
                                {report.resolution_notes ? (
                                  <p style={{ color: "#1e3a5f" }}>
                                    <strong style={{ color: "#1e3a5f" }}>
                                      Resolution Notes:
                                    </strong>{" "}
                                    {report.resolution_notes}
                                  </p>
                                ) : null}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </main>

      {photoModalUrl ? (
        <div
          id="photo-modal"
          className="photo-modal show"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setPhotoModalUrl("");
            }
          }}
        >
          <img id="modal-photo" src={photoModalUrl} alt="Appeal" />
        </div>
      ) : null}
    </div>
  );
}
