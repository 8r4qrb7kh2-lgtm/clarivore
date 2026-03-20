import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { supabaseClient as supabase } from "../../../../lib/supabase";
import { ADMIN_DISPLAY_NAME } from "../constants/dashboardConstants";

const INITIAL_CHAT_PAGE_SIZE = 6;
const CHAT_PAGE_INCREMENT = 10;

// Encapsulates direct-message state and actions for the dashboard quick-actions panel.
// The chat model is intentionally small: latest messages, read markers, unread count, and send/ack actions.
export function useManagerChat({ selectedRestaurantId, managerDisplayName, userId, setStatus }) {
  const [chatMessages, setChatMessages] = useState([]);
  const [chatReadState, setChatReadState] = useState({ admin: null, restaurant: null });
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatVisibleCount, setChatVisibleCount] = useState(INITIAL_CHAT_PAGE_SIZE);
  const [chatHasOlderMessages, setChatHasOlderMessages] = useState(false);
  const [chatLoadingOlderMessages, setChatLoadingOlderMessages] = useState(false);

  const chatListRef = useRef(null);
  const lastLoadedRestaurantIdRef = useRef(null);
  const pendingScrollModeRef = useRef("bottom");
  const preservedScrollPositionRef = useRef(null);

  const clearChatState = useCallback(() => {
    setChatMessages([]);
    setChatReadState({ admin: null, restaurant: null });
    setChatUnreadCount(0);
    setChatVisibleCount(INITIAL_CHAT_PAGE_SIZE);
    setChatHasOlderMessages(false);
    setChatLoadingOlderMessages(false);
    lastLoadedRestaurantIdRef.current = null;
    preservedScrollPositionRef.current = null;
    pendingScrollModeRef.current = "bottom";
  }, []);

  const loadChatState = useCallback(
    async (restaurantId, options = {}) => {
      if (!supabase || !restaurantId) {
        clearChatState();
        return;
      }

      try {
        const isNewRestaurant = lastLoadedRestaurantIdRef.current !== restaurantId;
        const nextVisibleCount = Math.max(
          1,
          Number(options.visibleCount)
            || (isNewRestaurant ? INITIAL_CHAT_PAGE_SIZE : chatVisibleCount),
        );

        // Load latest messages and read markers together to keep counts aligned.
        const [messagesResult, readsResult] = await Promise.all([
          supabase
            .from("restaurant_direct_messages")
            .select("id, message, sender_role, sender_name, created_at", { count: "exact" })
            .eq("restaurant_id", restaurantId)
            .order("created_at", { ascending: false })
            .limit(nextVisibleCount),
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

        // Unread count from restaurant perspective: admin-sent messages after last restaurant read.
        let unreadQuery = supabase
          .from("restaurant_direct_messages")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", restaurantId)
          .eq("sender_role", "admin");

        if (nextReadState.restaurant?.last_read_at) {
          unreadQuery = unreadQuery.gt("created_at", nextReadState.restaurant.last_read_at);
        }

        const unreadResult = await unreadQuery;
        if (unreadResult.error) throw unreadResult.error;

        // DB query is descending for cheap limit; reverse for natural chat chronology.
        const nextMessages = (messagesResult.data || []).slice().reverse();
        pendingScrollModeRef.current = options.scrollMode || "bottom";
        setChatMessages(nextMessages);
        setChatReadState(nextReadState);
        setChatUnreadCount(unreadResult.count || 0);
        setChatVisibleCount(nextVisibleCount);
        setChatHasOlderMessages((messagesResult.count || 0) > nextMessages.length);
        lastLoadedRestaurantIdRef.current = restaurantId;
      } catch (error) {
        console.error("[manager-dashboard-next] failed to load chat", error);
        clearChatState();
      }
    },
    [chatVisibleCount, clearChatState],
  );

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
        sender_id: userId || null,
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
  }, [chatInput, loadChatState, managerDisplayName, selectedRestaurantId, setStatus, userId]);

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

  const onLoadOlderMessages = useCallback(async () => {
    if (!selectedRestaurantId || chatLoadingOlderMessages || !chatHasOlderMessages) return;

    const listNode = chatListRef.current;
    if (listNode) {
      preservedScrollPositionRef.current = {
        scrollHeight: listNode.scrollHeight,
        scrollTop: listNode.scrollTop,
      };
    }

    setChatLoadingOlderMessages(true);
    try {
      await loadChatState(selectedRestaurantId, {
        visibleCount: chatVisibleCount + CHAT_PAGE_INCREMENT,
        scrollMode: "preserve",
      });
    } finally {
      setChatLoadingOlderMessages(false);
    }
  }, [
    chatHasOlderMessages,
    chatLoadingOlderMessages,
    chatVisibleCount,
    loadChatState,
    selectedRestaurantId,
  ]);

  useLayoutEffect(() => {
    const listNode = chatListRef.current;
    if (!listNode) return;

    if (pendingScrollModeRef.current === "preserve" && preservedScrollPositionRef.current) {
      const previousPosition = preservedScrollPositionRef.current;
      listNode.scrollTop =
        listNode.scrollHeight - previousPosition.scrollHeight + previousPosition.scrollTop;
      preservedScrollPositionRef.current = null;
      pendingScrollModeRef.current = "idle";
      return;
    }

    if (pendingScrollModeRef.current === "bottom") {
      listNode.scrollTop = listNode.scrollHeight;
    }

    pendingScrollModeRef.current = "idle";
  }, [chatMessages]);

  const managerChatAckByIndex = useMemo(() => {
    const ackByIndex = new Map();

    const pushAck = (index, entry) => {
      if (index < 0) return;
      const existing = ackByIndex.get(index) || [];
      existing.push(entry);
      ackByIndex.set(index, existing);
    };

    // Attach acknowledgement markers to the last message in each acknowledged run.
    chatMessages.forEach((message, index) => {
      const messageTime = new Date(message.created_at).getTime();
      if (Number.isNaN(messageTime)) return;

      if (chatReadState.admin?.acknowledged_at && message.sender_role === "restaurant") {
        const adminAckTime = new Date(chatReadState.admin.acknowledged_at).getTime();
        if (!Number.isNaN(adminAckTime) && messageTime <= adminAckTime) {
          const next = chatMessages[index + 1];
          const nextTime = next?.created_at ? new Date(next.created_at).getTime() : NaN;
          if (
            !next ||
            Number.isNaN(nextTime) ||
            next.sender_role !== "restaurant" ||
            nextTime > adminAckTime
          ) {
            pushAck(index, {
              name: ADMIN_DISPLAY_NAME,
              acknowledgedAt: chatReadState.admin.acknowledged_at,
            });
          }
        }
      }

      if (chatReadState.restaurant?.acknowledged_at && message.sender_role === "admin") {
        const managerAckTime = new Date(chatReadState.restaurant.acknowledged_at).getTime();
        if (!Number.isNaN(managerAckTime) && messageTime <= managerAckTime) {
          const next = chatMessages[index + 1];
          const nextTime = next?.created_at ? new Date(next.created_at).getTime() : NaN;
          if (
            !next ||
            Number.isNaN(nextTime) ||
            next.sender_role !== "admin" ||
            nextTime > managerAckTime
          ) {
            pushAck(index, {
              name: managerDisplayName,
              acknowledgedAt: chatReadState.restaurant.acknowledged_at,
            });
          }
        }
      }
    });

    return ackByIndex;
  }, [chatMessages, chatReadState, managerDisplayName]);

  return {
    chatMessages,
    chatReadState,
    chatUnreadCount,
    chatInput,
    setChatInput,
    chatSending,
    chatHasOlderMessages,
    chatLoadingOlderMessages,
    chatListRef,
    clearChatState,
    loadChatState,
    onSendChatMessage,
    onAcknowledgeChat,
    onLoadOlderMessages,
    managerChatAckByIndex,
  };
}
