import { NextRequest, NextResponse } from "next/server";
import { SYSTEM_PROMPT_ASISTEN } from "@/lib/asisten-pengetahuan";

// Route server-side untuk Asisten Smart Class (v9).
// API key Gemini dibaca dari env server GEMINI_API_KEY (TANPA awalan
// NEXT_PUBLIC_) sehingga tidak pernah terekspos ke peramban maupun repo.
export const runtime = "nodejs";

// Plafon durasi fungsi dinaikkan (v9.0.4): rantai model kini boleh
// jatuh ke model berikutnya juga saat timeout, jadi satu request
// berpotensi memuat beberapa percobaan berurutan.
export const maxDuration = 60;

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

const MAX_MESSAGES = 10;
const MAX_CHARS = 1200;
const TIMEOUT_MS = 20_000;

// Anggaran total satu request (v9.0.4): percobaan model BARU tidak
// dimulai bila waktu yang sudah berlalu melewati batas ini, supaya
// respons 502 diagnostik tetap sempat terkirim sebelum maxDuration.
const ANGGARAN_TOTAL_MS = 45_000;

// Rantai model cadangan. Riwayat:
// - v9.0.2: seluruhnya keluarga 2.x — semuanya 404 di live user.
// - v9.0.3: keluarga 3.x, terkuat di depan (gemini-3.8-flash) —
//   asisten terbukti MENJAWAB benar (200), tetapi panggilan berikutnya
//   gagal FETCH_FAILED: model pertama free-tier kadang merespons
//   LEBIH LAMBAT dari timeout per-percobaan 20 detik, dan desain lama
//   tidak jatuh ke model berikutnya saat fetch gagal/timeout.
// - v9.0.4: model LITE ditaruh di depan — umumnya lebih cepat dan
//   kuotanya lebih ringan, kualitasnya cukup untuk tanya-jawab
//   panduan. Model penuh tetap ada di belakang sebagai cadangan.
//   Timeout/fetch gagal DAN 404 sama-sama jatuh ke model berikutnya
//   (anggaran total 45 detik); error non-404 lain tetap langsung
//   dilaporkan agar diagnosisnya tidak tertutup.
const DAFTAR_MODEL = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.6-flash",
];

function badRequest() {
  return NextResponse.json({ error: "bad_request" }, { status: 400 });
}

// Hasil satu percobaan ke satu model.
type HasilPercobaan =
  | { tipe: "ok"; reply: string }
  | { tipe: "kosong" }
  | { tipe: "http"; status: number; kode: string; pesan: string }
  | { tipe: "fetch"; nama: string; pesan: string };

export async function POST(req: NextRequest) {
  const awalRequest = Date.now();

  // ---- Validasi payload ----
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest();
  }
  const raw = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(raw) || raw.length === 0) return badRequest();

  const parsed: ChatMsg[] = [];
  for (const item of raw.slice(-MAX_MESSAGES)) {
    if (!item || typeof item !== "object") return badRequest();
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if (role !== "user" && role !== "assistant") return badRequest();
    if (typeof content !== "string") return badRequest();
    const teks = content.trim().slice(0, MAX_CHARS);
    if (!teks) return badRequest();
    parsed.push({ role, content: teks });
  }

  // Gemini multi-turn mengharuskan giliran pertama berperan "user" dan
  // peran bergantian: buang pesan assistant di awal (mis. salam pembuka
  // UI) lalu gabungkan pesan berurutan yang berperan sama.
  while (parsed.length > 0 && parsed[0].role === "assistant") parsed.shift();
  if (parsed.length === 0) return badRequest();
  const riwayat: ChatMsg[] = [];
  for (const m of parsed) {
    const last = riwayat[riwayat.length - 1];
    if (last && last.role === m.role) last.content += "\n" + m.content;
    else riwayat.push({ ...m });
  }

  // ---- API key ----
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // UI menampilkan pesan ramah bahwa asisten belum diaktifkan.
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  // ---- Panggil Gemini (REST, tanpa SDK), berurutan per DAFTAR_MODEL ----
  const contents = riwayat.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  // thinkingConfig.thinkingBudget 0 (v9.0.4): mematikan penalaran
  // berlebih model Flash agar jawaban panduan yang faktual keluar
  // cepat. Pengaman kompatibilitas: bila Google menolak field ini
  // (400 yang pesannya menyebut "thinking"), model yang sama dicoba
  // ulang sekali TANPA thinkingConfig dan field itu tidak dipakai
  // lagi selama sisa request ini (flag per-request di bawah).
  let pakaiThinking = true;
  const buatBody = () =>
    JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT_ASISTEN }] },
      contents,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 800,
        ...(pakaiThinking
          ? { thinkingConfig: { thinkingBudget: 0 } }
          : {}),
      },
    });

  // Satu percobaan ke satu model. Kegagalan dicatat ringkas ke log
  // server (nama model + status/kode; TANPA kunci API/header).
  const cobaSekali = async (model: string): Promise<HasilPercobaan> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: buatBody(),
          signal: controller.signal,
        }
      );
      if (!res.ok) {
        const teksError = await res.text().catch(() => "");
        let kodeGoogle = "";
        let pesanGoogle = "";
        try {
          const j = JSON.parse(teksError) as {
            error?: { status?: unknown; message?: unknown };
          };
          if (typeof j?.error?.status === "string") kodeGoogle = j.error.status;
          if (typeof j?.error?.message === "string") pesanGoogle = j.error.message;
        } catch {
          pesanGoogle = teksError;
        }
        console.error(
          "asisten-upstream",
          model,
          res.status,
          kodeGoogle,
          pesanGoogle.slice(0, 200)
        );
        return {
          tipe: "http",
          status: res.status,
          kode: kodeGoogle,
          pesan: pesanGoogle,
        };
      }
      const data: unknown = await res.json();
      const parts = (
        data as {
          candidates?: { content?: { parts?: { text?: unknown }[] } }[];
        }
      )?.candidates?.[0]?.content?.parts;
      const reply = Array.isArray(parts)
        ? parts
            .map((p) => (typeof p?.text === "string" ? p.text : ""))
            .join("")
            .trim()
        : "";
      if (!reply) return { tipe: "kosong" };
      return { tipe: "ok", reply };
    } catch (err) {
      const nama = err instanceof Error ? err.name : "Error";
      const pesan = err instanceof Error ? err.message : String(err);
      console.error("asisten-fetch-failed", model, nama, pesan.slice(0, 200));
      return { tipe: "fetch", nama, pesan };
    } finally {
      clearTimeout(timer);
    }
  };

  // Kegagalan terakhir yang bisa diteruskan ke model berikutnya
  // (404 atau fetch/timeout), disimpan agar bila rantai berhenti —
  // habis model atau habis anggaran — klien tetap menerima diagnosis
  // kegagalan TERAKHIR dengan pola v9.0.1.
  let statusTerakhir = 404;
  let kodeTerakhir = "NOT_FOUND";
  let terakhirFetch = false;

  let percobaanPertama = true;
  for (const model of DAFTAR_MODEL) {
    // Anggaran total: jangan mulai percobaan baru bila waktu sejak
    // awal request sudah melewati batas — berhenti dan laporkan
    // kegagalan terakhir.
    if (
      !percobaanPertama &&
      Date.now() - awalRequest > ANGGARAN_TOTAL_MS
    ) {
      break;
    }
    percobaanPertama = false;

    // Per model: normalnya satu percobaan; satu percobaan ulang hanya
    // untuk kasus kompatibilitas thinkingConfig (lihat di dalam loop).
    for (;;) {
      const hasil = await cobaSekali(model);

      if (hasil.tipe === "ok") {
        return NextResponse.json({ reply: hasil.reply });
      }
      if (hasil.tipe === "kosong") {
        return NextResponse.json({ error: "upstream" }, { status: 502 });
      }
      if (hasil.tipe === "fetch") {
        // v9.0.4: timeout/fetch gagal TIDAK lagi final — catat lalu
        // jatuh ke model berikutnya (bisa jadi model itu yang lambat).
        terakhirFetch = true;
        break;
      }
      // hasil.tipe === "http"
      if (
        hasil.status === 400 &&
        pakaiThinking &&
        /thinking/i.test(hasil.pesan)
      ) {
        // Field thinkingConfig ditolak model ini: matikan untuk sisa
        // request dan coba ulang MODEL YANG SAMA sekali lagi; hasil
        // percobaan ulang mengikuti aturan normal di bawah ini juga.
        pakaiThinking = false;
        continue;
      }
      if (hasil.status === 404) {
        // Model tidak tersedia untuk key/proyek ini → coba model
        // berikutnya dalam rantai.
        statusTerakhir = hasil.status;
        kodeTerakhir = hasil.kode;
        terakhirFetch = false;
        break;
      }
      // Error selain 404 (key tidak valid, kuota, dst) adalah diagnosis
      // final: JANGAN jatuh ke model lain, laporkan apa adanya.
      return NextResponse.json(
        { error: "upstream", upstream_status: hasil.status, upstream_code: hasil.kode },
        { status: 502 }
      );
    }
  }

  // Rantai berhenti (semua model gagal diteruskan, atau anggaran
  // habis): laporkan kegagalan TERAKHIR — FETCH_FAILED bila yang
  // terakhir adalah fetch/timeout, 404 NOT_FOUND bila 404.
  if (terakhirFetch) {
    return NextResponse.json(
      { error: "upstream", upstream_status: 0, upstream_code: "FETCH_FAILED" },
      { status: 502 }
    );
  }
  return NextResponse.json(
    { error: "upstream", upstream_status: statusTerakhir, upstream_code: kodeTerakhir },
    { status: 502 }
  );
}
