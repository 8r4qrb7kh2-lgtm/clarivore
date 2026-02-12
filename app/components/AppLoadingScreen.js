"use client";

import styles from "./AppLoadingScreen.module.css";
import { CLARIVORE_LOGO_SRC } from "./clarivoreBrand";

export default function AppLoadingScreen({ label = "page" }) {
  const announcement = `Loading ${label}...`;

  return (
    <div className={styles.screen} role="status" aria-live="polite" aria-label={announcement}>
      <div className={styles.stack}>
        <img className={styles.logo} src={CLARIVORE_LOGO_SRC} alt="Clarivore logo" />
        <span className={styles.spinner} aria-hidden="true" />
      </div>
      <span className={styles.srOnly}>{announcement}</span>
    </div>
  );
}
