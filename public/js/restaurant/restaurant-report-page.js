export function renderRestaurantReportPage(options = {}) {
  const { renderTopbar, mountReportShell, send } = options;

  renderTopbar();
  const root = document.getElementById("root");
  mountReportShell(root);

  const sendButton = document.getElementById("rSend");
  if (!sendButton) return;

  sendButton.onclick = () => {
    const name = (document.getElementById("rName")?.value || "").trim();
    const email = (document.getElementById("rEmail")?.value || "").trim();
    const message = (document.getElementById("rMsg")?.value || "").trim();

    if (!email) {
      alert("Please enter your email.");
      return;
    }

    send({ type: "sendReport", name, email, message });
  };
}
