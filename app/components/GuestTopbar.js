"use client";

import Link from "next/link";
import { CLARIVORE_LOGO_SRC } from "./clarivoreBrand";
import styles from "./GuestTopbar.module.css";

export default function GuestTopbar({
  brandHref = "/guest",
  signInHref = "/account?mode=signin",
}) {
  return (
    <header className={styles.topbar} role="banner">
      <div className={styles.inner}>
        <div className={styles.leftSlot} aria-hidden="true" />
        <Link className={styles.brand} href={brandHref}>
          <img src={CLARIVORE_LOGO_SRC} alt="Clarivore logo" />
          <span>Clarivore</span>
        </Link>
        <Link className={styles.signInLink} href={signInHref}>
          Sign in
        </Link>
      </div>
    </header>
  );
}
