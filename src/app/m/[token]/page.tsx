"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

/* Halaman Mahasiswa — halaman publik hanya-baca per kelas.
   Mahasiswa membuka /m/<token> tanpa login. Data diambil lewat
   fungsi database halaman_mahasiswa(token) yang hanya
   mengembalikan info kelas, pertemuan, materi, dan tugas kelas
   tersebut — tidak pernah data pribadi mahasiswa, absensi,
   atau nilai. */

interface HmPertemuan { pertemuan_ke: number; tanggal: string; topik: string | null; status: string }
interface HmMateri { judul: string; deskripsi: string | null; file_url: string | null; file_name: string | null; pertemuan_ke: number | null }
interface HmTugas { judul: string; deskripsi: string | null; deadline: string | null; bobot: number | null; file_url: string | null; file_name: string | null }
interface HmData {
  aplikasi: { nama: string; institusi: string } | null;
  kelas: { kode_kelas: string; ruang: string | null; hari: string | null; jam_mulai: string | null; jam_selesai: string | null; deskripsi: string | null; status: string } | null;
  mata_kuliah: { kode: string | null; nama: string; sks: number | null; semester: number | null; prodi: string | null } | null;
  dosen: { nama: string; prodi: string | null; fakultas: string | null } | null;
  tahun_akademik: { tahun: string; semester: string } | null;
  pertemuan: HmPertemuan[];
  materi: HmMateri[];
  tugas: HmTugas[];
}

function fmtTanggal(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function fmtDeadline(deadline: string | null): string {
  if (!deadline) return "Tanpa deadline";
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return deadline;
  return d.toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function deadlineChip(deadline: string | null): { label: string; cls: string } | null {
  if (!deadline) return null;
  const t = new Date(deadline).getTime();
  if (Number.isNaN(t)) return null;
  const now = Date.now();
  if (t < now) return { label: "Lewat deadline", cls: "bad" };
  if (t - now <= 3 * 24 * 3600 * 1000) return { label: "Segera berakhir", cls: "warn" };
  return { label: "Masih dibuka", cls: "ok" };
}

export default function HalamanMahasiswaPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === "string" ? params.token : "";
  const [state, setState] = useState<"loading" | "ok" | "notfound" | "error">("loading");
  const [data, setData] = useState<HmData | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const supabase = getSupabase();
      if (!supabase || !token) { if (active) setState("error"); return; }
      const { data: result, error } = await supabase.rpc("halaman_mahasiswa", { p_token: token });
      if (!active) return;
      if (error) { setState("error"); return; }
      if (!result) { setState("notfound"); return; }
      setData(result as HmData);
      setState("ok");
    })();
    return () => { active = false; };
  }, [token]);

  if (!isSupabaseConfigured || state === "error") {
    return (
      <main className="hm-wrap">
        <div className="hm-card hm-center">
          <p className="hm-emoji">⚠️</p>
          <h1>Halaman belum dapat dimuat</h1>
          <p className="muted">Terjadi kendala saat mengambil data kelas. Coba muat ulang halaman ini beberapa saat lagi.</p>
        </div>
      </main>
    );
  }

  if (state === "loading") {
    return (
      <main className="hm-wrap">
        <div className="hm-card hm-center">
          <p className="hm-emoji">⏳</p>
          <p className="muted">Memuat halaman kelas…</p>
        </div>
      </main>
    );
  }

  if (state === "notfound" || !data) {
    return (
      <main className="hm-wrap">
        <div className="hm-card hm-center">
          <p className="hm-emoji">🔒</p>
          <h1>Tautan tidak aktif</h1>
          <p className="muted">Tautan kelas ini tidak ditemukan atau sudah dinonaktifkan oleh dosen pengampu. Minta tautan terbaru kepada dosen Anda.</p>
        </div>
      </main>
    );
  }

  const mk = data.mata_kuliah;
  const kelas = data.kelas;
  const dosen = data.dosen;
  const ta = data.tahun_akademik;
  const jadwal = [kelas?.hari, kelas?.jam_mulai ? `${kelas.jam_mulai}${kelas?.jam_selesai ? `–${kelas.jam_selesai}` : ""}` : null].filter(Boolean).join(" • ");

  return (
    <main className="hm-wrap">
      <header className="hm-hero">
        <p className="hm-appname">{data.aplikasi?.nama || "Smart Class"}{data.aplikasi?.institusi ? ` • ${data.aplikasi.institusi}` : ""}</p>
        <h1>{mk?.nama ?? "Mata Kuliah"}</h1>
        <p className="hm-sub">
          {mk?.kode ? `${mk.kode} • ` : ""}Kelas {kelas?.kode_kelas ?? "-"}
          {ta ? ` • ${ta.tahun} — ${ta.semester}` : ""}
        </p>
      </header>

      <section className="hm-card">
        <div className="hm-info-grid">
          <div><span>Dosen Pengampu</span><strong>{dosen?.nama ?? "-"}</strong>{dosen?.prodi ? <em>{dosen.prodi}{dosen.fakultas ? ` • ${dosen.fakultas}` : ""}</em> : null}</div>
          <div><span>Jadwal</span><strong>{jadwal || "-"}</strong>{kelas?.ruang ? <em>Ruang {kelas.ruang}</em> : null}</div>
          <div><span>Mata Kuliah</span><strong>{mk?.sks ? `${mk.sks} SKS` : "-"}</strong>{mk?.semester ? <em>Semester {mk.semester}{mk?.prodi ? ` • ${mk.prodi}` : ""}</em> : null}</div>
          <div><span>Status Kelas</span><strong>{kelas?.status ?? "-"}</strong>{ta ? <em>TA {ta.tahun} {ta.semester}</em> : null}</div>
        </div>
        {kelas?.deskripsi ? <p className="hm-desc">{kelas.deskripsi}</p> : null}
      </section>

      <section className="hm-card">
        <h2>📝 Tugas</h2>
        {data.tugas.length === 0 && <p className="muted">Belum ada tugas untuk kelas ini.</p>}
        {data.tugas.map((t, i) => {
          const chip = deadlineChip(t.deadline);
          return (
            <article key={i} className="hm-item">
              <div className="hm-item-head">
                <h3>{t.judul}</h3>
                {chip ? <span className={`chip ${chip.cls}`}>{chip.label}</span> : null}
              </div>
              <p className="hm-meta">⏰ Deadline: <strong>{fmtDeadline(t.deadline)}</strong>{t.bobot ? ` • Bobot ${t.bobot}%` : ""}</p>
              {t.deskripsi ? <p className="hm-text">{t.deskripsi}</p> : null}
              {t.file_url ? <a className="btn btn-small" href={t.file_url} target="_blank" rel="noopener noreferrer">📎 {t.file_name || "Buka lampiran tugas"}</a> : null}
            </article>
          );
        })}
      </section>

      <section className="hm-card">
        <h2>📚 Materi</h2>
        {data.materi.length === 0 && <p className="muted">Belum ada materi untuk kelas ini.</p>}
        {data.materi.map((m, i) => (
          <article key={i} className="hm-item">
            <div className="hm-item-head">
              <h3>{m.judul}</h3>
              {m.pertemuan_ke ? <span className="chip">Pertemuan {m.pertemuan_ke}</span> : null}
            </div>
            {m.deskripsi ? <p className="hm-text">{m.deskripsi}</p> : null}
            {m.file_url ? <a className="btn btn-small" href={m.file_url} target="_blank" rel="noopener noreferrer">📎 {m.file_name || "Buka / unduh materi"}</a> : null}
          </article>
        ))}
      </section>

      <section className="hm-card">
        <h2>🗓️ Jadwal Pertemuan &amp; Topik</h2>
        {data.pertemuan.length === 0 && <p className="muted">Belum ada pertemuan terjadwal untuk kelas ini.</p>}
        <ol className="hm-meetings">
          {data.pertemuan.map((p, i) => (
            <li key={i}>
              <span className="hm-meet-no">{p.pertemuan_ke}</span>
              <div>
                <strong>{p.topik || "—"}</strong>
                <p className="hm-meta">{fmtTanggal(p.tanggal)} • {p.status}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <footer className="hm-footer">
        <p>Halaman ini dibagikan oleh dosen pengampu untuk mahasiswa kelas {kelas?.kode_kelas ?? ""}.</p>
        <p className="muted">Dibagikan melalui Smart Class • Manrapi EduTech</p>
      </footer>
    </main>
  );
}
