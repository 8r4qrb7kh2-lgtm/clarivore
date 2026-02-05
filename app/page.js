export default function Home() {
  return (
    <main className="page">
      <section className="card">
        <p className="eyebrow">Clarivore</p>
        <h1>Next.js scaffold</h1>
        <p className="lead">
          This is the starting point for the Next.js migration. We'll port the
          existing flows here page by page.
        </p>
        <div className="links">
          <a className="button" href="/restaurants">
            Open Next restaurants
          </a>
          <a className="button ghost" href="/home.html">
            Open legacy customer UI
          </a>
          <a className="button ghost" href="/restaurant.html">
            Open legacy restaurant UI
          </a>
        </div>
        <div className="divider" />
        <h2>Migration intent</h2>
        <p className="muted">
          App Router with client-side data access and static export so iOS can
          load the same build when we cut over.
        </p>
      </section>
    </main>
  );
}
