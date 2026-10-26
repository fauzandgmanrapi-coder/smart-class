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
   **`SMART CLASS ONLINE v2026-10-26-v2`**.
2. Buka **`package.json`** — tekan Ctrl+F dan cari kata **`qrcode`**.
   Harus ketemu (dependency baru v2 untuk QR Halaman Mahasiswa). Bila tidak
   ketemu, Anda membuka folder yang salah/versi lama — ekstrak ulang ZIP
   `smart-class-online-v2026-10-26-v2.zip` ke folder baru.
3. Pastikan folder **`public/templates-siakad/`** berisi 4 file:
   `PAI.xlsx`, `PGMI.xlsx`, `HKI.xlsx`, `ESy.xlsx`, dan ada file baru
   **`src/app/m/[token]/page.tsx`** serta
   **`supabase/migrasi-v2-halaman-mahasiswa.sql`**.
4. Ekstrak ZIP ke **folder baru** (jangan menimpa ekstraksi lama), upload dari
   folder baru itu, lalu hapus ZIP & folder lama agar tidak tertukar.

Marker unik build ini: string **`qrcode`** di `package.json` dan baris pertama
`VERSION.txt` = `SMART CLASS ONLINE v2026-10-26-v2`.

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
