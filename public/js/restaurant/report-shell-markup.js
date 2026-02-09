const LEGACY_REPORT_SHELL_HTML = `
<h1>Report an issue</h1>
<div style="max-width:640px">
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin:8px 0">
    <input id="rName" type="text" placeholder="Your name" style="flex:1">
    <input id="rEmail" type="email" placeholder="Email (required)" style="flex:1">
  </div>
  <textarea id="rMsg" rows="6" style="width:100%;border-radius:16px" placeholder="Describe the issue"></textarea>
  <div class="mgrRow" style="justify-content:flex-start"><button class="btn btnPrimary" id="rSend">Send</button></div>
  <div class="note">We require an email so we can follow up if needed.</div>
</div>
`;

export function mountReportShell(root) {
  if (!root) return;

  const template = document.getElementById("reportWorkspaceTemplate");
  if (
    typeof HTMLTemplateElement !== "undefined" &&
    template instanceof HTMLTemplateElement
  ) {
    root.replaceChildren(template.content.cloneNode(true));
    return;
  }

  root.innerHTML = LEGACY_REPORT_SHELL_HTML;
}
