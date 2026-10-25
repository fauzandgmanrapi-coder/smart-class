"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

/** Layar petunjuk saat env Supabase belum diisi. */
export function SetupScreen() {
  return (
    <main className="setup-wrap">
      <div className="setup-card">
        <div className="setup-badge">MODE SETUP</div>
        <h1>Smart Class Online belum terhubung ke Supabase</h1>
        <p>
          Aplikasi sudah berjalan, tetapi data belum bisa dimuat karena
          konfigurasi Supabase belum diisi. Ikuti langkah berikut:
        </p>
        <ol>
          <li>Buka <strong>supabase.com</strong> dan buat project baru (gratis).</li>
          <li>
            Di Supabase (buat project BARU bernama <strong>smart-class</strong>),
            buka <strong>SQL Editor</strong>, lalu jalankan isi file{" "}
            <code>supabase/schema.sql</code> dari repositori ini untuk membuat
            tabel, kebijakan keamanan (RLS), dan data awal.
          </li>
          <li>
            Buat user dosen/pemilik pertama di menu{" "}
            <strong>Authentication &gt; Users &gt; Add user</strong> (email +
            password).
          </li>
          <li>
            Salin <strong>Project URL</strong> dan <strong>anon key</strong>{" "}
            dari <strong>Project Settings &gt; API</strong>.
          </li>
          <li>
            Isi kedua nilai itu sebagai environment variable{" "}
            <code>NEXT_PUBLIC_SUPABASE_URL</code> dan{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> — di file{" "}
            <code>.env.local</code> untuk lokal, atau di Vercel pada{" "}
            <strong>Project Settings &gt; Environment Variables</strong>, lalu
            deploy ulang.
          </li>
        </ol>
        <p className="setup-note">
          Panduan lengkap ada di file <code>README.md</code> repositori ini.
        </p>
        <Link className="btn btn-primary" href="/login">
          Ke Halaman Login
        </Link>
      </div>
    </main>
  );
}

export interface SessionUser {
  id: string;
  email: string;
  roleMeta: string | null;
}

/** Ambil user yang sedang login (id, email, peran dari app_metadata). */
export function useSessionUser(ready: boolean) {
  const [user, setUser] = useState<SessionUser | null>(null);
  useEffect(() => {
    if (!ready) return;
    const supabase = getSupabase();
    if (!supabase) return;
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!active || !data.user) return;
      const meta = (data.user.app_metadata ?? {}) as { role?: string };
      setUser({
        id: data.user.id,
        email: data.user.email ?? "",
        roleMeta: typeof meta.role === "string" ? meta.role : null,
      });
    });
    return () => { active = false; };
  }, [ready]);
  return user;
}

/** Guard sesi: mengarahkan ke /login bila belum masuk. */
export function useRequireSession() {
  const [state, setState] = useState<"loading" | "ready" | "setup">("loading");

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setState("setup");
      return;
    }
    const supabase = getSupabase();
    if (!supabase) {
      setState("setup");
      return;
    }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (!data.session) {
        window.location.href = "/login";
      } else {
        setState("ready");
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) window.location.href = "/login";
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return state;
}
