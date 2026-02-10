function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function PageShell({
  topbar = null,
  children = null,
  shellClassName = "page-shell",
  mainClassName = "page-main",
  contentClassName = "",
  wrapContent = true,
  afterMain = null,
}) {
  const content = wrapContent ? (
    <div className={joinClassNames("page-content", contentClassName)}>{children}</div>
  ) : (
    children
  );
  const mainProps = mainClassName ? { className: mainClassName } : {};

  return (
    <div className={shellClassName}>
      {topbar}
      <main {...mainProps}>{content}</main>
      {afterMain}
    </div>
  );
}
