export default function RestaurantLoaderOverlay({ status, error }) {
  return (
    <>
      <style>{`
        html, body { background: #0b1020; }
        #pageLoader {
          position: fixed;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          background: #0b1020;
          color: #e9ecff;
          z-index: 10000;
          opacity: 1;
          transition: opacity 0.3s ease;
        }
        #pageLoader.hidden { opacity: 0; pointer-events: none; }
        #pageLoader img { width: 72px; height: 72px; }
        #pageLoader .pageLoaderSpinner {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: 4px solid rgba(233, 236, 255, 0.2);
          border-top-color: #7c9cff;
          animation: pageLoaderSpin 1s linear infinite;
        }
        @keyframes pageLoaderSpin { to { transform: rotate(360deg); } }
      `}</style>

      <div id="pageLoader" role="status" aria-live="polite" aria-label="Loading">
        <img src="/favicon.png" alt="Clarivore" />
        <div className="pageLoaderSpinner" aria-hidden="true" />
        {status ? <p style={{ margin: 0 }}>{status}</p> : null}
        {error ? <p style={{ margin: 0, color: "#ef4444" }}>{error}</p> : null}
      </div>
    </>
  );
}
