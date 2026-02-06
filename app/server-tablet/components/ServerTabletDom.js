export default function ServerTabletDom() {
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

        .tablet-status {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          align-items: center;
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

        .tablet-status-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: rgba(92, 108, 210, 0.15);
          border: 1px solid rgba(92, 108, 210, 0.25);
          border-radius: 999px;
          padding: 8px 16px;
          font-size: 0.9rem;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 500;
        }

        .server-queue {
          display: grid;
          gap: 20px;
        }

        .server-order-card {
          background: linear-gradient(145deg, rgba(26, 35, 65, 0.95), rgba(18, 25, 50, 0.98));
          border-radius: 18px;
          padding: 24px;
          border: 1px solid rgba(92, 108, 210, 0.3);
          box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.03) inset;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .server-order-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 20px 56px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
        }

        .server-order-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 20px;
          padding-bottom: 16px;
          border-bottom: 1px solid rgba(92, 108, 210, 0.15);
        }

        .server-order-header h2 {
          font-size: 1.4rem;
          font-weight: 600;
          margin: 0 0 8px 0;
          color: #fff;
          letter-spacing: -0.01em;
        }

        .server-order-meta {
          font-size: 0.9rem;
          color: rgba(255, 255, 255, 0.6);
          line-height: 1.6;
        }

        .server-order-meta + .server-order-meta {
          margin-top: 4px;
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

        .status-badge[data-tone="info"] {
          background: linear-gradient(135deg, rgba(33, 150, 243, 0.2), rgba(25, 118, 210, 0.15));
          color: #42a5f5;
          border: 1px solid rgba(33, 150, 243, 0.3);
          box-shadow: 0 0 12px rgba(33, 150, 243, 0.15);
        }

        .status-badge[data-tone="info"]::before {
          content: "";
          width: 8px;
          height: 8px;
          background: #42a5f5;
          border-radius: 50%;
          animation: pulse-info 2s ease-in-out infinite;
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

        @keyframes pulse-info {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }

        .server-order-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 16px;
        }

        .server-order-actions button {
          border-radius: 10px;
          padding: 12px 20px;
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .server-order-actions button.primary-btn {
          background: linear-gradient(135deg, #5c6cd2, #4a5bc7);
          border: none;
          color: #fff;
          box-shadow: 0 4px 16px rgba(92, 108, 210, 0.35);
        }

        .server-order-actions button.primary-btn:hover:not(:disabled) {
          background: linear-gradient(135deg, #6b7bd9, #5565cf);
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(92, 108, 210, 0.45);
        }

        .server-order-actions button.secondary-btn {
          background: rgba(92, 108, 210, 0.12);
          border: 1px solid rgba(92, 108, 210, 0.3);
          color: rgba(255, 255, 255, 0.8);
        }

        .server-order-actions button.secondary-btn:hover:not(:disabled) {
          background: rgba(92, 108, 210, 0.2);
          border-color: rgba(92, 108, 210, 0.4);
        }

        .server-order-actions button.danger-btn {
          background: linear-gradient(135deg, rgba(239, 68, 68, 0.85), rgba(220, 38, 38, 0.85));
          border: 1px solid rgba(239, 68, 68, 0.6);
          color: #fff;
          box-shadow: 0 4px 14px rgba(239, 68, 68, 0.35);
        }

        .server-order-actions button.danger-btn:hover:not(:disabled) {
          background: linear-gradient(135deg, rgba(248, 113, 113, 0.9), rgba(239, 68, 68, 0.9));
          border-color: rgba(248, 113, 113, 0.8);
          transform: translateY(-1px);
          box-shadow: 0 6px 18px rgba(239, 68, 68, 0.45);
        }

        .server-order-actions button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
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
          content: "📋";
          display: block;
          font-size: 3rem;
          margin-bottom: 16px;
          opacity: 0.6;
        }

        .server-order-timestamps {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid rgba(92, 108, 210, 0.1);
        }

        .server-order-timestamp {
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.5);
          margin-top: 4px;
        }

        .server-order-timestamp-time {
          color: rgba(255, 255, 255, 0.35);
          margin-left: 8px;
        }

        .server-tabs {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 16px;
        }

        .server-tab {
          border-radius: 999px;
          padding: 10px 18px;
          background: rgba(92, 108, 210, 0.12);
          color: rgba(255, 255, 255, 0.6);
          cursor: pointer;
          border: 1px solid transparent;
          font-size: 0.9rem;
          font-weight: 500;
          transition: all 0.2s ease;
        }

        .server-tab:hover {
          background: rgba(92, 108, 210, 0.2);
          color: rgba(255, 255, 255, 0.8);
        }

        .server-tab.is-active {
          background: linear-gradient(135deg, rgba(92, 108, 210, 0.35), rgba(92, 108, 210, 0.25));
          color: #fff;
          border-color: rgba(92, 108, 210, 0.4);
          box-shadow: 0 2px 8px rgba(92, 108, 210, 0.2);
        }

        @media (max-width: 600px) {
          .tablet-page {
            padding: 0 12px;
          }

          .server-order-card {
            padding: 18px;
          }

          .server-order-header h2 {
            font-size: 1.2rem;
          }

          .server-order-actions {
            flex-direction: column;
          }

          .server-order-actions button {
            width: 100%;
            justify-content: center;
          }

          .server-tabs {
            overflow-x: auto;
            flex-wrap: nowrap;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
            -ms-overflow-style: none;
            padding-bottom: 4px;
          }

          .server-tabs::-webkit-scrollbar {
            display: none;
          }

          .server-tab {
            flex-shrink: 0;
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
                <h1>Server monitor</h1>
                <p className="muted-text">
                  Review allergy notices waiting for approval or dispatch.
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
            <div className="tablet-status" id="server-status" />
            <div className="tablet-filters">
              <label className="tablet-filter" htmlFor="server-show-completed">
                <input type="checkbox" id="server-show-completed" />
                <span>Show completed/rescinded</span>
              </label>
            </div>
          </header>
          <section>
            <div id="server-tabs" className="server-tabs" role="tablist" />
            <div id="server-queue" className="server-queue" />
          </section>
        </div>
      </main>
    </div>
  );
}

