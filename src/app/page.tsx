"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { SetupScreen } from "@/components/Setup";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      router.replace(data.session ? "/dashboard" : "/login");
    });
  }, [router]);

  if (!isSupabaseConfigured) return <SetupScreen />;

  return (
    <main className="setup-wrap">
      <p className="muted">Memuat Smart Class Online…</p>
    </main>
  );
}
