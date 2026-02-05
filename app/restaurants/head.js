export default function Head() {
  return (
    <>
      <title>All Restaurants - Clarivore</title>
      <link rel="icon" type="image/png" sizes="32x32" href="/favicon.png" />
      <link rel="icon" type="image/png" sizes="16x16" href="/favicon.png" />
      <link rel="apple-touch-icon" sizes="180x180" href="/favicon.png" />
      <link rel="stylesheet" href="/css/styles.css" />
      <style>{`
        .restaurant-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 20px;
          margin: 40px 0;
        }
        .restaurant-card {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 16px;
          overflow: hidden;
          transition: transform 0.2s;
          box-shadow: 0 16px 30px rgba(0,0,0,0.35);
        }
        .restaurant-card:hover {
          transform: translateY(-6px);
          border-color: var(--hover);
        }
        .restaurant-card img {
          width: 100%;
          height: 200px;
          object-fit: cover;
        }
        .restaurant-card-media { position: relative; }
        .restaurant-card-content { padding: 20px; }
        .restaurant-card h3 { margin-bottom: 10px; }
        .restaurant-card .meta { color: var(--muted); font-size: 0.9rem; margin-bottom: 14px; }
        .restaurant-card .cta-button {
          background: #3651ff;
          border: 1px solid #4e65ff;
          color: #fff;
        }
        .restaurant-card .cta-button:hover {
          transform: translateY(-1px);
          box-shadow: 0 10px 24px rgba(54,81,255,0.35);
        }
        .empty-state {
          text-align: center;
          color: var(--muted);
          padding: 60px 20px;
          border: 1px dashed var(--border);
          border-radius: 18px;
        }
      `}</style>
    </>
  );
}
