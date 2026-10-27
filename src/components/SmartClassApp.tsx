"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import {
  STATUS_ABSENSI,
  nilaiHuruf,
  type Absensi,
  type AkunDosen,
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
  type ProfileAkun,
  type StatusAbsensi,
  type TahunAkademik,
  type Tugas,
} from "@/lib/types";
import { deteksiProdi, exportSiakadWorkbook } from "@/lib/siakad";
import QRCode from "qrcode";
import { SetupScreen, useRequireSession, useSessionUser } from "@/components/Setup";
import AsistenChat from "@/components/AsistenChat";

type View =
  | "dashboard" | "dosen" | "matakuliah" | "kelas" | "mahasiswa"
  | "pertemuan" | "penilaian" | "materi" | "rekap" | "pengaturan" | "tentang"
  | "admin-dashboard" | "admin-akun" | "admin-monitoring";

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
  "admin-dashboard": "Dashboard Admin",
  "admin-akun": "Manajemen Akun Dosen",
  "admin-monitoring": "Monitoring Dosen",
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

const NAV_ADMIN: { view: View; icon: string; label: string }[] = [
  { view: "admin-dashboard", icon: "🏛️", label: "Dashboard Admin" },
  { view: "admin-monitoring", icon: "🔭", label: "Monitoring Dosen" },
  { view: "admin-akun", icon: "👥", label: "Manajemen Akun Dosen" },
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
function fmtTanggalWaktu(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value.trim() : d.toLocaleString("id-ID");
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


/* ================= Manajemen Akun Dosen (Admin, v8) ================= */

function AccountActionModal(props: {
  mode: "create" | "create-baru" | "reset" | "link";
  userId?: string;
  dosenId?: number;
  dosenNama?: string;
  initialEmail?: string;
  dosenList: Dosen[];
  linkedDosenIds: Set<number>;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [nama, setNama] = useState("");
  const [email, setEmail] = useState(props.initialEmail ?? "");
  const [nidn, setNidn] = useState("");
  const [prodi, setProdi] = useState("");
  const [password, setPassword] = useState("");
  const [dosenId, setDosenId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const titles: Record<string, string> = {
    create: "Buat Akun Login Dosen",
    "create-baru": "Buat Profil + Akun Dosen Baru",
    reset: "Reset Password Akun",
    link: "Tautkan Akun ke Profil Dosen",
  };

  async function submit() {
    setErr("");
    let body: Record<string, unknown> | null = null;
    if (props.mode === "create") {
      if (!email.trim()) { setErr("Email wajib diisi."); return; }
      if (password.length < 8) { setErr("Password minimal 8 karakter."); return; }
      body = { action: "create", dosen_id: props.dosenId, email: email.trim(), password };
    } else if (props.mode === "create-baru") {
      if (!nama.trim()) { setErr("Nama dosen wajib diisi."); return; }
      if (!email.trim()) { setErr("Email wajib diisi."); return; }
      if (password.length < 8) { setErr("Password minimal 8 karakter."); return; }
      body = { action: "create", nama: nama.trim(), email: email.trim(), nidn: nidn.trim(), prodi, password };
    } else if (props.mode === "reset") {
      if (password.length < 8) { setErr("Password minimal 8 karakter."); return; }
      body = { action: "reset", user_id: props.userId, password };
    } else {
      if (!dosenId) { setErr("Pilih profil dosen dulu."); return; }
      body = { action: "link", user_id: props.userId, dosen_id: Number(dosenId) };
    }
    setBusy(true);
    const ok = await props.onSubmit(body);
    setBusy(false);
    if (ok) props.onClose();
  }

  const bebas = props.dosenList.filter((d) => !props.linkedDosenIds.has(d.id));

  return (
    <Modal title={titles[props.mode]} onClose={props.onClose}>
      {err && <div className="alert-error">{err}</div>}
      {props.mode === "create" && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>Akun login untuk profil dosen <strong>{props.dosenNama ?? "-"}</strong>. Dosen masuk dengan email + password ini dan hanya melihat datanya sendiri.</p>
          <div className="form-grid">
            <label>Email Login<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label>Password Awal<input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimal 8 karakter" /></label>
          </div>
        </>
      )}
      {props.mode === "create-baru" && (
        <div className="form-grid">
          <label>Nama Dosen<input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="Nama lengkap + gelar" /></label>
          <label>Email Login<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>NIDN<input value={nidn} onChange={(e) => setNidn(e.target.value)} /></label>
          <label>Program Studi
            <select value={prodi} onChange={(e) => setProdi(e.target.value)}>
              <option value="">— Pilih —</option>
              {PRODI_OPTIONS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label>Password Awal<input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimal 8 karakter" /></label>
        </div>
      )}
      {props.mode === "reset" && (
        <div className="form-grid">
          <label>Password Baru<input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimal 8 karakter" /></label>
        </div>
      )}
      {props.mode === "link" && (
        <div className="form-grid">
          <label>Profil Dosen (belum tertaut)
            <select value={dosenId} onChange={(e) => setDosenId(e.target.value)}>
              <option value="">— Pilih —</option>
              {bebas.map((d) => <option key={d.id} value={d.id}>{d.nama}{d.nidn ? ` — ${d.nidn}` : ""}</option>)}
            </select>
          </label>
          {bebas.length === 0 && <p className="muted">Semua profil dosen sudah tertaut ke akun.</p>}
        </div>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={props.onClose} disabled={busy}>Batal</button>
        <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>{busy ? "Memproses…" : "Simpan"}</button>
      </div>
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
  const [myProfile, setMyProfile] = useState<ProfileAkun | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [accounts, setAccounts] = useState<AkunDosen[]>([]);
  const [accountModal, setAccountModal] = useState<null | {
    mode: "create" | "create-baru" | "reset" | "link";
    userId?: string;
    dosenId?: number;
    initialEmail?: string;
  }>(null);
  const isAdmin = myProfile?.role === "admin";
  // v8.1 Monitoring Dosen: pilihan drill-down admin (dosen -> kelas).
  const [monitorDosenId, setMonitorDosenId] = useState<number | null>(null);
  const [monitorKelasId, setMonitorKelasId] = useState<number | null>(null);
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

  /* ---------- Mode Admin: muat agregat lintas dosen ---------- */
  async function loadAdmin() {
    const supabase = getSupabase();
    if (!supabase) return;
    const [ds, ta, mk, kl, mh, ag, pt, ab, kn, nl, mt, tg, pg] = await Promise.all([
      supabase.from("dosen").select("*").order("nama"),
      supabase.from("tahun_akademik").select("*").order("tahun", { ascending: false }),
      supabase.from("mata_kuliah").select("*").order("nama"),
      supabase.from("kelas").select("*").order("kode_kelas"),
      supabase.from("mahasiswa").select("*").order("nama"),
      supabase.from("anggota_kelas").select("*"),
      supabase.from("pertemuan").select("*"),
      supabase.from("absensi").select("*"),
      supabase.from("komponen_nilai").select("*"),
      supabase.from("nilai").select("*"),
      supabase.from("materi").select("*").order("created_at", { ascending: false }),
      supabase.from("tugas").select("*").order("created_at", { ascending: false }),
      supabase.from("pengumpulan_tugas").select("*"),
    ]);
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
    // v8.1: materi/tugas/pengumpulan ikut dimuat untuk Monitoring Dosen.
    if (mt.data) setMateriList(mt.data as Materi[]);
    if (tg.data) setTugasList(tg.data as unknown as Tugas[]);
    if (pg.data) setPengumpulanList(pg.data as unknown as PengumpulanTugas[]);
    setLoading(false);
    await refreshAccounts();
  }

  async function refreshAccounts() {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data, error } = await supabase.functions.invoke("create-lecturer-account", { body: { action: "list" } });
    if (!error && data && Array.isArray((data as { accounts?: unknown }).accounts)) {
      setAccounts((data as { accounts: AkunDosen[] }).accounts);
    }
  }

  async function accountAction(body: Record<string, unknown>, okMsg: string): Promise<boolean> {
    const supabase = getSupabase();
    if (!supabase) return false;
    const { data, error } = await supabase.functions.invoke("create-lecturer-account", { body });
    const errMsg = (data as { error?: string } | null)?.error ?? (error ? error.message : "");
    if (error || errMsg) {
      showToast(`Gagal: ${errMsg || "Edge Function tidak merespons."}`);
      return false;
    }
    showToast(okMsg);
    await loadAdmin();
    return true;
  }

  useEffect(() => {
    if (sessionState !== "ready" || !profileLoaded) return;
    if (isAdmin) {
      setView((v) => (v === "dashboard" ? "admin-dashboard" : v));
      void loadAdmin();
    } else {
      void loadAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionState, profileLoaded, isAdmin]);

  useEffect(() => {
    if (!sessionUser) return;
    const supabase = getSupabase();
    if (!supabase) return;
    let active = true;
    void (async () => {
      const { data } = await supabase.from("profiles").select("*").eq("user_id", sessionUser.id).maybeSingle();
      if (!active) return;
      if (data) {
        const prof = data as ProfileAkun;
        setMyProfile(prof);
        setMyPhoto(prof.photo ?? "");
      } else {
        // Akun yang belum punya baris penghubung (akun lama / dibuat
        // langsung di Supabase): buat sebagai dosen. Peran admin hanya
        // ditetapkan lewat SQL migrasi atau Edge Function.
        const { data: created } = await supabase.from("profiles")
          .insert({ user_id: sessionUser.id, role: "dosen" })
          .select("*")
          .maybeSingle();
        if (!active) return;
        if (created) {
          const prof = created as ProfileAkun;
          setMyProfile(prof);
          setMyPhoto(prof.photo ?? "");
        } else {
          setMyProfile({ user_id: sessionUser.id, photo: "", role: "dosen", dosen_id: null, aktif: true });
        }
      }
      if (active) setProfileLoaded(true);
    })();
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

  // Tautkan otomatis profil dosen pertama ke akun ini (sekali saja),
  // agar konteks dosen = profil milik sendiri tanpa "dosen aktif" global.
  useEffect(() => {
    if (!sessionUser || !myProfile || isAdmin || myProfile.dosen_id) return;
    if (!dosenList.length) return;
    const mine = dosenList.find((d) => (d.email ?? "").toLowerCase() === sessionUser.email.toLowerCase()) ?? dosenList[0];
    if (!mine) return;
    const supabase = getSupabase();
    if (!supabase) return;
    void supabase.from("profiles").update({ dosen_id: mine.id }).eq("user_id", sessionUser.id)
      .then(({ error }) => { if (!error) setMyProfile((p) => (p ? { ...p, dosen_id: mine.id } : p)); });
  }, [sessionUser, myProfile, isAdmin, dosenList]);

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
  const activeTA = taList.find((t) => String(t.id) === settings.tahun_akademik_aktif_id) ?? taList.find((t) => t.aktif === 1) ?? null;
  // v8: tidak ada lagi "dosen aktif" global — konteks dosen adalah
  // profil yang tertaut ke akun login sendiri (profiles.dosen_id).
  const activeDosen = (myProfile?.dosen_id ? dosenList.find((d) => d.id === myProfile.dosen_id) : undefined) ?? dosenList[0] ?? null;
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
    const uid = sessionUser?.id;
    if (!uid) throw new Error("Sesi login tidak ditemukan.");
    const { error } = await supabase.from("pengaturan").upsert({ owner_id: uid, kunci, nilai }, { onConflict: "owner_id,kunci" });
    if (error) throw new Error(error.message);
    setSettings((p) => ({ ...p, [kunci]: nilai }));
  }
  async function logout() {
    const supabase = getSupabase();
    if (supabase) await supabase.auth.signOut();
    window.location.href = "/login";
  }

  if (sessionState === "setup") return <SetupScreen />;
  if (sessionState === "loading" || !profileLoaded || loading) {
    return <main className="setup-wrap"><p className="muted">Memuat Smart Class Online…</p></main>;
  }

  const appName = settings.nama_aplikasi || "Smart Class";
  const institusi = settings.institusi || "IAI DDI Maros";
  const userName = isAdmin ? (sessionUser?.email || "Admin") : activeDosen?.nama || sessionUser?.email || "Dosen";

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
          <p>{isAdmin ? "Rektor / Admin Kampus" : <>{activeDosen?.prodi || "Dosen"} {activeDosen?.fakultas ? `• ${activeDosen.fakultas}` : ""}</>}</p>
          <p className="online-dot">● Online</p>
          <span className="role-chip admin">{isAdmin ? "Admin" : "Dosen"}</span>
        </div>
        <p className="nav-label">Menu Utama</p>
        <nav className="nav">
          {(isAdmin ? NAV_ADMIN : NAV).map((n) => (
            <button key={n.view} className={view === n.view ? "active" : ""} onClick={() => setView(n.view)}>
              <span className="ico">{n.icon}</span> {n.label}
            </button>
          ))}
        </nav>
        {!isAdmin && (<div className="journal-card">
          <div className="crown">🎓</div>
          <h4>{activeTA ? `${activeTA.tahun} • ${activeTA.semester}` : "Tahun Akademik"}</h4>
          <p>{activeTA ? "Tahun akademik aktif saat ini." : "Belum ada tahun akademik aktif. Atur di menu Pengaturan."}</p>
          <button className="btn btn-gold btn-small" onClick={() => setView("pengaturan")}>Atur Tahun Akademik</button>
        </div>)}
      </aside>

      <main className="main">
        <div className="topbar no-print">
          <h1>{VIEW_TITLES[view]}</h1>
          <span className="badge-live">{activeTA ? `${activeTA.semester} • ${activeTA.tahun}` : "Online"}</span>
          <span className="spacer" />
          <button className="btn-logout" onClick={() => void logout()}>⏻ Keluar</button>
        </div>

        {!isAdmin && (<div className="context-bar no-print">
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
        </div>)}

        {view === "admin-dashboard" && isAdmin && (() => {
          const totalAbsensi = absensiList.length;
          const hadirEfektif = absensiList.filter((a) => a.status === "Hadir" || a.status === "Terlambat").length;
          const rataKehadiran = totalAbsensi ? Math.round((hadirEfektif / totalAbsensi) * 1000) / 10 : 0;
          const kelasAktifCount = kelasList.filter((k) => k.status === "Aktif").length;
          const hurufGroups = [
            { label: "A", color: "#0284c7" },
            { label: "B", color: "#38bdf8" },
            { label: "C", color: "#e9b949" },
            { label: "D", color: "#d97706" },
            { label: "E", color: "#dc2626" },
          ];
          const hurufCount: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
          let dinilaiTotal = 0;
          for (const k of kelasList) {
            const komps = komponenList.filter((x) => x.kelas_id === k.id);
            const bobot = komps.reduce((sm, x) => sm + Number(x.bobot || 0), 0);
            if (Math.abs(bobot - 100) >= 0.01) continue;
            for (const a of anggotaList.filter((x) => x.kelas_id === k.id && x.status === "Aktif")) {
              if (!nilaiList.some((n) => n.kelas_id === k.id && n.mahasiswa_id === a.mahasiswa_id)) continue;
              let total = 0;
              for (const kp of komps) {
                const n = nilaiList.find((x) => x.kelas_id === k.id && x.mahasiswa_id === a.mahasiswa_id && x.komponen_nilai_id === kp.id);
                if (n) total += Number(n.nilai_angka) * Number(kp.bobot || 0) / 100;
              }
              const huruf = nilaiHuruf(total);
              const g = ["A", "A-"].includes(huruf) ? "A" : ["B+", "B", "B-"].includes(huruf) ? "B" : ["C+", "C", "C-"].includes(huruf) ? "C" : huruf;
              hurufCount[g] = (hurufCount[g] ?? 0) + 1;
              dinilaiTotal++;
            }
          }
          return (
            <>
              <div className="hero no-print">
                <span className="pill">{institusi}</span>
                <h2>Dashboard Admin Kampus 👋</h2>
                <p>
                  Pantau seluruh dosen dalam satu pandangan: jumlah dosen, kelas, mahasiswa,
                  kehadiran, dan distribusi nilai agregat. Sebagai Admin Anda <strong>hanya memantau</strong> —
                  data kerja dosen tidak dapat diubah dari akun ini.
                </p>
                <div className="actions">
                  <button className="btn btn-primary" onClick={() => setView("admin-akun")}>Kelola Akun Dosen</button>
                </div>
              </div>
              <div className="kpis">
                <div className="kpi tone-1"><div className="k-ico">👨‍🏫</div><div className="k-label">Dosen Terdaftar</div><div className="k-value">{dosenList.length}</div><div className="k-sub">{accounts.filter((a) => a.role === "dosen").length} akun login dosen</div></div>
                <div className="kpi tone-2"><div className="k-ico">🗂️</div><div className="k-label">Kelas</div><div className="k-value">{kelasList.length}</div><div className="k-sub">{kelasAktifCount} kelas berstatus Aktif</div></div>
                <div className="kpi tone-3"><div className="k-ico">🎓</div><div className="k-label">Mahasiswa</div><div className="k-value">{mhsList.length}</div><div className="k-sub">Total data mahasiswa semua dosen</div></div>
                <div className="kpi tone-4"><div className="k-ico">🗓️</div><div className="k-label">Rata-rata Kehadiran</div><div className="k-value">{totalAbsensi ? `${rataKehadiran}%` : "-"}</div><div className="k-sub">{totalAbsensi} catatan absensi • {pertemuanList.length} pertemuan</div></div>
              </div>
              <div className="grid-2">
                <div className="panel">
                  <h3>Distribusi Nilai Huruf (Agregat)</h3>
                  <p className="sub">Nilai akhir semua kelas yang bobot komponennya 100% dan sudah dinilai</p>
                  {dinilaiTotal === 0 && <p className="empty">Belum ada nilai akhir yang bisa diagregat.</p>}
                  {dinilaiTotal > 0 && hurufGroups.map((g) => (
                    <div key={g.label} className="legend-row">
                      <span className="dot" style={{ background: g.color }} />
                      <span>Nilai {g.label}</span>
                      <span className="val">{hurufCount[g.label] ?? 0} ({Math.round(((hurufCount[g.label] ?? 0) / dinilaiTotal) * 100)}%)</span>
                    </div>
                  ))}
                  {dinilaiTotal > 0 && (
                    <div className="legend-row"><span>Total dinilai</span><span className="val">{dinilaiTotal} mahasiswa</span></div>
                  )}
                </div>
                <div className="panel">
                  <h3>Akun &amp; Akses</h3>
                  <p className="sub">Ringkasan akun login terdaftar</p>
                  <div className="legend-row"><span>Total akun login</span><span className="val">{accounts.length}</span></div>
                  <div className="legend-row"><span>Akun admin</span><span className="val">{accounts.filter((a) => a.role === "admin").length}</span></div>
                  <div className="legend-row"><span>Akun dosen tertaut profil</span><span className="val">{accounts.filter((a) => a.dosen_id).length}</span></div>
                  <div className="legend-row"><span>Akun nonaktif / diblokir</span><span className="val">{accounts.filter((a) => !a.aktif).length}</span></div>
                  <div className="legend-row"><span>Profil dosen belum punya akun</span><span className="val">{dosenList.filter((d) => !accounts.some((a) => a.dosen_id === d.id)).length}</span></div>
                </div>
              </div>
              <div className="panel" style={{ marginTop: 20 }}>
                <h3>Ringkasan per Dosen</h3>
                <p className="sub">Hanya-baca — detail dikelola dosen yang bersangkutan dari akunnya sendiri</p>
                <table>
                  <thead><tr><th>Dosen</th><th>Prodi</th><th>Kelas</th><th>Mahasiswa Unik</th><th>Pertemuan</th><th>% Kehadiran</th><th>Akun</th></tr></thead>
                  <tbody>
                    {dosenList.map((d) => {
                      const kIds = kelasList.filter((k) => k.dosen_id === d.id).map((k) => k.id);
                      const mhsUnik = new Set(anggotaList.filter((a) => kIds.includes(a.kelas_id)).map((a) => a.mahasiswa_id)).size;
                      const pIds = pertemuanList.filter((x) => kIds.includes(x.kelas_id)).map((x) => x.id);
                      const abs = absensiList.filter((a) => pIds.includes(a.pertemuan_id));
                      const pct = abs.length ? Math.round((abs.filter((a) => a.status === "Hadir" || a.status === "Terlambat").length / abs.length) * 1000) / 10 : null;
                      const akun = accounts.find((a) => a.dosen_id === d.id);
                      return (
                        <tr key={d.id}>
                          <td><strong>{d.nama}</strong>{d.nidn ? <><br /><span className="muted" style={{ fontSize: 12 }}>NIDN {d.nidn}</span></> : null}</td>
                          <td>{d.prodi || "-"}</td>
                          <td>{kIds.length}</td>
                          <td>{mhsUnik}</td>
                          <td>{pIds.length}</td>
                          <td>{pct === null ? "-" : `${pct}%`}</td>
                          <td>{akun ? <span className={`chip ${akun.aktif ? "ok" : "warn"}`}>{akun.aktif ? "Aktif" : "Nonaktif"}</span> : <span className="chip">Belum ada akun</span>}</td>
                        </tr>
                      );
                    })}
                    {dosenList.length === 0 && <tr><td colSpan={7} className="empty">Belum ada profil dosen. Buat dari menu Manajemen Akun Dosen.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          );
        })()}

        {view === "admin-akun" && isAdmin && (
          <section className="module">
            <div className="module-head">
              <h2>Manajemen Akun Dosen</h2><span className="spacer" />
              <button className="btn" onClick={() => void refreshAccounts()}>↻ Muat Ulang Akun</button>
              <button className="btn btn-primary" onClick={() => setAccountModal({ mode: "create-baru" })}>+ Profil + Akun Dosen Baru</button>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              Setiap dosen masuk dengan akunnya sendiri dan hanya melihat datanya sendiri.
              Pembuatan akun, reset password, dan penonaktifan berjalan lewat Edge Function
              <strong> create-lecturer-account</strong> (service role tetap di server Supabase).
              {accounts.length === 0 && <> Bila daftar akun kosong, pastikan Edge Function sudah di-deploy mengikuti panduan v8.</>}
            </p>
            <h3 style={{ margin: "18px 0 8px" }}>Profil Dosen &amp; Akunnya</h3>
            <table>
              <thead><tr><th>Dosen</th><th>Email Profil</th><th>Akun Login</th><th>Status</th><th>Aksi</th></tr></thead>
              <tbody>
                {dosenList.map((d) => {
                  const akun = accounts.find((a) => a.dosen_id === d.id);
                  return (
                    <tr key={d.id}>
                      <td><strong>{d.nama}</strong>{d.nidn ? <><br /><span className="muted" style={{ fontSize: 12 }}>NIDN {d.nidn}</span></> : null}</td>
                      <td>{d.email || "-"}</td>
                      <td>{akun ? akun.email : <span className="muted">—</span>}</td>
                      <td>{akun ? <span className={`chip ${akun.aktif ? "ok" : "warn"}`}>{akun.aktif ? "Aktif" : "Nonaktif"}</span> : <span className="chip">Belum ada akun</span>}</td>
                      <td><div className="row-actions">
                        {!akun && (
                          <button className="btn btn-small btn-primary" onClick={() => setAccountModal({ mode: "create", dosenId: d.id, initialEmail: d.email ?? "" })}>Buat Akun</button>
                        )}
                        {akun && (
                          <>
                            <button className="btn btn-small" onClick={() => setAccountModal({ mode: "reset", userId: akun.user_id })}>Reset Password</button>
                            <button className="btn btn-small" onClick={() => {
                              if (window.confirm(`${akun.aktif ? "Nonaktifkan" : "Aktifkan lagi"} akun ${akun.email}?`)) {
                                void accountAction({ action: "set_active", user_id: akun.user_id, aktif: !akun.aktif }, akun.aktif ? "Akun dinonaktifkan." : "Akun diaktifkan lagi.");
                              }
                            }}>{akun.aktif ? "Nonaktifkan" : "Aktifkan"}</button>
                            <button className="btn btn-small btn-danger" onClick={() => {
                              if (window.confirm(`Lepas tautan akun ${akun.email} dari profil ${d.nama}? Akun tetap ada, profil tidak lagi tertaut.`)) {
                                void accountAction({ action: "unlink", user_id: akun.user_id }, "Tautan akun dilepas.");
                              }
                            }}>Lepas Tautan</button>
                          </>
                        )}
                      </div></td>
                    </tr>
                  );
                })}
                {dosenList.length === 0 && <tr><td colSpan={5} className="empty">Belum ada profil dosen.</td></tr>}
              </tbody>
            </table>

            <h3 style={{ margin: "26px 0 8px" }}>Semua Akun Login</h3>
            <table>
              <thead><tr><th>Email</th><th>Peran</th><th>Tertaut ke</th><th>Status</th><th>Aksi</th></tr></thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.user_id}>
                    <td><strong>{a.email || "(tanpa email)"}</strong></td>
                    <td><span className="chip">{a.role === "admin" ? "Admin" : "Dosen"}</span></td>
                    <td>{a.dosen_nama || <span className="muted">—</span>}</td>
                    <td><span className={`chip ${a.aktif ? "ok" : "warn"}`}>{a.aktif ? "Aktif" : "Nonaktif"}</span></td>
                    <td><div className="row-actions">
                      {!a.dosen_id && a.role !== "admin" && (
                        <button className="btn btn-small" onClick={() => setAccountModal({ mode: "link", userId: a.user_id })}>Tautkan</button>
                      )}
                      <button className="btn btn-small" onClick={() => {
                        const baru = a.role === "admin" ? "dosen" : "admin";
                        if (window.confirm(`Ubah peran ${a.email} menjadi ${baru === "admin" ? "Admin" : "Dosen"}?`)) {
                          void accountAction({ action: "set_role", user_id: a.user_id, role: baru }, "Peran akun diperbarui.");
                        }
                      }}>{a.role === "admin" ? "Jadikan Dosen" : "Jadikan Admin"}</button>
                      <button className="btn btn-small" onClick={() => setAccountModal({ mode: "reset", userId: a.user_id })}>Reset Password</button>
                      <button className="btn btn-small" onClick={() => {
                        if (window.confirm(`${a.aktif ? "Nonaktifkan" : "Aktifkan lagi"} akun ${a.email}?`)) {
                          void accountAction({ action: "set_active", user_id: a.user_id, aktif: !a.aktif }, a.aktif ? "Akun dinonaktifkan." : "Akun diaktifkan lagi.");
                        }
                      }}>{a.aktif ? "Nonaktifkan" : "Aktifkan"}</button>
                    </div></td>
                  </tr>
                ))}
                {accounts.length === 0 && <tr><td colSpan={5} className="empty">Daftar akun belum termuat. Pastikan Edge Function create-lecturer-account sudah di-deploy, lalu klik Muat Ulang Akun.</td></tr>}
              </tbody>
            </table>
          </section>
        )}

        {view === "admin-monitoring" && isAdmin && (() => {
          // ===== Monitoring Dosen (v8.1) — HANYA-LIHAT =====
          // Seluruh tampilan di blok ini murni membaca state yang sudah
          // dimuat loadAdmin(); tidak ada satu pun aksi tulis (tambah /
          // edit / hapus / simpan) yang dirender untuk admin di sini.
          const TERLAKSANA = new Set(["Selesai", "Berlangsung"]);
          const pantauBadge = <span className="pantau-badge">👁 Mode Pantau — Hanya Lihat</span>;
          const hadirDi = (kelasId: number, mhsId: number) => {
            const pIds = new Set(pertemuanList.filter((p) => p.kelas_id === kelasId).map((p) => p.id));
            const rows = absensiList.filter((a) => a.mahasiswa_id === mhsId && pIds.has(a.pertemuan_id));
            const hitung = (s: string) => rows.filter((r) => r.status === s).length;
            const efektif = hitung("Hadir") + hitung("Terlambat");
            const persen = rows.length ? Math.round((efektif / rows.length) * 1000) / 10 : 0;
            return { Hadir: hitung("Hadir"), Izin: hitung("Izin"), Sakit: hitung("Sakit"), Alpha: hitung("Alpha"), Terlambat: hitung("Terlambat"), total: rows.length, persen };
          };
          const gradeDi = (kelasId: number, mhsId: number) => {
            let total = 0;
            for (const kp of komponenList.filter((k) => k.kelas_id === kelasId)) {
              const n = nilaiList.find((x) => x.kelas_id === kelasId && x.mahasiswa_id === mhsId && x.komponen_nilai_id === kp.id);
              if (n && Number.isFinite(Number(n.nilai_angka))) total += Number(n.nilai_angka) * Number(kp.bobot || 0) / 100;
            }
            return total;
          };
          const ringkasDosen = (d: Dosen) => {
            const ks = kelasList.filter((k) => k.dosen_id === d.id);
            const kIds = ks.map((k) => k.id);
            const pers = pertemuanList.filter((p) => kIds.includes(p.kelas_id));
            const terlaksana = pers.filter((p) => TERLAKSANA.has(p.status)).length;
            const pIds = new Set(pers.map((p) => p.id));
            const abs = absensiList.filter((a) => pIds.has(a.pertemuan_id));
            const pct = abs.length ? Math.round((abs.filter((a) => a.status === "Hadir" || a.status === "Terlambat").length / abs.length) * 1000) / 10 : null;
            return {
              ks, terlaksana, totalPertemuan: pers.length, pct,
              materi: materiList.filter((m) => kIds.includes(m.kelas_id)).length,
              tugas: tugasList.filter((t) => kIds.includes(t.kelas_id)).length,
            };
          };

          const monDosen = monitorDosenId ? dosenList.find((d) => d.id === monitorDosenId) ?? null : null;
          const monKelas = monDosen && monitorKelasId
            ? kelasList.find((k) => k.id === monitorKelasId && k.dosen_id === monDosen.id) ?? null
            : null;

          /* ----- Level 1: daftar dosen ----- */
          if (!monDosen) {
            return (
              <section className="module">
                <div className="module-head">
                  <h2>Monitoring Dosen</h2>{pantauBadge}<span className="spacer" />
                </div>
                <p className="muted" style={{ marginTop: 0 }}>
                  Pantau kelengkapan administrasi mengajar setiap dosen: keadaan kelas, pertemuan yang
                  terlaksana, materi yang diajarkan, tugas yang diberikan, dan mahasiswa yang diajar.
                  Sebagai Admin Anda <strong>hanya melihat</strong> — tidak ada data dosen yang dapat
                  diubah dari halaman ini.
                </p>
                <table>
                  <thead><tr><th>Dosen</th><th>Prodi</th><th>Kelas</th><th>Pertemuan Terlaksana</th><th>% Kehadiran</th><th>Materi</th><th>Tugas</th><th>Akun</th><th></th></tr></thead>
                  <tbody>
                    {dosenList.map((d) => {
                      const r = ringkasDosen(d);
                      const akun = accounts.find((a) => a.dosen_id === d.id);
                      return (
                        <tr key={d.id}>
                          <td><strong>{d.nama}</strong>{d.nidn ? <><br /><span className="muted" style={{ fontSize: 12 }}>NIDN {d.nidn}</span></> : null}</td>
                          <td>{d.prodi || "-"}</td>
                          <td>{r.ks.length}</td>
                          <td>{r.terlaksana} dari {r.totalPertemuan}</td>
                          <td>{r.pct === null ? "-" : `${r.pct}%`}</td>
                          <td>{r.materi}</td>
                          <td>{r.tugas}</td>
                          <td>{akun ? <span className={`chip ${akun.aktif ? "ok" : "warn"}`}>{akun.aktif ? "Aktif" : "Nonaktif"}</span> : <span className="chip">Belum ada akun</span>}</td>
                          <td><button className="btn btn-small" onClick={() => { setMonitorDosenId(d.id); setMonitorKelasId(null); }}>🔭 Pantau</button></td>
                        </tr>
                      );
                    })}
                    {dosenList.length === 0 && <tr><td colSpan={9} className="empty">Belum ada profil dosen. Buat dari menu Manajemen Akun Dosen.</td></tr>}
                  </tbody>
                </table>
              </section>
            );
          }

          const ringkasan = ringkasDosen(monDosen);
          const akunDosen = accounts.find((a) => a.dosen_id === monDosen.id);

          /* ----- Level 2: daftar kelas milik dosen terpilih ----- */
          if (!monKelas) {
            return (
              <section className="module">
                <div className="module-head">
                  <button className="btn btn-small" onClick={() => { setMonitorDosenId(null); setMonitorKelasId(null); }}>← Semua Dosen</button>
                  <h2>{monDosen.nama}</h2>{pantauBadge}<span className="spacer" />
                </div>
                <p className="muted" style={{ marginTop: 0 }}>
                  {monDosen.nidn ? `NIDN ${monDosen.nidn} • ` : ""}{monDosen.prodi || "-"}
                  {monDosen.fakultas ? ` • ${monDosen.fakultas}` : ""}{monDosen.email ? ` • ${monDosen.email}` : ""}
                  {" • Akun: "}{akunDosen ? (akunDosen.aktif ? "Aktif" : "Nonaktif") : "Belum ada akun"}
                </p>
                <div className="kpis">
                  <div className="kpi tone-2"><div className="k-ico">🗂️</div><div className="k-label">Kelas</div><div className="k-value">{ringkasan.ks.length}</div><div className="k-sub">Kelas yang diampu dosen ini</div></div>
                  <div className="kpi tone-1"><div className="k-ico">🗓️</div><div className="k-label">Pertemuan Terlaksana</div><div className="k-value">{ringkasan.terlaksana}</div><div className="k-sub">dari {ringkasan.totalPertemuan} pertemuan terjadwal</div></div>
                  <div className="kpi tone-4"><div className="k-ico">✅</div><div className="k-label">Rata-rata Kehadiran</div><div className="k-value">{ringkasan.pct === null ? "-" : `${ringkasan.pct}%`}</div><div className="k-sub">Hadir + terlambat dari seluruh absensi</div></div>
                  <div className="kpi tone-3"><div className="k-ico">📁</div><div className="k-label">Materi &amp; Tugas</div><div className="k-value">{ringkasan.materi + ringkasan.tugas}</div><div className="k-sub">{ringkasan.materi} materi • {ringkasan.tugas} tugas</div></div>
                </div>
                <h3 style={{ margin: "6px 0 8px" }}>Kelas yang Diampu ({ringkasan.ks.length})</h3>
                <div className="cards-grid">
                  {ringkasan.ks.map((k) => {
                    const peserta = anggotaList.filter((a) => a.kelas_id === k.id && a.status === "Aktif").length;
                    const persK = pertemuanList.filter((p) => p.kelas_id === k.id);
                    const terlaksanaK = persK.filter((p) => TERLAKSANA.has(p.status)).length;
                    return (
                      <div key={k.id} className="class-card">
                        <h3 style={{ fontSize: 16 }}>{k.kode_kelas} — {mkById.get(k.mata_kuliah_id)?.nama ?? "Mata Kuliah"}</h3>
                        <p>
                          {taById.get(k.tahun_akademik_id) ? `${taById.get(k.tahun_akademik_id)?.tahun} • ${taById.get(k.tahun_akademik_id)?.semester}` : "-"}
                          {" • Status "}{k.status}
                          <br />{peserta} peserta • {terlaksanaK} dari {persK.length} pertemuan terlaksana
                          <br />{materiList.filter((m) => m.kelas_id === k.id).length} materi • {tugasList.filter((t) => t.kelas_id === k.id).length} tugas
                        </p>
                        <div className="row-actions">
                          <button className="btn btn-small btn-primary" onClick={() => setMonitorKelasId(k.id)}>Lihat Detail Kelas</button>
                        </div>
                      </div>
                    );
                  })}
                  {ringkasan.ks.length === 0 && <p className="empty">Dosen ini belum memiliki kelas.</p>}
                </div>
              </section>
            );
          }

          /* ----- Level 3: detail kelas (hanya-lihat) ----- */
          const persK = pertemuanList.filter((p) => p.kelas_id === monKelas.id).sort((a, b) => a.pertemuan_ke - b.pertemuan_ke);
          const materiK = materiList.filter((m) => m.kelas_id === monKelas.id);
          const tugasK = tugasList.filter((t) => t.kelas_id === monKelas.id);
          const anggotaK = anggotaList.filter((a) => a.kelas_id === monKelas.id && a.status === "Aktif")
            .sort((a, b) => (a.nomor_absen ?? 999) - (b.nomor_absen ?? 999) || (mhsById.get(a.mahasiswa_id)?.nama ?? "").localeCompare(mhsById.get(b.mahasiswa_id)?.nama ?? ""));
          const kompsK = komponenList.filter((k) => k.kelas_id === monKelas.id);
          const bobotK = kompsK.reduce((s, k) => s + Number(k.bobot || 0), 0);
          const bobotSiap = Math.abs(bobotK - 100) < 0.01;
          return (
            <section className="module">
              <div className="module-head">
                <button className="btn btn-small" onClick={() => setMonitorKelasId(null)}>← Kelas {monDosen.nama}</button>
                <h2>{monKelas.kode_kelas} — {mkById.get(monKelas.mata_kuliah_id)?.nama ?? "Mata Kuliah"}</h2>{pantauBadge}<span className="spacer" />
              </div>
              <div className="summary-bar">
                <span>Dosen: {monDosen.nama}</span>
                <span>Tahun Akademik: {taById.get(monKelas.tahun_akademik_id) ? `${taById.get(monKelas.tahun_akademik_id)?.tahun} ${taById.get(monKelas.tahun_akademik_id)?.semester}` : "-"}</span>
                <span>Ruang: {monKelas.ruang || "-"}</span>
                <span>Jadwal: {monKelas.hari || "-"} {monKelas.jam_mulai || ""}{monKelas.jam_selesai ? `–${monKelas.jam_selesai}` : ""}</span>
                <span>Status: {monKelas.status}</span>
                <span>Peserta: {anggotaK.length}</span>
                <span>Pertemuan: {persK.length}</span>
              </div>

              <h3 style={{ margin: "6px 0 8px" }}>Pertemuan ({persK.length})</h3>
              <table style={{ marginBottom: 20 }}>
                <thead><tr><th>Ke</th><th>Tanggal</th><th>Jam</th><th>Topik</th><th>Status</th></tr></thead>
                <tbody>
                  {persK.map((p) => (
                    <tr key={p.id}>
                      <td>{p.pertemuan_ke}</td>
                      <td>{fmtTanggal(p.tanggal)}</td>
                      <td>{p.jam_mulai || "-"}{p.jam_selesai ? `–${p.jam_selesai}` : ""}</td>
                      <td><strong>{p.topik || "-"}</strong>{p.catatan ? <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{p.catatan}</div> : null}</td>
                      <td><span className={`chip ${p.status === "Selesai" ? "ok" : p.status === "Dibatalkan" ? "bad" : p.status === "Berlangsung" ? "warn" : ""}`}>{p.status}</span></td>
                    </tr>
                  ))}
                  {persK.length === 0 && <tr><td colSpan={5} className="empty">Belum ada pertemuan di kelas ini.</td></tr>}
                </tbody>
              </table>

              <h3 style={{ margin: "0 0 8px" }}>Materi yang Diajarkan ({materiK.length})</h3>
              <table style={{ marginBottom: 20 }}>
                <thead><tr><th>Judul</th><th>Pertemuan</th><th>Deskripsi</th><th>Lampiran</th></tr></thead>
                <tbody>
                  {materiK.map((m) => (
                    <tr key={m.id}>
                      <td><strong>{m.judul}</strong></td>
                      <td>{m.pertemuan_id ? `Pertemuan ${pertemuanList.find((p) => p.id === m.pertemuan_id)?.pertemuan_ke ?? "-"}` : "-"}</td>
                      <td>{m.deskripsi || "-"}</td>
                      <td>{m.file_url ? <a className="file-link" href={m.file_url} target="_blank" rel="noreferrer">🔗 {m.file_name || "Buka file"}</a> : "-"}</td>
                    </tr>
                  ))}
                  {materiK.length === 0 && <tr><td colSpan={4} className="empty">Belum ada materi di kelas ini.</td></tr>}
                </tbody>
              </table>

              <h3 style={{ margin: "0 0 8px" }}>Tugas yang Diberikan ({tugasK.length})</h3>
              <table style={{ marginBottom: 20 }}>
                <thead><tr><th>Judul</th><th>Deadline</th><th>Status</th><th>Bobot</th><th>Pengumpulan</th><th>Lampiran</th></tr></thead>
                <tbody>
                  {tugasK.map((t) => {
                    const ds = deadlineStatus(t.deadline);
                    const kumpul = pengumpulanList.filter((p) => p.tugas_id === t.id);
                    const dinilai = kumpul.filter((p) => p.status === "Sudah Dinilai").length;
                    const terlambat = kumpul.filter((p) => p.status === "Terlambat").length;
                    const belum = kumpul.filter((p) => p.status === "Belum Dinilai").length;
                    const kumpulUrut = [...kumpul].sort((a, b) => (mhsById.get(a.mahasiswa_id)?.nama ?? "").localeCompare(mhsById.get(b.mahasiswa_id)?.nama ?? ""));
                    return (
                      <Fragment key={t.id}>
                        <tr>
                          <td><strong>{t.judul}</strong>{t.deskripsi ? <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{t.deskripsi}</div> : null}</td>
                          <td>{fmtTanggalWaktu(t.deadline)}</td>
                          <td><span className={`chip ${ds.cls}`}>{ds.label}</span></td>
                          <td>{t.bobot != null ? `${Number(t.bobot)}%` : "-"}</td>
                          <td>
                            {kumpul.length} dari {anggotaK.length} mahasiswa
                            {kumpul.length > 0 && (
                              <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                                Sudah dinilai {dinilai} • Terlambat {terlambat} • Belum dinilai {belum}
                              </div>
                            )}
                          </td>
                          <td>{t.file_url ? <a className="file-link" href={t.file_url} target="_blank" rel="noreferrer">🔗 {t.file_name || "Buka file"}</a> : "-"}</td>
                        </tr>
                        <tr>
                          <td colSpan={6} style={{ background: "#f8fafc" }}>
                            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Pengumpulan Mahasiswa ({kumpul.length})</div>
                            {kumpul.length === 0 ? (
                              <span className="muted">Belum ada pengumpulan.</span>
                            ) : (
                              <table style={{ margin: 0 }}>
                                <thead><tr><th>Mahasiswa</th><th>Waktu Kumpul</th><th>Status</th><th>Nilai</th><th>File</th></tr></thead>
                                <tbody>
                                  {kumpulUrut.map((p) => {
                                    const m = mhsById.get(p.mahasiswa_id);
                                    return (
                                      <tr key={p.id}>
                                        <td><strong>{m?.nama ?? "-"}</strong><div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{m?.nim ?? "-"}</div></td>
                                        <td>{fmtTanggalWaktu(p.waktu_kumpul)}</td>
                                        <td><span className={`chip ${p.status === "Sudah Dinilai" ? "ok" : p.status === "Terlambat" ? "bad" : "warn"}`}>{p.status}</span></td>
                                        <td>{p.nilai != null ? Number(p.nilai) : "-"}</td>
                                        <td>{p.file_url ? <a className="file-link" href={p.file_url} target="_blank" rel="noreferrer">🔗 {p.file_name || "Buka file"}</a> : "-"}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                  {tugasK.length === 0 && <tr><td colSpan={6} className="empty">Belum ada tugas di kelas ini.</td></tr>}
                </tbody>
              </table>

              <h3 style={{ margin: "0 0 8px" }}>Mahasiswa yang Diajar ({anggotaK.length})</h3>
              <table style={{ marginBottom: 20 }}>
                <thead><tr><th>No. Absen</th><th>NIM</th><th>Nama</th><th>JK</th><th>Prodi</th><th>Angkatan</th></tr></thead>
                <tbody>
                  {anggotaK.map((a) => {
                    const m = mhsById.get(a.mahasiswa_id); if (!m) return null;
                    return (
                      <tr key={a.id}>
                        <td>{a.nomor_absen ?? "-"}</td><td>{m.nim}</td><td><strong>{m.nama}</strong></td>
                        <td>{m.jenis_kelamin || "-"}</td><td>{m.prodi || "-"}</td><td>{m.angkatan ?? "-"}</td>
                      </tr>
                    );
                  })}
                  {anggotaK.length === 0 && <tr><td colSpan={6} className="empty">Belum ada peserta aktif di kelas ini.</td></tr>}
                </tbody>
              </table>

              <h3 style={{ margin: "0 0 8px" }}>Rekap Kehadiran</h3>
              <table style={{ marginBottom: 20 }}>
                <thead><tr><th>No</th><th>NIM</th><th>Nama</th><th>Hadir</th><th>Izin</th><th>Sakit</th><th>Alpha</th><th>Terlambat</th><th>% Hadir</th></tr></thead>
                <tbody>
                  {anggotaK.map((a, i) => {
                    const m = mhsById.get(a.mahasiswa_id); if (!m) return null;
                    const r = hadirDi(monKelas.id, a.mahasiswa_id);
                    return <tr key={a.id}><td>{i + 1}</td><td>{m.nim}</td><td><strong>{m.nama}</strong></td><td>{r.Hadir}</td><td>{r.Izin}</td><td>{r.Sakit}</td><td>{r.Alpha}</td><td>{r.Terlambat}</td><td>{r.persen}%</td></tr>;
                  })}
                  {anggotaK.length === 0 && <tr><td colSpan={9} className="empty">Belum ada peserta aktif di kelas ini.</td></tr>}
                </tbody>
              </table>

              <h3 style={{ margin: "0 0 8px" }}>Rekap Nilai</h3>
              {!bobotSiap && <p className="muted" style={{ marginTop: 0 }}>Total bobot komponen kelas ini {bobotK}% — nilai akhir &amp; huruf ditampilkan bila total bobot tepat 100%.</p>}
              <table>
                <thead><tr><th>No</th><th>NIM</th><th>Nama</th>{kompsK.map((k) => <th key={k.id}>{k.nama}</th>)}<th>Akhir</th><th>Huruf</th></tr></thead>
                <tbody>
                  {anggotaK.map((a, i) => {
                    const m = mhsById.get(a.mahasiswa_id); if (!m) return null;
                    const akhir = gradeDi(monKelas.id, a.mahasiswa_id);
                    return (
                      <tr key={a.id}><td>{i + 1}</td><td>{m.nim}</td><td><strong>{m.nama}</strong></td>
                        {kompsK.map((k) => {
                          const n = nilaiList.find((x) => x.kelas_id === monKelas.id && x.mahasiswa_id === a.mahasiswa_id && x.komponen_nilai_id === k.id);
                          return <td key={k.id}>{n ? Number(n.nilai_angka) : "-"}</td>;
                        })}
                        <td><strong>{bobotSiap ? akhir.toFixed(2) : "-"}</strong></td>
                        <td>{bobotSiap ? nilaiHuruf(akhir) : "-"}</td>
                      </tr>
                    );
                  })}
                  {anggotaK.length === 0 && <tr><td colSpan={5 + kompsK.length} className="empty">Belum ada peserta aktif di kelas ini.</td></tr>}
                </tbody>
              </table>
            </section>
          );
        })()}

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
                <h3>Kehadiran per Pertemuan</h3>
                <p className="sub">Persentase kehadiran (hadir + terlambat) kelas aktif</p>
                {(() => {
                  const data: { ke: number; topik: string; pct: number }[] = [];
                  for (const p of [...pertemuanAktif].sort((a, b) => a.pertemuan_ke - b.pertemuan_ke)) {
                    const rows = absensiList.filter((a) => a.pertemuan_id === p.id);
                    if (!rows.length) continue;
                    const efektif = rows.filter((r) => r.status === "Hadir" || r.status === "Terlambat").length;
                    data.push({ ke: p.pertemuan_ke, topik: p.topik || "", pct: Math.round((efektif / rows.length) * 100) });
                  }
                  if (data.length === 0) return <p className="empty">Belum ada data absensi untuk kelas aktif.</p>;
                  return (
                    <div className="bars">
                      {data.map((d) => (
                        <div key={d.ke} className="bar-col" title={`Pertemuan ${d.ke} — ${d.topik}`}>
                          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink)" }}>{d.pct}%</span>
                          <div className={`bar${d.pct < 75 ? " alt" : ""}`} style={{ height: `${Math.max(d.pct, 4)}%` }} />
                          <span>P{d.ke}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <div className="panel">
                <h3>Distribusi Nilai Huruf</h3>
                <p className="sub">Nilai akhir mahasiswa kelas aktif yang sudah dinilai</p>
                {(() => {
                  if (Math.abs(totalBobot - 100) >= 0.01) return <p className="empty">Total bobot komponen belum 100% — distribusi nilai belum dapat ditampilkan.</p>;
                  const groups = [
                    { label: "A (A / A-)", color: "#0284c7", letters: ["A", "A-"] },
                    { label: "B (B+ / B / B-)", color: "#38bdf8", letters: ["B+", "B", "B-"] },
                    { label: "C (C+ / C / C-)", color: "#e9b949", letters: ["C+", "C", "C-"] },
                    { label: "D", color: "#d97706", letters: ["D"] },
                    { label: "E", color: "#dc2626", letters: ["E"] },
                  ];
                  const dinilai = anggotaAktif.filter((a) => nilaiList.some((n) => n.kelas_id === activeKelasId && n.mahasiswa_id === a.mahasiswa_id));
                  const total = dinilai.length;
                  if (total === 0) return <p className="empty">Belum ada nilai tersimpan untuk kelas aktif.</p>;
                  const counts = groups.map((g) => ({ ...g, count: dinilai.filter((a) => g.letters.includes(nilaiHuruf(finalGrade(a.mahasiswa_id)))).length })).filter((g) => g.count > 0);
                  const C = 2 * Math.PI * 52;
                  let acc = 0;
                  const segs = counts.map((g) => { const len = (g.count / total) * C; const s = { ...g, len, off: acc }; acc += len; return s; });
                  return (
                    <div className="donut-wrap">
                      <svg viewBox="0 0 140 140" style={{ width: 148, height: 148, flex: "0 0 auto" }} role="img" aria-label="Diagram lingkaran distribusi nilai huruf">
                        <circle cx="70" cy="70" r="52" fill="none" stroke="#E2E8F0" strokeWidth="22" />
                        {segs.map((g) => (
                          <circle key={g.label} cx="70" cy="70" r="52" fill="none" stroke={g.color} strokeWidth="22"
                            strokeDasharray={`${Math.max(g.len - 2, 0.5)} ${C - g.len + 2}`} strokeDashoffset={-g.off}
                            transform="rotate(-90 70 70)" />
                        ))}
                        <text x="70" y="67" textAnchor="middle" fontSize="23" fontWeight="800" fill="#172554">{total}</text>
                        <text x="70" y="86" textAnchor="middle" fontSize="10.5" fill="#64748B">mahasiswa</text>
                      </svg>
                      <div className="donut-legend">
                        {segs.map((g) => (
                          <div key={g.label} className="legend-row">
                            <span className="dot" style={{ background: g.color }} />
                            <span>{g.label}</span>
                            <span className="val">{g.count} ({Math.round((g.count / total) * 100)}%)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
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
            <p className="muted" style={{ marginTop: 0 }}>Profil dosen ini tertaut ke akun login Anda dan menjadi konteks aplikasi. Sejak v8 setiap akun memiliki data dan konteksnya sendiri — tidak ada lagi &quot;dosen aktif&quot; global yang bisa tertimpa akun lain.</p>
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
                  {activeDosen?.id === d.id
                    ? <span className="chip ok">● Profil Anda</span>
                    : <span className="chip">Profil tambahan</span>}
                  <div className="row-actions">
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
                              <td>{m.nim}</td><td><strong>{m.nama}</strong>{existing?.waktu_kumpul ? <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>Dikumpulkan: {existing.waktu_kumpul}</div> : null}</td>
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
          <section className="module no-print">
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

            <h3 style={{ margin: "26px 0 8px" }}>Tanda Tangan Laporan</h3>
            <p className="muted" style={{ fontSize: 13, maxWidth: 720, margin: "0 0 10px" }}>
              Blok tanda tangan di kaki laporan cetak (Rekap &amp; Laporan). Isi nama atasan
              (Rektor, Ketua Program Studi, Dekan, dan sebagainya) agar tampil sebagai pihak
              yang <em>Mengetahui</em> di sisi kiri, berhadapan dengan tanda tangan Dosen Pengampu.
              Bila Nama Atasan dikosongkan, blok Mengetahui tidak tampil.
            </p>
            <div className="form-grid" style={{ maxWidth: 720 }}>
              <label>Jabatan Atasan
                <input id="set-ttd-jabatan" placeholder="cth. Rektor IAI DDI Maros / Ketua Program Studi PAI" defaultValue={settings.ttd_jabatan ?? ""} key={`tj-${settings.ttd_jabatan ?? ""}`} />
              </label>
              <label>Nama Atasan
                <input id="set-ttd-nama" placeholder="Nama lengkap + gelar atasan" defaultValue={settings.ttd_nama ?? ""} key={`tn-${settings.ttd_nama ?? ""}`} />
              </label>
              <label>NIDN Atasan (opsional)
                <input id="set-ttd-nidn" placeholder="NIDN atasan" defaultValue={settings.ttd_nidn ?? ""} key={`ti-${settings.ttd_nidn ?? ""}`} />
              </label>
              <label>Kota Tanda Tangan
                <input id="set-ttd-kota" placeholder="cth. Maros" defaultValue={settings.ttd_kota ?? "Maros"} key={`tk-${settings.ttd_kota ?? ""}`} />
              </label>
            </div>
            <button className="btn btn-primary" onClick={() => void (async () => {
              const jab = (document.getElementById("set-ttd-jabatan") as HTMLInputElement | null)?.value.trim() ?? "";
              const nm = (document.getElementById("set-ttd-nama") as HTMLInputElement | null)?.value.trim() ?? "";
              const ni = (document.getElementById("set-ttd-nidn") as HTMLInputElement | null)?.value.trim() ?? "";
              const kt = (document.getElementById("set-ttd-kota") as HTMLInputElement | null)?.value.trim() ?? "";
              await saveSetting("ttd_jabatan", jab);
              await saveSetting("ttd_nama", nm);
              await saveSetting("ttd_nidn", ni);
              await saveSetting("ttd_kota", kt);
              showToast("Pengaturan tanda tangan laporan berhasil disimpan.");
            })()}>Simpan Tanda Tangan</button>

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
              Backup mengekspor seluruh data milik akun Anda (semua tabel) ke satu file JSON. Restore/import akan memvalidasi file,
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
                const payload = { app: "smart-class-online", version: "v2026-10-28-v9.0.5", exported_at: new Date().toISOString(), tables };
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
                        const rawRows = parsed.tables[t];
                        if (!rawRows.length) continue;
                        // v8: paksa kepemilikan ke akun yang sedang login,
                        // agar backup lama (tanpa owner_id) tetap bisa dipulihkan.
                        const rows = rawRows.map((r) => ({ ...r, owner_id: sessionUser?.id ?? r.owner_id }));
                        const { error } = await supabase.from(t).upsert(rows, { onConflict: t === "pengaturan" ? "owner_id,kunci" : "id" });
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
                { j: "Multi-Akun Dua Peran (v8)", d: "Setiap dosen memiliki data dan konteksnya sendiri. Admin/Rektor memantau agregat seluruh kampus dan mengelola akun dosen tanpa bisa mengubah data kerja dosen." },
                { j: "Asisten AI (v9)", d: "Chatbot panduan penggunaan aplikasi (tombol chat pojok kanan bawah) yang menjawab pertanyaan seputar cara kerja Smart Class berdasarkan Manual Book, untuk dosen dan admin yang sudah login." },
                { j: "Pengaturan", d: "Tahun akademik aktif, backup/restore JSON online, dan reset semester yang aman." },
              ].map((c) => (
                <div key={c.j} className="class-card"><h3 style={{ fontSize: 16 }}>{c.j}</h3><p>{c.d}</p></div>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 16 }}>
              Versi paket: SMART CLASS ONLINE v2026-10-28-v9.0.5 • Teknologi: Next.js + Supabase + Vercel.
              Program studi yang didukung Export SIAKAD: PGMI (86232), PAI (86208), Ekonomi Syariah (60206), Hukum Keluarga Islam (74230).
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
              <span className="muted" style={{ fontSize: 13.5 }}>Dikembangkan oleh</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-manrapi.png" alt="Logo Manrapi EduTech" style={{ width: 25, height: 25, borderRadius: 7, display: "block" }} />
              <strong style={{ fontSize: 13.5 }}>Manrapi EduTech</strong>
              <span className="muted" style={{ fontSize: 13.5 }}>— Solusi Digital untuk Sekolah &amp; Kampus</span>
            </div>
          </section>
        )}
      </main>

      {accountModal && (
        <AccountActionModal
          mode={accountModal.mode}
          userId={accountModal.userId}
          dosenId={accountModal.dosenId}
          dosenNama={accountModal.dosenId ? dosenList.find((d) => d.id === accountModal.dosenId)?.nama : undefined}
          initialEmail={accountModal.initialEmail}
          dosenList={dosenList}
          linkedDosenIds={new Set(accounts.map((a) => a.dosen_id).filter((x): x is number => typeof x === "number"))}
          onClose={() => setAccountModal(null)}
          onSubmit={async (body) => {
            const ok = await accountAction(body, "Operasi akun berhasil disimpan.");
            return ok;
          }}
        />
      )}

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
              {settings.ttd_nama ? (
                <div className="sign-block">
                  <div>Mengetahui,</div>
                  <div>{settings.ttd_jabatan || "Pimpinan"}</div>
                  <div className="sign-space" />
                  <div className="sign-name">{settings.ttd_nama}</div>
                  {settings.ttd_nidn ? <div>NIDN. {settings.ttd_nidn}</div> : null}
                </div>
              ) : (
                <div className="sign-block" />
              )}
              <div className="sign-block">
                <div>{settings.ttd_kota || "Maros"}, {new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</div>
                <div>Dosen Pengampu,</div>
                <div className="sign-space" />
                <div className="sign-name">{dosenById.get(activeKelas.dosen_id)?.nama ?? "-"}</div>
                <div>NIDN. {dosenById.get(activeKelas.dosen_id)?.nidn ?? "-"}</div>
              </div>
            </div>
            <div className="report-foot">
              Dokumen ini dicetak dari {appName} Online pada {new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })} • {institusi}
            </div>
          </div>
          <div className="modal-actions no-print">
            <button className="btn" onClick={() => setReportType(null)}>Tutup</button>
            <button className="btn btn-primary" onClick={() => window.print()}>🖨 Cetak / Simpan PDF</button>
          </div>
        </Modal>
      )}

      {toast && <div className="toast no-print">{toast}</div>}
      <AsistenChat />
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
