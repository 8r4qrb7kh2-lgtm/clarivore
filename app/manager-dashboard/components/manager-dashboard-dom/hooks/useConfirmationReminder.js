import { useCallback, useEffect, useRef } from "react";
import { supabaseClient as supabase } from "../../../../lib/supabase";
import { notifyManagerChat } from "../../../../lib/chatNotifications";
import {
  AUTO_ALERT_SENDER,
  CONFIRM_REMINDER_DAYS,
} from "../constants/dashboardConstants";

// Sends automated reminder chat messages when restaurant confirmation is nearing due date.
// Guardrails prevent duplicate reminders for the same restaurant + due-date window.
export function useConfirmationReminder({
  currentRestaurantData,
  selectedRestaurantId,
  loadChatState,
}) {
  const sentReminderKeysRef = useRef(new Set());

  const maybeSendConfirmReminder = useCallback(
    async (restaurant) => {
      if (!supabase || !restaurant?.id || !restaurant?.slug) return;
      if (!restaurant.last_confirmed) return;

      const lastConfirmed = new Date(restaurant.last_confirmed);
      if (Number.isNaN(lastConfirmed.getTime())) return;

      const nextDueDate = new Date(lastConfirmed);
      nextDueDate.setMonth(nextDueDate.getMonth() + 1);
      const daysUntilDue = Math.ceil((nextDueDate - new Date()) / (24 * 60 * 60 * 1000));

      // Only send reminders on configured lead-time days and never for already overdue dates.
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
        // First check whether a matching reminder already exists in DB.
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

        // Refresh chat when the currently viewed restaurant receives the reminder.
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
}
