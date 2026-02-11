import Link from "next/link";
import { Button } from "./ui";

const CLARIVORE_LOGO_SRC =
  "https://static.wixstatic.com/media/945e9d_2b97098295d341d493e4a07d80d6b57c~mv2.png";

export function ManagerModeSwitch({
  mode = "editor",
  onChange,
  customerLabel = "Customer",
  editorLabel = "Editor",
}) {
  return (
    <div className="mode-toggle-container" style={{ display: "flex" }}>
      <Button
        variant="link"
        style={{
          opacity: mode === "customer" ? 1 : 0.65,
          fontWeight: mode === "customer" ? 700 : 500,
        }}
        onClick={() => onChange?.("customer")}
      >
        {customerLabel}
      </Button>
      <Button
        variant="link"
        style={{
          opacity: mode === "editor" ? 1 : 0.65,
          fontWeight: mode === "editor" ? 700 : 500,
        }}
        onClick={() => onChange?.("editor")}
      >
        {editorLabel}
      </Button>
    </div>
  );
}

export default function SimpleTopbar({
  brandHref = "/home",
  links = [],
  showBrand = true,
  showNav = true,
  showAuthAction = false,
  signedIn = false,
  onSignOut,
  signInHref = "/account?mode=signin",
  signInLabel = "Sign in",
  signOutLabel = "Sign out",
  rightContent = null,
  headerId,
  innerId,
  headerClassName = "simple-topbar",
  innerClassName = "simple-topbar-inner",
}) {
  return (
    <header className={headerClassName} id={headerId}>
      <div className={innerClassName} id={innerId}>
        {showBrand ? (
          <Link className="simple-brand" href={brandHref}>
            <img src={CLARIVORE_LOGO_SRC} alt="Clarivore logo" />
            <span>Clarivore</span>
          </Link>
        ) : null}
        {showNav ? (
          <div className="simple-nav">
            {links
              .filter((item) => item && item.href && item.label && item.visible !== false)
              .map((item, index) => (
                <Link key={item.key || `${item.href}-${index}`} href={item.href}>
                  {item.label}
                </Link>
              ))}
            {showAuthAction
              ? signedIn
                ? (
                    <Button variant="link" type="button" onClick={onSignOut}>
                      {signOutLabel}
                    </Button>
                  )
                : (
                    <Link href={signInHref}>{signInLabel}</Link>
                  )
              : null}
          </div>
        ) : null}
        {rightContent}
      </div>
    </header>
  );
}
