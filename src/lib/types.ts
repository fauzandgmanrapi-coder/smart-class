export interface Dosen {
  id: number;
  nidn: string | null;
  nama: string;
  email: string | null;
  no_hp: string | null;
  prodi: string | null;
  fakultas: string | null;
  foto: string | null;
}

export interface TahunAkademik {
  id: number;
  tahun: string;
  semester: string; // Ganjil | Genap | Pendek
  aktif: number;
}

export interface MataKuliah {
  id: number;
  kode: string | null;
  nama: string;
  sks: number | null;
  semester: number | null;
  prodi: string | null;
  deskripsi: string | null;
}

export interface Kelas {
  id: number;
  kode_kelas: string;
  mata_kuliah_id: number;
  dosen_id: number;
  tahun_akademik_id: number;
  ruang: string | null;
  hari: string | null;
  jam_mulai: string | null;
  jam_selesai: string | null;
  kapasitas: number | null;
  status: string;
  deskripsi: string | null;
}

export interface Mahasiswa {
  id: number;
  nim: string;
  nama: string;
  jenis_kelamin: string | null;
  prodi: string | null;
  angkatan: number | null;
  email: string | null;
  no_hp: string | null;
  foto: string | null;
  status: string;
}

export interface AnggotaKelas {
  id: number;
  kelas_id: number;
  mahasiswa_id: number;
  status: string;
  nomor_absen: number | null;
}

export interface Pertemuan {
  id: number;
  kelas_id: number;
  pertemuan_ke: number;
  tanggal: string;
  jam_mulai: string | null;
  jam_selesai: string | null;
  topik: string | null;
  catatan: string | null;
  status: string;
}

export type StatusAbsensi = "Hadir" | "Izin" | "Sakit" | "Alpha" | "Terlambat";
export const STATUS_ABSENSI: StatusAbsensi[] = ["Hadir", "Izin", "Sakit", "Alpha", "Terlambat"];

export interface Absensi {
  id: number;
  pertemuan_id: number;
  mahasiswa_id: number;
  status: StatusAbsensi;
  waktu_absen: string | null;
  keterangan: string | null;
}

export interface KomponenNilai {
  id: number;
  kelas_id: number;
  nama: string;
  bobot: number;
}

export interface Nilai {
  id: number;
  kelas_id: number;
  mahasiswa_id: number;
  komponen_nilai_id: number;
  nilai_angka: number;
}

export interface Materi {
  id: number;
  kelas_id: number;
  pertemuan_id: number | null;
  judul: string;
  deskripsi: string | null;
  file_url: string | null;
  file_name: string | null;
}

export interface Tugas {
  id: number;
  kelas_id: number;
  judul: string;
  deskripsi: string | null;
  deadline: string | null;
  bobot: number | null;
  file_url: string | null;
  file_name: string | null;
}

export interface PengumpulanTugas {
  id: number;
  tugas_id: number;
  mahasiswa_id: number;
  waktu_kumpul: string | null;
  file_url: string | null;
  file_name: string | null;
  nilai: number | null;
  status: string; // Belum Dinilai | Sudah Dinilai | Terlambat
  catatan: string | null;
}

/** Skala nilai huruf resmi Smart Class (sama seperti versi desktop). */
export function nilaiHuruf(score: number): string {
  if (score >= 85) return "A";
  if (score >= 80) return "A-";
  if (score >= 75) return "B+";
  if (score >= 70) return "B";
  if (score >= 65) return "B-";
  if (score >= 60) return "C+";
  if (score >= 55) return "C";
  if (score >= 50) return "C-";
  if (score >= 40) return "D";
  return "E";
}

/** Nilai indeks SIAKAD dari huruf: A/A-=4, B+/B/B-=3, C+/C/C-=2, D=1, E=0. */
export function nilaiIndeks(letter: string): number | "" {
  const map: Record<string, number> = {
    A: 4, "A-": 4, "B+": 3, B: 3, "B-": 3,
    "C+": 2, C: 2, "C-": 2, D: 1, E: 0,
  };
  return map[letter] ?? "";
}
