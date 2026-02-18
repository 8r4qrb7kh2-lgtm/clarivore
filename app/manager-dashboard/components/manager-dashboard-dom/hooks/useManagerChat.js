import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseClient as supabase } from "../../../../lib/supabase";
import { ADMIN_DISPLAY_NAME } from "../constants/dashboardConstants";

// Encapsulates direct-message state and actions for the dashboard quick-actions panel.
// The chat model is intentionally small: latest messages, read markers, unread count, and send/ack actions.
export function useManagerChat({ selectedRestaurantId, managerDisplayName, userId, setStatus }) {
  const [chatMessages, setChatMessages] = useState([]);
  const [chatReadState, setChatReadState] = useState({ admin: null, restaurant: null });
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);

  const chatListRef = useRef(null);

  const clearChatState = useCallback(() => {
    setChatMessages([]);
    setChatReadState({ admin: null, restaurant: null });
    setChatUnreadCount(0);
  }, []);

  const loadChatState = useCallback(
    async (restaurantId) => {
      if (!supabase || !restaurantId) {
        clearChatState();
        return;
      }

      try {
        // Load latest messages and read markers together to keep counts aligned.
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
        setChatMessages((messagesResult.data || []).slice().reverse());
        setChatReadState(nextReadState);
        setChatUnreadCount(unreadResult.count || 0);
      } catch (error) {
        console.error("[manager-dashboard-next] failed to load chat", error);
        clearChatState();
      }
    },
    [clearChatState],
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

  useEffect(() => {
    // Auto-scroll to latest message after each chat refresh.
    if (!chatListRef.current) return;
    chatListRef.current.scrollTop = chatListRef.current.scrollHeight;
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
    chatListRef,
    clearChatState,
    loadChatState,
    onSendChatMessage,
    onAcknowledgeChat,
    managerChatAckByIndex,
  };
}
