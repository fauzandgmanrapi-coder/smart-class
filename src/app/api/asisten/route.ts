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
const TIMEOUT_MS = 25_000;

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

  // ---- Panggil Gemini (REST, tanpa SDK) ----
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT_ASISTEN }] },
          contents: riwayat.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
        }),
        signal: controller.signal,
      }
    );
    if (!res.ok) {
      return NextResponse.json({ error: "upstream" }, { status: 502 });
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
  } catch {
    // Timeout/jaringan/upstream: jangan bocorkan detail apa pun.
    return NextResponse.json({ error: "upstream" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
