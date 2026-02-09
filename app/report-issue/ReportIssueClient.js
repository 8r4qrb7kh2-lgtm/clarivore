"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseClient as supabase } from "../lib/supabase";
import { fetchManagerRestaurants } from "../lib/managerRestaurants";

function resolveAccountName(user, fallbackName = "") {
  if (!user) return (fallbackName || "").trim() || null;
  const firstName = user.user_metadata?.first_name || "";
  const lastName = user.user_metadata?.last_name || "";
  let fullName = `${firstName} ${lastName}`.trim();
  if (!fullName) fullName = (user.user_metadata?.full_name || "").trim();
  if (!fullName) fullName = (user.raw_user_meta_data?.full_name || "").trim();
  if (!fullName) fullName = (user.user_metadata?.name || "").trim();
  if (!fullName) fullName = (user.user_metadata?.display_name || "").trim();
  if (!fullName) fullName = (user.name || "").trim();
  if (!fullName && fallbackName) fullName = fallbackName.trim();
  return fullName || null;
}

export default function ReportIssueClient() {
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

        const [{ setupTopbar, attachSignOutHandler }, managerRestaurants] =
          await Promise.all([
            import(
              /* webpackIgnore: true */
              "/js/shared-nav.js"
            ),
            authUser
              ? fetchManagerRestaurants(supabase, authUser)
              : Promise.resolve([]),
          ]);

        if (!isMounted) return;
        setupTopbar("report-issue", authUser, { managerRestaurants });
        if (authUser) attachSignOutHandler(supabase);
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
    <div className="page-shell">
      <header className="simple-topbar">
        <div className="simple-topbar-inner">
          <Link className="simple-brand" href="/home">
            <img
              src="https://static.wixstatic.com/media/945e9d_2b97098295d341d493e4a07d80d6b57c~mv2.png"
              alt="Clarivore logo"
            />
            <span>Clarivore</span>
          </Link>
          <div className="simple-nav" />
          <div
            className="mode-toggle-container"
            id="modeToggleContainer"
            style={{ display: "none" }}
          />
        </div>
      </header>

      <main>
        <div>
          <h1>Report an issue</h1>
          <p>The report form opens in a popup. Tap the button below to continue.</p>
        </div>
      </main>

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
    </div>
  );
}
