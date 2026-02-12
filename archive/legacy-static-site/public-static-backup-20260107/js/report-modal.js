// Use the shared Supabase client from window
// Wait for it to be available if it's not ready yet
const getSupabaseClient = () => {
  return new Promise((resolve) => {
    if (window.supabaseClient) {
      resolve(window.supabaseClient);
    } else {
      const check = setInterval(() => {
        if (window.supabaseClient) {
          clearInterval(check);
          resolve(window.supabaseClient);
        }
      }, 50);
    }
  });
};

if (!window.__reportModalBootstrapped) {
  window.__reportModalBootstrapped = true;

  const STYLE_ID = 'report-modal-styles';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .reportFooter{
        margin-top:60px;
        padding:40px 20px 60px;
        display:flex;
        justify-content:center;
        width:100%;
      }
      .reportFab{
        background:#3651ff;
        border:1px solid #4e65ff;
        color:#fff;
        padding:12px 26px;
        border-radius:999px;
        font-weight:600;
        font-size:15px;
        cursor:pointer;
        display:inline-flex;
        align-items:center;
        gap:8px;
        box-shadow:0 12px 30px rgba(54,81,255,.25);
      }
      .reportFab:hover{box-shadow:0 12px 30px rgba(54,81,255,.4);}
      @media (max-width:640px){
        .reportFooter{padding:32px 16px 48px;}
        .reportFab{padding:10px 20px;font-size:14px;}
      }
      .reportOverlay{
        position:fixed;
        inset:0;
        background:rgba(9,12,28,0.82);
        display:none;
        align-items:center;
        justify-content:center;
        z-index:2600;
        padding:20px;
      }
      .reportOverlay.show{display:flex;}
      .reportModal{
        width:min(480px,calc(100% - 40px));
        background:linear-gradient(180deg,#121a3f,#0d132a);
        border:1px solid #2a3466;
        border-radius:20px;
        box-shadow:0 20px 50px rgba(0,0,0,.45);
        padding:28px 28px 26px;
        color:#e9ecff;
        position:relative;
        display:flex;
        flex-direction:column;
        gap:18px;
      }
      .reportModal h2{
        margin:0;
        font-size:clamp(1.2rem,1.05rem + 1vw,1.8rem);
        text-align:center;
      }
      .reportClose{
        position:absolute;
        top:18px;
        right:18px;
        width:30px;
        height:30px;
        border-radius:8px;
        border:1px solid #2a3466;
        background:#16205a;
        color:#fff;
        font-size:18px;
        cursor:pointer;
        display:flex;
        align-items:center;
        justify-content:center;
      }
      .reportClose:hover{border-color:#4c5ad4;box-shadow:0 0 8px #3651ff;}
      .reportModal form{display:flex;flex-direction:column;gap:12px;}
      .reportModal input,
      .reportModal textarea{
        width:100%;
        border-radius:12px;
        border:1px solid #2a3466;
        background:#101739;
        color:#e9ecff;
        padding:12px 14px;
        font-size:15px;
      }
      .reportModal textarea{min-height:140px;resize:vertical;}
      .reportModal button[type="submit"]{
        align-self:flex-start;
        background:#3651ff;
        border:1px solid #4e65ff;
        color:#fff;
        padding:10px 20px;
        border-radius:10px;
        font-weight:600;
        cursor:pointer;
      }
      .reportModal button[type="submit"]:disabled{
        opacity:0.6;
        cursor:wait;
      }
      .reportStatus{
        font-size:14px;
        color:#a8b2d6;
        min-height:18px;
      }
      .reportStatus.error{color:#ef4444;}
      .reportStatus.success{color:#22c55e;}
    `;
    document.head.appendChild(style);
  }

  const overlay = document.createElement('div');
  overlay.className = 'reportOverlay';
  overlay.id = 'reportIssueOverlay';
  overlay.innerHTML = `
    <div class="reportModal" role="dialog" aria-modal="true" aria-labelledby="reportIssueTitle">
      <button class="reportClose" type="button" aria-label="Close report form">×</button>
      <h2 id="reportIssueTitle">Report an issue</h2>
      <p style="margin:0;text-align:center;color:#a8b2d6;font-size:0.95rem;">Tell us what needs attention and we’ll follow up quickly.</p>
      <form>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <input id="reportName" name="name" type="text" placeholder="Your name (optional)" style="flex:1 1 160px;">
          <input id="reportEmail" name="email" type="email" placeholder="Email (required)" style="flex:1 1 200px;">
        </div>
        <textarea id="reportMessage" name="message" placeholder="Describe the issue" required></textarea>
        <div class="reportStatus" id="reportStatus" aria-live="polite"></div>
        <button type="submit" id="reportSubmit">Send</button>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'reportFab';
  trigger.id = 'reportIssueButton';
  trigger.innerHTML = 'Report an issue';
  const footer = document.createElement('footer');
  footer.className = 'reportFooter';
  footer.appendChild(trigger);
  document.body.appendChild(footer);

  const nameInput = overlay.querySelector('#reportName');
  const emailInput = overlay.querySelector('#reportEmail');
  const messageInput = overlay.querySelector('#reportMessage');
  const statusEl = overlay.querySelector('#reportStatus');
  const submitBtn = overlay.querySelector('#reportSubmit');
  const closeBtn = overlay.querySelector('.reportClose');

  const openModal = () => {
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
    statusEl.textContent = '';
    statusEl.classList.remove('error', 'success');
    setTimeout(() => {
      (nameInput.value ? messageInput : nameInput).focus({ preventScroll: true });
    }, 30);
  };

  const closeModal = () => {
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
  };

  trigger.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeModal();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay.classList.contains('show')) {
      closeModal();
    }
  });

  const submitReport = async (event) => {
    event.preventDefault();
    statusEl.classList.remove('error', 'success');
    statusEl.textContent = '';

    const email = (emailInput.value || '').trim();
    const name = (nameInput.value || '').trim();
    const message = (messageInput.value || '').trim();
    if (!email) {
      statusEl.textContent = 'Please enter your email so we can follow up.';
      statusEl.classList.add('error');
      emailInput.focus();
      return;
    }
    if (!message) {
      statusEl.textContent = 'Please describe the issue.';
      statusEl.classList.add('error');
      messageInput.focus();
      return;
    }

    submitBtn.disabled = true;
    const originalLabel = submitBtn.textContent;
    submitBtn.textContent = 'Sending…';

    try {
      const payload = {
        name,
        email,
        message,
        page_url: window.location.href
      };
      const client = await getSupabaseClient();
      const { error } = await client
        .from('issue_reports')
        .insert([payload]);
      if (error) throw error;

      statusEl.textContent = 'Thanks! We’ll reach out soon.';
      statusEl.classList.add('success');
      nameInput.value = '';
      messageInput.value = '';
      setTimeout(() => {
        closeModal();
        statusEl.textContent = '';
        statusEl.classList.remove('success');
      }, 1500);
    } catch (err) {
      console.error('Issue report failed', err);
      statusEl.textContent = 'Something went wrong. Please try again or email us directly.';
      statusEl.classList.add('error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  };

  overlay.querySelector('form').addEventListener('submit', submitReport);

  window.openReportModal = openModal;
  window.closeReportModal = closeModal;
  document.dispatchEvent(new Event('reportModalReady'));

  const banner = document.querySelector('.qrBanner');
  if (banner) {
    const adjustFooter = () => {
      footer.style.marginBottom = banner.classList.contains('show') ? '140px' : '';
    };
    const observer = new MutationObserver(adjustFooter);
    observer.observe(banner, { attributes: true, attributeFilter: ['class'] });
    adjustFooter();
  }
}
