"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseClient as supabase } from "./lib/supabase";
import AppLoadingScreen from "./components/AppLoadingScreen";

export default function Home() {
  const router = useRouter();
  const [status, setStatus] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function redirect() {
      if (!supabase) {
        if (isMounted) {
          setStatus("Supabase env vars are missing.");
        }
        return;
      }

      try {
        const { data } = await supabase.auth.getUser();
        const destination = data?.user ? "/home" : "/account?mode=signin";
        router.replace(destination);
      } catch (error) {
        console.error("Failed to check session", error);
        router.replace("/account?mode=signin");
      }
    }

    redirect();

    return () => {
      isMounted = false;
    };
  }, [router]);

  return (
    status
      ? (
        <main className="page-shell" style={{ padding: "48px 20px" }}>
          <div className="page-content" style={{ textAlign: "center" }}>
            <h1 style={{ marginBottom: 12 }}>Clarivore</h1>
            <p className="muted">{status}</p>
          </div>
        </main>
      )
      : <AppLoadingScreen label="Clarivore" />
  );
}
