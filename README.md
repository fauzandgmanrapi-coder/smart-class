# Smart Class Online

Versi web (online) dari aplikasi desktop **Smart Class** untuk dosen —
tampilan navy/sky khas aslinya (#172554 + aksen sky), font Plus Jakarta Sans —
untuk mengelola:

- **Dashboard** — kartu statistik mata kuliah, kelas, peserta kelas aktif, pertemuan + konteks tahun akademik & kelas aktif
- **Profil Dosen** — profil dosen aktif (NIDN, nama, email, HP, prodi, fakultas, foto)
- **Mata Kuliah** — CRUD mata kuliah semester 1–8
- **Kelas** — CRUD kelas + pilih kelas aktif
- **Mahasiswa** — CRUD global, tambah ke kelas aktif (dedupe NIM, nomor absen otomatis), Import Excel
- **Pertemuan & Absensi** — pertemuan per kelas aktif, absensi massal Hadir/Izin/Sakit/Alpha/Terlambat, % kehadiran
- **Penilaian** — komponen bobot (total wajib 100%), input nilai massal, nilai akhir + huruf, **Export SIAKAD**
- **Materi & Tugas** — materi terkait pertemuan, tugas + deadline, pengumpulan tugas per mahasiswa
- **Halaman Mahasiswa** *(baru di v2)* — halaman publik hanya-baca per kelas lewat link/QR (menu Kelas → tombol **🔗 Bagikan**): mahasiswa melihat info kelas, jadwal & topik pertemuan, materi, dan tugas **tanpa login**; data mahasiswa, absensi, dan nilai tidak pernah ditampilkan
- **Rekap & Laporan** — ringkasan kelas, rekap kehadiran/nilai/mahasiswa/pertemuan, laporan lengkap siap cetak/PDF (A4 landscape)
- **Pengaturan** — tahun akademik, Backup/Restore JSON online, Reset Semester
- **Tentang** — ringkasan aplikasi & fitur

Teknologi: **Next.js (App Router + TypeScript)** di **Vercel**, database +
login di **Supabase** (PostgreSQL + Supabase Auth). Semua data hanya bisa
diakses oleh user yang sudah login — kebijakan RLS di database menolak akses
publik/anon.

> Berbeda dari versi desktop (offline, SQLite): lampiran file lokal diganti
> **tautan file** (`file_url` + `file_name`, mis. Google Drive), dan backup
> `.db` diganti **Export/Import JSON** dari menu Pengaturan.

---

## Cara Deploy (Gratis)

### 1. Buat proyek Supabase BARU bernama `smart-class`

1. Buka [supabase.com](https://supabase.com) → **New project** → beri nama
   **`smart-class`**, buat password database (simpan baik-baik), pilih region
   terdekat (Singapore) → tunggu sampai project selesai dibuat.
   > Gunakan proyek BARU yang terpisah — jangan memakai proyek Supabase milik
   > Dashboard Sekolah Premium.
2. Buka menu **SQL Editor → New query**, salin **seluruh isi** file
   `supabase/schema.sql` dari repositori ini, lalu klik **Run**.
   Ini membuat semua tabel (dosen, tahun_akademik, mata_kuliah, kelas,
   mahasiswa, anggota_kelas, pertemuan, absensi, komponen_nilai, nilai,
   materi, tugas, pengumpulan_tugas, pengaturan, profiles), keamanan RLS,
   dan pengaturan awal (nama aplikasi "Smart Class", institusi "IAI DDI Maros").
   File ini aman dijalankan berulang (idempotent).

### 2. Buat user Auth pertama

1. Di Supabase buka **Authentication → Users → Add user → Create new user**.
2. Isi email + password untuk akun dosen/pemilik, centang
   **Auto Confirm User** bila tersedia, lalu simpan.
   User inilah yang dipakai untuk login pertama kali ke Smart Class Online.

### 3. Buat repo GitHub baru `ocank/smart-class` dan upload isi proyek

1. Buka [github.com](https://github.com) → **New repository** → beri nama
   **`smart-class`** pada akun **ocank** → **Create repository**.
2. Upload **seluruh isi folder proyek ini** (termasuk folder `public/` yang
   berisi `templates-siakad/`, folder `src/`, folder `supabase/`,
   `package.json`, `package-lock.json`, `VERSION.txt`, dll.) ke repo itu.
   Jangan upload folder `node_modules/` atau `.next/` (sudah diabaikan oleh
   `.gitignore`).

### 4. Import ke Vercel + isi environment variable

1. Buka [vercel.com](https://vercel.com) → **Add New → Project** → import
   repositori GitHub `ocank/smart-class` → framework akan terdeteksi sebagai
   Next.js, jangan ubah apa pun dulu.
2. Pada bagian **Environment Variables**, tambahkan dua variabel.
   Ambil nilainya dari Supabase proyek `smart-class`:
   **Project Settings → API**.

   | Nama | Nilai |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL — contoh `https://abcdefgh.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **publishable key** — nilai `sb_publishable_...` (nama baru untuk anon key) dari Project Settings → API |

3. Klik **Deploy** dan tunggu sampai selesai. Aplikasi live di alamat seperti
   `https://smart-class-xxxx.vercel.app`.

> Bila suatu saat mengganti env variable di Vercel, lakukan **Redeploy**
> (Deployments → titik tiga → Redeploy) agar nilai baru dipakai. Tanpa env,
> aplikasi menampilkan layar "MODE SETUP" (bukan error) sebagai petunjuk.

### 5. Tes login & checklist fitur

Login dengan user Auth dari langkah 2, lalu cek berurutan:

- [ ] **Pengaturan** → buat Tahun Akademik (mis. 2026/2027 — Ganjil) → **Jadikan Aktif**
- [ ] **Profil Dosen** → tambah profil dosen → **Jadikan Aktif**
- [ ] **Mata Kuliah** → tambah mata kuliah (isi Kode, Semester 1–8, dan Prodi — wajib untuk Export SIAKAD)
- [ ] **Kelas** → tambah kelas → **Pilih Aktif** (atau pilih lewat bilah Kelas Aktif di atas)
- [ ] **Mahasiswa** → tambah manual / **Import Excel** → **+ Kelas Aktif** (nomor absen otomatis)
- [ ] **Pertemuan & Absensi** → tambah pertemuan → **Isi Absensi** → Simpan
- [ ] **Penilaian** → buat komponen sampai total bobot **tepat 100%** → input nilai → cek Nilai Akhir & Huruf
- [ ] **Penilaian → Export SIAKAD** → file `Nilai_SIAKAD_{PRODI}_{kodekelas}.xlsx` terunduh
- [ ] **Materi & Tugas** → tambah materi (tautan file) & tugas → isi Pengumpulan
- [ ] **Rekap & Laporan** → Pratinjau laporan → Cetak / Simpan PDF
- [ ] **Pengaturan → Export Backup JSON** → file backup terunduh
- [ ] Klik foto/inisial di sidebar → ganti **Foto Profil Akun** → tersimpan

---

## 🔄 Pembaruan v2026-10-28-v9 — Asisten AI Panduan Penggunaan (Chatbot)

Fitur baru: **Asisten Smart Class** — chatbot AI di dalam aplikasi
yang menjawab pertanyaan tentang **cara menggunakan Smart Class**
berdasarkan Manual Book. Murni fitur panduan; asisten **tidak**
memiliki akses ke data mahasiswa/nilai/absensi siapa pun.

**Cara tampilnya:** setelah login (dosen maupun admin), muncul
tombol chat 💬 melayang di pojok kanan bawah. Klik untuk membuka
panel "Asisten Smart Class — Panduan penggunaan aplikasi"
beserta chip pertanyaan cepat (input absensi, export SIAKAD,
pengumpulan tugas mahasiswa, bagikan tautan kelas, beda akun
Dosen/Admin). Tanpa kunci API, panel tetap tampil tetapi
menjawab dengan pesan ramah bahwa asisten belum diaktifkan.

**Arsitektur:**

- UI: `src/components/AsistenChat.tsx`, dirender dari
  `SmartClassApp.tsx` hanya setelah login (kedua peran).
- Server: route `POST /api/asisten`
  (`src/app/api/asisten/route.ts`, runtime nodejs) memanggil
  Gemini REST (`gemini-2.5-flash:generateContent`) via `fetch`
  — tanpa SDK/dependensi baru. Batas: 10 pesan terakhir,
  maks 1200 karakter per pesan; payload tidak valid → 400;
  kunci belum dipasang → 503 `{error:"not_configured"}`;
  gangguan upstream → 502 tanpa membocorkan detail.
- Pengetahuan: `src/lib/asisten-pengetahuan.ts` merangkai
  persona + ringkasan panduan lengkap (dari Manual Book Edisi
  v5 + fitur v8) + aturan ketat: hanya menjawab dari panduan,
  menyebut nama menu persis, maks ±250 kata, menolak topik di
  luar aplikasi, dan mengarahkan ke Manual Book / WhatsApp
  pengembang 0823-4555-5534 bila di luar jangkauan.

**Langkah deploy v9:**

1. Upload seluruh isi paket ke GitHub (timpa file lama) —
   **tanpa migrasi SQL baru**; folder `supabase/` tidak berubah.
2. Buat kunci API di **Google AI Studio**:
   `aistudio.google.com` → **Get API key** → **Create API key**
   → salin kuncinya.
3. Di Vercel: **Settings → Environment Variables** → tambah
   `GEMINI_API_KEY` = kunci tadi (**TANPA** awalan
   `NEXT_PUBLIC_`, berlaku untuk semua environment). Kunci ini
   rahasia: jangan dibagikan ke siapa pun, jangan masuk
   GitHub/chat.
4. Redeploy (deploy ulang dari commit terbaru), lalu Ctrl+F5.
5. Uji: login → buka panel Asisten → klik chip "Cara export
   nilai ke SIAKAD?" dan pastikan jawaban menyebut menu
   Penilaian dan prasyarat bobot 100%.

Self-check paket: baris pertama `VERSION.txt` adalah
**`SMART CLASS ONLINE v2026-10-28-v9`**, versi di
`package.json` adalah **1.6.0**, teks **`Asisten Smart Class`**
ada di `src/components/AsistenChat.tsx`, dan
`src/components/SmartClassApp.tsx` memuat **`AsistenChat`**
(import + render) serta kartu Tentang **`Asisten AI (v9)`**.

---

## 🔄 Pembaruan v2026-10-28-v9.0.2 — Rantai Model Cadangan Asisten

Perbaikan mikro route `/api/asisten` — **tanpa perubahan
perilaku lain, tanpa migrasi SQL baru**, menggantikan paket
v9.0.1. Diagnosis live v9.0.1 menunjukkan `404 NOT_FOUND`:
kunci API valid dan Gemini API aktif, tetapi model
`gemini-2.5-flash` tidak tersedia untuk kunci/proyek itu.

- Route kini mencoba `DAFTAR_MODEL` **berurutan**:
  `gemini-2.5-flash` → `gemini-flash-latest` →
  `gemini-2.5-flash-lite` → `gemini-2.0-flash`; respons OK
  pertama langsung menjadi `{reply}`.
- Jatuh ke model berikutnya **hanya pada 404**; error lain
  (400 kunci tidak valid, 403, 429 kuota) dan kegagalan
  fetch (`FETCH_FAILED`) langsung dilaporkan dengan format
  diagnostik v9.0.1 (`upstream_status` + `upstream_code`).
- Bila semua model 404, klien menerima error terakhir
  (404 `NOT_FOUND`).

Self-check paket: baris pertama `VERSION.txt` adalah
**`SMART CLASS ONLINE v2026-10-28-v9.0.2`**, versi di
`package.json` adalah **1.6.2**, teks **`gemini-flash-latest`**
ada di `src/app/api/asisten/route.ts`.

---

## 🔄 Pembaruan v2026-10-28-v9.0.1 — Diagnostik Error Asisten

Perbaikan mikro khusus **diagnostik** route `/api/asisten` —
**tanpa perubahan perilaku lain, tanpa migrasi SQL baru**,
menggantikan paket v9. Kegagalan panggilan Gemini kini bisa
dibaca penyebab pastinya:

- Bila respons Gemini tidak OK: route mencatat satu baris
  `asisten-upstream` (status HTTP + `error.status` Google +
  potongan pesan, maks 200 karakter) ke log server, dan klien
  menerima `502 {error:"upstream", upstream_status:<angka>,
  upstream_code:<kode Google>}`.
- Bila fetch-nya sendiri gagal (jaringan/timeout): dicatat
  sebagai `asisten-fetch-failed` dan klien menerima
  `502 {error:"upstream", upstream_status:0,
  upstream_code:"FETCH_FAILED"}`.
- Kunci API tidak pernah ditulis ke log maupun respons.

Self-check paket: baris pertama `VERSION.txt` adalah
**`SMART CLASS ONLINE v2026-10-28-v9.0.1`**, versi di
`package.json` adalah **1.6.1**, teks **`Asisten Smart Class`**
ada di `src/components/AsistenChat.tsx`.

---

## 🔄 Pembaruan v2026-10-27-v8.2.1 — Perbaikan "Invalid Date" di Monitoring

Perbaikan mikro khusus tampilan Monitoring Dosen — **murni
frontend, tanpa migrasi SQL baru**, menggantikan paket v8.2.

**Yang diperbaiki:** pada daftar Pengumpulan Mahasiswa di
Monitoring, kolom Waktu Kumpul untuk pengumpulan online sempat
tampil **"Invalid Date"** karena nilai waktunya tersimpan
sebagai teks tampilan lokal (dari RPC pengumpulan online)
yang tidak bisa diolah `new Date(...)`. Sekarang kolom itu —
dan kolom Deadline tugas di blok Monitoring — memakai helper
aman `fmtTanggalWaktu`: nilai yang valid diformat id-ID
seperti biasa, nilai yang tidak bisa diolah ditampilkan apa
adanya sebagai teks (sama seperti tampilan sisi dosen), nilai
kosong tampil "-". Tidak ada perubahan data, skema, atau
perilaku peran dosen.

**Langkah deploy v8.2.1:** sama seperti v8.2 — upload seluruh
isi paket ke GitHub (timpa file lama), tunggu Vercel, Ctrl+F5.

Self-check paket: baris pertama `VERSION.txt` adalah
**`SMART CLASS ONLINE v2026-10-27-v8.2.1`**, versi di
`package.json` adalah **1.5.3**, dan di
`src/components/SmartClassApp.tsx` ada teks **`Monitoring Dosen`**
serta **`fmtTanggalWaktu`**.

---

## 🔄 Pembaruan v2026-10-27-v8.2 — Daftar Pengumpulan Mahasiswa di Monitoring

Penyempurnaan kecil khusus Admin — **murni frontend, tanpa
migrasi SQL baru**. Paket ini **menggantikan paket v8.1** (yang
belum pernah di-deploy), jadi dari v8 langsung naik ke v8.2.

**Yang baru:**

1. **Daftar pengumpulan per tugas di Monitoring Dosen**: pada
   detail kelas (Mode Pantau), setiap tugas kini menampilkan
   daftar **Pengumpulan Mahasiswa** tepat di bawah baris
   tugasnya — nama mahasiswa + NIM, waktu kumpul, status
   pengumpulan (Belum Dinilai / Sudah Dinilai / Terlambat),
   nilai bila sudah dinilai, dan tautan file kiriman mahasiswa
   yang bisa diklik untuk mengunduh/membuka. Bila belum ada
   kiriman, tertulis "Belum ada pengumpulan."
2. Tetap **100% hanya-lihat**: tidak ada tombol/input/aksi
   tulis baru; badge **"Mode Pantau — Hanya Lihat"** tetap
   tampil di setiap level Monitoring.

**Langkah deploy v8.2 (dari v8):** sama persis dengan langkah
v8.1 di bawah — upload seluruh isi paket ke GitHub (timpa file
lama), tunggu Vercel, Ctrl+F5. Tidak ada file SQL yang perlu
dijalankan.

Self-check paket: baris pertama `VERSION.txt` adalah
**`SMART CLASS ONLINE v2026-10-27-v8.2`**, versi di
`package.json` adalah **1.5.2**, dan di
`src/components/SmartClassApp.tsx` ada teks **`Monitoring Dosen`**
serta **`Pengumpulan Mahasiswa`**.

---

## 🔄 Pembaruan v2026-10-27-v8.1 — Monitoring Dosen (Admin)

Tambahan antarmuka khusus Admin — **murni frontend, tanpa
migrasi SQL baru**. Skema, RLS, dan fungsi publik sama persis
dengan v8.

**Yang baru:**

1. **Menu admin "Monitoring Dosen"** (di antara Dashboard Admin
   dan Manajemen Akun Dosen). Daftar dosen kini dilengkapi
   ringkasan per dosen: jumlah kelas, pertemuan terlaksana dari
   total pertemuan, rata-rata % kehadiran, jumlah materi dan
   tugas.
2. **Drill-down hanya-lihat per dosen → kelas → detail kelas**:
   pertemuan (tanggal, topik, status), materi yang diajarkan
   (judul + tautan file), tugas yang diberikan (deadline, bobot,
   jumlah pengumpulan + rincian status dinilai/terlambat/belum),
   daftar mahasiswa peserta, rekap kehadiran per mahasiswa, dan
   rekap nilai per komponen (nilai akhir & huruf hanya tampil
   bila total bobot komponen kelas tepat 100%).
3. **Pagar hanya-lihat ditegakkan keras**: tidak ada tombol
   tambah/edit/hapus/simpan dan tidak ada form pada seluruh
   tampilan Monitoring; setiap level ditandai badge
   **"Mode Pantau — Hanya Lihat"**. Ini melengkapi RLS v8 yang
   memang hanya memberi admin hak SELECT atas data dosen.

**Langkah deploy v8.1 (dari v8):**

1. **Upload seluruh isi paket ini ke GitHub** seperti biasa
   (timpa file lama). Tidak ada file SQL yang perlu dijalankan.
2. Tunggu Vercel selesai deploy, lalu **Ctrl+F5**.
3. **Verifikasi**: masuk sebagai admin → menu **Monitoring
   Dosen** harus muncul; buka satu dosen lalu satu kelas dan
   pastikan detailnya tampil tanpa tombol edit apa pun. Bila
   menu belum muncul, bundle lama masih tersaji — uji di
   jendela privat/incognito.

Self-check paket: baris pertama `VERSION.txt` adalah
**`SMART CLASS ONLINE v2026-10-27-v8.1`**, versi di
`package.json` adalah **1.5.1**, dan di
`src/components/SmartClassApp.tsx` ada teks **`Monitoring Dosen`**.

---

## 🔄 Pembaruan v2026-10-27-v8 — Multi-Akun Dua Peran (Dosen & Admin)

Pembaruan arsitektur terbesar sejak rilis: aplikasi tidak lagi
satu dataset bersama untuk semua akun login.

**Perubahan konsep:**

1. **Setiap akun dosen punya data sendiri.** Semua tabel kini
   memiliki `owner_id`; RLS memastikan dosen hanya bisa membaca
   dan mengubah baris miliknya. Konteks aplikasi adalah akun
   sendiri — penunjuk global "dosen aktif" dihapus, "kelas aktif"
   dan "tahun aktif" kini tersimpan per pengguna.
2. **Peran Admin (Rektor/Admin kampus).** Akun admin masuk ke
   **Dashboard Admin** (jumlah dosen, kelas, mahasiswa, rata-rata
   kehadiran, distribusi nilai huruf agregat, ringkasan per dosen)
   dan **Manajemen Akun Dosen** (buat akun dosen, reset password,
   nonaktifkan/aktifkan, lepas/tautkan profil). Admin hanya
   *membaca* data dosen — tidak bisa menulis kelas, absensi,
   nilai, dan data kerja dosen lainnya.
3. **Backup/Restore JSON dan Reset Semester kini hanya menyentuh
   data milik akun yang sedang login.** Halaman Mahasiswa
   (`/m/[token]`) dan pengumpulan tugas online tetap bekerja
   seperti sebelumnya.
4. **Perbaikan cetak Rekap & Laporan.** Yang tercetak kini hanya
   dokumen laporan formalnya — kartu pemilih laporan, tombol
   Pratinjau, judul/meta view, dan tabel pratinjau layar tidak
   lagi ikut tercetak sebagai halaman pertama PDF.

**Langkah deploy v8 (urutan wajib):**

1. **Backup dulu** — dari aplikasi versi lama: Pengaturan →
   Export Backup JSON. Simpan file-nya di tempat aman.
2. **Jalankan migrasi** `supabase/migrasi-v8-multi-akun.sql` di
   Supabase SQL Editor (seluruh file, sekali Run). Semua data lama
   otomatis menjadi milik akun `nurfauzan79@gmail.com`.
3. **Deploy Edge Function** `create-lecturer-account`:
   Supabase → Edge Functions → Create a new function → nama
   `create-lecturer-account` → tempel isi
   `supabase/functions/create-lecturer-account/index.ts` → Deploy.
4. **Upload seluruh isi paket ini ke GitHub** seperti biasa
   (termasuk `supabase/functions/` dan file migrasi), tunggu
   Vercel selesai deploy, lalu Ctrl+F5.
5. **Tetapkan admin pertama** (bila ingin akun Rektor/Admin):
   buat user-nya di Authentication → Users, lalu jalankan potongan
   SQL "MENETAPKAN ADMIN PERTAMA" di akhir file migrasi v8.
6. **Verifikasi dua akun**: masuk sebagai dosen → data lama utuh
   dan menu lengkap; masuk sebagai admin → yang tampil hanya
   Dashboard Admin + Manajemen Akun Dosen + Tentang.

Self-check paket: baris pertama `VERSION.txt` adalah
**`SMART CLASS ONLINE v2026-10-27-v8`** dan versi di
`package.json` adalah **1.5.0**.

---

## 🔄 Pembaruan v2026-10-26-v7 — Tanda Tangan Atasan + Dashboard Monitoring

Dua peningkatan — **tanpa migrasi SQL**:

**A. Dashboard monitoring (baru).** Dashboard kelas aktif kini
menampilkan diagram batang **Kehadiran per Pertemuan** dan diagram
lingkaran **Distribusi Nilai Huruf** (kelompok A/B/C/D/E + legenda).
Tidak ada yang perlu diatur — grafik terisi otomatis dari data
absensi dan nilai yang sudah ada.

**B. Blok tanda tangan atasan pada laporan.** Kaki laporan cetak
kini resmi dan bisa diatur:

1. Di menu **Pengaturan → Tanda Tangan Laporan**, isi **Jabatan
   Atasan** (mis. "Rektor IAI DDI Maros" atau "Ketua Program Studi
   PAI"), **Nama Atasan**, **NIDN Atasan** (opsional), dan **Kota
   Tanda Tangan** (bawaan: Maros), lalu **Simpan Tanda Tangan**.
2. Buka **Rekap & Laporan → Pratinjau**: blok kiri kini
   "Mengetahui, — {jabatan atasan}" dengan nama atasan bergaris
   bawah + NIDN; blok kanan "{Kota}, {tanggal} — Dosen Pengampu,"
   dengan nama + NIDN dosen kelas. Blok lama "Dicetak pada /
   {Nama Aplikasi} Online" menjadi catatan kecil di bawah dokumen.
3. Bila Nama Atasan dikosongkan, blok Mengetahui tidak tampil.
4. Upload 2 file yang berubah: `src/components/SmartClassApp.tsx`
   dan `src/app/globals.css` (atau seluruh isi paket seperti
   biasa). Setelah deploy, Ctrl+F5 lalu periksa Pengaturan dan
   pratinjau laporan.

---

## 🔄 Pembaruan v2026-10-26-v6 — Logo Smart Class & Kredit Manrapi EduTech

Pembaruan tampilan (branding) — **tanpa migrasi SQL**:

1. **Logo Smart Class baru** di halaman login, menggantikan lencana
   teks "SC": topi wisuda emas di atas buku terbuka pada plakat
   gradasi navy–biru (file `public/logo-smartclass.png`).
2. **Kredit pengembang** "Dikembangkan oleh [logo] Manrapi EduTech"
   di kaki halaman login dan di menu **Tentang**
   (file `public/logo-manrapi.png`).
3. Upload 5 file yang berubah: `src/app/login/page.tsx`,
   `src/components/SmartClassApp.tsx`, `src/app/globals.css`,
   `package.json`, dan 2 logo baru di `public/`
   (`logo-smartclass.png`, `logo-manrapi.png`) — atau upload seluruh
   isi paket seperti biasa. Setelah deploy, buka `/login` dengan
   Ctrl+F5: logo baru tampil di atas tulisan "Smart Class Online"
   dan kredit Manrapi EduTech tampil di kaki halaman.

---

## 🔄 Pembaruan v2026-10-26-v5 — Pengumpulan Tugas Online

Mahasiswa kini bisa **mengumpulkan tugas langsung dari Halaman
Mahasiswa** (link publik per kelas), tanpa login:

1. **Jalankan migrasi dulu:** buka Supabase proyek `smart-class` →
   SQL Editor → tempel seluruh isi
   **`supabase/migrasi-v5-pengumpulan-online.sql`** → Run.
   (Menambah fungsi `kumpul_tugas_mahasiswa` dan memperbarui
   `halaman_mahasiswa` agar menyertakan id tugas.)
2. Upload ke repo GitHub `smart-class`: `src/app/m/[token]/page.tsx`,
   `src/app/globals.css`, `src/components/SmartClassApp.tsx`,
   `supabase/schema.sql`, `supabase/migrasi-v5-pengumpulan-online.sql`,
   `package.json`, `package-lock.json`, `VERSION.txt`, `README.md`.
3. Tunggu deploy Vercel selesai, **Ctrl+F5**.

Cara kerjanya: setiap tugas di halaman publik punya tombol
**📤 Kumpulkan Tugas**. Mahasiswa mengisi NIM, nama lengkap, dan
tautan file (mis. Google Drive). Server memeriksa NIM + nama harus
cocok dengan anggota aktif kelas — daftar mahasiswa tidak pernah
ditampilkan ke publik. Kirim ulang menimpa kiriman lama selama
belum dinilai; lewat deadline tercatat **Terlambat** (waktu WITA).
Hasilnya muncul di sisi dosen pada **Materi & Tugas → Pengumpulan**,
lengkap dengan waktu kirimnya, dan dinilai seperti biasa.

## 🔄 Pembaruan v2026-10-26-v4 — Ikon Tanggal/Jam Diperkuat

Glyph pemilih tanggal/jam bawaan Chrome sangat pucat walau sudah
diberi opacity di v3. Di v4 siluet ikon dipaksa hitam
(`filter: brightness(0)`, opacity 0,62 + hover) di
**`src/app/globals.css`** — satu-satunya file aplikasi yang berubah.
Upload file itu (+ `VERSION.txt`, `README.md`) ke repo GitHub
`smart-class`, tunggu deploy Vercel, **Ctrl+F5**, lalu cek ikon jam di
form Edit Kelas / Tambah Pertemuan. Tanpa migrasi SQL.

## 🔄 Pembaruan v2026-10-26-v3 — Perbaikan 4 Bug Uji Coba

Perbaikan: (1) Export SIAKAD corrupt (tag `<calcPr/>` self-closing di
workbook.xml rusak saat disetel — sudah diperbaiki & teruji lokal),
(2) kolom **Keterangan** pada absensi, (3) kontras ikon kalender/jam,
(4) klarifikasi tombol Bagikan v2 (cache tab lama — tekan Ctrl+F5).

**Tidak ada migrasi SQL untuk v3.** Cukup upload/timpa file ini ke repo
GitHub `smart-class`:

- `src/lib/siakad.ts`
- `src/components/SmartClassApp.tsx`
- `src/app/globals.css`
- `package.json` dan `package-lock.json`
- `VERSION.txt` dan `README.md`

Setelah Vercel selesai deploy, **tekan Ctrl+F5** di tab aplikasi, lalu
retes: Export SIAKAD harus terbuka di Excel; Isi Absensi punya kolom
Keterangan; ikon kalender/jam di form Tambah Pertemuan tampak jelas;
kartu Kelas punya tombol **🔗 Bagikan**.

## 🔄 Pembaruan v2026-10-26-v2 — Halaman Mahasiswa (untuk yang sudah deploy v1)

Lakukan 3 langkah ini berurutan:

### Langkah A — Jalankan migrasi database (sekali saja)

1. Buka Supabase proyek **`smart-class`** → **SQL Editor → New query**.
2. Salin **seluruh isi** file `supabase/migrasi-v2-halaman-mahasiswa.sql`
   dari paket ini, lalu klik **Run**. Harus berhasil tanpa pesan error.
   (File ini menambahkan kolom berbagi di tabel kelas + fungsi publik
   `halaman_mahasiswa`. Aman dijalankan berulang.)

### Langkah B — Upload file yang berubah ke repo GitHub `smart-class`

Upload/timpa file-file ini dari paket v2 (struktur folder dipertahankan):

- `package.json` dan `package-lock.json` *(ada dependency baru: `qrcode`)*
- `src/lib/types.ts`
- `src/components/SmartClassApp.tsx`
- `src/app/globals.css`
- `src/app/m/[token]/page.tsx` *(file baru — buat folder `src/app/m/[token]`)*
- `supabase/schema.sql` dan `supabase/migrasi-v2-halaman-mahasiswa.sql`
- `VERSION.txt` dan `README.md`

Vercel akan otomatis men-deploy ulang setelah upload selesai.

### Langkah C — Tes Halaman Mahasiswa

- [ ] Login → menu **Kelas** → pada kartu kelas ada tombol **🔗 Bagikan**
- [ ] Klik **🔗 Bagikan** → **Aktifkan Link Mahasiswa** → link + QR muncul
- [ ] Klik **Salin**, lalu buka link-nya di jendela **penyamaran/incognito**
      (atau HP lain) — halaman kelas terbuka **tanpa login**, berisi info
      kelas, tugas, materi, dan jadwal pertemuan
- [ ] Coba **Nonaktifkan** → link lama menampilkan pesan "Tautan tidak aktif"

## ✅ Self-Check Sebelum Upload

Lakukan cek ini pada folder hasil ekstrak ZIP **sebelum** upload ke GitHub,
agar tidak tertukar dengan versi lama:

1. Buka file **`VERSION.txt`** di root folder — isinya harus diawali
   **`SMART CLASS ONLINE v2026-10-27-v8.2`**.
2. Buka **`src/components/SmartClassApp.tsx`** — tekan Ctrl+F dan
   cari teks **`Monitoring Dosen`** dan **`Pengumpulan Mahasiswa`**.
   Keduanya harus ketemu (fitur v8.1 + penyempurnaan v8.2). Bila
   tidak ketemu, Anda membuka folder yang salah/versi lama —
   ekstrak ulang ZIP `smart-class-online-v2026-10-27-v8.2.zip`
   ke folder baru.
3. Pastikan file **`supabase/migrasi-v8-multi-akun.sql`** ada, dan
   folder **`supabase/functions/create-lecturer-account/`** berisi
   **`index.ts`** (Edge Function baru v8).
4. Pastikan folder **`public/`** berisi **`logo-smartclass.png`** dan
   **`logo-manrapi.png`**, dan folder **`public/templates-siakad/`**
   berisi 4 file: `PAI.xlsx`, `PGMI.xlsx`, `HKI.xlsx`, `ESy.xlsx`.
5. Ekstrak ZIP ke **folder baru** (jangan menimpa ekstraksi lama), upload dari
   folder baru itu, lalu hapus ZIP & folder lama agar tidak tertukar.

Marker unik build ini: teks **`Monitoring Dosen`**,
**`Mode Pantau`**, dan **`Pengumpulan Mahasiswa`** di
`src/components/SmartClassApp.tsx`,
teks **`owner select`** di `supabase/migrasi-v8-multi-akun.sql`,
serta baris pertama `VERSION.txt` = `SMART CLASS ONLINE v2026-10-27-v8.2`.

---

## Export Nilai SIAKAD

Fitur khas Smart Class, setia pada kontrak versi desktop:

- Template resmi per prodi di `public/templates-siakad/` **tidak pernah
  ditulis ulang** dengan SheetJS. Export bekerja client-side di browser
  memakai **JSZip**: template di-unzip, lalu **hanya sheet semester yang
  sesuai** yang di-patch pada level XML (style cell dipertahankan, teks
  sebagai `inlineStr`, angka sebagai angka, `fullCalcOnLoad` disetel pada
  workbook), lalu di-zip kembali dan diunduh.
- Deteksi prodi: **PGMI** kode `86232`, **PAI** kode `86208`,
  **Ekonomi Syariah** kode `60206`, **HKI / Hukum Keluarga Islam** kode `74230`.
- Semester 1–8 diambil dari `mata_kuliah.semester`. Nama sheet target:
  PAI `SM n`, PGMI `PGMI{n}`, HKI `AS{n}`, Ekonomi Syariah `ESy{n}`.
- Baris data mulai baris 2: A=NIM, B=Nama, C=Kode MK, D=Nama MK,
  E=Kode Semester SIAKAD (tahun 4 digit + Ganjil=`2`, Genap=`1`, Pendek=`3`),
  F=Kode Kelas, G=Nilai Huruf, H=Nilai Indeks (A/A-=4, B+/B/B-=3, C+/C/C-=2,
  D=1, E=0), I=Nilai Angka (nilai akhir), J=Kode Prodi, K=Nama Prodi.
- Export **ditolak** bila total bobot komponen ≠ 100%.
- Skala huruf: A ≥ 85, A- ≥ 80, B+ ≥ 75, B ≥ 70, B- ≥ 65, C+ ≥ 60, C ≥ 55,
  C- ≥ 50, D ≥ 40, E < 40.

## Penilaian

- Komponen nilai dibuat per kelas aktif; nilai akhir hanya dihitung dan
  Export SIAKAD hanya aktif bila total bobot **tepat 100%**.
- Input nilai massal 0–100 per mahasiswa per komponen, disimpan dengan
  `mahasiswa_id` asli mahasiswa (bukan id anggota kelas).

## Mahasiswa & Import Excel

- Data mahasiswa global; **Tambah ke kelas aktif** memasukkan mahasiswa ke
  kelas aktif dengan nomor absen otomatis berikutnya. Mahasiswa bisa
  **dikeluarkan** dari kelas aktif tanpa menghapus data globalnya.
- **Import Excel (.xlsx)**: kolom dikenali fleksibel — NIM, Nama,
  JK/Jenis Kelamin, Prodi, Angkatan, Email, HP. Ada pratinjau sebelum impor.
  Dedupe berdasarkan NIM: NIM yang sudah terdaftar langsung dipakai (tidak
  dibuat ganda) dan bisa langsung dimasukkan ke kelas aktif.

## Backup, Restore & Reset Semester

- **Backup Online**: menu Pengaturan → Export Backup JSON mengunduh seluruh
  data. **Import/Restore JSON** memvalidasi file, menghapus data saat ini,
  lalu memasukkan isi backup.
- **Reset Semester**: menghapus hanya data tahun akademik aktif — kelas +
  anggota, pertemuan + absensi, komponen + nilai, materi, tugas +
  pengumpulan. Data master **dosen, mahasiswa, dan mata kuliah dipertahankan**.
  Wajib konfirmasi ganda; sangat disarankan backup dulu.

## Foto Profil

Klik foto/inisial di sidebar untuk mengganti foto profil akun login. Foto
dosen juga bisa diatur di menu Profil Dosen. Keduanya dipotong persegi dan
diperkecil menjadi 256px JPEG (data URL) di browser lalu disimpan di
database — **tidak perlu Supabase Storage**. Foto akun disimpan di tabel
`profiles` (satu baris per user; RLS: hanya pemilik yang bisa menulis).

> ⚠️ **Catatan tier gratis Supabase:** project gratis akan **di-pause**
> bila tidak ada aktivitas dalam waktu lama (sekitar 1 minggu). Data **tidak
> hilang** — buka dashboard Supabase lalu klik **Restore / Unpause** untuk
> menghidupkannya lagi. Vercel Hobby dan GitHub gratis tidak mem-pause project.

## Pengembangan Lokal

```bash
npm install
cp .env.example .env.local   # lalu isi URL + publishable key Supabase Anda
npm run dev                  # buka http://localhost:3000
npm run build                # memastikan build produksi lolos
```

Tanpa `.env.local`, aplikasi tetap bisa di-build dan akan menampilkan layar
petunjuk setup berbahasa Indonesia (bukan error).

## Struktur Project

```
src/app/            Halaman: / (pengarah), /login, /dashboard, /m/[token] (Halaman Mahasiswa publik)
src/components/     SmartClassApp (semua modul), layar Setup
src/lib/            Client Supabase, tipe data, Export SIAKAD (siakad.ts)
supabase/schema.sql Skema database + RLS + data awal
public/templates-siakad/  Template SIAKAD: PAI, PGMI, HKI, ESy (.xlsx)
```
