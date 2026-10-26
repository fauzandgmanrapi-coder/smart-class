-- ============================================================
-- Smart Class Online v2026-10-26-v2 — Migrasi: Halaman Mahasiswa
-- Jalankan SELURUH file ini SEKALI di proyek Supabase "smart-class":
-- SQL Editor > New query > paste > Run.
-- File ini idempotent: aman dijalankan berulang.
--
-- Yang ditambahkan:
-- 1. Kolom token_bagikan (unik, boleh kosong) + bagikan_aktif
--    pada tabel kelas.
-- 2. Fungsi publik halaman_mahasiswa(token) yang HANYA
--    mengembalikan data aman untuk mahasiswa dari kelas pemilik
--    token: info kelas, mata kuliah, dosen, tahun akademik,
--    jadwal pertemuan & topik, daftar materi, dan daftar tugas.
--    Fungsi ini TIDAK PERNAH mengembalikan data mahasiswa lain,
--    absensi, nilai, atau pengumpulan tugas.
-- ============================================================

-- ---------- 1. Kolom berbagi pada tabel kelas ----------
alter table public.kelas add column if not exists token_bagikan text;
alter table public.kelas add column if not exists bagikan_aktif boolean not null default false;

create unique index if not exists kelas_token_bagikan_unik
  on public.kelas (token_bagikan);

-- ---------- 2. Fungsi publik (hanya-baca, terbatas token) ----------
create or replace function public.halaman_mahasiswa(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kelas public.kelas%rowtype;
begin
  if p_token is null or length(trim(p_token)) = 0 then
    return null;
  end if;

  select * into v_kelas
    from public.kelas
   where token_bagikan = p_token
     and bagikan_aktif is true
   limit 1;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'aplikasi', (
      select jsonb_build_object(
        'nama', coalesce(max(nilai) filter (where kunci = 'nama_aplikasi'), 'Smart Class'),
        'institusi', coalesce(max(nilai) filter (where kunci = 'institusi'), '')
      ) from public.pengaturan
    ),
    'kelas', jsonb_build_object(
      'kode_kelas', v_kelas.kode_kelas,
      'ruang', v_kelas.ruang,
      'hari', v_kelas.hari,
      'jam_mulai', v_kelas.jam_mulai,
      'jam_selesai', v_kelas.jam_selesai,
      'deskripsi', v_kelas.deskripsi,
      'status', v_kelas.status
    ),
    'mata_kuliah', (
      select jsonb_build_object(
        'kode', mk.kode, 'nama', mk.nama, 'sks', mk.sks,
        'semester', mk.semester, 'prodi', mk.prodi
      ) from public.mata_kuliah mk where mk.id = v_kelas.mata_kuliah_id
    ),
    'dosen', (
      select jsonb_build_object(
        'nama', d.nama, 'prodi', d.prodi, 'fakultas', d.fakultas
      ) from public.dosen d where d.id = v_kelas.dosen_id
    ),
    'tahun_akademik', (
      select jsonb_build_object('tahun', ta.tahun, 'semester', ta.semester)
      from public.tahun_akademik ta where ta.id = v_kelas.tahun_akademik_id
    ),
    'pertemuan', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'pertemuan_ke', p.pertemuan_ke,
          'tanggal', p.tanggal,
          'topik', p.topik,
          'status', p.status
        ) order by p.pertemuan_ke
      )
      from public.pertemuan p where p.kelas_id = v_kelas.id
    ), '[]'::jsonb),
    'materi', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'judul', m.judul,
          'deskripsi', m.deskripsi,
          'file_url', m.file_url,
          'file_name', m.file_name,
          'pertemuan_ke', pt.pertemuan_ke
        ) order by m.created_at desc
      )
      from public.materi m
      left join public.pertemuan pt on pt.id = m.pertemuan_id
      where m.kelas_id = v_kelas.id
    ), '[]'::jsonb),
    'tugas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'judul', t.judul,
          'deskripsi', t.deskripsi,
          'deadline', t.deadline,
          'bobot', t.bobot,
          'file_url', t.file_url,
          'file_name', t.file_name
        ) order by t.created_at desc
      )
      from public.tugas t where t.kelas_id = v_kelas.id
    ), '[]'::jsonb)
  );
end;
$$;

-- Fungsi hanya boleh dipanggil lewat RPC oleh anon & user login;
-- isi datanya tetap dibatasi oleh token di dalam fungsi.
revoke all on function public.halaman_mahasiswa(text) from public;
grant execute on function public.halaman_mahasiswa(text) to anon, authenticated;
