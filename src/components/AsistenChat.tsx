"use client";

// Asisten Smart Class (v9) — panel chat panduan penggunaan aplikasi.
// Hanya dirender dari SmartClassApp setelah login (dosen & admin).
// Riwayat percakapan disimpan di state lokal komponen; pengiriman
// dibatasi sesuai kontrak route /api/asisten (10 pesan terakhir).

import { useEffect, useRef, useState } from "react";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

const SALAM_PEMBUKA =
  "Halo! Saya Asisten Smart Class. Saya dapat membantu menjelaskan cara menggunakan aplikasi ini — misalnya input absensi, penilaian, ekspor nilai ke SIAKAD, membagikan tautan kelas, sampai backup data. Silakan ketik pertanyaan Anda, atau pilih pertanyaan cepat di bawah ini.";

const PERTANYAAN_CEPAT = [
  "Bagaimana cara input absensi?",
  "Cara export nilai ke SIAKAD?",
  "Bagaimana mahasiswa mengumpulkan tugas?",
  "Cara membagikan tautan kelas ke mahasiswa?",
  "Apa beda akun Dosen dan Admin?",
];

const PESAN_BELUM_AKTIF =
  "Maaf, Asisten Smart Class belum diaktifkan pada aplikasi ini (kunci API belum dipasang oleh pengelola). Sementara itu, silakan merujuk ke Manual Book Smart Class, atau hubungi pengembang melalui WhatsApp 0823-4555-5534.";

const PESAN_GANGGUAN =
  "Maaf, Asisten Smart Class sedang mengalami gangguan. Silakan coba lagi sesaat lagi, atau merujuk ke Manual Book Smart Class / hubungi pengembang melalui WhatsApp 0823-4555-5534.";

export default function AsistenChat() {
  const [terbuka, setTerbuka] = useState(false);
  const [pesan, setPesan] = useState<ChatMsg[]>([
    { role: "assistant", content: SALAM_PEMBUKA },
  ]);
  const [draf, setDraf] = useState("");
  const [mengirim, setMengirim] = useState(false);
  const badanRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Gulir ke pesan terbaru setiap kali isi berubah/panel dibuka.
  useEffect(() => {
    const el = badanRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [pesan, terbuka, mengirim]);

  useEffect(() => {
    if (terbuka) inputRef.current?.focus();
  }, [terbuka]);

  async function kirim(teksMentah: string) {
    const teks = teksMentah.trim();
    if (!teks || mengirim) return;
    const riwayatBaru: ChatMsg[] = [...pesan, { role: "user", content: teks }];
    setPesan(riwayatBaru);
    setDraf("");
    setMengirim(true);
    try {
      const res = await fetch("/api/asisten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: riwayatBaru.slice(-10) }),
      });
      if (res.status === 503) {
        setPesan((prev) => [...prev, { role: "assistant", content: PESAN_BELUM_AKTIF }]);
        return;
      }
      if (!res.ok) throw new Error("gagal");
      const data: unknown = await res.json();
      const reply = (data as { reply?: unknown })?.reply;
      if (typeof reply !== "string" || !reply.trim()) throw new Error("kosong");
      setPesan((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setPesan((prev) => [...prev, { role: "assistant", content: PESAN_GANGGUAN }]);
    } finally {
      setMengirim(false);
    }
  }

  return (
    <>
      {!terbuka && (
        <button
          type="button"
          className="asisten-fab no-print"
          aria-label="Buka Asisten Smart Class"
          title="Asisten Smart Class — panduan penggunaan aplikasi"
          onClick={() => setTerbuka(true)}
        >
          💬
        </button>
      )}

      {terbuka && (
        <section className="asisten-panel no-print" aria-label="Panel Asisten Smart Class">
          <header className="asisten-head">
            <div>
              <strong>💬 Asisten Smart Class</strong>
              <span>Panduan penggunaan aplikasi</span>
            </div>
            <button
              type="button"
              className="asisten-close"
              aria-label="Tutup Asisten Smart Class"
              onClick={() => setTerbuka(false)}
            >
              ✕
            </button>
          </header>

          <div className="asisten-body" ref={badanRef}>
            {pesan.map((m, i) => (
              <div key={i} className={`asisten-row ${m.role}`}>
                <div className="asisten-bubble">{m.content}</div>
              </div>
            ))}

            {pesan.length === 1 && !mengirim && (
              <div className="asisten-chips">
                {PERTANYAAN_CEPAT.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="asisten-chip"
                    onClick={() => void kirim(q)}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {mengirim && (
              <div className="asisten-row assistant">
                <div className="asisten-bubble asisten-typing">Asisten sedang mengetik…</div>
              </div>
            )}
          </div>

          <form
            className="asisten-form"
            onSubmit={(e) => {
              e.preventDefault();
              void kirim(draf);
            }}
          >
            <input
              ref={inputRef}
              value={draf}
              onChange={(e) => setDraf(e.target.value)}
              placeholder="Tulis pertanyaan Anda…"
              aria-label="Tulis pertanyaan untuk Asisten Smart Class"
              maxLength={1200}
              disabled={mengirim}
            />
            <button type="submit" className="btn btn-primary" disabled={mengirim || !draf.trim()}>
              Kirim
            </button>
          </form>
        </section>
      )}
    </>
  );
}
