import { NextRequest, NextResponse } from "next/server";
import { SYSTEM_PROMPT_ASISTEN } from "@/lib/asisten-pengetahuan";

// Route server-side untuk Asisten Smart Class (v9).
// API key Gemini dibaca dari env server GEMINI_API_KEY (TANPA awalan
// NEXT_PUBLIC_) sehingga tidak pernah terekspos ke peramban maupun repo.
export const runtime = "nodejs";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

const MAX_MESSAGES = 10;
const MAX_CHARS = 1200;
const TIMEOUT_MS = 20_000;

// Rantai model cadangan v9.0.2: tidak semua API key/proyek punya akses ke
// model yang sama (live user membalas 404 NOT_FOUND untuk gemini-2.5-flash
// padahal key-nya valid). Model dicoba BERURUTAN; yang pertama berhasil
// dipakai. Fallback HANYA untuk 404 — error lain (key salah 400, kuota
// 429, dst) langsung dilaporkan agar diagnosisnya tidak tertutup.
const DAFTAR_MODEL = [
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
];

function badRequest() {
  return NextResponse.json({ error: "bad_request" }, { status: 400 });
}

export async function POST(req: NextRequest) {
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
  const isiBody = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT_ASISTEN }] },
    contents: riwayat.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
  });

  // Error 404 terakhir, disimpan agar bila SEMUA model 404 klien tetap
  // menerima diagnosis NOT_FOUND persis seperti perilaku v9.0.1.
  let statusTerakhir = 404;
  let kodeTerakhir = "NOT_FOUND";

  for (const model of DAFTAR_MODEL) {
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
          body: isiBody,
          signal: controller.signal,
        }
      );
      if (!res.ok) {
        // Diagnostik v9.0.1: catat status/kode error Google + nama model
        // ke log server (TANPA kunci API/header).
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
        if (res.status === 404) {
          // Model tidak tersedia untuk key/proyek ini → coba model
          // berikutnya dalam rantai.
          statusTerakhir = res.status;
          kodeTerakhir = kodeGoogle;
          continue;
        }
        // Error selain 404 (key tidak valid, kuota, dst) adalah diagnosis
        // final: JANGAN jatuh ke model lain, laporkan apa adanya.
        return NextResponse.json(
          { error: "upstream", upstream_status: res.status, upstream_code: kodeGoogle },
          { status: 502 }
        );
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
      if (!reply) {
        return NextResponse.json({ error: "upstream" }, { status: 502 });
      }
      return NextResponse.json({ reply });
    } catch (err) {
      // fetch-nya sendiri gagal (jaringan/timeout): kemungkinan masalah
      // jaringan umum, bukan per-model → langsung FETCH_FAILED seperti
      // pola v9.0.1, tidak lanjut ke model berikutnya.
      const nama = err instanceof Error ? err.name : "Error";
      const pesan = err instanceof Error ? err.message : String(err);
      console.error("asisten-fetch-failed", nama, pesan.slice(0, 200));
      return NextResponse.json(
        { error: "upstream", upstream_status: 0, upstream_code: "FETCH_FAILED" },
        { status: 502 }
      );
    } finally {
      clearTimeout(timer);
    }
  }

  // Seluruh rantai menjawab 404: model tidak satu pun tersedia untuk
  // key/proyek ini — laporkan error terakhir (404 NOT_FOUND).
  return NextResponse.json(
    { error: "upstream", upstream_status: statusTerakhir, upstream_code: kodeTerakhir },
    { status: 502 }
  );
}
