import { getSupabaseClient } from "./runtimeSessionState.js";

export function initFeedbackModals(deps = {}) {
  const configureModalClose =
    typeof deps.configureModalClose === "function"
      ? deps.configureModalClose
      : () => {};
  const getIssueReportMeta =
    typeof deps.getIssueReportMeta === "function"
      ? deps.getIssueReportMeta
      : () => ({});
  const state = deps.state || {};
  const supabaseKey = deps.SUPABASE_KEY || "";

  function openFeedbackModal() {
    const mb = document.getElementById("modalBack");
    if (!mb) return;
    const body = document.getElementById("modalBody");
    document.getElementById("modalTitle").textContent = "Share Your Experience";

    body.innerHTML = `
<div style="max-width:520px;margin:0 auto">
  <p style="color:#a8b2d6;margin:0 0 20px;line-height:1.6;text-align:center">
    Help us ensure restaurant safety by sharing your experience with how this restaurant handles allergies. Your feedback is completely anonymous and will not be shared with the restaurant.
  </p>
  <form id="feedbackForm" style="display:flex;flex-direction:column;gap:16px">
    <textarea 
      id="feedbackText" 
      placeholder="For example: 'The staff was very knowledgeable about cross-contamination', 'I had a reaction to something not listed', 'They made great accommodations for my allergies'..."
      style="width:100%;min-height:140px;padding:12px;border-radius:10px;border:1px solid #2a3261;background:#0f163a;color:#e9ecff;font-family:inherit;resize:vertical;font-size:15px"
      required
    ></textarea>
    <div id="feedbackStatus" style="font-size:14px;min-height:20px;text-align:center"></div>
    <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
      <button type="button" class="btn" onclick="document.getElementById('modalBack').style.display='none'" style="padding:10px 20px;cursor:pointer">
        Cancel
      </button>
      <button type="submit" class="btn btnSecondary" style="padding:10px 20px;cursor:pointer">
        Send Feedback
      </button>
    </div>
  </form>
</div>
  `;

    configureModalClose({
      visible: true,
      onClick: () => {
        mb.style.display = "none";
        mb.onclick = null;
        const form = document.getElementById("feedbackForm");
        if (form) form.innerHTML = "";
      },
    });

    mb.style.display = "flex";

    const form = document.getElementById("feedbackForm");
    const statusDiv = document.getElementById("feedbackStatus");
    const feedbackText = document.getElementById("feedbackText");

    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const text = (feedbackText?.value || "").trim();
        if (!text) {
          if (statusDiv) statusDiv.textContent = "Please enter your feedback.";
          if (feedbackText) feedbackText.focus();
          return;
        }

        if (statusDiv) statusDiv.textContent = "Sending...";
        if (form.querySelector('button[type="submit"]')) {
          form.querySelector('button[type="submit"]').disabled = true;
        }

        try {
          const client = getSupabaseClient();
          if (!client) throw new Error("Database connection not ready");

          const restaurantId =
            state.restaurant?._id || state.restaurant?.id || null;
          if (!restaurantId)
            throw new Error("Restaurant information not available");

          console.log("Submitting feedback for restaurant ID:", restaurantId);

          const { data, error } = await client
            .from("anonymous_feedback")
            .insert([
              {
                restaurant_id: restaurantId,
                feedback_text: text,
              },
            ]);

          if (error) {
            console.error("Supabase error details:", error);
            throw error;
          }

          console.log("Feedback submitted successfully:", data);

          try {
            const restaurantName = state.restaurant?.name || "Restaurant";
            const restaurantSlug = state.restaurant?.slug || "";

            await fetch(
              "https://fgoiyycctnwnghrvsilt.supabase.co/functions/v1/send-notification-email",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${supabaseKey}`,
                  apikey: supabaseKey,
                },
                body: JSON.stringify({
                  type: "feedback",
                  restaurantName: restaurantName,
                  feedbackText: text,
                  restaurantSlug: restaurantSlug,
                }),
              },
            );
            console.log("Notification email sent");
          } catch (emailErr) {
            console.error("Failed to send notification email:", emailErr);
          }

          if (statusDiv) {
            statusDiv.textContent = "✓ Thank you for your feedback!";
            statusDiv.style.color = "#22c55e";
          }
          if (feedbackText) feedbackText.value = "";

          setTimeout(() => {
            mb.style.display = "none";
            mb.onclick = null;
          }, 1500);
        } catch (err) {
          console.error("Feedback submission error:", err);
          if (statusDiv) {
            let errorMsg =
              "Sorry, something went wrong. Please try again.";
            if (err.message === 'relation "anonymous_feedback" does not exist') {
              errorMsg =
                "Feature not available yet. Database setup in progress.";
            } else if (err.message) {
              errorMsg = `Error: ${err.message}`;
            }
            statusDiv.textContent = errorMsg;
            statusDiv.style.color = "#ef4444";
          }
          if (form.querySelector('button[type="submit"]')) {
            form.querySelector('button[type="submit"]').disabled = false;
          }
        }
      };
    }

    mb.onclick = (e) => {
      if (e.target === mb) {
        mb.style.display = "none";
        mb.onclick = null;
      }
    };

    if (feedbackText) {
      setTimeout(() => feedbackText.focus(), 100);
    }
  }

  function openReportIssueModal() {
    const mb = document.getElementById("modalBack");
    if (!mb) return;
    const body = document.getElementById("modalBody");
    document.getElementById("modalTitle").textContent = "Report an Issue";

    body.innerHTML = `
<div style="max-width:520px;margin:0 auto">
  <p style="color:#a8b2d6;margin:0 0 20px;line-height:1.6;text-align:center">
    Found incorrect information? Let us know so we can fix it.
  </p>
  <form id="reportIssueForm" style="display:flex;flex-direction:column;gap:16px">
    <textarea
      id="issueDetails"
      placeholder="Please describe the issue in detail..."
      style="width:100%;min-height:100px;padding:12px;border-radius:10px;border:1px solid #2a3261;background:#0f163a;color:#e9ecff;font-family:inherit;resize:vertical;font-size:15px"
      required
    ></textarea>
    <div id="reportStatus" style="font-size:14px;min-height:20px;text-align:center"></div>
    <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
      <button type="button" class="btn" onclick="document.getElementById('modalBack').style.display='none'" style="padding:10px 20px;cursor:pointer">
        Cancel
      </button>
      <button type="submit" class="btn btnSecondary" style="padding:10px 20px;cursor:pointer">
        Submit Report
      </button>
    </div>
  </form>
</div>
  `;

    configureModalClose({
      visible: true,
      onClick: () => {
        mb.style.display = "none";
        mb.onclick = null;
      },
    });

    mb.style.display = "flex";

    const form = document.getElementById("reportIssueForm");
    const statusDiv = document.getElementById("reportStatus");

    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const details = document.getElementById("issueDetails")?.value?.trim();

        if (!details) {
          if (statusDiv) statusDiv.textContent = "Please fill in all fields.";
          return;
        }

        if (statusDiv) statusDiv.textContent = "Sending...";
        form.querySelector('button[type="submit"]').disabled = true;

        try {
          const client = getSupabaseClient();
          if (!client) throw new Error("Database connection not ready");
          const restaurantId = state.restaurant?._id || state.restaurant?.id;
          const reportMeta = getIssueReportMeta();

          const { data, error } = await client.functions.invoke("report-issue", {
            body: {
              restaurantId,
              restaurantName: state.restaurant?.name || "",
              context: "menu_verification",
              message: details,
              userEmail: reportMeta.userEmail,
              reporterName: reportMeta.reporterName,
              accountName: reportMeta.accountName,
              accountId: reportMeta.accountId,
              pageUrl: reportMeta.pageUrl,
            },
          });

          if (error) throw error;

          if (statusDiv) {
            statusDiv.textContent = "✓ Thank you! We will review this issue.";
            statusDiv.style.color = "#22c55e";
          }

          setTimeout(() => {
            mb.style.display = "none";
            mb.onclick = null;
          }, 1500);
        } catch (err) {
          console.error("Report issue error:", err);
          if (statusDiv) {
            statusDiv.textContent =
              "Sorry, something went wrong. Please try again.";
            statusDiv.style.color = "#ef4444";
          }
          form.querySelector('button[type="submit"]').disabled = false;
        }
      };
    }

    mb.onclick = (e) => {
      if (e.target === mb) {
        mb.style.display = "none";
        mb.onclick = null;
      }
    };
  }

  return {
    openFeedbackModal,
    openReportIssueModal,
  };
}
