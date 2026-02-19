"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import AppLoadingScreen from "./components/AppLoadingScreen";
import { ToastProvider } from "./components/ui";
import { supabaseClient as supabase } from "./lib/supabase";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        gcTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
      mutations: {
        retry: 1,
      },
    },
  });
}

function shouldBypassGuestGate(pathname) {
  const route = String(pathname || "").trim() || "/";
  const normalizedRoute = route.replace(/\/+$/, "") || "/";

  if (normalizedRoute.startsWith("/account")) return true;
  if (normalizedRoute.startsWith("/guest")) return true;
  if (normalizedRoute.startsWith("/report-issue")) return true;
  // Let the restaurant route settle first to avoid query-param race conditions
  // during guest navigation from /guest -> /restaurant.
  if (normalizedRoute === "/restaurant") return true;

  return false;
}

function GuestAccessGate({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const redirectRef = useRef("");
  const [authState, setAuthState] = useState(() => (supabase ? "unknown" : "signedOut"));

  const searchKey = searchParams?.toString() || "";
  const bypassGuestGate = useMemo(
    () => shouldBypassGuestGate(pathname),
    [pathname],
  );

  useEffect(() => {
    if (!supabase) return;

    let active = true;

    const loadSession = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!active) return;
        setAuthState(data?.user ? "signedIn" : "signedOut");
      } catch {
        if (!active) return;
        setAuthState("signedOut");
      }
    };

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthState(session?.user ? "signedIn" : "signedOut");
    });

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || bypassGuestGate || authState !== "signedOut") {
      return;
    }

    const nextPath = `${pathname || "/"}${searchKey ? `?${searchKey}` : ""}`;
    const next = encodeURIComponent(nextPath);
    const target = `/guest${next ? `?next=${next}` : ""}`;
    if (redirectRef.current === target) return;
    redirectRef.current = target;
    router.replace(target);
  }, [authState, bypassGuestGate, pathname, router, searchKey]);

  useEffect(() => {
    if (authState !== "signedOut") return;
    if (!bypassGuestGate) return;
    redirectRef.current = "";
  }, [authState, bypassGuestGate]);

  if (!supabase) {
    return children;
  }

  if (bypassGuestGate) {
    return children;
  }

  if (authState === "signedIn") {
    return children;
  }

  return <AppLoadingScreen label="Clarivore" />;
}

export default function Providers({ children }) {
  const [queryClient] = useState(() => createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Suspense fallback={<AppLoadingScreen label="Clarivore" />}>
          <GuestAccessGate>{children}</GuestAccessGate>
        </Suspense>
      </ToastProvider>
      {process.env.NODE_ENV === "development" ? (
        <ReactQueryDevtools initialIsOpen={false} />
      ) : null}
    </QueryClientProvider>
  );
}
