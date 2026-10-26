"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import {
  STATUS_ABSENSI,
  nilaiHuruf,
  type Absensi,
  type AnggotaKelas,
  type Dosen,
  type Kelas,
  type KomponenNilai,
  type Mahasiswa,
  type MataKuliah,
  type Materi,
  type Nilai,
  type PengumpulanTugas,
  type Pertemuan,
  type StatusAbsensi,
  type TahunAkademik,
  type Tugas,
} from "@/lib/types";
import { deteksiProdi, exportSiakadWorkbook } from "@/lib/siakad";
import QRCode from "qrcode";
import { SetupScreen, useRequireSession, useSessionUser } from "@/components/Setup";

type View =
  | "dashboard" | "dosen" | "matakuliah" | "kelas" | "mahasiswa"
  | "pertemuan" | "penilaian" | "materi" | "rekap" | "pengaturan" | "tentang";

const VIEW_TITLES: Record<View, string> = {
  dashboard: "Dashboard",
  dosen: "Profil Dosen",
  matakuliah: "Mata Kuliah",
  kelas: "Kelas",
  mahasiswa: "Mahasiswa",
  pertemuan: "Pertemuan & Absensi",
  penilaian: "Penilaian",
  materi: "Materi & Tugas",
  rekap: "Rekap & Laporan",
  pengaturan: "Pengaturan",
  tentang: "Tentang",
};

const NAV: { view: View; icon: string; label: string }[] = [
  { view: "dashboard", icon: "🏠", label: "Dashboard" },
  { view: "dosen", icon: "👨‍🏫", label: "Profil Dosen" },
  { view: "matakuliah", icon: "📚", label: "Mata Kuliah" },
  { view: "kelas", icon: "🗂️", label: "Kelas" },
  { view: "mahasiswa", icon: "🎓", label: "Mahasiswa" },
  { view: "pertemuan", icon: "🗓️", label: "Pertemuan & Absensi" },
  { view: "penilaian", icon: "📊", label: "Penilaian" },
  { view: "materi", icon: "📁", label: "Materi & Tugas" },
  { view: "rekap", icon: "🖨️", label: "Rekap & Laporan" },
  { view: "pengaturan", icon: "⚙️", label: "Pengaturan" },
  { view: "tentang", icon: "ℹ️", label: "Tentang" },
];

const PRODI_OPTIONS = ["PGMI", "PAI", "Ekonomi Syariah", "Hukum Keluarga Islam"];
const HARI_OPTIONS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
const TABLES_BACKUP = [
  "pengaturan", "dosen", "tahun_akademik", "mata_kuliah", "kelas", "mahasiswa",
  "anggota_kelas", "pertemuan", "absensi", "komponen_nilai", "nilai",
  "materi", "tugas", "pengumpulan_tugas",
] as const;

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtTanggal(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}
function deadlineStatus(deadline: string | null): { label: string; cls: string } {
  if (!deadline) return { label: "Tanpa deadline", cls: "" };
  const now = Date.now();
  const t = new Date(deadline).getTime();
  if (Number.isNaN(t)) return { label: deadline, cls: "" };
  if (t < now) return { label: "Lewat", cls: "bad" };
  if (t - now <= 3 * 24 * 3600 * 1000) return { label: "Segera", cls: "warn" };
  return { label: "Aktif", cls: "ok" };
}

/* ================= Modal & form generik ================= */

function Modal(props: { title: string; onClose: () => void; wide?: boolean; xwide?: boolean; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className={`modal${props.wide ? " wide" : ""}${props.xwide ? " xwide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <h3>{props.title}</h3>
        {props.children}
      </div>
    </div>
  );
}

export interface FieldDef {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "time" | "datetime" | "select" | "textarea" | "photo";
  options?: { value: string; label: string }[];
  full?: boolean;
  required?: boolean;
}

function EditorModal(props: {
  title: string;
  fields: FieldDef[];
  initial: Record<string, string>;
  onClose: () => void;
  onSave: (values: Record<string, string>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(props.initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string, v: string) => setValues((p) => ({ ...p, [k]: v }));

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>, key: string) {
    const file = e.target.files?.[0];
    if (!file) return;
    try { set(key, await fileToSquareDataUrl(file)); }
    catch (er) { setErr(er instanceof Error ? er.message : "Gagal memproses foto."); }
  }

  async function submit() {
    setErr("");
    for (const f of props.fields) {
      if (f.required && !String(values[f.key] ?? "").trim()) { setErr(`${f.label} wajib diisi.`); return; }
    }
    setBusy(true);
    try { await props.onSave(values); }
    catch (e) { setBusy(false); setErr(e instanceof Error ? e.message : "Gagal menyimpan."); return; }
    setBusy(false);
    props.onClose();
  }

  return (
    <Modal title={props.title} onClose={props.onClose} wide>
      {err && <div className="alert-error">{err}</div>}
      <div className="form-grid">
        {props.fields.map((f) => (
          <label key={f.key} className={f.full ? "full" : undefined}>
            {f.label}
            {f.type === "select" ? (
              <select value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}>
                {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.type === "textarea" ? (
              <textarea rows={3} value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
            ) : f.type === "photo" ? (
              <span style={{ display: "block", marginTop: 6 }}>
                {values[f.key] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={values[f.key]} alt="Foto" style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", display: "block", marginBottom: 6 }} />
                ) : null}
                <input type="file" accept="image/*" onChange={(e) => void onPhoto(e, f.key)} />
              </span>
            ) : (
              <input
                type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "time" ? "time" : f.type === "datetime" ? "datetime-local" : "text"}
                value={values[f.key] ?? ""}
                onChange={(e) => set(f.key, e.target.value)}
              />
            )}
          </label>
        ))}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={props.onClose} disabled={busy}>Batal</button>
        <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</button>
      </div>
    </Modal>
  );
}

/* ================= Foto profil (crop persegi 256px) ================= */

function fileToSquareDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error("Canvas tidak tersedia.")); return; }
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("File gambar tidak terbaca.")); };
    img.src = url;
  });
}

function PhotoProfileModal(props: { userId: string; name: string; current: string; table: "profiles" | "dosen"; dosenId?: number; onClose: () => void; onSaved: (photo: string) => void }) {
  const [preview, setPreview] = useState(props.current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr("");
    if (!file.type.startsWith("image/")) { setErr("Pilih file gambar (JPG/PNG)."); return; }
    if (file.size > 8 * 1024 * 1024) { setErr("Ukuran foto maksimal 8 MB."); return; }
    try { setPreview(await fileToSquareDataUrl(file)); }
    catch (er) { setErr(er instanceof Error ? er.message : "Gagal memproses foto."); }
  }

  async function save(photo: string) {
    const supabase = getSupabase();
    if (!supabase) return;
    setErr(""); setBusy(true);
    let error: { message: string } | null = null;
    if (props.table === "profiles") {
      ({ error } = await supabase.from("profiles").upsert(
        { user_id: props.userId, photo, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      ));
    } else {
      ({ error } = await supabase.from("dosen").update({ foto: photo || null }).eq("id", props.dosenId ?? 0));
    }
    setBusy(false);
    if (error) { setErr(error.message); return; }
    props.onSaved(photo);
  }

  return (
    <Modal title={props.table === "profiles" ? "Foto Profil Akun" : "Foto Dosen"} onClose={props.onClose}>
      {err && <div className="alert-error">{err}</div>}
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <span className="avatar" style={{ width: 110, height: 110, fontSize: 42, margin: "0 auto" }}>
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt={`Foto ${props.name}`} />
          ) : (props.name.charAt(0) || "S")}
        </span>
        <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>
          Foto otomatis dipotong persegi &amp; diperkecil (256px) agar ringan.
        </p>
      </div>
      <label>Upload Foto Baru
        <input type="file" accept="image/*" onChange={(e) => void onFile(e)} />
      </label>
      <div className="modal-actions">
        {props.current && <button className="btn btn-danger" onClick={() => void save("")} disabled={busy}>Hapus Foto</button>}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={props.onClose} disabled={busy}>Batal</button>
        <button className="btn btn-primary" onClick={() => void save(preview)} disabled={busy || preview === props.current}>
          {busy ? "Menyimpan…" : "Simpan Foto"}
        </button>
      </div>
    </Modal>
  );
}

/* ================= Aplikasi utama ================= */

/* ================= Bagikan ke Mahasiswa (Halaman Mahasiswa) ================= */

function buatTokenBagikan(): string {
  const c: Crypto | undefined = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID().replace(/-/g, "");
  }
  const bytes = new Uint8Array(16);
  if (c) c.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function ShareKelasModal(props: {
  kelas: Kelas;
  mkNama: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
  showToast: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState("");
  const aktif = Boolean(props.kelas.bagikan_aktif && props.kelas.token_bagikan);
  const url = aktif ? `${window.location.origin}/m/${props.kelas.token_bagikan}` : "";

  useEffect(() => {
    let alive = true;
    if (url) {
      QRCode.toDataURL(url, { width: 220, margin: 1 })
        .then((d) => { if (alive) setQr(d); })
        .catch(() => { if (alive) setQr(""); });
    } else {
      setQr("");
    }
    return () => { alive = false; };
  }, [url]);

  async function updateKelas(patch: Partial<Kelas>, okMsg: string) {
    const supabase = getSupabase();
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.from("kelas").update(patch).eq("id", props.kelas.id);
    setBusy(false);
    if (error) { props.showToast(`Gagal: ${error.message}`); return; }
    await props.onChanged();
    props.showToast(okMsg);
  }

  async function salinLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      props.showToast("Tidak bisa menyalin otomatis — salin manual dari kotak link.");
    }
  }

  return (
    <Modal title={`Bagikan ke Mahasiswa — ${props.kelas.kode_kelas}`} onClose={props.onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        Halaman Mahasiswa adalah halaman publik <strong>hanya-baca</strong> untuk kelas ini ({props.mkNama}).
        Mahasiswa membukanya lewat link/QR <strong>tanpa login dan tanpa akun dosen</strong>.
      </p>
      <p className="muted">
        Yang terlihat mahasiswa: info kelas, jadwal &amp; topik pertemuan, materi, dan tugas.
        Yang <strong>tidak</strong> terlihat: daftar mahasiswa, absensi, dan nilai.
      </p>

      {!aktif && (
        <>
          <p><span className="chip warn">Link belum aktif</span></p>
          <div className="modal-actions">
            <button className="btn" onClick={props.onClose}>Tutup</button>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void updateKelas(
                { token_bagikan: props.kelas.token_bagikan ?? buatTokenBagikan(), bagikan_aktif: true },
                "Link Halaman Mahasiswa diaktifkan."
              )}
            >Aktifkan Link Mahasiswa</button>
          </div>
        </>
      )}

      {aktif && (
        <>
          <p><span className="chip ok">Link aktif</span></p>
          <div className="share-link-box">
            <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Link Halaman Mahasiswa" />
            <button className="btn btn-primary" onClick={() => void salinLink()}>{copied ? "✓ Tersalin" : "Salin"}</button>
          </div>
          {qr && (
            <div className="share-qr">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="QR code Halaman Mahasiswa" />
              <p>Mahasiswa cukup memindai QR ini dengan kamera HP.</p>
            </div>
          )}
          <div className="modal-actions" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
            <a className="btn" href={url} target="_blank" rel="noopener noreferrer">Buka Halaman ↗</a>
            <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Ganti link? Link lama langsung berhenti bekerja dan mahasiswa harus memakai link/QR baru.")) {
                    void updateKelas({ token_bagikan: buatTokenBagikan(), bagikan_aktif: true }, "Link diganti. Bagikan link/QR baru ke mahasiswa.");
                  }
                }}
              >Ganti Link</button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Nonaktifkan link? Mahasiswa tidak bisa lagi membuka halaman kelas ini sampai link diaktifkan lagi.")) {
                    void updateKelas({ bagikan_aktif: false }, "Link Halaman Mahasiswa dinonaktifkan.");
                  }
                }}
              >Nonaktifkan</button>
              <button className="btn" onClick={props.onClose}>Tutup</button>
            </span>
          </div>
        </>
      )}
    </Modal>
  );
}

interface EditorState { table: string; title: string; fields: FieldDef[]; initial: Record<string, string>; id?: number; numericKeys: string[]; nullableKeys: string[]; fixed?: Record<string, unknown>; }

export default function SmartClassApp() {
  const sessionState = useRequireSession();
  const sessionUser = useSessionUser(sessionState === "ready");
  const [view, setView] = useState<View>("dashboard");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [settings, setSettings] = useState<Record<string, string>>({});
  const [dosenList, setDosenList] = useState<Dosen[]>([]);
  const [taList, setTaList] = useState<TahunAkademik[]>([]);
  const [mkList, setMkList] = useState<MataKuliah[]>([]);
  const [kelasList, setKelasList] = useState<Kelas[]>([]);
  const [mhsList, setMhsList] = useState<Mahasiswa[]>([]);
  const [anggotaList, setAnggotaList] = useState<AnggotaKelas[]>([]);
  const [pertemuanList, setPertemuanList] = useState<Pertemuan[]>([]);
  const [absensiList, setAbsensiList] = useState<Absensi[]>([]);
  const [komponenList, setKomponenList] = useState<KomponenNilai[]>([]);
  const [nilaiList, setNilaiList] = useState<Nilai[]>([]);
  const [materiList, setMateriList] = useState<Materi[]>([]);
  const [tugasList, setTugasList] = useState<Tugas[]>([]);
  const [pengumpulanList, setPengumpulanList] = useState<PengumpulanTugas[]>([]);

  const [myPhoto, setMyPhoto] = useState("");
  const [photoOpen, setPhotoOpen] = useState(false);
  const [activeKelasId, setActiveKelasId] = useState<number | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [shareKelasId, setShareKelasId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [searchMhs, setSearchMhs] = useState("");
  const [selectedPertemuanId, setSelectedPertemuanId] = useState<number | null>(null);
  const [attDraft, setAttDraft] = useState<Record<number, StatusAbsensi>>({});
  const [attKetDraft, setAttKetDraft] = useState<Record<number, string>>({});
  const [nilaiDraft, setNilaiDraft] = useState<Record<string, string>>({});
  const [selectedTugasId, setSelectedTugasId] = useState<number | null>(null);
  const [kumpulDraft, setKumpulDraft] = useState<Record<number, { status: string; nilai: string; catatan: string; file_url: string; file_name: string }>>({});
  const [reportType, setReportType] = useState<null | "lengkap" | "kehadiran" | "nilai" | "mahasiswa" | "pertemuan">(null);
  const [exporting, setExporting] = useState(false);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3400);
  }

  async function loadAll() {
    const supabase = getSupabase();
    if (!supabase) return;
    const [st, ds, ta, mk, kl, mh, ag, pt, ab, kn, nl, mt, tg, pg] = await Promise.all([
      supabase.from("pengaturan").select("*"),
      supabase.from("dosen").select("*").order("nama"),
      supabase.from("tahun_akademik").select("*").order("tahun", { ascending: false }),
      supabase.from("mata_kuliah").select("*").order("nama"),
      supabase.from("kelas").select("*").order("kode_kelas"),
      supabase.from("mahasiswa").select("*").order("nama"),
      supabase.from("anggota_kelas").select("*").order("nomor_absen"),
      supabase.from("pertemuan").select("*").order("pertemuan_ke"),
      supabase.from("absensi").select("*"),
      supabase.from("komponen_nilai").select("*").order("id"),
      supabase.from("nilai").select("*"),
      supabase.from("materi").select("*").order("created_at", { ascending: false }),
      supabase.from("tugas").select("*").order("created_at", { ascending: false }),
      supabase.from("pengumpulan_tugas").select("*"),
    ]);
    if (st.data) {
      const rec: Record<string, string> = {};
      for (const r of st.data as { kunci: string; nilai: string | null }[]) rec[r.kunci] = r.nilai ?? "";
      setSettings(rec);
    }
    if (ds.data) setDosenList(ds.data as Dosen[]);
    if (ta.data) setTaList(ta.data as TahunAkademik[]);
    if (mk.data) setMkList(mk.data as MataKuliah[]);
    if (kl.data) setKelasList(kl.data as Kelas[]);
    if (mh.data) setMhsList(mh.data as Mahasiswa[]);
    if (ag.data) setAnggotaList(ag.data as AnggotaKelas[]);
    if (pt.data) setPertemuanList(pt.data as Pertemuan[]);
    if (ab.data) setAbsensiList(ab.data as Absensi[]);
    if (kn.data) setKomponenList(kn.data as unknown as KomponenNilai[]);
    if (nl.data) setNilaiList(nl.data as unknown as Nilai[]);
    if (mt.data) setMateriList(mt.data as Materi[]);
    if (tg.data) setTugasList(tg.data as unknown as Tugas[]);
    if (pg.data) setPengumpulanList(pg.data as unknown as PengumpulanTugas[]);
    setLoading(false);
  }

  useEffect(() => { if (sessionState === "ready") void loadAll(); }, [sessionState]);

  useEffect(() => {
    if (!sessionUser) return;
    const supabase = getSupabase();
    if (!supabase) return;
    let active = true;
    supabase.from("profiles").select("photo").eq("user_id", sessionUser.id).maybeSingle()
      .then(({ data }) => { if (active && data) setMyPhoto((data as { photo: string }).photo ?? ""); });
    return () => { active = false; };
  }, [sessionUser]);

  useEffect(() => {
    const saved = Number(localStorage.getItem("smart-class-kelas-aktif") || "");
    if (saved) setActiveKelasId(saved);
  }, []);
  useEffect(() => {
    if (activeKelasId === null && kelasList.length) {
      const saved = Number(localStorage.getItem("smart-class-kelas-aktif") || "");
      const pick = kelasList.find((k) => k.id === saved) ?? kelasList[0];
      if (pick) setActiveKelasId(pick.id);
    }
  }, [kelasList, activeKelasId]);

  function pilihKelasAktif(id: number | null) {
    setActiveKelasId(id);
    if (id) localStorage.setItem("smart-class-kelas-aktif", String(id));
    setSelectedPertemuanId(null);
    setSelectedTugasId(null);
  }

  /* ---------- data turunan ---------- */
  const mhsById = useMemo(() => new Map(mhsList.map((m) => [m.id, m])), [mhsList]);
  const mkById = useMemo(() => new Map(mkList.map((m) => [m.id, m])), [mkList]);
  const dosenById = useMemo(() => new Map(dosenList.map((d) => [d.id, d])), [dosenList]);
  const taById = useMemo(() => new Map(taList.map((t) => [t.id, t])), [taList]);
  const activeKelas = kelasList.find((k) => k.id === activeKelasId) ?? null;
  const activeTA = taList.find((t) => t.aktif === 1) ?? taList.find((t) => String(t.id) === settings.tahun_akademik_aktif_id) ?? null;
  const activeDosen = dosenList.find((d) => String(d.id) === settings.dosen_aktif_id) ?? dosenList[0] ?? null;
  const anggotaAktif = useMemo(
    () => anggotaList.filter((a) => a.kelas_id === activeKelasId && a.status === "Aktif")
      .sort((a, b) => (a.nomor_absen ?? 999) - (b.nomor_absen ?? 999) || (mhsById.get(a.mahasiswa_id)?.nama ?? "").localeCompare(mhsById.get(b.mahasiswa_id)?.nama ?? "")),
    [anggotaList, activeKelasId, mhsById]
  );
  const pertemuanAktif = useMemo(() => pertemuanList.filter((p) => p.kelas_id === activeKelasId), [pertemuanList, activeKelasId]);
  const komponenAktif = useMemo(() => komponenList.filter((k) => k.kelas_id === activeKelasId), [komponenList, activeKelasId]);
  const totalBobot = komponenAktif.reduce((s, k) => s + Number(k.bobot || 0), 0);

  function finalGrade(mahasiswaId: number): number {
    let total = 0;
    for (const k of komponenAktif) {
      const n = nilaiList.find((x) => x.kelas_id === activeKelasId && x.mahasiswa_id === mahasiswaId && x.komponen_nilai_id === k.id);
      if (n && Number.isFinite(Number(n.nilai_angka))) total += Number(n.nilai_angka) * Number(k.bobot || 0) / 100;
    }
    return total;
  }
  function rekapKehadiran(mahasiswaId: number) {
    const perIds = new Set(pertemuanAktif.map((p) => p.id));
    const rows = absensiList.filter((a) => a.mahasiswa_id === mahasiswaId && perIds.has(a.pertemuan_id));
    const hitung = (s: string) => rows.filter((r) => r.status === s).length;
    const efektif = hitung("Hadir") + hitung("Terlambat");
    const persen = rows.length ? Math.round((efektif / rows.length) * 1000) / 10 : 0;
    return { Hadir: hitung("Hadir"), Izin: hitung("Izin"), Sakit: hitung("Sakit"), Alpha: hitung("Alpha"), Terlambat: hitung("Terlambat"), total: rows.length, persen };
  }

  /* ---------- CRUD generik ---------- */
  function openEditor(cfg: EditorState) { setEditor(cfg); }
  async function saveEditor(values: Record<string, string>) {
    if (!editor) return;
    const supabase = getSupabase();
    if (!supabase) return;
    const payload: Record<string, unknown> = { ...(editor.fixed ?? {}) };
    for (const f of editor.fields) {
      const raw = values[f.key] ?? "";
      if (editor.numericKeys.includes(f.key)) payload[f.key] = raw === "" ? null : Number(raw);
      else if (editor.nullableKeys.includes(f.key)) payload[f.key] = raw.trim() === "" ? null : raw;
      else payload[f.key] = raw;
    }
    let error: { message: string } | null = null;
    if (editor.id) {
      ({ error } = await supabase.from(editor.table).update(payload).eq("id", editor.id));
    } else {
      ({ error } = await supabase.from(editor.table).insert(payload));
    }
    if (error) throw new Error(error.message);
    await loadAll();
    showToast("Data berhasil disimpan.");
  }
  async function hapus(table: string, id: number, label: string) {
    if (!window.confirm(`Hapus ${label}? Tindakan ini tidak bisa dibatalkan.`)) return;
    const supabase = getSupabase();
    if (!supabase) return;
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) { showToast(`Gagal menghapus: ${error.message}`); return; }
    await loadAll();
    showToast(`${label} berhasil dihapus.`);
  }
  async function saveSetting(kunci: string, nilai: string) {
    const supabase = getSupabase();
    if (!supabase) return;
    const { error } = await supabase.from("pengaturan").upsert({ kunci, nilai }, { onConflict: "kunci" });
    if (error) throw new Error(error.message);
    setSettings((p) => ({ ...p, [kunci]: nilai }));
  }
  async function logout() {
    const supabase = getSupabase();
    if (supabase) await supabase.auth.signOut();
    window.location.href = "/login";
  }

  if (sessionState === "setup") return <SetupScreen />;
  if (sessionState === "loading" || loading) {
    return <main className="setup-wrap"><p className="muted">Memuat Smart Class Online…</p></main>;
  }

  const appName = settings.nama_aplikasi || "Smart Class";
  const institusi = settings.institusi || "IAI DDI Maros";
  const userName = activeDosen?.nama || sessionUser?.email || "Dosen";

  return (
    <div className="shell">
      <aside className="sidebar no-print">
        <div className="app-title">
          <div className="logo">SC</div>
          <h2>{appName}</h2>
          <p>{institusi}</p>
        </div>
        <div className="profile">
          <button type="button" className="avatar-btn" title="Klik foto untuk mengganti" onClick={() => setPhotoOpen(true)}>
            <span className="avatar">
              {myPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={myPhoto} alt={`Foto profil ${userName}`} />
              ) : (userName.charAt(0) || "D")}
            </span>
          </button>
          <p className="avatar-hint">Klik foto untuk mengganti</p>
          <h3>{userName}</h3>
          <p>{activeDosen?.prodi || "Dosen"} {activeDosen?.fakultas ? `• ${activeDosen.fakultas}` : ""}</p>
          <p className="online-dot">● Online</p>
          <span className="role-chip admin">Dosen</span>
        </div>
        <p className="nav-label">Menu Utama</p>
        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.view} className={view === n.view ? "active" : ""} onClick={() => setView(n.view)}>
              <span className="ico">{n.icon}</span> {n.label}
            </button>
          ))}
        </nav>
        <div className="journal-card">
          <div className="crown">🎓</div>
          <h4>{activeTA ? `${activeTA.tahun} • ${activeTA.semester}` : "Tahun Akademik"}</h4>
          <p>{activeTA ? "Tahun akademik aktif saat ini." : "Belum ada tahun akademik aktif. Atur di menu Pengaturan."}</p>
          <button className="btn btn-gold btn-small" onClick={() => setView("pengaturan")}>Atur Tahun Akademik</button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar no-print">
          <h1>{VIEW_TITLES[view]}</h1>
          <span className="badge-live">{activeTA ? `${activeTA.semester} • ${activeTA.tahun}` : "Online"}</span>
          <span className="spacer" />
          <button className="btn-logout" onClick={() => void logout()}>⏻ Keluar</button>
        </div>

        <div className="context-bar no-print">
          <div>
            <label>Kelas Aktif
              <select value={activeKelasId ?? ""} onChange={(e) => pilihKelasAktif(e.target.value ? Number(e.target.value) : null)}>
                <option value="">— Pilih Kelas —</option>
                {kelasList.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.kode_kelas} — {mkById.get(k.mata_kuliah_id)?.nama ?? "Mata Kuliah"} ({taById.get(k.tahun_akademik_id)?.tahun ?? "-"})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ flex: "0 1 auto" }}>
            <span className="muted" style={{ fontSize: 13 }}>
              {activeKelas ? <>{anggotaAktif.length} peserta • {pertemuanAktif.length} pertemuan • {mkById.get(activeKelas.mata_kuliah_id)?.sks ?? "-"} SKS</> : "Buat kelas dulu di menu Kelas, lalu pilih di sini."}
            </span>
          </div>
        </div>

        {view === "dashboard" && (
          <>
            <div className="hero no-print">
              <span className="pill">{institusi}</span>
              <h2>Selamat datang, {userName} 👋</h2>
              <p>
                Kelola perkuliahan Anda dalam satu tempat: mata kuliah, kelas, mahasiswa,
                absensi, penilaian, export SIAKAD, materi &amp; tugas, dan laporan.
              </p>
              <div className="actions">
                <button className="btn btn-primary" onClick={() => setView("pertemuan")}>Isi Absensi</button>
                <button className="btn" onClick={() => setView("penilaian")}>Input Nilai</button>
                <button className="btn" onClick={() => setView("rekap")}>Rekap &amp; Laporan</button>
              </div>
            </div>
            <div className="kpis">
              <div className="kpi tone-1"><div className="k-ico">📚</div><div className="k-label">Mata Kuliah</div><div className="k-value">{mkList.length}</div><div className="k-sub">Total mata kuliah</div></div>
              <div className="kpi tone-2"><div className="k-ico">🗂️</div><div className="k-label">Kelas</div><div className="k-value">{kelasList.length}</div><div className="k-sub">Total kelas</div></div>
              <div className="kpi tone-3"><div className="k-ico">🎓</div><div className="k-label">Peserta Kelas Aktif</div><div className="k-value">{anggotaAktif.length}</div><div className="k-sub">{activeKelas ? activeKelas.kode_kelas : "Belum ada kelas aktif"}</div></div>
              <div className="kpi tone-4"><div className="k-ico">🗓️</div><div className="k-label">Pertemuan Kelas Aktif</div><div className="k-value">{pertemuanAktif.length}</div><div className="k-sub">{mhsList.length} mahasiswa terdaftar</div></div>
            </div>
            <div className="kelas-aktif-banner">
              <div style={{ fontSize: 13, opacity: 0.85 }}>Konteks saat ini</div>
              <div style={{ fontSize: 17, marginTop: 4 }}>
                Tahun Akademik Aktif: <strong>{activeTA ? `${activeTA.tahun} — Semester ${activeTA.semester}` : "Belum diatur"}</strong>
                {" • "}Kelas Aktif: <strong>{activeKelas ? `${activeKelas.kode_kelas} — ${mkById.get(activeKelas.mata_kuliah_id)?.nama ?? ""}` : "Belum dipilih"}</strong>
              </div>
              <div style={{ fontSize: 13, marginTop: 4, opacity: 0.9 }}>
                {activeKelas ? <>Dosen: {dosenById.get(activeKelas.dosen_id)?.nama ?? "-"} • Ruang {activeKelas.ruang || "-"} • {activeKelas.hari || "-"} {activeKelas.jam_mulai || ""}{activeKelas.jam_selesai ? `–${activeKelas.jam_selesai}` : ""} • Status {activeKelas.status}</> : "Pilih kelas aktif pada bilah konteks di atas."}
              </div>
            </div>
            <div className="grid-2">
              <div className="panel">
                <h3>Pertemuan Terakhir Kelas Aktif</h3>
                <p className="sub">Jadwal &amp; topik pertemuan terbaru</p>
                {pertemuanAktif.length === 0 && <p className="empty">Belum ada pertemuan untuk kelas aktif.</p>}
                {[...pertemuanAktif].slice(-5).reverse().map((p) => (
                  <div key={p.id} className="legend-row">
                    <span className="dot" style={{ background: "#0284c7" }} />
                    <span>Pertemuan {p.pertemuan_ke} — {p.topik || "(tanpa topik)"}</span>
                    <span className="val">{fmtTanggal(p.tanggal)}</span>
                  </div>
                ))}
              </div>
              <div className="panel">
                <h3>Ringkasan Penilaian Kelas Aktif</h3>
                <p className="sub">Komponen nilai &amp; total bobot</p>
                {komponenAktif.map((k) => (
                  <div key={k.id} className="legend-row">
                    <span className="dot" style={{ background: "#38bdf8" }} />
                    <span>{k.nama}</span>
                    <span className="val">{Number(k.bobot)}%</span>
                  </div>
                ))}
                <div className="legend-row">
                  <span>Total Bobot</span>
                  <span className="val">{totalBobot}% {Math.abs(totalBobot - 100) < 0.01 ? "✅" : "⚠️ harus 100%"}</span>
                </div>
              </div>
            </div>
          </>
        )}

        {view === "dosen" && (
          <section className="module">
            <div className="module-head">
              <h2>Profil Dosen</h2><span className="spacer" />
              <button className="btn btn-primary" onClick={() => openEditor({
                table: "dosen", title: "Tambah Dosen", id: undefined, numericKeys: [], nullableKeys: ["nidn", "email", "no_hp", "prodi", "fakultas", "foto"],
                fields: [
                  { key: "nidn", label: "NIDN" }, { key: "nama", label: "Nama Dosen", required: true },
                  { key: "email", label: "Email" }, { key: "no_hp", label: "No. HP" },
                  { key: "prodi", label: "Program Studi", type: "select", options: [{ value: "", label: "— Pilih —" }, ...PRODI_OPTIONS.map((p) => ({ value: p, label: p }))] },
                  { key: "fakultas", label: "Fakultas" },
                  { key: "foto", label: "Foto Dosen (opsional)", type: "photo", full: true },
                ],
                initial: { nidn: "", nama: "", email: "", no_hp: "", prodi: "", fakultas: "", foto: "" },
              })}>+ Tambah Dosen</button>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>Satu profil dosen aktif dipakai sebagai konteks aplikasi. Klik <strong>Jadikan Aktif</strong> untuk memilihnya.</p>
            <div className="cards-grid">
              {dosenList.map((d) => (
                <div key={d.id} className="class-card">
                  <span className="avatar" style={{ width: 64, height: 64, fontSize: 24, margin: "0 0 8px" }}>
                    {d.foto ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={d.foto} alt={`Foto ${d.nama}`} />
                    ) : d.nama.charAt(0)}
                  </span>
                  <h3>{d.nama}</h3>
                  <p>NIDN: {d.nidn || "-"}</p>
                  <p>{d.prodi || "-"} {d.fakultas ? `• ${d.fakultas}` : ""}</p>
                  <p>{d.email || "-"} • {d.no_hp || "-"}</p>
                  {String(d.id) === settings.dosen_aktif_id || (dosenList[0]?.id === d.id && !settings.dosen_aktif_id)
                    ? <span className="chip ok">● Dosen Aktif</span>
                    : <span className="chip">Nonaktif</span>}
                  <div className="row-actions">
                    <button className="btn btn-small" onClick={() => void (async () => { await saveSetting("dosen_aktif_id", String(d.id)); showToast(`${d.nama} menjadi dosen aktif.`); })()}>Jadikan Aktif</button>
                    <button className="btn btn-small" onClick={() => openEditor({
                      table: "dosen", title: "Edit Dosen", id: d.id, numericKeys: [], nullableKeys: ["nidn", "email", "no_hp", "prodi", "fakultas", "foto"],
                      fields: [
                        { key: "nidn", label: "NIDN" }, { key: "nama", label: "Nama Dosen", required: true },
                        { key: "email", label: "Email" }, { key: "no_hp", label: "No. HP" },
                        { key: "prodi", label: "Program Studi", type: "select", options: [{ value: "", label: "— Pilih —" }, ...PRODI_OPTIONS.map((p) => ({ value: p, label: p }))] },
                        { key: "fakultas", label: "Fakultas" },
                        { key: "foto", label: "Foto Dosen (opsional)", type: "photo", full: true },
                      ],
                      initial: { nidn: d.nidn ?? "", nama: d.nama, email: d.email ?? "", no_hp: d.no_hp ?? "", prodi: d.prodi ?? "", fakultas: d.fakultas ?? "", foto: d.foto ?? "" },
                    })}>Edit</button>
                    <button className="btn btn-small btn-danger" onClick={() => void hapus("dosen", d.id, `dosen ${d.nama}`)}>Hapus</button>
                  </div>
                </div>
              ))}
              {dosenList.length === 0 && <p className="empty">Belum ada data dosen. Tambahkan profil dosen pertama Anda.</p>}
            </div>
          </section>
        )}

        {view === "matakuliah" && (
          <section className="module">
            <div className="module-head">
              <h2>Mata Kuliah</h2><span className="spacer" />
              <button className="btn btn-primary" onClick={() => openEditor({
                table: "mata_kuliah", title: "Tambah Mata Kuliah", numericKeys: ["sks", "semester"], nullableKeys: ["kode", "prodi", "deskripsi"],
                fields: [
                  { key: "kode", label: "Kode MK" }, { key: "nama", label: "Nama Mata Kuliah", required: true },
                  { key: "sks", label: "SKS", type: "number" },
                  { key: "semester", label: "Semester (1–8)", type: "select", options: [{ value: "", label: "— Pilih —" }, ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: String(n), label: `Semester ${n}` }))] },
                  { key: "prodi", label: "Program Studi", type: "select", options: [{ value: "", label: "— Pilih —" }, ...PRODI_OPTIONS.map((p) => ({ value: p, label: p }))] },
                  { key: "deskripsi", label: "Deskripsi", type: "textarea", full: true },
                ],
                initial: { kode: "", nama: "", sks: "3", semester: "", prodi: activeDosen?.prodi ?? "", deskripsi: "" },
              })}>+ Tambah Mata Kuliah</button>
            </div>
            <table>
              <thead><tr><th>Kode</th><th>Nama</th><th>SKS</th><th>Semester</th><th>Prodi</th><th>Aksi</th></tr></thead>
              <tbody>
                {mkList.map((m) => (
                  <tr key={m.id}>
                    <td>{m.kode || "-"}</td><td><strong>{m.nama}</strong></td><td>{m.sks ?? "-"}</td>
                    <td>{m.semester ?? "-"}</td><td>{m.prodi || "-"}</td>
                    <td><div className="row-actions">
                      <button className="btn btn-small" onClick={() => openEditor({
                        table: "mata_kuliah", title: "Edit Mata Kuliah", id: m.id, numericKeys: ["sks", "semester"], nullableKeys: ["kode", "prodi", "deskripsi"],
                        fields: [
                          { key: "kode", label: "Kode MK" }, { key: "nama", label: "Nama Mata Kuliah", required: true },
                          { key: "sks", label: "SKS", type: "number" },
                          { key: "semester", label: "Semester (1–8)", type: "select", options: [{ value: "", label: "— Pilih —" }, ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: String(n), label: `Semester ${n}` }))] },
                          { key: "prodi", label: "Program Studi", type: "select", options: [{ value: "", label: "— Pilih —" }, ...PRODI_OPTIONS.map((p) => ({ value: p, label: p }))] },
                          { key: "deskripsi", label: "Deskripsi", type: "textarea", full: true },
                        ],
                        initial: { kode: m.kode ?? "", nama: m.nama, sks: String(m.sks ?? 3), semester: m.semester ? String(m.semester) : "", prodi: m.prodi ?? "", deskripsi: m.deskripsi ?? "" },
                      })}>Edit</button>
                      <button className="btn btn-small btn-danger" onClick={() => void hapus("mata_kuliah", m.id, `mata kuliah ${m.nama}`)}>Hapus</button>
                    </div></td>
                  </tr>
                ))}
                {mkList.length === 0 && <tr><td colSpan={6} className="empty">Belum ada mata kuliah.</td></tr>}
              </tbody>
            </table>
          </section>
        )}

        {view === "kelas" && (
          <section className="module">
            <div className="module-head">
              <h2>Kelas</h2><span className="spacer" />
              <button className="btn btn-primary" onClick={() => openEditor({
                table: "kelas", title: "Tambah Kelas", numericKeys: ["mata_kuliah_id", "dosen_id", "tahun_akademik_id", "kapasitas"], nullableKeys: ["ruang", "hari", "jam_mulai", "jam_selesai", "deskripsi"],
                fields: [
                  { key: "kode_kelas", label: "Kode Kelas", required: true },
                  { key: "mata_kuliah_id", label: "Mata Kuliah", type: "select", required: true, options: mkList.map((m) => ({ value: String(m.id), label: `${m.kode ? `${m.kode} — ` : ""}${m.nama}` })) },
                  { key: "dosen_id", label: "Dosen", type: "select", required: true, options: dosenList.map((d) => ({ value: String(d.id), label: d.nama })) },
                  { key: "tahun_akademik_id", label: "Tahun Akademik", type: "select", required: true, options: taList.map((t) => ({ value: String(t.id), label: `${t.tahun} — ${t.semester}${t.aktif ? " (Aktif)" : ""}` })) },
                  { key: "ruang", label: "Ruang" },
                  { key: "hari", label: "Hari", type: "select", options: [{ value: "", label: "— Pilih —" }, ...HARI_OPTIONS.map((h) => ({ value: h, label: h }))] },
                  { key: "jam_mulai", label: "Jam Mulai", type: "time" }, { key: "jam_selesai", label: "Jam Selesai", type: "time" },
                  { key: "kapasitas", label: "Kapasitas", type: "number" },
                  { key: "status", label: "Status", type: "select", options: ["Aktif", "Selesai", "Nonaktif"].map((s) => ({ value: s, label: s })) },
                  { key: "deskripsi", label: "Deskripsi", type: "textarea", full: true },
                ],
                initial: {
                  kode_kelas: "", mata_kuliah_id: mkList[0] ? String(mkList[0].id) : "", dosen_id: activeDosen ? String(activeDosen.id) : "",
                  tahun_akademik_id: activeTA ? String(activeTA.id) : "", ruang: "", hari: "", jam_mulai: "", jam_selesai: "",
                  kapasitas: "40", status: "Aktif", deskripsi: "",
                },
              })}>+ Tambah Kelas</button>
            </div>
            <div className="cards-grid">
              {kelasList.map((k) => {
                const jumlah = anggotaList.filter((a) => a.kelas_id === k.id && a.status === "Aktif").length;
                return (
                  <div key={k.id} className="class-card">
                    <h3>{k.kode_kelas}</h3>
                    <p><strong>{mkById.get(k.mata_kuliah_id)?.nama ?? "-"}</strong></p>
                    <p>Dosen: {dosenById.get(k.dosen_id)?.nama ?? "-"}</p>
                    <p>{taById.get(k.tahun_akademik_id) ? `${taById.get(k.tahun_akademik_id)?.tahun} — ${taById.get(k.tahun_akademik_id)?.semester}` : "-"}</p>
                    <p>{k.hari || "-"} {k.jam_mulai || ""}{k.jam_selesai ? `–${k.jam_selesai}` : ""} • Ruang {k.ruang || "-"}</p>
                    <p>{jumlah} peserta • Kapasitas {k.kapasitas ?? "-"}</p>
                    <span className={`pill-status${k.status !== "Aktif" ? " off" : ""}`}>{k.status}</span>
                    {k.id === activeKelasId && <> <span className="chip ok">Kelas Aktif</span></>}
                    {k.bagikan_aktif && k.token_bagikan && <> <span className="chip">🔗 Link Mahasiswa Aktif</span></>}
                    <div className="row-actions">
                      <button className="btn btn-small" onClick={() => { pilihKelasAktif(k.id); showToast(`${k.kode_kelas} menjadi kelas aktif.`); }}>Pilih Aktif</button>
                      <button className="btn btn-small" onClick={() => setShareKelasId(k.id)}>🔗 Bagikan</button>
                      <button className="btn btn-small" onClick={() => openEditor({
                        table: "kelas", title: "Edit Kelas", id: k.id, numericKeys: ["mata_kuliah_id", "dosen_id", "tahun_akademik_id", "kapasitas"], nullableKeys: ["ruang", "hari", "jam_mulai", "jam_selesai", "deskripsi"],
                        fields: [
                          { key: "kode_kelas", label: "Kode Kelas", required: true },
                          { key: "mata_kuliah_id", label: "Mata Kuliah", type: "select", required: true, options: mkList.map((m) => ({ value: String(m.id), label: `${m.kode ? `${m.kode} — ` : ""}${m.nama}` })) },
                          { key: "dosen_id", label: "Dosen", type: "select", required: true, options: dosenList.map((d) => ({ value: String(d.id), label: d.nama })) },
                          { key: "tahun_akademik_id", label: "Tahun Akademik", type: "select", required: true, options: taList.map((t) => ({ value: String(t.id), label: `${t.tahun} — ${t.semester}${t.aktif ? " (Aktif)" : ""}` })) },
                          { key: "ruang", label: "Ruang" },
                          { key: "hari", label: "Hari", type: "select", options: [{ value: "", label: "— Pilih —" }, ...HARI_OPTIONS.map((h) => ({ value: h, label: h }))] },
                          { key: "jam_mulai", label: "Jam Mulai", type: "time" }, { key: "jam_selesai", label: "Jam Selesai", type: "time" },
                          { key: "kapasitas", label: "Kapasitas", type: "number" },
                          { key: "status", label: "Status", type: "select", options: ["Aktif", "Selesai", "Nonaktif"].map((s) => ({ value: s, label: s })) },
                          { key: "deskripsi", label: "Deskripsi", type: "textarea", full: true },
                        ],
                        initial: {
                          kode_kelas: k.kode_kelas, mata_kuliah_id: String(k.mata_kuliah_id), dosen_id: String(k.dosen_id),
                          tahun_akademik_id: String(k.tahun_akademik_id), ruang: k.ruang ?? "", hari: k.hari ?? "",
                          jam_mulai: k.jam_mulai ?? "", jam_selesai: k.jam_selesai ?? "", kapasitas: String(k.kapasitas ?? 40),
                          status: k.status, deskripsi: k.deskripsi ?? "",
                        },
                      })}>Edit</button>
                      <button className="btn btn-small btn-danger" onClick={() => void hapus("kelas", k.id, `kelas ${k.kode_kelas}`)}>Hapus</button>
                    </div>
                  </div>
                );
              })}
              {kelasList.length === 0 && <p className="empty">Belum ada kelas. Buat tahun akademik, dosen, dan mata kuliah dulu bila pilihan masih kosong.</p>}
            </div>
          </section>
        )}

        {view === "mahasiswa" && (
          <section className="module">
            <div className="module-head">
              <h2>Mahasiswa</h2><span className="spacer" />
              <input className="search-inline" placeholder="Cari NIM / nama…" value={searchMhs} onChange={(e) => setSearchMhs(e.target.value)} />
              <button className="btn" onClick={() => setImportOpen(true)}>📥 Import Excel</button>
              <button className="btn btn-primary" onClick={() => openEditor({
                table: "mahasiswa", title: "Tambah Mahasiswa", numericKeys: ["angkatan"], nullableKeys: ["jenis_kelamin", "prodi", "email", "no_hp", "foto"],
                fields: [
                  { key: "nim", label: "NIM", required: true }, { key: "nama", label: "Nama Mahasiswa", required: true },
                  { key: "jenis_kelamin", label: "Jenis Kelamin", type: "select", options: [{ value: "", label: "— Pilih —" }, { value: "L", label: "Laki-laki (L)" }, { value: "P", label: "Perempuan (P)" }] },
                  { key: "prodi", label: "Program Studi", type: "select", options: [{ value: "", label: "— Pilih —" }, ...PRODI_OPTIONS.map((p) => ({ value: p, label: p }))] },
                  { key: "angkatan", label: "Angkatan", type: "number" },
                  { key: "email", label: "Email" }, { key: "no_hp", label: "No. HP" },
                  { key: "status", label: "Status", type: "select", options: ["Aktif", "Cuti", "Lulus", "Nonaktif"].map((s) => ({ value: s, label: s })) },
                ],
                initial: { nim: "", nama: "", jenis_kelamin: "", prodi: activeKelas ? (mkById.get(activeKelas.mata_kuliah_id)?.prodi ?? "") : "", angkatan: "", email: "", no_hp: "", status: "Aktif" },
              })}>+ Tambah Mahasiswa</button>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              Data mahasiswa bersifat global. Gunakan tombol <strong>+ Kelas Aktif</strong> untuk memasukkan mahasiswa
              ke kelas aktif ({activeKelas ? activeKelas.kode_kelas : "belum dipilih"}) — nomor absen otomatis berikutnya.
              Bila NIM sudah terdaftar, mahasiswa tidak diduplikasi.
            </p>
            <h3 style={{ margin: "18px 0 8px" }}>Anggota Kelas Aktif ({anggotaAktif.length})</h3>
            <table>
              <thead><tr><th>No. Absen</th><th>NIM</th><th>Nama</th><th>JK</th><th>Prodi</th><th>Aksi</th></tr></thead>
              <tbody>
                {anggotaAktif.map((a) => {
                  const m = mhsById.get(a.mahasiswa_id);
                  if (!m) return null;
                  return (
                    <tr key={a.id}>
                      <td>{a.nomor_absen ?? "-"}</td><td>{m.nim}</td><td><strong>{m.nama}</strong></td>
                      <td>{m.jenis_kelamin || "-"}</td><td>{m.prodi || "-"}</td>
                      <td><button className="btn btn-small btn-danger" onClick={() => void hapus("anggota_kelas", a.id, `${m.nama} dari kelas aktif`)}>Keluarkan</button></td>
                    </tr>
                  );
                })}
                {anggotaAktif.length === 0 && <tr><td colSpan={6} className="empty">Belum ada anggota pada kelas aktif.</td></tr>}
              </tbody>
            </table>
            <h3 style={{ margin: "22px 0 8px" }}>Semua Mahasiswa ({mhsList.length})</h3>
            <table>
              <thead><tr><th>NIM</th><th>Nama</th><th>JK</th><th>Prodi</th><th>Angkatan</th><th>Status</th><th>Aksi</th></tr></thead>
              <tbody>
                {mhsList.filter((m) => !searchMhs || m.nama.toLowerCase().includes(searchMhs.toLowerCase()) || m.nim.toLowerCase().includes(searchMhs.toLowerCase())).map((m) => {
                  const sudahAnggota = anggotaAktif.some((a) => a.mahasiswa_id === m.id);
                  return (
                    <tr key={m.id}>
                      <td>{m.nim}</td><td><strong>{m.nama}</strong></td><td>{m.jenis_kelamin || "-"}</td>
                      <td>{m.prodi || "-"}</td><td>{m.angkatan ?? "-"}</td>
                      <td><span className={`pill-status${m.status !== "Aktif" ? " off" : ""}`}>{m.status}</span></td>
                      <td><div className="row-actions">
                        {!sudahAnggota && (
                          <button className="btn btn-small" disabled={!activeKelas} onClick={() => void (async () => {
                            if (!activeKelas) return;
                            const supabase = getSupabase(); if (!supabase) return;
                            const nextNo = anggotaAktif.reduce((mx, a) => Math.max(mx, a.nomor_absen ?? 0), 0) + 1;
                            const { error } = await supabase.from("anggota_kelas").insert({ kelas_id: activeKelas.id, mahasiswa_id: m.id, status: "Aktif", nomor_absen: nextNo });
                            if (error) { showToast(`Gagal: ${error.message}`); return; }
                            await loadAll(); showToast(`${m.nama} masuk kelas aktif dengan nomor absen ${nextNo}.`);
                          })()}>+ Kelas Aktif</button>
                        )}
                        {sudahAnggota && <span className="chip ok">Anggota aktif</span>}
                        <button className="btn btn-small" onClick={() => openEditor({
                          table: "mahasiswa", title: "Edit Mahasiswa", id: m.id, numericKeys: ["angkatan"], nullableKeys: ["jenis_kelamin", "prodi", "email", "no_hp", "foto"],
                          fields: [
                            { key: "nim", label: "NIM", required: true }, { key: "nama", label: "Nama Mahasiswa", required: true },
                            { key: "jenis_kelamin", label: "Jenis Kelamin", type: "select", options: [{ value: "", label: "— Pilih —" }, { value: "L", label: "Laki-laki (L)" }, { value: "P", label: "Perempuan (P)" }] },
                            { key: "prodi", label: "Program Studi", type: "select", options: [{ value: "", label: "— Pilih —" }, ...PRODI_OPTIONS.map((p) => ({ value: p, label: p }))] },
                            { key: "angkatan", label: "Angkatan", type: "number" },
                            { key: "email", label: "Email" }, { key: "no_hp", label: "No. HP" },
                            { key: "status", label: "Status", type: "select", options: ["Aktif", "Cuti", "Lulus", "Nonaktif"].map((s) => ({ value: s, label: s })) },
                          ],
                          initial: { nim: m.nim, nama: m.nama, jenis_kelamin: m.jenis_kelamin ?? "", prodi: m.prodi ?? "", angkatan: m.angkatan ? String(m.angkatan) : "", email: m.email ?? "", no_hp: m.no_hp ?? "", status: m.status },
                        })}>Edit</button>
                        <button className="btn btn-small btn-danger" onClick={() => void hapus("mahasiswa", m.id, `mahasiswa ${m.nama}`)}>Hapus</button>
                      </div></td>
                    </tr>
                  );
                })}
                {mhsList.length === 0 && <tr><td colSpan={7} className="empty">Belum ada mahasiswa. Tambah manual atau Import Excel.</td></tr>}
              </tbody>
            </table>
          </section>
        )}

        {view === "pertemuan" && (
          <section className="module">
            <div className="module-head">
              <h2>Pertemuan &amp; Absensi — {activeKelas ? activeKelas.kode_kelas : "pilih kelas aktif"}</h2><span className="spacer" />
              <button className="btn btn-primary" disabled={!activeKelas} onClick={() => openEditor({
                table: "pertemuan", title: "Tambah Pertemuan", numericKeys: ["pertemuan_ke"], nullableKeys: ["jam_mulai", "jam_selesai", "topik", "catatan"],
                fixed: { kelas_id: activeKelasId },
                fields: [
                  { key: "pertemuan_ke", label: "Pertemuan Ke", type: "number", required: true },
                  { key: "tanggal", label: "Tanggal", type: "date", required: true },
                  { key: "jam_mulai", label: "Jam Mulai", type: "time" }, { key: "jam_selesai", label: "Jam Selesai", type: "time" },
                  { key: "topik", label: "Topik / Materi", full: true },
                  { key: "catatan", label: "Catatan", type: "textarea", full: true },
                  { key: "status", label: "Status", type: "select", options: ["Terjadwal", "Berlangsung", "Selesai", "Dibatalkan"].map((s) => ({ value: s, label: s })) },
                ],
                initial: {
                  pertemuan_ke: String((pertemuanAktif.reduce((mx, p) => Math.max(mx, p.pertemuan_ke), 0) || 0) + 1),
                  tanggal: todayISO(), jam_mulai: activeKelas?.jam_mulai ?? "", jam_selesai: activeKelas?.jam_selesai ?? "",
                  topik: "", catatan: "", status: "Terjadwal",
                },
              })}>+ Tambah Pertemuan</button>
            </div>
            {!activeKelas && <p className="empty">Pilih kelas aktif terlebih dahulu.</p>}
            {activeKelas && (
              <>
                <table>
                  <thead><tr><th>Ke</th><th>Tanggal</th><th>Jam</th><th>Topik</th><th>Status</th><th>Aksi</th></tr></thead>
                  <tbody>
                    {pertemuanAktif.map((p) => (
                      <tr key={p.id} style={p.id === selectedPertemuanId ? { background: "#e0f2fe" } : undefined}>
                        <td>{p.pertemuan_ke}</td><td>{fmtTanggal(p.tanggal)}</td>
                        <td>{p.jam_mulai || "-"}{p.jam_selesai ? `–${p.jam_selesai}` : ""}</td>
                        <td>{p.topik || "-"}</td>
                        <td><span className="pill-status">{p.status}</span></td>
                        <td><div className="row-actions">
                          <button className="btn btn-small" onClick={() => {
                            setSelectedPertemuanId(p.id);
                            const draft: Record<number, StatusAbsensi> = {};
                            const ketDraft: Record<number, string> = {};
                            for (const a of anggotaAktif) {
                              const existing = absensiList.find((x) => x.pertemuan_id === p.id && x.mahasiswa_id === a.mahasiswa_id);
                              draft[a.mahasiswa_id] = existing?.status ?? "Hadir";
                              ketDraft[a.mahasiswa_id] = existing?.keterangan ?? "";
                            }
                            setAttDraft(draft);
                            setAttKetDraft(ketDraft);
                          }}>Isi Absensi</button>
                          <button className="btn btn-small" onClick={() => openEditor({
                            table: "pertemuan", title: "Edit Pertemuan", id: p.id, numericKeys: ["pertemuan_ke"], nullableKeys: ["jam_mulai", "jam_selesai", "topik", "catatan"],
                            fixed: { kelas_id: activeKelasId },
                            fields: [
                              { key: "pertemuan_ke", label: "Pertemuan Ke", type: "number", required: true },
                              { key: "tanggal", label: "Tanggal", type: "date", required: true },
                              { key: "jam_mulai", label: "Jam Mulai", type: "time" }, { key: "jam_selesai", label: "Jam Selesai", type: "time" },
                              { key: "topik", label: "Topik / Materi", full: true },
                              { key: "catatan", label: "Catatan", type: "textarea", full: true },
                              { key: "status", label: "Status", type: "select", options: ["Terjadwal", "Berlangsung", "Selesai", "Dibatalkan"].map((s) => ({ value: s, label: s })) },
                            ],
                            initial: { pertemuan_ke: String(p.pertemuan_ke), tanggal: p.tanggal, jam_mulai: p.jam_mulai ?? "", jam_selesai: p.jam_selesai ?? "", topik: p.topik ?? "", catatan: p.catatan ?? "", status: p.status },
                          })}>Edit</button>
                          <button className="btn btn-small btn-danger" onClick={() => void hapus("pertemuan", p.id, `pertemuan ${p.pertemuan_ke}`)}>Hapus</button>
                        </div></td>
                      </tr>
                    ))}
                    {pertemuanAktif.length === 0 && <tr><td colSpan={6} className="empty">Belum ada pertemuan untuk kelas aktif.</td></tr>}
                  </tbody>
                </table>

                {selectedPertemuanId && (
                  <div style={{ marginTop: 22 }}>
                    <div className="module-head">
                      <h3 style={{ margin: 0 }}>Absensi Pertemuan {pertemuanAktif.find((p) => p.id === selectedPertemuanId)?.pertemuan_ke ?? ""}</h3>
                      <span className="spacer" />
                      <button className="btn" onClick={() => { const d: Record<number, StatusAbsensi> = {}; anggotaAktif.forEach((a) => { d[a.mahasiswa_id] = "Hadir"; }); setAttDraft(d); }}>Semua Hadir</button>
                      <button className="btn btn-primary" onClick={() => void (async () => {
                        const supabase = getSupabase(); if (!supabase) return;
                        const rows = anggotaAktif.map((a) => ({
                          pertemuan_id: selectedPertemuanId, mahasiswa_id: a.mahasiswa_id,
                          status: attDraft[a.mahasiswa_id] ?? "Hadir",
                          keterangan: (attKetDraft[a.mahasiswa_id] ?? "").trim() || null,
                        }));
                        const { error } = await supabase.from("absensi").upsert(rows, { onConflict: "pertemuan_id,mahasiswa_id" });
                        if (error) { showToast(`Gagal menyimpan absensi: ${error.message}`); return; }
                        await loadAll(); showToast(`Absensi tersimpan untuk ${rows.length} mahasiswa.`);
                      })()}>💾 Simpan Absensi</button>
                    </div>
                    <table>
                      <thead><tr><th>No</th><th>NIM</th><th>Nama</th><th>Status Kehadiran</th><th>Keterangan</th><th>% Hadir (semua pertemuan)</th></tr></thead>
                      <tbody>
                        {anggotaAktif.map((a) => {
                          const m = mhsById.get(a.mahasiswa_id);
                          if (!m) return null;
                          const cur = attDraft[a.mahasiswa_id] ?? "Hadir";
                          return (
                            <tr key={a.id}>
                              <td>{a.nomor_absen ?? "-"}</td><td>{m.nim}</td><td><strong>{m.nama}</strong></td>
                              <td><span className="att-btns">
                                {STATUS_ABSENSI.map((s) => (
                                  <button key={s} className={cur === s ? `sel-${s}` : ""} onClick={() => setAttDraft((prev) => ({ ...prev, [a.mahasiswa_id]: s }))}>{s}</button>
                                ))}
                              </span></td>
                              <td><input
                                type="text"
                                style={{ minWidth: 170 }}
                                placeholder="Keterangan (opsional)"
                                value={attKetDraft[a.mahasiswa_id] ?? ""}
                                onChange={(e) => setAttKetDraft((prev) => ({ ...prev, [a.mahasiswa_id]: e.target.value }))}
                              /></td>
                              <td>{rekapKehadiran(a.mahasiswa_id).persen}%</td>
                            </tr>
                          );
                        })}
                        {anggotaAktif.length === 0 && <tr><td colSpan={6} className="empty">Belum ada anggota kelas aktif.</td></tr>}
                      </tbody>
                    </table>
                    <p className="muted" style={{ fontSize: 13 }}>Persentase kehadiran = (Hadir + Terlambat) ÷ total pertemuan tercatat × 100%.</p>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {view === "penilaian" && (
          <section className="module">
            <div className="module-head">
              <h2>Penilaian — {activeKelas ? activeKelas.kode_kelas : "pilih kelas aktif"}</h2><span className="spacer" />
              <button className="btn" disabled={!activeKelas} onClick={() => openEditor({
                table: "komponen_nilai", title: "Tambah Komponen Nilai", numericKeys: ["bobot"], nullableKeys: [],
                fixed: { kelas_id: activeKelasId },
                fields: [
                  { key: "nama", label: "Nama Komponen (mis. Tugas, UTS, UAS)", required: true },
                  { key: "bobot", label: "Bobot (%)", type: "number", required: true },
                ],
                initial: { nama: "", bobot: "0" },
              })}>+ Komponen Nilai</button>
              <button className="btn btn-primary" disabled={exporting || !activeKelas} onClick={() => void (async () => {
                if (!activeKelas) return;
                const mk = mkById.get(activeKelas.mata_kuliah_id);
                const ta = taById.get(activeKelas.tahun_akademik_id);
                const config = deteksiProdi(mk?.prodi || anggotaAktif.map((a) => mhsById.get(a.mahasiswa_id)?.prodi).find(Boolean) || "");
                if (!config) { showToast("Program studi kelas belum dikenali. Pastikan Prodi pada mata kuliah berisi PGMI, PAI, Ekonomi Syariah, atau Hukum Keluarga Islam."); return; }
                if (Math.abs(totalBobot - 100) >= 0.01) { showToast(`Total bobot penilaian ${totalBobot.toFixed(2)}%. Harus tepat 100% sebelum export SIAKAD.`); return; }
                setExporting(true);
                try {
                  const hasil = await exportSiakadWorkbook({
                    config,
                    kelas: {
                      kodeKelas: activeKelas.kode_kelas, mkKode: mk?.kode ?? "", mkNama: mk?.nama ?? "",
                      mkSemester: mk?.semester ?? null, tahun: ta?.tahun ?? "", semesterTerm: ta?.semester ?? "",
                    },
                    students: anggotaAktif.map((a) => {
                      const m = mhsById.get(a.mahasiswa_id);
                      return { nim: m?.nim ?? "", nama: m?.nama ?? "", nilaiAkhir: finalGrade(a.mahasiswa_id) };
                    }),
                    totalBobot,
                  });
                  showToast(`Export SIAKAD berhasil: ${hasil.fileName} (sheet ${hasil.sheet}, ${hasil.matched} mahasiswa).`);
                } catch (e) {
                  showToast(e instanceof Error ? e.message : "Export SIAKAD gagal.");
                }
                setExporting(false);
              })()}>⬇ Export SIAKAD{exporting ? "…" : ""}</button>
            </div>
            {!activeKelas && <p className="empty">Pilih kelas aktif terlebih dahulu.</p>}
            {activeKelas && (
              <>
                <div className="summary-bar">
                  <span>Komponen: {komponenAktif.length}</span>
                  <span>Total Bobot: {totalBobot}% {Math.abs(totalBobot - 100) < 0.01 ? "✅ siap export SIAKAD" : "⚠️ nilai akhir & export SIAKAD aktif bila tepat 100%"}</span>
                </div>
                <table style={{ marginBottom: 20 }}>
                  <thead><tr><th>Komponen</th><th>Bobot</th><th>Aksi</th></tr></thead>
                  <tbody>
                    {komponenAktif.map((k) => (
                      <tr key={k.id}>
                        <td><strong>{k.nama}</strong></td><td>{Number(k.bobot)}%</td>
                        <td><div className="row-actions">
                          <button className="btn btn-small" onClick={() => openEditor({
                            table: "komponen_nilai", title: "Edit Komponen Nilai", id: k.id, numericKeys: ["bobot"], nullableKeys: [],
                            fixed: { kelas_id: activeKelasId },
                            fields: [
                              { key: "nama", label: "Nama Komponen", required: true },
                              { key: "bobot", label: "Bobot (%)", type: "number", required: true },
                            ],
                            initial: { nama: k.nama, bobot: String(k.bobot) },
                          })}>Edit</button>
                          <button className="btn btn-small btn-danger" onClick={() => void hapus("komponen_nilai", k.id, `komponen ${k.nama}`)}>Hapus</button>
                        </div></td>
                      </tr>
                    ))}
                    {komponenAktif.length === 0 && <tr><td colSpan={3} className="empty">Belum ada komponen nilai. Contoh: Kehadiran 10, Tugas 20, UTS 30, UAS 40.</td></tr>}
                  </tbody>
                </table>

                <div className="module-head">
                  <h3 style={{ margin: 0 }}>Input Nilai Massal</h3><span className="spacer" />
                  <button className="btn btn-primary" disabled={komponenAktif.length === 0} onClick={() => void (async () => {
                    const supabase = getSupabase(); if (!supabase || !activeKelas) return;
                    const rows: { kelas_id: number; mahasiswa_id: number; komponen_nilai_id: number; nilai_angka: number }[] = [];
                    for (const a of anggotaAktif) {
                      for (const k of komponenAktif) {
                        const key = `${a.mahasiswa_id}:${k.id}`;
                        const existing = nilaiList.find((x) => x.kelas_id === activeKelasId && x.mahasiswa_id === a.mahasiswa_id && x.komponen_nilai_id === k.id);
                        const raw = nilaiDraft[key] ?? (existing ? String(existing.nilai_angka) : "");
                        if (raw === "") continue;
                        const v = Math.max(0, Math.min(100, Number(raw)));
                        if (!Number.isFinite(v)) continue;
                        // WAJIB mahasiswa_id asli (bukan anggota_kelas id) — bug FK desktop tidak boleh terulang.
                        rows.push({ kelas_id: activeKelas.id, mahasiswa_id: a.mahasiswa_id, komponen_nilai_id: k.id, nilai_angka: v });
                      }
                    }
                    if (!rows.length) { showToast("Belum ada nilai yang diisi."); return; }
                    const { error } = await supabase.from("nilai").upsert(rows, { onConflict: "kelas_id,mahasiswa_id,komponen_nilai_id" });
                    if (error) { showToast(`Gagal menyimpan nilai: ${error.message}`); return; }
                    await loadAll(); showToast(`${rows.length} nilai berhasil disimpan.`);
                  })()}>💾 Simpan Semua Nilai</button>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr><th>NIM</th><th>Nama</th>{komponenAktif.map((k) => <th key={k.id}>{k.nama} ({Number(k.bobot)}%)</th>)}<th>Nilai Akhir</th><th>Huruf</th></tr>
                    </thead>
                    <tbody>
                      {anggotaAktif.map((a) => {
                        const m = mhsById.get(a.mahasiswa_id);
                        if (!m) return null;
                        const akhir = finalGrade(a.mahasiswa_id);
                        return (
                          <tr key={a.id}>
                            <td>{m.nim}</td><td><strong>{m.nama}</strong></td>
                            {komponenAktif.map((k) => {
                              const key = `${a.mahasiswa_id}:${k.id}`;
                              const existing = nilaiList.find((x) => x.kelas_id === activeKelasId && x.mahasiswa_id === a.mahasiswa_id && x.komponen_nilai_id === k.id);
                              return (
                                <td key={k.id}>
                                  <input type="number" min={0} max={100} step="0.01" style={{ width: 84 }}
                                    value={nilaiDraft[key] ?? (existing ? String(existing.nilai_angka) : "")}
                                    onChange={(e) => setNilaiDraft((prev) => ({ ...prev, [key]: e.target.value }))} />
                                </td>
                              );
                            })}
                            <td><strong>{Math.abs(totalBobot - 100) < 0.01 ? akhir.toFixed(2) : "-"}</strong></td>
                            <td><span className="chip">{Math.abs(totalBobot - 100) < 0.01 ? nilaiHuruf(akhir) : "-"}</span></td>
                          </tr>
                        );
                      })}
                      {anggotaAktif.length === 0 && <tr><td colSpan={3 + komponenAktif.length} className="empty">Belum ada anggota kelas aktif.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <p className="muted" style={{ fontSize: 13 }}>
                  Skala huruf: A ≥ 85, A- ≥ 80, B+ ≥ 75, B ≥ 70, B- ≥ 65, C+ ≥ 60, C ≥ 55, C- ≥ 50, D ≥ 40, E &lt; 40.
                  Nilai akhir = Σ (nilai komponen × bobot ÷ 100), dihitung bila total bobot tepat 100%.
                  Export SIAKAD memakai template resmi per prodi (PAI/PGMI/HKI/Ekonomi Syariah, semester 1–8) tanpa mengubah format template.
                </p>
              </>
            )}
          </section>
        )}

        {view === "materi" && (
          <section className="module">
            <div className="module-head">
              <h2>Materi &amp; Tugas — {activeKelas ? activeKelas.kode_kelas : "pilih kelas aktif"}</h2><span className="spacer" />
              <button className="btn" disabled={!activeKelas} onClick={() => openEditor({
                table: "materi", title: "Tambah Materi", numericKeys: ["pertemuan_id"], nullableKeys: ["pertemuan_id", "deskripsi", "file_url", "file_name"],
                fixed: { kelas_id: activeKelasId },
                fields: [
                  { key: "judul", label: "Judul Materi", required: true, full: true },
                  { key: "pertemuan_id", label: "Pertemuan Terkait", type: "select", options: [{ value: "", label: "— Tidak terkait —" }, ...pertemuanAktif.map((p) => ({ value: String(p.id), label: `Pertemuan ${p.pertemuan_ke} — ${p.topik || fmtTanggal(p.tanggal)}` }))] },
                  { key: "deskripsi", label: "Deskripsi", type: "textarea", full: true },
                  { key: "file_url", label: "Tautan File (mis. Google Drive)", full: true },
                  { key: "file_name", label: "Nama File Lampiran" },
                ],
                initial: { judul: "", pertemuan_id: "", deskripsi: "", file_url: "", file_name: "" },
              })}>+ Materi</button>
              <button className="btn btn-primary" disabled={!activeKelas} onClick={() => openEditor({
                table: "tugas", title: "Tambah Tugas", numericKeys: ["bobot"], nullableKeys: ["deskripsi", "deadline", "file_url", "file_name"],
                fixed: { kelas_id: activeKelasId },
                fields: [
                  { key: "judul", label: "Judul Tugas", required: true, full: true },
                  { key: "deskripsi", label: "Deskripsi", type: "textarea", full: true },
                  { key: "deadline", label: "Deadline", type: "datetime" },
                  { key: "bobot", label: "Bobot (%)", type: "number" },
                  { key: "file_url", label: "Tautan File (mis. Google Drive)", full: true },
                  { key: "file_name", label: "Nama File Lampiran" },
                ],
                initial: { judul: "", deskripsi: "", deadline: "", bobot: "0", file_url: "", file_name: "" },
              })}>+ Tugas</button>
            </div>
            {!activeKelas && <p className="empty">Pilih kelas aktif terlebih dahulu.</p>}
            {activeKelas && (
              <>
                <h3 style={{ margin: "6px 0 8px" }}>Materi ({materiList.filter((x) => x.kelas_id === activeKelasId).length})</h3>
                <table>
                  <thead><tr><th>Judul</th><th>Pertemuan</th><th>Deskripsi</th><th>Lampiran</th><th>Aksi</th></tr></thead>
                  <tbody>
                    {materiList.filter((x) => x.kelas_id === activeKelasId).map((x) => (
                      <tr key={x.id}>
                        <td><strong>{x.judul}</strong></td>
                        <td>{x.pertemuan_id ? `Pertemuan ${pertemuanList.find((p) => p.id === x.pertemuan_id)?.pertemuan_ke ?? "-"}` : "-"}</td>
                        <td>{x.deskripsi || "-"}</td>
                        <td>{x.file_url ? <a className="file-link" href={x.file_url} target="_blank" rel="noreferrer">🔗 {x.file_name || "Buka file"}</a> : "-"}</td>
                        <td><div className="row-actions">
                          <button className="btn btn-small" onClick={() => openEditor({
                            table: "materi", title: "Edit Materi", id: x.id, numericKeys: ["pertemuan_id"], nullableKeys: ["pertemuan_id", "deskripsi", "file_url", "file_name"],
                            fixed: { kelas_id: activeKelasId },
                            fields: [
                              { key: "judul", label: "Judul Materi", required: true, full: true },
                              { key: "pertemuan_id", label: "Pertemuan Terkait", type: "select", options: [{ value: "", label: "— Tidak terkait —" }, ...pertemuanAktif.map((p) => ({ value: String(p.id), label: `Pertemuan ${p.pertemuan_ke} — ${p.topik || fmtTanggal(p.tanggal)}` }))] },
                              { key: "deskripsi", label: "Deskripsi", type: "textarea", full: true },
                              { key: "file_url", label: "Tautan File (mis. Google Drive)", full: true },
                              { key: "file_name", label: "Nama File Lampiran" },
                            ],
                            initial: { judul: x.judul, pertemuan_id: x.pertemuan_id ? String(x.pertemuan_id) : "", deskripsi: x.deskripsi ?? "", file_url: x.file_url ?? "", file_name: x.file_name ?? "" },
                          })}>Edit</button>
                          <button className="btn btn-small btn-danger" onClick={() => void hapus("materi", x.id, `materi ${x.judul}`)}>Hapus</button>
                        </div></td>
                      </tr>
                    ))}
                    {materiList.filter((x) => x.kelas_id === activeKelasId).length === 0 && <tr><td colSpan={5} className="empty">Belum ada materi untuk kelas aktif.</td></tr>}
                  </tbody>
                </table>

                <h3 style={{ margin: "22px 0 8px" }}>Tugas ({tugasList.filter((x) => x.kelas_id === activeKelasId).length})</h3>
                <table>
                  <thead><tr><th>Judul</th><th>Deadline</th><th>Status</th><th>Bobot</th><th>Pengumpulan</th><th>Lampiran</th><th>Aksi</th></tr></thead>
                  <tbody>
                    {tugasList.filter((x) => x.kelas_id === activeKelasId).map((t) => {
                      const ds = deadlineStatus(t.deadline);
                      const jumlah = pengumpulanList.filter((p) => p.tugas_id === t.id).length;
                      return (
                        <tr key={t.id} style={t.id === selectedTugasId ? { background: "#e0f2fe" } : undefined}>
                          <td><strong>{t.judul}</strong></td>
                          <td>{t.deadline ? new Date(t.deadline).toLocaleString("id-ID") : "-"}</td>
                          <td><span className={`chip ${ds.cls}`}>{ds.label}</span></td>
                          <td>{t.bobot != null ? `${Number(t.bobot)}%` : "-"}</td>
                          <td>{jumlah} mahasiswa</td>
                          <td>{t.file_url ? <a className="file-link" href={t.file_url} target="_blank" rel="noreferrer">🔗 {t.file_name || "Buka file"}</a> : "-"}</td>
                          <td><div className="row-actions">
                            <button className="btn btn-small" onClick={() => setSelectedTugasId(t.id === selectedTugasId ? null : t.id)}>Pengumpulan</button>
                            <button className="btn btn-small" onClick={() => openEditor({
                              table: "tugas", title: "Edit Tugas", id: t.id, numericKeys: ["bobot"], nullableKeys: ["deskripsi", "deadline", "file_url", "file_name"],
                              fixed: { kelas_id: activeKelasId },
                              fields: [
                                { key: "judul", label: "Judul Tugas", required: true, full: true },
                                { key: "deskripsi", label: "Deskripsi", type: "textarea", full: true },
                                { key: "deadline", label: "Deadline", type: "datetime" },
                                { key: "bobot", label: "Bobot (%)", type: "number" },
                                { key: "file_url", label: "Tautan File (mis. Google Drive)", full: true },
                                { key: "file_name", label: "Nama File Lampiran" },
                              ],
                              initial: { judul: t.judul, deskripsi: t.deskripsi ?? "", deadline: t.deadline ? t.deadline.slice(0, 16) : "", bobot: String(t.bobot ?? 0), file_url: t.file_url ?? "", file_name: t.file_name ?? "" },
                            })}>Edit</button>
                            <button className="btn btn-small btn-danger" onClick={() => void hapus("tugas", t.id, `tugas ${t.judul}`)}>Hapus</button>
                          </div></td>
                        </tr>
                      );
                    })}
                    {tugasList.filter((x) => x.kelas_id === activeKelasId).length === 0 && <tr><td colSpan={7} className="empty">Belum ada tugas untuk kelas aktif.</td></tr>}
                  </tbody>
                </table>

                {selectedTugasId && (
                  <div style={{ marginTop: 20 }}>
                    <h3 style={{ margin: "0 0 8px" }}>Pengumpulan: {tugasList.find((t) => t.id === selectedTugasId)?.judul}</h3>
                    <table>
                      <thead><tr><th>NIM</th><th>Nama</th><th>Status</th><th>Nilai</th><th>Catatan</th><th>Tautan File</th><th>Aksi</th></tr></thead>
                      <tbody>
                        {anggotaAktif.map((a) => {
                          const m = mhsById.get(a.mahasiswa_id);
                          if (!m) return null;
                          const existing = pengumpulanList.find((p) => p.tugas_id === selectedTugasId && p.mahasiswa_id === a.mahasiswa_id);
                          const d = kumpulDraft[a.mahasiswa_id] ?? {
                            status: existing?.status ?? "Belum Dinilai",
                            nilai: existing?.nilai != null ? String(existing.nilai) : "",
                            catatan: existing?.catatan ?? "",
                            file_url: existing?.file_url ?? "",
                            file_name: existing?.file_name ?? "",
                          };
                          const upd = (patch: Partial<typeof d>) => setKumpulDraft((prev) => ({ ...prev, [a.mahasiswa_id]: { ...d, ...patch } }));
                          return (
                            <tr key={a.id}>
                              <td>{m.nim}</td><td><strong>{m.nama}</strong></td>
                              <td>
                                <select value={d.status} onChange={(e) => upd({ status: e.target.value })}>
                                  {["Belum Dinilai", "Sudah Dinilai", "Terlambat"].map((s) => <option key={s} value={s}>{s}</option>)}
                                </select>
                              </td>
                              <td><input type="number" min={0} max={100} style={{ width: 76 }} value={d.nilai} onChange={(e) => upd({ nilai: e.target.value })} /></td>
                              <td><input value={d.catatan} onChange={(e) => upd({ catatan: e.target.value })} placeholder="Catatan" /></td>
                              <td><input value={d.file_url} onChange={(e) => upd({ file_url: e.target.value })} placeholder="https://drive.google.com/…" /></td>
                              <td><button className="btn btn-small btn-primary" onClick={() => void (async () => {
                                const supabase = getSupabase(); if (!supabase) return;
                                const { error } = await supabase.from("pengumpulan_tugas").upsert({
                                  tugas_id: selectedTugasId, mahasiswa_id: a.mahasiswa_id,
                                  status: d.status, nilai: d.nilai === "" ? null : Number(d.nilai),
                                  catatan: d.catatan || null, file_url: d.file_url || null, file_name: d.file_name || null,
                                  waktu_kumpul: existing?.waktu_kumpul ?? new Date().toISOString(),
                                }, { onConflict: "tugas_id,mahasiswa_id" });
                                if (error) { showToast(`Gagal: ${error.message}`); return; }
                                await loadAll(); showToast(`Pengumpulan ${m.nama} tersimpan.`);
                              })()}>Simpan</button></td>
                            </tr>
                          );
                        })}
                        {anggotaAktif.length === 0 && <tr><td colSpan={7} className="empty">Belum ada anggota kelas aktif.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {view === "rekap" && (
          <section className="module">
            <div className="module-head">
              <h2>Rekap &amp; Laporan — {activeKelas ? activeKelas.kode_kelas : "pilih kelas aktif"}</h2>
            </div>
            {!activeKelas && <p className="empty">Pilih kelas aktif terlebih dahulu.</p>}
            {activeKelas && (
              <>
                <div className="summary-bar">
                  <span>Mata Kuliah: {mkById.get(activeKelas.mata_kuliah_id)?.nama ?? "-"}</span>
                  <span>Dosen: {dosenById.get(activeKelas.dosen_id)?.nama ?? "-"}</span>
                  <span>Peserta: {anggotaAktif.length}</span>
                  <span>Pertemuan: {pertemuanAktif.length}</span>
                  <span>Total Bobot: {totalBobot}%</span>
                </div>
                <div className="cards-grid" style={{ marginBottom: 20 }}>
                  {([
                    { t: "lengkap" as const, judul: "Laporan Lengkap", desc: "Ringkasan kelas, kehadiran, nilai, mahasiswa, dan pertemuan dalam satu dokumen." },
                    { t: "kehadiran" as const, judul: "Rekap Kehadiran", desc: "Hadir, Izin, Sakit, Alpha, Terlambat, dan % kehadiran per mahasiswa." },
                    { t: "nilai" as const, judul: "Rekap Nilai", desc: "Nilai akhir berbobot dan nilai huruf per mahasiswa." },
                    { t: "mahasiswa" as const, judul: "Daftar Mahasiswa", desc: "Daftar peserta kelas aktif beserta NIM dan nomor absen." },
                    { t: "pertemuan" as const, judul: "Rekap Pertemuan", desc: "Daftar pertemuan, tanggal, dan topik kelas aktif." },
                  ]).map((c) => (
                    <div key={c.t} className="class-card">
                      <h3 style={{ fontSize: 16 }}>{c.judul}</h3>
                      <p>{c.desc}</p>
                      <div className="row-actions">
                        <button className="btn btn-small btn-primary" onClick={() => setReportType(c.t)}>👁 Pratinjau</button>
                      </div>
                    </div>
                  ))}
                </div>
                <h3 style={{ margin: "0 0 8px" }}>Rekap Kehadiran</h3>
                <table style={{ marginBottom: 20 }}>
                  <thead><tr><th>No</th><th>NIM</th><th>Nama</th><th>Hadir</th><th>Izin</th><th>Sakit</th><th>Alpha</th><th>Terlambat</th><th>% Hadir</th></tr></thead>
                  <tbody>
                    {anggotaAktif.map((a, i) => {
                      const m = mhsById.get(a.mahasiswa_id); if (!m) return null;
                      const r = rekapKehadiran(a.mahasiswa_id);
                      return <tr key={a.id}><td>{i + 1}</td><td>{m.nim}</td><td><strong>{m.nama}</strong></td><td>{r.Hadir}</td><td>{r.Izin}</td><td>{r.Sakit}</td><td>{r.Alpha}</td><td>{r.Terlambat}</td><td>{r.persen}%</td></tr>;
                    })}
                    {anggotaAktif.length === 0 && <tr><td colSpan={9} className="empty">Belum ada anggota kelas aktif.</td></tr>}
                  </tbody>
                </table>
                <h3 style={{ margin: "0 0 8px" }}>Rekap Nilai</h3>
                <table>
                  <thead><tr><th>No</th><th>NIM</th><th>Nama</th>{komponenAktif.map((k) => <th key={k.id}>{k.nama}</th>)}<th>Akhir</th><th>Huruf</th></tr></thead>
                  <tbody>
                    {anggotaAktif.map((a, i) => {
                      const m = mhsById.get(a.mahasiswa_id); if (!m) return null;
                      const akhir = finalGrade(a.mahasiswa_id);
                      return (
                        <tr key={a.id}><td>{i + 1}</td><td>{m.nim}</td><td><strong>{m.nama}</strong></td>
                          {komponenAktif.map((k) => {
                            const n = nilaiList.find((x) => x.kelas_id === activeKelasId && x.mahasiswa_id === a.mahasiswa_id && x.komponen_nilai_id === k.id);
                            return <td key={k.id}>{n ? Number(n.nilai_angka) : "-"}</td>;
                          })}
                          <td><strong>{Math.abs(totalBobot - 100) < 0.01 ? akhir.toFixed(2) : "-"}</strong></td>
                          <td>{Math.abs(totalBobot - 100) < 0.01 ? nilaiHuruf(akhir) : "-"}</td>
                        </tr>
                      );
                    })}
                    {anggotaAktif.length === 0 && <tr><td colSpan={5 + komponenAktif.length} className="empty">Belum ada anggota kelas aktif.</td></tr>}
                  </tbody>
                </table>
              </>
            )}
          </section>
        )}

        {view === "pengaturan" && (
          <section className="module">
            <div className="module-head"><h2>Pengaturan</h2></div>
            <h3 style={{ margin: "0 0 8px" }}>Identitas Aplikasi</h3>
            <div className="form-grid" style={{ maxWidth: 720 }}>
              <label>Nama Aplikasi
                <input id="set-nama-aplikasi" defaultValue={settings.nama_aplikasi ?? "Smart Class"} key={`na-${settings.nama_aplikasi ?? ""}`} />
              </label>
              <label>Institusi
                <input id="set-institusi" defaultValue={settings.institusi ?? "IAI DDI Maros"} key={`in-${settings.institusi ?? ""}`} />
              </label>
            </div>
            <button className="btn btn-primary" onClick={() => void (async () => {
              const nama = (document.getElementById("set-nama-aplikasi") as HTMLInputElement | null)?.value ?? "Smart Class";
              const inst = (document.getElementById("set-institusi") as HTMLInputElement | null)?.value ?? "IAI DDI Maros";
              await saveSetting("nama_aplikasi", nama);
              await saveSetting("institusi", inst);
              showToast("Pengaturan aplikasi berhasil disimpan.");
            })()}>Simpan Pengaturan</button>

            <h3 style={{ margin: "26px 0 8px" }}>Tahun Akademik</h3>
            <div className="module-head" style={{ marginBottom: 8 }}>
              <span className="muted" style={{ fontSize: 13 }}>Hanya satu tahun akademik yang aktif pada satu waktu.</span><span className="spacer" />
              <button className="btn btn-primary" onClick={() => openEditor({
                table: "tahun_akademik", title: "Tambah Tahun Akademik", numericKeys: [], nullableKeys: [], fixed: { aktif: 0 },
                fields: [
                  { key: "tahun", label: "Tahun (mis. 2026/2027)", required: true },
                  { key: "semester", label: "Semester", type: "select", options: ["Ganjil", "Genap", "Pendek"].map((s) => ({ value: s, label: s })) },
                ],
                initial: { tahun: "", semester: "Ganjil" },
              })}>+ Tahun Akademik</button>
            </div>
            <table>
              <thead><tr><th>Tahun</th><th>Semester</th><th>Status</th><th>Aksi</th></tr></thead>
              <tbody>
                {taList.map((t) => (
                  <tr key={t.id}>
                    <td><strong>{t.tahun}</strong></td><td>{t.semester}</td>
                    <td>{t.aktif === 1 ? <span className="chip ok">Aktif</span> : <span className="chip">Nonaktif</span>}</td>
                    <td><div className="row-actions">
                      <button className="btn btn-small" onClick={() => void (async () => {
                        const supabase = getSupabase(); if (!supabase) return;
                        await supabase.from("tahun_akademik").update({ aktif: 0 }).neq("id", 0);
                        const { error } = await supabase.from("tahun_akademik").update({ aktif: 1 }).eq("id", t.id);
                        if (error) { showToast(`Gagal: ${error.message}`); return; }
                        await saveSetting("tahun_akademik_aktif_id", String(t.id));
                        await loadAll(); showToast(`${t.tahun} ${t.semester} menjadi tahun akademik aktif.`);
                      })()}>Jadikan Aktif</button>
                      <button className="btn btn-small" onClick={() => openEditor({
                        table: "tahun_akademik", title: "Edit Tahun Akademik", id: t.id, numericKeys: [], nullableKeys: [], fixed: { aktif: t.aktif },
                        fields: [
                          { key: "tahun", label: "Tahun (mis. 2026/2027)", required: true },
                          { key: "semester", label: "Semester", type: "select", options: ["Ganjil", "Genap", "Pendek"].map((s) => ({ value: s, label: s })) },
                        ],
                        initial: { tahun: t.tahun, semester: t.semester },
                      })}>Edit</button>
                      <button className="btn btn-small btn-danger" onClick={() => void hapus("tahun_akademik", t.id, `tahun akademik ${t.tahun} ${t.semester}`)}>Hapus</button>
                    </div></td>
                  </tr>
                ))}
                {taList.length === 0 && <tr><td colSpan={4} className="empty">Belum ada tahun akademik.</td></tr>}
              </tbody>
            </table>

            <h3 style={{ margin: "26px 0 8px" }}>Backup Online (JSON)</h3>
            <p className="muted" style={{ fontSize: 13.5, maxWidth: 720 }}>
              Backup mengekspor seluruh data (semua tabel) ke satu file JSON. Restore/import akan memvalidasi file,
              menghapus data saat ini, lalu memasukkan isi backup. Lakukan backup sebelum restore atau reset semester.
            </p>
            <div className="row-actions">
              <button className="btn btn-primary" onClick={() => void (async () => {
                const supabase = getSupabase(); if (!supabase) return;
                const tables: Record<string, unknown> = {};
                for (const t of TABLES_BACKUP) {
                  const { data, error } = await supabase.from(t).select("*");
                  if (error) { showToast(`Backup gagal pada tabel ${t}: ${error.message}`); return; }
                  tables[t] = data ?? [];
                }
                const payload = { app: "smart-class-online", version: "v2026-10-25-v1", exported_at: new Date().toISOString(), tables };
                const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url; a.download = `backup-smart-class-${todayISO()}.json`;
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 4000);
                showToast("Backup JSON berhasil diunduh.");
              })()}>⬇ Export Backup JSON</button>
              <label className="btn" style={{ margin: 0 }}>
                ⬆ Import / Restore JSON
                <input type="file" accept="application/json,.json" style={{ display: "none" }} onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  void (async () => {
                    try {
                      const parsed = JSON.parse(await file.text()) as { app?: string; tables?: Record<string, Record<string, unknown>[]> };
                      if (!parsed || typeof parsed !== "object" || !parsed.tables || typeof parsed.tables !== "object") {
                        showToast("File backup tidak valid: struktur JSON tidak dikenal."); return;
                      }
                      const missing = TABLES_BACKUP.filter((t) => !Array.isArray(parsed.tables?.[t]));
                      if (missing.length) { showToast(`File backup tidak valid: tabel hilang (${missing.join(", ")}).`); return; }
                      if (!window.confirm("Restore akan MENGHAPUS data saat ini dan menggantinya dengan isi backup. Lanjutkan?")) return;
                      const supabase = getSupabase(); if (!supabase) return;
                      for (const t of [...TABLES_BACKUP].reverse()) {
                        if (t === "pengaturan") { await supabase.from(t).delete().not("kunci", "is", null); }
                        else { await supabase.from(t).delete().neq("id", 0); }
                      }
                      for (const t of TABLES_BACKUP) {
                        const rows = parsed.tables[t];
                        if (!rows.length) continue;
                        const { error } = await supabase.from(t).upsert(rows, { onConflict: t === "pengaturan" ? "kunci" : "id" });
                        if (error) { showToast(`Restore gagal pada tabel ${t}: ${error.message}`); return; }
                      }
                      setActiveKelasId(null);
                      localStorage.removeItem("smart-class-kelas-aktif");
                      await loadAll();
                      showToast("Restore backup selesai. Data sudah diganti dari file backup.");
                    } catch {
                      showToast("File backup tidak valid: bukan JSON yang bisa dibaca.");
                    }
                  })();
                }} />
              </label>
            </div>

            <h3 style={{ margin: "26px 0 8px", color: "var(--danger)" }}>Reset Semester</h3>
            <p className="muted" style={{ fontSize: 13.5, maxWidth: 720 }}>
              Menghapus hanya data tahun akademik aktif ({activeTA ? `${activeTA.tahun} — ${activeTA.semester}` : "belum diatur"}):
              kelas + anggota, pertemuan + absensi, komponen + nilai, materi, tugas + pengumpulan.
              Data master dosen, mahasiswa, dan mata kuliah <strong>dipertahankan</strong>. Sangat disarankan Export Backup JSON dulu.
            </p>
            <button className="btn btn-danger" disabled={!activeTA} onClick={() => void (async () => {
              if (!activeTA) return;
              if (!window.confirm(`Reset semester ${activeTA.tahun} ${activeTA.semester}? Semua kelas dan data turunannya pada tahun akademik ini akan dihapus permanen.`)) return;
              if (!window.confirm("Konfirmasi sekali lagi: Anda sudah membuat backup? Klik OK untuk menghapus.")) return;
              const supabase = getSupabase(); if (!supabase) return;
              const kelasIds = kelasList.filter((k) => k.tahun_akademik_id === activeTA.id).map((k) => k.id);
              if (kelasIds.length) {
                const tugasIds = tugasList.filter((t) => kelasIds.includes(t.kelas_id)).map((t) => t.id);
                const pertemuanIds = pertemuanList.filter((p) => kelasIds.includes(p.kelas_id)).map((p) => p.id);
                if (tugasIds.length) await supabase.from("pengumpulan_tugas").delete().in("tugas_id", tugasIds);
                await supabase.from("tugas").delete().in("kelas_id", kelasIds);
                await supabase.from("materi").delete().in("kelas_id", kelasIds);
                await supabase.from("nilai").delete().in("kelas_id", kelasIds);
                await supabase.from("komponen_nilai").delete().in("kelas_id", kelasIds);
                if (pertemuanIds.length) await supabase.from("absensi").delete().in("pertemuan_id", pertemuanIds);
                await supabase.from("pertemuan").delete().in("kelas_id", kelasIds);
                await supabase.from("anggota_kelas").delete().in("kelas_id", kelasIds);
                await supabase.from("kelas").delete().in("id", kelasIds);
              }
              setActiveKelasId(null);
              localStorage.removeItem("smart-class-kelas-aktif");
              await loadAll();
              showToast("Reset semester selesai. Data master dosen, mahasiswa, dan mata kuliah dipertahankan.");
            })()}>🗑 Reset Semester (Tahun Akademik Aktif)</button>
          </section>
        )}

        {view === "tentang" && (
          <section className="module">
            <div className="module-head"><h2>Tentang Smart Class</h2></div>
            <p className="muted" style={{ maxWidth: 760 }}>
              <strong>{appName} Online</strong> adalah versi web dari aplikasi desktop Smart Class untuk dosen
              {institusi ? <> di <strong>{institusi}</strong></> : null}. Data tersimpan online di Supabase (PostgreSQL + Auth)
              dan aplikasi berjalan di Vercel — dapat diakses dari perangkat apa pun dengan login dosen.
            </p>
            <div className="cards-grid">
              {[
                { j: "Profil Dosen", d: "Kelola identitas dan informasi dosen secara terpusat." },
                { j: "Mata Kuliah", d: "Kelola mata kuliah semester 1–8 yang digunakan dalam perkuliahan." },
                { j: "Kelas & Mahasiswa", d: "Atur kelas, anggota kelas, nomor absen otomatis, dan impor Excel mahasiswa." },
                { j: "Pertemuan & Absensi", d: "Catat pertemuan dan kehadiran mahasiswa (Hadir/Izin/Sakit/Alpha/Terlambat) secara massal." },
                { j: "Penilaian & SIAKAD", d: "Komponen bobot 100%, nilai akhir + huruf, dan Export Nilai SIAKAD template-preserving per prodi." },
                { j: "Materi & Tugas", d: "Kelola materi, tugas, deadline, dan pengumpulan tugas per mahasiswa." },
                { j: "Halaman Mahasiswa", d: "Bagikan link/QR per kelas: mahasiswa melihat info kelas, jadwal & topik pertemuan, materi, dan tugas tanpa login. Nilai dan absensi tidak ditampilkan." },
                { j: "Rekap & Laporan", d: "Rekap kehadiran, nilai, dan laporan lengkap yang siap dicetak / disimpan PDF." },
                { j: "Pengaturan", d: "Tahun akademik aktif, backup/restore JSON online, dan reset semester yang aman." },
              ].map((c) => (
                <div key={c.j} className="class-card"><h3 style={{ fontSize: 16 }}>{c.j}</h3><p>{c.d}</p></div>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 16 }}>
              Versi paket: SMART CLASS ONLINE v2026-10-26-v3 • Teknologi: Next.js + Supabase + Vercel.
              Program studi yang didukung Export SIAKAD: PGMI (86232), PAI (86208), Ekonomi Syariah (60206), Hukum Keluarga Islam (74230).
            </p>
          </section>
        )}
      </main>

      {editor && (
        <EditorModal
          title={editor.title}
          fields={editor.fields}
          initial={editor.initial}
          onClose={() => setEditor(null)}
          onSave={async (values) => { await saveEditor(values); setEditor(null); }}
        />
      )}

      {photoOpen && sessionUser && (
        <PhotoProfileModal
          userId={sessionUser.id}
          name={userName}
          current={myPhoto}
          table="profiles"
          onClose={() => setPhotoOpen(false)}
          onSaved={(photo) => { setMyPhoto(photo); setPhotoOpen(false); showToast(photo ? "Foto profil berhasil diperbarui." : "Foto profil dihapus."); }}
        />
      )}

      {shareKelasId !== null && (() => {
        const k = kelasList.find((x) => x.id === shareKelasId);
        if (!k) return null;
        return (
          <ShareKelasModal
            kelas={k}
            mkNama={mkById.get(k.mata_kuliah_id)?.nama ?? "-"}
            onClose={() => setShareKelasId(null)}
            onChanged={loadAll}
            showToast={showToast}
          />
        );
      })()}

      {importOpen && (
        <ImportMahasiswaModal
          mahasiswa={mhsList}
          activeKelas={activeKelas}
          anggotaAktif={anggotaAktif}
          onClose={() => setImportOpen(false)}
          onDone={async (msg) => { setImportOpen(false); await loadAll(); showToast(msg); }}
        />
      )}

      {reportType && activeKelas && (
        <Modal title={`Pratinjau Laporan — ${activeKelas.kode_kelas}`} onClose={() => setReportType(null)} xwide>
          <div className="report-doc landscape">
            <div className="report-head">
              <div className="report-school">{institusi}</div>
              <div className="report-addr">{appName} — Laporan Akademik Kelas</div>
              <div className="report-line" />
              <div className="report-title">
                {reportType === "lengkap" ? "LAPORAN LENGKAP KELAS" : reportType === "kehadiran" ? "REKAP KEHADIRAN MAHASISWA" : reportType === "nilai" ? "REKAP NILAI MAHASISWA" : reportType === "mahasiswa" ? "DAFTAR MAHASISWA" : "REKAP PERTEMUAN"}
              </div>
              <div className="report-sub">
                {mkById.get(activeKelas.mata_kuliah_id)?.nama ?? "-"} • Kelas {activeKelas.kode_kelas} • {taById.get(activeKelas.tahun_akademik_id) ? `${taById.get(activeKelas.tahun_akademik_id)?.tahun} — ${taById.get(activeKelas.tahun_akademik_id)?.semester}` : "-"}
              </div>
            </div>
            <div className="report-meta">
              <div><span>Dosen</span><strong>{dosenById.get(activeKelas.dosen_id)?.nama ?? "-"}</strong></div>
              <div><span>Kode MK</span><strong>{mkById.get(activeKelas.mata_kuliah_id)?.kode ?? "-"}</strong></div>
              <div><span>Peserta</span><strong>{anggotaAktif.length} mahasiswa</strong></div>
              <div><span>Pertemuan</span><strong>{pertemuanAktif.length} pertemuan</strong></div>
            </div>

            {(reportType === "lengkap" || reportType === "kehadiran") && (
              <>
                <div className="report-section">A. Rekap Kehadiran</div>
                <table className="report-table">
                  <thead><tr><th className="c">No</th><th>NIM</th><th>Nama</th><th className="c">Hadir</th><th className="c">Izin</th><th className="c">Sakit</th><th className="c">Alpha</th><th className="c">Terlambat</th><th className="c">% Hadir</th></tr></thead>
                  <tbody>
                    {anggotaAktif.map((a, i) => {
                      const m = mhsById.get(a.mahasiswa_id); if (!m) return null;
                      const r = rekapKehadiran(a.mahasiswa_id);
                      return <tr key={a.id}><td className="c">{i + 1}</td><td>{m.nim}</td><td>{m.nama}</td><td className="c">{r.Hadir}</td><td className="c">{r.Izin}</td><td className="c">{r.Sakit}</td><td className="c">{r.Alpha}</td><td className="c">{r.Terlambat}</td><td className="c">{r.persen}%</td></tr>;
                    })}
                  </tbody>
                </table>
              </>
            )}

            {(reportType === "lengkap" || reportType === "nilai") && (
              <>
                <div className="report-section">B. Rekap Nilai</div>
                <table className="report-table">
                  <thead><tr><th className="c">No</th><th>NIM</th><th>Nama</th>{komponenAktif.map((k) => <th key={k.id} className="c">{k.nama} ({Number(k.bobot)}%)</th>)}<th className="c">Nilai Akhir</th><th className="c">Huruf</th></tr></thead>
                  <tbody>
                    {anggotaAktif.map((a, i) => {
                      const m = mhsById.get(a.mahasiswa_id); if (!m) return null;
                      const akhir = finalGrade(a.mahasiswa_id);
                      return (
                        <tr key={a.id}><td className="c">{i + 1}</td><td>{m.nim}</td><td>{m.nama}</td>
                          {komponenAktif.map((k) => {
                            const n = nilaiList.find((x) => x.kelas_id === activeKelasId && x.mahasiswa_id === a.mahasiswa_id && x.komponen_nilai_id === k.id);
                            return <td key={k.id} className="c">{n ? Number(n.nilai_angka) : "-"}</td>;
                          })}
                          <td className="c"><strong>{Math.abs(totalBobot - 100) < 0.01 ? akhir.toFixed(2) : "-"}</strong></td>
                          <td className="c">{Math.abs(totalBobot - 100) < 0.01 ? nilaiHuruf(akhir) : "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}

            {(reportType === "lengkap" || reportType === "mahasiswa") && (
              <>
                <div className="report-section">C. Daftar Mahasiswa</div>
                <table className="report-table">
                  <thead><tr><th className="c">No. Absen</th><th>NIM</th><th>Nama</th><th className="c">JK</th><th>Prodi</th><th className="c">Angkatan</th></tr></thead>
                  <tbody>
                    {anggotaAktif.map((a) => {
                      const m = mhsById.get(a.mahasiswa_id); if (!m) return null;
                      return <tr key={a.id}><td className="c">{a.nomor_absen ?? "-"}</td><td>{m.nim}</td><td>{m.nama}</td><td className="c">{m.jenis_kelamin || "-"}</td><td>{m.prodi || "-"}</td><td className="c">{m.angkatan ?? "-"}</td></tr>;
                    })}
                  </tbody>
                </table>
              </>
            )}

            {(reportType === "lengkap" || reportType === "pertemuan") && (
              <>
                <div className="report-section">D. Rekap Pertemuan</div>
                <table className="report-table">
                  <thead><tr><th className="c">Pertemuan Ke</th><th>Tanggal</th><th>Topik</th><th>Status</th></tr></thead>
                  <tbody>
                    {pertemuanAktif.map((p) => (
                      <tr key={p.id}><td className="c">{p.pertemuan_ke}</td><td>{fmtTanggal(p.tanggal)}</td><td>{p.topik || "-"}</td><td>{p.status}</td></tr>
                    ))}
                    {pertemuanAktif.length === 0 && <tr><td colSpan={4} className="c">Belum ada pertemuan.</td></tr>}
                  </tbody>
                </table>
              </>
            )}

            <div className="report-sign">
              <div className="sign-block">
                <div>Mengetahui,</div>
                <div>Dosen Pengampu</div>
                <div className="sign-space" />
                <div className="sign-name">{dosenById.get(activeKelas.dosen_id)?.nama ?? "-"}</div>
                <div>NIDN. {dosenById.get(activeKelas.dosen_id)?.nidn ?? "-"}</div>
              </div>
              <div className="sign-block">
                <div>Dicetak pada</div>
                <div>{new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</div>
                <div className="sign-space" />
                <div className="sign-name">{appName} Online</div>
                <div>{institusi}</div>
              </div>
            </div>
          </div>
          <div className="modal-actions no-print">
            <button className="btn" onClick={() => setReportType(null)}>Tutup</button>
            <button className="btn btn-primary" onClick={() => window.print()}>🖨 Cetak / Simpan PDF</button>
          </div>
        </Modal>
      )}

      {toast && <div className="toast no-print">{toast}</div>}
    </div>
  );
}

/* ================= Import Mahasiswa dari Excel ================= */

interface ImportRow { nim: string; nama: string; jk: string; prodi: string; angkatan: string; email: string; hp: string; dup: boolean; noName: boolean; existingId: number | null; }

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function ImportMahasiswaModal(props: {
  mahasiswa: Mahasiswa[];
  activeKelas: Kelas | null;
  anggotaAktif: AnggotaKelas[];
  onClose: () => void;
  onDone: (msg: string) => Promise<void>;
}) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [addToClass, setAddToClass] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr("");
    setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      if (!raw.length) { setErr("File kosong atau formatnya tidak terbaca."); return; }
      const firstKeys = Object.keys(raw[0]);
      const findCol = (cands: string[]) => {
        const hit = firstKeys.find((k) => {
          const lk = k.toLowerCase().trim();
          return cands.some((c) => lk === c || lk.includes(c));
        });
        return hit ?? null;
      };
      const colNama = findCol(["nama mahasiswa", "nama"]);
      const colNim = findCol(["nim", "nipd", "nisn", "nis"]);
      const colJk = findCol(["jk", "jenis kelamin"]);
      const colProdi = findCol(["prodi", "program studi"]);
      const colAngkatan = findCol(["angkatan", "tahun masuk"]);
      const colEmail = findCol(["email", "e-mail"]);
      const colHp = findCol(["no hp", "no_hp", "hp", "telepon", "whatsapp"]);
      if (!colNama || !colNim) { setErr("Kolom NIM dan Nama tidak ditemukan. Pastikan file Excel memiliki kolom NIM dan Nama."); return; }

      const existingByNim = new Map(props.mahasiswa.map((m) => [m.nim.toLowerCase(), m]));
      const seen = new Set<string>();
      const parsed: ImportRow[] = raw.map((r) => {
        const nim = cellText(r[colNim]);
        const nama = cellText(r[colNama]);
        const jkRaw = colJk ? cellText(r[colJk]).toUpperCase() : "";
        const jk = jkRaw.startsWith("P") || jkRaw.includes("PEREMPUAN") ? "P" : jkRaw.startsWith("L") || jkRaw.includes("LAKI") ? "L" : "";
        const key = nim.toLowerCase();
        const existing = nim ? existingByNim.get(key) ?? null : null;
        let dup = false;
        if (nim) { if (seen.has(key)) dup = true; seen.add(key); }
        return {
          nim, nama, jk,
          prodi: colProdi ? cellText(r[colProdi]) : "",
          angkatan: colAngkatan ? cellText(r[colAngkatan]) : "",
          email: colEmail ? cellText(r[colEmail]) : "",
          hp: colHp ? cellText(r[colHp]) : "",
          dup, noName: !nama || !nim, existingId: existing ? existing.id : null,
        };
      });
      setRows(parsed);
    } catch {
      setErr("Gagal membaca file. Gunakan file .xlsx yang valid.");
    }
  }

  const validRows = (rows ?? []).filter((r) => !r.dup && !r.noName);
  const newRows = validRows.filter((r) => r.existingId === null);
  const existingRows = validRows.filter((r) => r.existingId !== null);
  const dupCount = (rows ?? []).filter((r) => r.dup).length;
  const noNameCount = (rows ?? []).filter((r) => r.noName).length;

  async function submit() {
    const supabase = getSupabase();
    if (!supabase) return;
    setErr(""); setBusy(true);
    try {
      const idByNim = new Map<string, number>(props.mahasiswa.map((m) => [m.nim.toLowerCase(), m.id]));
      if (newRows.length) {
        const payload = newRows.map((r) => ({
          nim: r.nim, nama: r.nama, jenis_kelamin: r.jk || null,
          prodi: r.prodi || null, angkatan: r.angkatan ? Number(r.angkatan) || null : null,
          email: r.email || null, no_hp: r.hp || null, status: "Aktif",
        }));
        const { data, error } = await supabase.from("mahasiswa").insert(payload).select("id,nim");
        if (error) throw new Error(error.message);
        for (const d of (data ?? []) as { id: number; nim: string }[]) idByNim.set(d.nim.toLowerCase(), d.id);
      }
      let addedToClass = 0;
      if (addToClass && props.activeKelas) {
        const already = new Set(props.anggotaAktif.map((a) => a.mahasiswa_id));
        let nextNo = props.anggotaAktif.reduce((mx, a) => Math.max(mx, a.nomor_absen ?? 0), 0);
        const anggotaPayload: { kelas_id: number; mahasiswa_id: number; status: string; nomor_absen: number }[] = [];
        for (const r of validRows) {
          const mid = idByNim.get(r.nim.toLowerCase());
          if (!mid || already.has(mid)) continue;
          nextNo += 1;
          anggotaPayload.push({ kelas_id: props.activeKelas.id, mahasiswa_id: mid, status: "Aktif", nomor_absen: nextNo });
        }
        if (anggotaPayload.length) {
          const { error } = await supabase.from("anggota_kelas").insert(anggotaPayload);
          if (error) throw new Error(error.message);
          addedToClass = anggotaPayload.length;
        }
      }
      await props.onDone(
        `Impor selesai: ${newRows.length} mahasiswa baru ditambahkan, ${existingRows.length} NIM sudah terdaftar (langsung dipakai, tidak diduplikasi)` +
        `${dupCount ? `, ${dupCount} baris duplikat di file dilewati` : ""}${noNameCount ? `, ${noNameCount} baris tanpa NIM/nama dilewati` : ""}` +
        `${addedToClass ? `, ${addedToClass} mahasiswa dimasukkan ke kelas aktif` : ""}.`
      );
    } catch (e) {
      setBusy(false);
      setErr(e instanceof Error ? e.message : "Impor gagal.");
    }
  }

  return (
    <Modal title="Import Mahasiswa dari Excel" onClose={props.onClose} wide>
      {err && <div className="alert-error">{err}</div>}
      <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
        Unggah file <strong>.xlsx</strong> daftar mahasiswa. Kolom dikenali secara fleksibel:
        <strong> NIM, Nama, JK/Jenis Kelamin, Prodi, Angkatan, Email, HP</strong>.
        NIM yang sudah terdaftar tidak diduplikasi — mahasiswa langsung dipakai (dan bisa langsung dimasukkan ke kelas aktif).
      </p>
      <label>File Excel (.xlsx)
        <input type="file" accept=".xlsx,.xls" onChange={(e) => void onFile(e)} />
      </label>
      {fileName && <p className="muted" style={{ fontSize: 13 }}>File: {fileName}</p>}
      {rows && (
        <>
          <div className="summary-bar">
            <span>Total baris: {rows.length}</span>
            <span>Baru: {newRows.length}</span>
            <span>Sudah terdaftar: {existingRows.length}</span>
            <span>Duplikat di file: {dupCount}</span>
            <span>Tanpa NIM/nama: {noNameCount}</span>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={addToClass} disabled={!props.activeKelas} onChange={(e) => setAddToClass(e.target.checked)} />
            Masukkan juga ke kelas aktif {props.activeKelas ? `(${props.activeKelas.kode_kelas})` : "(belum ada kelas aktif dipilih)"}
          </label>
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            <table>
              <thead><tr><th>NIM</th><th>Nama</th><th>JK</th><th>Prodi</th><th>Status</th></tr></thead>
              <tbody>
                {rows.slice(0, 60).map((r, i) => (
                  <tr key={i}>
                    <td>{r.nim || "-"}</td><td>{r.nama || "-"}</td><td>{r.jk || "-"}</td><td>{r.prodi || "-"}</td>
                    <td>{r.noName ? <span className="chip bad">Tanpa NIM/nama</span> : r.dup ? <span className="chip warn">Duplikat di file</span> : r.existingId ? <span className="chip">Sudah terdaftar</span> : <span className="chip ok">Baru</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 60 && <p className="muted" style={{ fontSize: 12.5 }}>Pratinjau dibatasi 60 baris pertama — semua baris valid tetap diimpor.</p>}
          </div>
        </>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={props.onClose} disabled={busy}>Batal</button>
        <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !rows || validRows.length === 0}>
          {busy ? "Mengimpor…" : `Impor ${validRows.length} Mahasiswa`}
        </button>
      </div>
    </Modal>
  );
}
