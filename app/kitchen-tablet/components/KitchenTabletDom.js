export default function KitchenTabletDom() {
  return (
    <div className="page-shell">
      <style>{`
        .tablet-page {
          display: flex;
          flex-direction: column;
          gap: 24px;
          max-width: 800px;
          margin: 0 auto;
        }

        .tablet-filters {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 12px;
          margin-top: 12px;
        }

        .tablet-filter {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 0.9rem;
          color: rgba(255, 255, 255, 0.7);
          cursor: pointer;
        }

        .tablet-filter input {
          width: 16px;
          height: 16px;
          accent-color: #6b7bd9;
          cursor: pointer;
        }

        .kitchen-queue {
          display: grid;
          gap: 20px;
        }

        .kitchen-card {
          background: linear-gradient(145deg, rgba(26, 35, 65, 0.95), rgba(18, 25, 50, 0.98));
          border-radius: 18px;
          padding: 24px;
          border: 1px solid rgba(92, 108, 210, 0.3);
          box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.03) inset;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .kitchen-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 20px 56px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
        }

        .kitchen-card header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 20px;
          padding-bottom: 16px;
          border-bottom: 1px solid rgba(92, 108, 210, 0.15);
          position: relative;
          z-index: 1;
        }

        .kitchen-card header h2 {
          font-size: 1.4rem;
          font-weight: 600;
          margin: 0 0 8px 0;
          color: #fff;
          letter-spacing: -0.01em;
        }

        .kitchen-meta {
          font-size: 0.9rem;
          color: rgba(255, 255, 255, 0.6);
          line-height: 1.6;
        }

        .kitchen-meta + .kitchen-meta {
          margin-top: 4px;
        }

        .kitchen-action-row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin: 8px 0 16px;
        }

        .question-inline {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: baseline;
        }

        .question-inline strong {
          color: #fff;
        }

        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          border-radius: 999px;
          font-size: 0.85rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          white-space: nowrap;
        }

        .status-badge[data-tone="warn"] {
          background: linear-gradient(135deg, rgba(255, 193, 7, 0.2), rgba(255, 152, 0, 0.15));
          color: #ffc107;
          border: 1px solid rgba(255, 193, 7, 0.3);
          box-shadow: 0 0 12px rgba(255, 193, 7, 0.15);
        }

        .status-badge[data-tone="warn"]::before {
          content: "";
          width: 8px;
          height: 8px;
          background: #ffc107;
          border-radius: 50%;
          animation: pulse-warn 2s ease-in-out infinite;
        }

        .status-badge[data-tone="success"] {
          background: linear-gradient(135deg, rgba(76, 175, 80, 0.2), rgba(56, 142, 60, 0.15));
          color: #66bb6a;
          border: 1px solid rgba(76, 175, 80, 0.3);
          box-shadow: 0 0 12px rgba(76, 175, 80, 0.15);
        }

        .status-badge[data-tone="success"]::before {
          content: "✓";
          font-size: 0.7rem;
        }

        .status-badge[data-tone="muted"] {
          background: rgba(92, 108, 210, 0.12);
          color: rgba(255, 255, 255, 0.6);
          border: 1px solid rgba(92, 108, 210, 0.2);
        }

        @keyframes pulse-warn {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }

        .kitchen-action-row button {
          border-radius: 10px;
          padding: 12px 20px;
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
          touch-action: manipulation;
          pointer-events: auto;
          position: relative;
          z-index: 11;
          transition: all 0.2s ease;
        }

        .kitchen-action-row .primary-btn {
          background: linear-gradient(135deg, #5c6cd2, #4a5bc7);
          border: none;
          color: #fff;
          box-shadow: 0 4px 16px rgba(92, 108, 210, 0.35);
        }

        .kitchen-action-row .primary-btn:hover:not(:disabled) {
          background: linear-gradient(135deg, #6b7bd9, #5565cf);
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(92, 108, 210, 0.45);
        }

        .kitchen-action-row .secondary-btn {
          background: rgba(92, 108, 210, 0.12);
          border: 1px solid rgba(92, 108, 210, 0.3);
          color: rgba(255, 255, 255, 0.8);
        }

        .kitchen-action-row .secondary-btn:hover:not(:disabled) {
          background: rgba(92, 108, 210, 0.2);
          border-color: rgba(92, 108, 210, 0.4);
        }

        .kitchen-action-row .danger-btn {
          background: linear-gradient(135deg, rgba(239, 68, 68, 0.85), rgba(220, 38, 38, 0.85));
          border: 1px solid rgba(239, 68, 68, 0.6);
          color: #fff;
          box-shadow: 0 4px 14px rgba(239, 68, 68, 0.35);
        }

        .kitchen-action-row .danger-btn:hover:not(:disabled) {
          background: linear-gradient(135deg, rgba(248, 113, 113, 0.9), rgba(239, 68, 68, 0.9));
          border-color: rgba(248, 113, 113, 0.8);
          transform: translateY(-1px);
          box-shadow: 0 6px 18px rgba(239, 68, 68, 0.45);
        }

        .kitchen-action-row button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .question-card,
        .faceid-log {
          margin-top: 16px;
          padding: 16px;
          border-radius: 12px;
          background: rgba(92, 108, 210, 0.1);
          border: 1px solid rgba(92, 108, 210, 0.15);
          color: rgba(255, 255, 255, 0.75);
          font-size: 0.9rem;
          line-height: 1.5;
        }

        .question-card strong,
        .faceid-log strong {
          color: rgba(255, 255, 255, 0.9);
        }

        .faceid-log ul {
          margin: 8px 0 0 0;
          padding-left: 20px;
        }

        .faceid-log li {
          margin-top: 4px;
          color: rgba(255, 255, 255, 0.6);
        }

        .kitchen-timestamps {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid rgba(92, 108, 210, 0.1);
        }

        .kitchen-timestamp {
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.5);
          margin-top: 4px;
        }

        .kitchen-timestamp-time {
          color: rgba(255, 255, 255, 0.35);
          margin-left: 8px;
        }

        .empty-tablet-state {
          text-align: center;
          padding: 64px 32px;
          border: 2px dashed rgba(92, 108, 210, 0.3);
          border-radius: 20px;
          color: rgba(255, 255, 255, 0.5);
          background: linear-gradient(145deg, rgba(26, 35, 65, 0.5), rgba(18, 25, 50, 0.6));
          font-size: 1.05rem;
        }

        .empty-tablet-state::before {
          content: "🍳";
          display: block;
          font-size: 3rem;
          margin-bottom: 16px;
          opacity: 0.6;
        }

        .kitchen-prompt-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(7, 10, 24, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          z-index: 4000;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.2s ease;
        }

        .kitchen-prompt-backdrop.show {
          opacity: 1;
          pointer-events: auto;
        }

        .kitchen-prompt-modal {
          width: min(460px, 92vw);
          background: rgba(14, 20, 44, 0.98);
          border-radius: 16px;
          padding: 20px;
          border: 1px solid rgba(92, 108, 210, 0.35);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .kitchen-prompt-modal h3 {
          margin: 0;
          font-size: 1.2rem;
          color: #fff;
        }

        .kitchen-prompt-modal p {
          margin: 0;
          color: rgba(255, 255, 255, 0.7);
          font-size: 0.95rem;
          line-height: 1.5;
        }

        .kitchen-prompt-modal textarea {
          width: 100%;
          min-height: 120px;
          border-radius: 12px;
          border: 1px solid rgba(92, 108, 210, 0.4);
          background: rgba(9, 14, 34, 0.9);
          color: #fff;
          padding: 12px 14px;
          font-size: 0.95rem;
          resize: vertical;
        }

        .kitchen-prompt-modal textarea:focus {
          outline: none;
          border-color: rgba(92, 108, 210, 0.7);
          box-shadow: 0 0 0 3px rgba(92, 108, 210, 0.2);
        }

        .kitchen-prompt-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          justify-content: flex-end;
        }

        @media (max-width: 600px) {
          .tablet-page {
            padding: 0 12px;
          }

          .kitchen-card {
            padding: 18px;
          }

          .kitchen-card header h2 {
            font-size: 1.2rem;
          }
        }
      `}</style>

      <header className="simple-topbar">
        <div className="simple-topbar-inner">
          <a className="simple-brand" href="/restaurants">
            <img
              src="https://static.wixstatic.com/media/945e9d_2b97098295d341d493e4a07d80d6b57c~mv2.png"
              alt="Clarivore logo"
            />
            <span>Clarivore</span>
          </a>
          <div className="simple-nav" />
        </div>
      </header>

      <main className="page-main">
        <div className="page-content tablet-page">
          <header>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 16,
                marginBottom: 12,
              }}
            >
              <div>
                <h1>Kitchen monitor</h1>
                <p className="muted-text">
                  Acknowledgements and follow-ups for active allergy notices.
                </p>
              </div>
              <button
                id="refresh-btn"
                type="button"
                className="secondary-btn"
                style={{ whiteSpace: "nowrap" }}
              >
                Refresh orders
              </button>
            </div>
            <div className="tablet-filters">
              <label className="tablet-filter" htmlFor="kitchen-show-completed">
                <input type="checkbox" id="kitchen-show-completed" />
                <span>Show completed/rescinded</span>
              </label>
            </div>
          </header>
          <section>
            <div id="kitchen-queue" className="kitchen-queue" />
          </section>
        </div>
      </main>

      <div className="kitchen-prompt-backdrop" id="kitchenPromptBackdrop" hidden>
        <div
          className="kitchen-prompt-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="kitchenPromptTitle"
        >
          <h3 id="kitchenPromptTitle">Follow-up question</h3>
          <p id="kitchenPromptMessage">
            Share the yes/no follow-up you need the diner to answer.
          </p>
          <textarea
            id="kitchenPromptInput"
            rows={4}
            placeholder="Type your message..."
          />
          <div className="kitchen-prompt-actions">
            <button type="button" className="secondary-btn" id="kitchenPromptCancel">
              Cancel
            </button>
            <button type="button" className="primary-btn" id="kitchenPromptConfirm">
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

