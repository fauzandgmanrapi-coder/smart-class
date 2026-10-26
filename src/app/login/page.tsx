"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { SetupScreen } from "@/components/Setup";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabase();
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/dashboard");
    });
  }, [router]);

  if (!isSupabaseConfigured) return <SetupScreen />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const supabase = getSupabase();
    if (!supabase) return;
    setLoading(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (err) {
      setError(
        "Login gagal. Periksa kembali email dan password Anda, atau pastikan user sudah dibuat di Supabase Authentication."
      );
      return;
    }
    router.replace("/dashboard");
  }

  return (
    <main className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="login-logo-img" src="/logo-smartclass.png" alt="Logo Smart Class" />
        <h1>Smart Class Online</h1>
        <p className="muted">
          Masuk dengan akun dosen yang terdaftar untuk mengelola data
          perkuliahan.
        </p>
        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="dosen@kampus.ac.id"
            autoComplete="email"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </label>
        {error && <div className="alert-error">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={loading}>
          {loading ? "Memproses…" : "Masuk ke Smart Class"}
        </button>
        <p className="login-note">
          Akun dibuat melalui Supabase Authentication oleh pemilik aplikasi.
          Tidak ada pendaftaran publik, demi keamanan data mahasiswa.
        </p>
      </form>
      <footer className="dev-credit">
        <span>Dikembangkan oleh</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-manrapi.png" alt="Logo Manrapi EduTech" />
        <strong>Manrapi EduTech</strong>
      </footer>
    </main>
  );
}
