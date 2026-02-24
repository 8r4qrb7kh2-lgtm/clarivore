"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppTopbar from "../components/AppTopbar";
import PageShell from "../components/PageShell";
import ChatPreviewPanel from "../components/chat/ChatPreviewPanel";
import SplitColumns from "../components/layout/SplitColumns";
import SurfaceCard from "../components/surfaces/SurfaceCard";
import PageHeading from "../components/surfaces/PageHeading";
import { supabaseClient as supabase } from "../lib/supabase";
import {
  fetchManagerRestaurants,
  isManagerOrOwnerUser,
} from "../lib/managerRestaurants";
import { initManagerNotifications } from "../lib/managerNotifications";
import { queryKeys } from "../lib/queryKeys";
import { resolveAccountName, resolveManagerDisplayName } from "../lib/userIdentity";

const ADMIN_DISPLAY_NAME = "Matt D (clarivore administrator)";

function setAutoRestaurant(restaurants, preferRecent = true) {
  if (!Array.isArray(restaurants) || !restaurants.length) return null;

  let selection = null;
  const storedId = localStorage.getItem("helpSelectedRestaurantId");
  if (storedId) {
    selection = restaurants.find((row) => String(row.id) === storedId) || null;
  }

  if (!selection && preferRecent) {
    try {
      const recent = JSON.parse(
        localStorage.getItem("recentlyViewedRestaurants") || "[]",
      );
      const recentSlug = Array.isArray(recent) && recent.length ? recent[0] : null;
      if (recentSlug) {
        selection = restaurants.find((row) => row.slug === recentSlug) || null;
      }
    } catch {
      selection = null;
    }
  }

  if (!selection) {
    selection = restaurants[0] || null;
  }

  if (selection) {
    localStorage.setItem("helpSelectedRestaurantId", String(selection.id));
    if (selection.slug) {
      localStorage.setItem("helpAssistantRestaurantSlug", selection.slug);
    }
  }

  return selection;
}

export default function HelpContactClient() {
  const router = useRouter();
  const [bootError, setBootError] = useState("");
  const [user, setUser] = useState(null);
  const [managerRestaurants, setManagerRestaurants] = useState([]);
  const [allRestaurants, setAllRestaurants] = useState([]);
  const [isEditorMode, setIsEditorMode] = useState(false);
  const [assistantModeReady, setAssistantModeReady] = useState(false);
  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestaurantId, setSelectedRestaurantId] = useState("");
  const [selectedRestaurant, setSelectedRestaurant] = useState(null);

  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState("");
  const [feedbackTone, setFeedbackTone] = useState("idle");
  const [feedbackSending, setFeedbackSending] = useState(false);

  const [issueText, setIssueText] = useState("");
  const [issueStatus, setIssueStatus] = useState("");
  const [issueTone, setIssueTone] = useState("idle");
  const [issueSending, setIssueSending] = useState(false);

  const [chatMessages, setChatMessages] = useState([]);
  const [chatReadState, setChatReadState] = useState({ admin: null, restaurant: null });
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);

  const helpQueryRef = useRef(null);
  const helpAskBtnRef = useRef(null);
  const helpStatusRef = useRef(null);
  const helpConversationRef = useRef(null);
  const helpNewConversationBtnRef = useRef(null);
  const assistantBoundModeRef = useRef("");

  const managerDisplayName = useMemo(() => resolveManagerDisplayName(user), [user]);

  const mode = isEditorMode ? "manager" : "customer";
  const isManagerOrOwner = isManagerOrOwnerUser(user);

  const applyRestaurantSelection = useCallback((availableRestaurants, preferRecent) => {
    setRestaurants(availableRestaurants);
    const initialSelection = setAutoRestaurant(availableRestaurants, preferRecent);
    if (initialSelection) {
      setSelectedRestaurantId(String(initialSelection.id));
      setSelectedRestaurant(initialSelection);
    } else {
      setSelectedRestaurantId("");
      setSelectedRestaurant(null);
    }
  }, []);

  const bootQuery = useQuery({
    queryKey: queryKeys.auth.user("help-contact"),
    enabled: Boolean(supabase),
    queryFn: async () => {
      if (!supabase) {
        throw new Error("Supabase env vars are missing.");
      }

      const {
        data: { user: authUser },
        error,
      } = await supabase.auth.getUser();
      if (error) throw error;

      if (!authUser) {
        return { redirect: "/account?mode=signin" };
      }

      const hasManagerAccess = isManagerOrOwnerUser(authUser);
      const managerRestaurants = hasManagerAccess
        ? await fetchManagerRestaurants(supabase, authUser)
        : [];

      const storedMode = localStorage.getItem("clarivoreManagerMode");
      const nextEditorMode = hasManagerAccess && storedMode === "editor";

      const { data, error: restaurantsError } = await supabase
        .from("restaurants")
        .select("id, name, slug")
        .order("name");
      if (restaurantsError) throw restaurantsError;

      const availableAllRestaurants = data || [];
      const initialRestaurants =
        nextEditorMode && hasManagerAccess
          ? managerRestaurants
          : availableAllRestaurants;

      return {
        redirect: "",
        user: authUser,
        hasManagerAccess,
        managerRestaurants,
        allRestaurants: availableAllRestaurants,
        nextEditorMode,
        initialRestaurants,
      };
    },
    staleTime: 30 * 1000,
  });

  const onModeChange = useCallback(
    (nextMode) => {
      if (!isManagerOrOwner) return;
      if (nextMode !== "editor" && nextMode !== "customer") return;

      localStorage.setItem("clarivoreManagerMode", nextMode);
      const nextEditorMode = nextMode === "editor";
      setIsEditorMode(nextEditorMode);

      const nextRestaurants = nextEditorMode
        ? managerRestaurants
        : allRestaurants;
      applyRestaurantSelection(nextRestaurants, !nextEditorMode);
    },
    [
      allRestaurants,
      applyRestaurantSelection,
      isManagerOrOwner,
      managerRestaurants,
    ],
  );

  const onSignOut = useCallback(async () => {
    if (!supabase) return;
    try {
      await supabase.auth.signOut();
      router.replace("/account?mode=signin");
    } catch (error) {
      console.error("[help-contact] sign-out failed", error);
      setBootError("Unable to sign out right now.");
    }
  }, [router]);

  const loadChatReadState = useCallback(async () => {
    if (!supabase || !selectedRestaurantId) {
      return { admin: null, restaurant: null };
    }

    try {
      const { data, error } = await supabase
        .from("restaurant_direct_message_reads")
        .select("restaurant_id, reader_role, last_read_at, acknowledged_at")
        .eq("restaurant_id", selectedRestaurantId)
        .in("reader_role", ["admin", "restaurant"]);

      if (error) throw error;
      const next = { admin: null, restaurant: null };
      (data || []).forEach((row) => {
        if (row.reader_role === "admin") next.admin = row;
        if (row.reader_role === "restaurant") next.restaurant = row;
      });
      return next;
    } catch (error) {
      console.error("[help-contact] failed to load chat read state", error);
      return { admin: null, restaurant: null };
    }
  }, [selectedRestaurantId]);

  const getUnreadCountForManager = useCallback(
    async (lastReadAt) => {
      if (!supabase || !selectedRestaurantId) return 0;

      try {
        let query = supabase
          .from("restaurant_direct_messages")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", selectedRestaurantId)
          .eq("sender_role", "admin");

        if (lastReadAt) {
          query = query.gt("created_at", lastReadAt);
        }

        const { count, error } = await query;
        if (error) throw error;
        return count || 0;
      } catch (error) {
        console.error("[help-contact] failed to count unread chat messages", error);
        return 0;
      }
    },
    [selectedRestaurantId],
  );

  const loadChatMessages = useCallback(async () => {
    if (!supabase || !selectedRestaurantId || !isEditorMode) {
      setChatMessages([]);
      setChatReadState({ admin: null, restaurant: null });
      setChatUnreadCount(0);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("restaurant_direct_messages")
        .select("id, message, sender_role, sender_name, created_at")
        .eq("restaurant_id", selectedRestaurantId)
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;

      const nextReadState = await loadChatReadState();
      const unread = await getUnreadCountForManager(
        nextReadState?.restaurant?.last_read_at || null,
      );

      setChatMessages(data || []);
      setChatReadState(nextReadState);
      setChatUnreadCount(unread);
    } catch (error) {
      console.error("[help-contact] failed to load chat messages", error);
      setChatMessages([]);
      setChatReadState({ admin: null, restaurant: null });
      setChatUnreadCount(0);
    }
  }, [getUnreadCountForManager, isEditorMode, loadChatReadState, selectedRestaurantId]);

  const chatRenderData = useMemo(() => {
    const messages = chatMessages.slice().reverse();

    const findAckIndex = (targetRole, acknowledgedAt) => {
      const ackTime = new Date(acknowledgedAt).getTime();
      if (Number.isNaN(ackTime)) return -1;
      let indexMatch = -1;
      messages.forEach((message, index) => {
        if (message.sender_role !== targetRole) return;
        const messageTime = new Date(message.created_at).getTime();
        if (!Number.isNaN(messageTime) && messageTime <= ackTime) {
          indexMatch = index;
        }
      });
      return indexMatch;
    };

    const byIndex = new Map();
    const pushAck = (index, entry) => {
      if (index < 0) return;
      const existing = byIndex.get(index) || [];
      existing.push(entry);
      byIndex.set(index, existing);
    };

    if (chatReadState?.admin?.acknowledged_at) {
      const index = findAckIndex("restaurant", chatReadState.admin.acknowledged_at);
      pushAck(index, {
        name: ADMIN_DISPLAY_NAME,
        acknowledgedAt: chatReadState.admin.acknowledged_at,
      });
    }

    if (chatReadState?.restaurant?.acknowledged_at) {
      const index = findAckIndex(
        "admin",
        chatReadState.restaurant.acknowledged_at,
      );
      pushAck(index, {
        name: managerDisplayName,
        acknowledgedAt: chatReadState.restaurant.acknowledged_at,
      });
    }

    return { messages, ackByIndex: byIndex };
  }, [chatMessages, chatReadState, managerDisplayName]);

  const sendChatMessage = useCallback(async () => {
    if (!supabase || !selectedRestaurantId) {
      setIssueStatus("No restaurant is linked to this account yet.");
      setIssueTone("error");
      return;
    }

    const message = chatInput.trim();
    if (!message || chatSending) return;

    setChatSending(true);
    try {
      const senderName = managerDisplayName;
      const { error } = await supabase.from("restaurant_direct_messages").insert({
        restaurant_id: selectedRestaurantId,
        message,
        sender_role: "restaurant",
        sender_name: senderName,
        sender_id: user?.id || null,
      });
      if (error) throw error;

      setChatInput("");
      await loadChatMessages();
    } catch (error) {
      console.error("[help-contact] failed to send chat message", error);
      setIssueStatus("Failed to send message. Please try again.");
      setIssueTone("error");
    } finally {
      setChatSending(false);
    }
  }, [chatInput, chatSending, loadChatMessages, managerDisplayName, selectedRestaurantId, user]);

  const acknowledgeChat = useCallback(async () => {
    if (!supabase || !selectedRestaurantId) return;

    const now = new Date().toISOString();
    try {
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

      setChatReadState((previous) => ({
        ...(previous || { admin: null, restaurant: null }),
        restaurant: {
          restaurant_id: selectedRestaurantId,
          reader_role: "restaurant",
          last_read_at: now,
          acknowledged_at: now,
        },
      }));
      setChatUnreadCount(0);
    } catch (error) {
      console.error("[help-contact] failed to acknowledge chat", error);
      setIssueStatus("Failed to acknowledge messages. Please try again.");
      setIssueTone("error");
    }
  }, [selectedRestaurantId]);

  const handleAnonymousFeedback = useCallback(async () => {
    const text = feedbackText.trim();

    if (!text) {
      setFeedbackStatus("Please enter your feedback.");
      setFeedbackTone("error");
      return;
    }

    setFeedbackSending(true);
    setFeedbackStatus("Sending...");
    setFeedbackTone("idle");

    try {
      const response = await fetch("/api/report-issue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          context: "help_feedback",
          message: text,
          pageUrl: window.location.href,
          restaurantName: selectedRestaurant?.name || "Clarivore",
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || "Failed to send feedback.");
      }

      setFeedbackStatus("Thanks for the feedback.");
      setFeedbackTone("success");
      setFeedbackText("");
    } catch (error) {
      console.error("[help-contact] feedback send failed", error);
      setFeedbackStatus("Something went wrong. Please try again.");
      setFeedbackTone("error");
    } finally {
      setFeedbackSending(false);
    }
  }, [feedbackText, selectedRestaurant?.name]);

  const handleReportIssue = useCallback(async () => {
    const text = issueText.trim();
    if (!text) {
      setIssueStatus("Please describe the issue.");
      setIssueTone("error");
      return;
    }

    setIssueSending(true);
    setIssueStatus("Sending...");
    setIssueTone("idle");

    try {
      const accountName = resolveAccountName(user);
      const payload = {
        restaurantId: selectedRestaurantId || null,
        restaurantName: selectedRestaurant?.name || "Clarivore",
        context: isEditorMode ? "help_editor_issue" : "help_customer_issue",
        message: text,
        pageUrl: window.location.href,
        userEmail: user?.email || null,
        reporterName: accountName,
        accountName,
        accountId: user?.id || null,
      };

      const response = await fetch("/api/report-issue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload || {}),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || "Issue report request failed.");
      }

      setIssueStatus("Report sent. Thank you.");
      setIssueTone("success");
      setIssueText("");
    } catch (error) {
      console.error("[help-contact] issue report failed", error);
      setIssueStatus("Something went wrong. Please try again.");
      setIssueTone("error");
    } finally {
      setIssueSending(false);
    }
  }, [isEditorMode, issueText, selectedRestaurant, selectedRestaurantId, user]);

  useEffect(() => {
    if (!bootQuery.data) return;
    if (bootQuery.data.redirect) {
      router.replace(bootQuery.data.redirect);
      return;
    }

    setUser(bootQuery.data.user || null);
    setManagerRestaurants(bootQuery.data.managerRestaurants || []);
    setAllRestaurants(bootQuery.data.allRestaurants || []);
    setIsEditorMode(Boolean(bootQuery.data.nextEditorMode));
    applyRestaurantSelection(
      bootQuery.data.initialRestaurants || [],
      !bootQuery.data.nextEditorMode,
    );
    setAssistantModeReady(true);

    if (bootQuery.data.hasManagerAccess) {
      initManagerNotifications({ user: bootQuery.data.user, client: supabase });
    }
  }, [applyRestaurantSelection, bootQuery.data, router]);

  useEffect(() => {
    if (!bootQuery.isError) return;
    setBootError(bootQuery.error?.message || "Failed to load help page.");
    setAssistantModeReady(false);
  }, [bootQuery.error, bootQuery.isError]);

  useEffect(() => {
    if (!selectedRestaurantId || !restaurants.length) {
      setSelectedRestaurant(null);
      return;
    }
    const match =
      restaurants.find((row) => String(row.id) === String(selectedRestaurantId)) ||
      null;
    setSelectedRestaurant(match);
  }, [restaurants, selectedRestaurantId]);

  useEffect(() => {
    if (!isEditorMode) {
      setChatMessages([]);
      setChatReadState({ admin: null, restaurant: null });
      setChatUnreadCount(0);
      return;
    }
    loadChatMessages();
  }, [isEditorMode, loadChatMessages]);

  useEffect(() => {
    if (!user || !assistantModeReady) return;
    if (!helpQueryRef.current) return;
    if (!helpAskBtnRef.current) return;
    if (!helpConversationRef.current) return;

    if (assistantBoundModeRef.current === mode) {
      return;
    }

    assistantBoundModeRef.current = mode;

    let cancelled = false;

    async function initAssistant() {
      try {
        const {
          initHelpAssistantPanel,
          setHelpAssistantMode,
        } = await import("../lib/helpAssistantDrawer");

        if (cancelled) return;

        setHelpAssistantMode(mode);
        initHelpAssistantPanel({
          mode,
          input: helpQueryRef.current,
          sendBtn: helpAskBtnRef.current,
          newBtn: helpNewConversationBtnRef.current,
          statusEl: helpStatusRef.current,
          conversationEl: helpConversationRef.current,
        });
      } catch (error) {
        console.error("[help-contact] failed to initialize assistant panel", error);
        if (helpStatusRef.current) {
          helpStatusRef.current.textContent = "Help assistant is unavailable right now.";
          helpStatusRef.current.style.color = "#ef4444";
        }
      }
    }

    initAssistant();

    return () => {
      cancelled = true;
    };
  }, [assistantModeReady, mode, user]);

  const onChatInputKeyDown = useCallback(
    (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendChatMessage();
      }
    },
    [sendChatMessage],
  );

  const editorChatEmptyText = selectedRestaurantId
    ? "No messages yet."
    : "No restaurant linked yet.";

  return (
    <PageShell
      shellClassName="page-shell route-help-contact"
      mainClassName="help-main"
      contentClassName="help-container"
      topbar={
        <AppTopbar
          mode={isEditorMode ? "editor" : "customer"}
          user={user || null}
          managerRestaurants={managerRestaurants}
          currentRestaurantSlug={selectedRestaurant?.slug || ""}
          onSignOut={onSignOut}
          onModeChange={onModeChange}
        />
      }
      afterMain={
        bootError ? (
          <p
            className="status-text error"
            style={{ margin: "12px auto 0", maxWidth: 1100, padding: "0 20px" }}
          >
            {bootError}
          </p>
        ) : null
      }
    >
          <PageHeading
            className="help-header"
            title="Help"
            subtitle="Ask how to use Clarivore, or send feedback and issues to the team."
          />

          <SurfaceCard className="help-panel" id="helpSearchPanel">
            <div className="help-search-row">
              <textarea
                id="helpQuery"
                rows={1}
                placeholder="Ask a question about Clarivore..."
                ref={helpQueryRef}
              />
              <button className="btn btnPrimary" id="helpAskBtn" ref={helpAskBtnRef}>
                Ask
              </button>
              <button
                className="btn btnGhost"
                id="helpNewConversationBtn"
                ref={helpNewConversationBtnRef}
              >
                New conversation
              </button>
            </div>
            <div className="help-status" id="helpSearchStatus" ref={helpStatusRef} />
            <div className="help-conversation" id="helpConversation" ref={helpConversationRef} />
          </SurfaceCard>

          <SplitColumns className="help-grid" id="helpGrid">
            {isEditorMode ? (
              <>
                <ChatPreviewPanel
                  title="Direct chat with Clarivore administrator"
                  unreadCount={chatUnreadCount}
                  messages={selectedRestaurantId ? chatRenderData.messages : []}
                  ackByIndex={chatRenderData.ackByIndex}
                  inputValue={chatInput}
                  onInputChange={setChatInput}
                  onInputKeyDown={onChatInputKeyDown}
                  onSend={sendChatMessage}
                  onAcknowledge={acknowledgeChat}
                  sending={chatSending}
                  emptyText={editorChatEmptyText}
                  cardClassName="help-card"
                  senderLabelResolver={(message) => {
                    const rawSenderName = String(message.sender_name || "").trim();
                    const isOutgoing = message.sender_role === "restaurant";
                    if (isOutgoing) {
                      return rawSenderName && rawSenderName.toLowerCase() !== "you"
                        ? rawSenderName
                        : managerDisplayName;
                    }
                    return rawSenderName || ADMIN_DISPLAY_NAME;
                  }}
                  isOutgoingResolver={(message) => message.sender_role === "restaurant"}
                />

                <SurfaceCard className="help-card" title="Report an issue" subtitle="Share any problems you find while managing your restaurant.">
                  <textarea
                    id="helpIssueText"
                    placeholder="Describe the issue..."
                    value={issueText}
                    onChange={(event) => setIssueText(event.target.value)}
                  />
                  <div
                    className="help-status"
                    id="helpIssueStatus"
                    style={{
                      color:
                        issueTone === "error"
                          ? "#ef4444"
                          : issueTone === "success"
                            ? "#22c55e"
                            : "var(--muted)",
                    }}
                  >
                    {issueStatus}
                  </div>
                  <button
                    className="btn btnPrimary"
                    id="helpIssueSend"
                    type="button"
                    onClick={handleReportIssue}
                    disabled={issueSending}
                  >
                    {issueSending ? "Sending..." : "Send report"}
                  </button>
                </SurfaceCard>
              </>
            ) : (
              <>
                <SurfaceCard className="help-card" title="Anonymous feedback" subtitle="Share your experience privately. This feedback is anonymous.">
                  <textarea
                    id="helpFeedbackText"
                    placeholder="What should we know?"
                    value={feedbackText}
                    onChange={(event) => setFeedbackText(event.target.value)}
                  />
                  <div
                    className="help-status"
                    id="helpFeedbackStatus"
                    style={{
                      color:
                        feedbackTone === "error"
                          ? "#ef4444"
                          : feedbackTone === "success"
                            ? "#22c55e"
                            : "var(--muted)",
                    }}
                  >
                    {feedbackStatus}
                  </div>
                  <button
                    className="btn btnPrimary"
                    id="helpFeedbackSend"
                    type="button"
                    onClick={handleAnonymousFeedback}
                    disabled={feedbackSending}
                  >
                    {feedbackSending ? "Sending..." : "Send feedback"}
                  </button>
                </SurfaceCard>

                <SurfaceCard className="help-card" title="Report an issue" subtitle="Let us know about errors or problems you found.">
                  <textarea
                    id="helpIssueText"
                    placeholder="Describe the issue..."
                    value={issueText}
                    onChange={(event) => setIssueText(event.target.value)}
                  />
                  <div
                    className="help-status"
                    id="helpIssueStatus"
                    style={{
                      color:
                        issueTone === "error"
                          ? "#ef4444"
                          : issueTone === "success"
                            ? "#22c55e"
                            : "var(--muted)",
                    }}
                  >
                    {issueStatus}
                  </div>
                  <button
                    className="btn btnPrimary"
                    id="helpIssueSend"
                    type="button"
                    onClick={handleReportIssue}
                    disabled={issueSending}
                  >
                    {issueSending ? "Sending..." : "Send report"}
                  </button>
                </SurfaceCard>
              </>
            )}
          </SplitColumns>
    </PageShell>
  );
}
