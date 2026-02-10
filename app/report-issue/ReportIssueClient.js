"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageShell from "../components/PageShell";
import SimpleTopbar from "../components/SimpleTopbar";
import { supabaseClient as supabase } from "../lib/supabase";
import { isManagerOrOwnerUser } from "../lib/managerRestaurants";
import { createDinerTopbarLinks } from "../lib/topbarLinks";
import { resolveAccountName } from "../lib/userIdentity";

export default function ReportIssueClient() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [bootError, setBootError] = useState("");
  const [isOpen, setIsOpen] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submitLabel = useMemo(
    () => (isSubmitting ? "Sending..." : "Send"),
    [isSubmitting],
  );
  const isManagerOrOwner = isManagerOrOwnerUser(user);

  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        if (!supabase) {
          throw new Error("Supabase env vars are missing.");
        }

        const {
          data: { user: authUser },
          error: authError,
        } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!isMounted) return;

        setUser(authUser || null);
        if (authUser?.email) {
          setEmail(authUser.email);
        }
      } catch (error) {
        console.error("[report-issue] boot failed", error);
        if (isMounted) {
          setBootError(error?.message || "Failed to load report issue page.");
        }
      }
    }

    init();
    return () => {
      isMounted = false;
    };
  }, []);

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
        setStatus("Please describe the issue.");
        setStatusTone("error");
        return;
      }

      setIsSubmitting(true);
      setStatus("");
      setStatusTone("idle");

      try {
        const payload = {
          message: trimmedMessage,
          context: "site_issue",
          pageUrl: window.location.href,
          userEmail: trimmedEmail,
          reporterName: trimmedName || null,
          accountName: resolveAccountName(user, trimmedName),
          accountId: user?.id || null,
        };

        const { error } = await supabase.functions.invoke("report-issue", {
          body: payload,
        });
        if (error) throw error;

        setStatus("Thanks. We received your report.");
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
      } finally {
        setIsSubmitting(false);
      }
    },
    [email, message, name, user],
  );

  return (
    <PageShell
      mainClassName=""
      wrapContent={false}
      topbar={
        <SimpleTopbar
          brandHref="/home"
          links={createDinerTopbarLinks({
            includeFavorites: false,
            includeDishSearch: false,
            includeHelp: true,
            includeDashboard: true,
            dashboardVisible: isManagerOrOwner,
            includeAccount: false,
          })}
          showAuthAction
          signedIn={Boolean(user)}
          onSignOut={onSignOut}
        />
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
              Report an issue
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
                aria-label="Close report form"
                onClick={() => setIsOpen(false)}
              >
                ×
              </button>
              <h2 id="reportIssueTitle">Report an issue</h2>
              <p
                style={{
                  margin: 0,
                  textAlign: "center",
                  color: "#a8b2d6",
                  fontSize: "0.95rem",
                }}
              >
                Tell us what needs attention and we will follow up quickly.
              </p>

              <form onSubmit={onSubmit}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <input
                    id="reportName"
                    name="name"
                    type="text"
                    placeholder="Your name (optional)"
                    style={{ flex: "1 1 160px" }}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <input
                    id="reportEmail"
                    name="email"
                    type="email"
                    placeholder="Email (required)"
                    style={{ flex: "1 1 200px" }}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>

                <textarea
                  id="reportMessage"
                  name="message"
                  placeholder="Describe the issue"
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

                <button type="submit" id="reportSubmit" disabled={isSubmitting}>
                  {submitLabel}
                </button>
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
      <div>
        <h1>Report an issue</h1>
        <p>The report form opens in a popup. Tap the button below to continue.</p>
      </div>
    </PageShell>
  );
}
