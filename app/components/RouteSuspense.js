import { Suspense } from "react";
import AppLoadingScreen from "./AppLoadingScreen";

export default function RouteSuspense({ label, children }) {
  return (
    <Suspense
      fallback={<AppLoadingScreen label={label} />}
    >
      {children}
    </Suspense>
  );
}
