"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import AppTopbar from "../components/AppTopbar";
import PageShell from "../components/PageShell";
import PageHeading from "../components/surfaces/PageHeading";
import { Button, Input, Textarea } from "../components/ui";
import { queryKeys } from "../lib/queryKeys";
import { supabaseClient as supabase } from "../lib/supabase";
import { resolveAccountName } from "../lib/userIdentity";

export default function ReportIssueClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState(null);
  const [bootError, setBootError] = useState("");
  const [isOpen, setIsOpen] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState("idle");
  const issueMode = String(searchParams?.get("mode") || "").trim().toLowerCase();
  const isFeedbackMode = issueMode === "feedback";
  const pageTitle = isFeedbackMode ? "Send feedback" : "Report an issue";
  const modalDescription = isFeedbackMode
    ? "Share feedback about your Clarivore experience and suggestions."
    : "Tell us what needs attention and we will follow up quickly.";
  const messagePlaceholder = isFeedbackMode ? "Share your feedback" : "Describe the issue";
  const successMessage = isFeedbackMode
    ? "Thanks. We received your feedback."
    : "Thanks. We received your report.";
  const authQuery = useQuery({
    queryKey: queryKeys.auth.user("report-issue"),
    enabled: Boolean(supabase),
    queryFn: async () => {
      const {
        data: { user: authUser },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError) throw authError;
      return authUser || null;
    },
    staleTime: 30 * 1000,
  });

  const submitMutation = useMutation({
    mutationFn: async (payload) => {
      const response = await fetch("/api/report-issue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload || {}),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Failed to submit issue report.");
      }
      return true;
    },
  });

  const submitLabel = useMemo(
    () =>
      submitMutation.isPending
        ? "Sending..."
        : isFeedbackMode
          ? "Send feedback"
          : "Send",
    [isFeedbackMode, submitMutation.isPending],
  );

  useEffect(() => {
    if (!supabase) {
      setBootError("Supabase env vars are missing.");
      return;
    }
    if (!authQuery.isError) return;
    setBootError(authQuery.error?.message || "Failed to load report issue page.");
  }, [authQuery.error, authQuery.isError]);

  useEffect(() => {
    const authUser = authQuery.data || null;
    setUser(authUser);
    if (authUser?.email) {
      setEmail((current) => current || authUser.email);
    }
  }, [authQuery.data]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleEsc = (event) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("keydown", handleEsc);
    };
  }, [isOpen]);

  const onSignOut = useCallback(async () => {
    if (!supabase) return;
    try {
      await supabase.auth.signOut();
      router.replace("/account?mode=signin");
    } catch (error) {
      console.error("[report-issue] sign-out failed", error);
      setBootError("Unable to sign out right now.");
    }
  }, [router]);

  const onSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      if (!supabase) {
        setStatus("Supabase is not configured.");
        setStatusTone("error");
        return;
      }

      const trimmedEmail = email.trim();
      const trimmedMessage = message.trim();
      const trimmedName = name.trim();

      if (!trimmedEmail) {
        setStatus("Please enter your email so we can follow up.");
        setStatusTone("error");
        return;
      }
      if (!trimmedMessage) {
        setStatus(isFeedbackMode ? "Please share your feedback." : "Please describe the issue.");
        setStatusTone("error");
        return;
      }

      setStatus("");
      setStatusTone("idle");

      try {
        const payload = {
          message: trimmedMessage,
          context: isFeedbackMode ? "website_feedback" : "site_issue",
          pageUrl: window.location.href,
          userEmail: trimmedEmail,
          reporterName: trimmedName || null,
          accountName: resolveAccountName(user, trimmedName),
          accountId: user?.id || null,
        };

        await submitMutation.mutateAsync(payload);

        setStatus(successMessage);
        setStatusTone("success");
        setMessage("");
        window.setTimeout(() => {
          setIsOpen(false);
          setStatus("");
          setStatusTone("idle");
        }, 1200);
      } catch (error) {
        console.error("[report-issue] submit failed", error);
        setStatus("Something went wrong. Please try again.");
        setStatusTone("error");
      }
    },
    [email, isFeedbackMode, message, name, submitMutation, successMessage, user],
  );

  return (
    <PageShell
      shellClassName="page-shell route-report-issue"
      mainClassName=""
      wrapContent={false}
      topbar={
        <AppTopbar mode="customer" user={user || null} onSignOut={onSignOut} />
      }
      afterMain={
        <>
          <footer className="reportFooter">
            <button
              type="button"
              className="reportFab"
              id="reportIssueButton"
              onClick={() => setIsOpen(true)}
            >
              {pageTitle}
            </button>
          </footer>

          <div
            className={`reportOverlay ${isOpen ? "show" : ""}`}
            id="reportIssueOverlay"
            aria-hidden={!isOpen}
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                setIsOpen(false);
              }
            }}
          >
            <div
              className="reportModal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="reportIssueTitle"
            >
              <button
                className="reportClose"
                type="button"
                aria-label={`Close ${isFeedbackMode ? "feedback" : "report"} form`}
                onClick={() => setIsOpen(false)}
              >
                ×
              </button>
              <h2 id="reportIssueTitle">{pageTitle}</h2>
              <p
                style={{
                  margin: 0,
                  textAlign: "center",
                  color: "#a8b2d6",
                  fontSize: "0.95rem",
                }}
              >
                {modalDescription}
              </p>

              <form onSubmit={onSubmit}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Input
                    id="reportName"
                    name="name"
                    type="text"
                    placeholder="Your name (optional)"
                    wrapperClassName="flex-[1_1_160px]"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <Input
                    id="reportEmail"
                    name="email"
                    type="email"
                    placeholder="Email (required)"
                    wrapperClassName="flex-[1_1_200px]"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>

                <Textarea
                  id="reportMessage"
                  name="message"
                  placeholder={messagePlaceholder}
                  required
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />

                <div
                  className={`reportStatus ${
                    statusTone === "error"
                      ? "error"
                      : statusTone === "success"
                        ? "success"
                        : ""
                  }`}
                  id="reportStatus"
                  aria-live="polite"
                >
                  {status}
                </div>

                <Button
                  type="submit"
                  id="reportSubmit"
                  loading={submitMutation.isPending}
                  disabled={submitMutation.isPending}
                >
                  {submitLabel}
                </Button>
              </form>
            </div>
          </div>

          {bootError ? (
            <p
              className="status-text error"
              style={{ margin: "12px auto 0", maxWidth: 900, padding: "0 20px" }}
            >
              {bootError}
            </p>
          ) : null}
        </>
      }
    >
      <PageHeading
        centered
        title={pageTitle}
        subtitle={
          isFeedbackMode
            ? "The feedback form opens in a popup. Tap the button below to continue."
            : "The report form opens in a popup. Tap the button below to continue."
        }
      />
    </PageShell>
  );
}
