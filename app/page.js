"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export default function Home() {
  const router = useRouter();
  const [status, setStatus] = useState("Checking your session...");

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
        const destination = data?.user ? "/home" : "/index.html";
        router.replace(destination);
      } catch (error) {
        console.error("Failed to check session", error);
        router.replace("/index.html");
      }
    }

    redirect();

    return () => {
      isMounted = false;
    };
  }, [router]);

  return (
    <main className="page-shell" style={{ padding: "48px 20px" }}>
      <div className="page-content" style={{ textAlign: "center" }}>
        <h1 style={{ marginBottom: 12 }}>Clarivore</h1>
        <p className="muted">{status}</p>
      </div>
    </main>
  );
}
