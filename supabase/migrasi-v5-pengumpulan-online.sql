-- ============================================================
-- Smart Class Online v2026-10-26-v5 — Migrasi: Pengumpulan Tugas
-- Online lewat Halaman Mahasiswa.
-- Jalankan SELURUH file ini SEKALI di proyek Supabase "smart-class":
-- SQL Editor > New query > paste > Run.
-- File ini idempotent: aman dijalankan berulang.
-- (Mensyaratkan migrasi v2 sudah pernah dijalankan.)
--
-- Yang ditambahkan:
-- 1. halaman_mahasiswa() kini menyertakan id tugas (dipakai
--    formulir pengumpulan di halaman publik).
-- 2. Fungsi kumpul_tugas_mahasiswa(): mahasiswa mengumpulkan
--    tugas dari halaman publik TANPA login, dengan penjagaan:
--    - token kelas harus aktif;
--    - tugas harus milik kelas pemilik token;
--    - NIM + Nama harus cocok dengan anggota AKTIF kelas itu
--      (daftar mahasiswa TIDAK pernah ditampilkan ke publik —
--      fungsi hanya memeriksa kecocokan);
--    - tautan file wajib diawali http;
--    - pengumpulan ulang menimpa kiriman lama, KECUALI yang
--      sudah dinilai dosen (ditolak dengan pesan);
--    - lewat deadline -> status otomatis "Terlambat"
--      (deadline ditafsirkan sebagai waktu Asia/Makassar).
-- ============================================================

-- ---------- 1. halaman_mahasiswa: tambah id tugas ----------
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
          'id', t.id,
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

revoke all on function public.halaman_mahasiswa(text) from public;
grant execute on function public.halaman_mahasiswa(text) to anon, authenticated;

-- ---------- 2. Pengumpulan tugas dari halaman publik ----------
create or replace function public.kumpul_tugas_mahasiswa(
  p_token text,
  p_tugas_id bigint,
  p_nim text,
  p_nama text,
  p_file_url text,
  p_file_name text,
  p_catatan text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kelas_id bigint;
  v_mhs_id bigint;
  v_deadline text;
  v_existing public.pengumpulan_tugas%rowtype;
  v_status text := 'Belum Dinilai';
  v_now timestamptz := now();
  v_dl timestamptz;
begin
  -- Token harus menunjuk kelas yang link-nya aktif.
  select id into v_kelas_id
    from public.kelas
   where token_bagikan = p_token
     and bagikan_aktif is true
   limit 1;
  if v_kelas_id is null then
    return jsonb_build_object('sukses', false, 'pesan', 'Tautan kelas tidak aktif. Minta tautan terbaru kepada dosen Anda.');
  end if;

  -- Tugas harus milik kelas tersebut.
  select deadline into v_deadline
    from public.tugas
   where id = p_tugas_id and kelas_id = v_kelas_id;
  if not found then
    return jsonb_build_object('sukses', false, 'pesan', 'Tugas tidak ditemukan untuk kelas ini.');
  end if;

  -- NIM + Nama harus cocok dengan anggota AKTIF kelas (tanpa
  -- pernah menampilkan daftar mahasiswa ke publik).
  select m.id into v_mhs_id
    from public.mahasiswa m
    join public.anggota_kelas a on a.mahasiswa_id = m.id
   where a.kelas_id = v_kelas_id
     and a.status = 'Aktif'
     and replace(m.nim, ' ', '') = replace(coalesce(trim(p_nim), ''), ' ', '')
     and regexp_replace(lower(trim(m.nama)), '\s+', ' ', 'g')
         = regexp_replace(lower(trim(coalesce(p_nama, ''))), '\s+', ' ', 'g')
   limit 1;
  if v_mhs_id is null then
    return jsonb_build_object('sukses', false, 'pesan', 'NIM/Nama tidak cocok dengan daftar kelas. Tulis NIM dan nama lengkap persis seperti data kampus Anda.');
  end if;

  -- Tautan file wajib valid.
  if p_file_url is null or trim(p_file_url) = '' or trim(p_file_url) not ilike 'http%' then
    return jsonb_build_object('sukses', false, 'pesan', 'Tautan file wajib diisi dan harus diawali http (mis. tautan Google Drive).');
  end if;
  if length(p_file_url) > 1000 or length(coalesce(p_nama, '')) > 120
     or length(coalesce(p_nim, '')) > 30 or length(coalesce(p_catatan, '')) > 500 then
    return jsonb_build_object('sukses', false, 'pesan', 'Isian terlalu panjang. Periksa kembali tautan/catatan Anda.');
  end if;

  -- Kiriman yang sudah dinilai tidak boleh ditimpa dari publik.
  select * into v_existing
    from public.pengumpulan_tugas
   where tugas_id = p_tugas_id and mahasiswa_id = v_mhs_id;
  if found and v_existing.status = 'Sudah Dinilai' then
    return jsonb_build_object('sukses', false, 'pesan', 'Tugas Anda sudah dinilai dosen. Hubungi dosen bila perlu mengumpulkan ulang.');
  end if;

  -- Status terlambat bila melewati deadline (waktu Asia/Makassar).
  if v_deadline is not null and trim(v_deadline) <> '' then
    begin
      v_dl := (trim(v_deadline))::timestamp at time zone 'Asia/Makassar';
      if v_now > v_dl then
        v_status := 'Terlambat';
      end if;
    exception when others then
      v_dl := null; -- deadline teks tak terbaca: abaikan pemeriksaan
    end;
  end if;

  insert into public.pengumpulan_tugas
    (tugas_id, mahasiswa_id, waktu_kumpul, file_url, file_name, status, catatan)
  values
    (p_tugas_id, v_mhs_id,
     to_char(v_now at time zone 'Asia/Makassar', 'DD Mon YYYY • HH24:MI') || ' WITA',
     trim(p_file_url), nullif(trim(coalesce(p_file_name, '')), ''),
     v_status, nullif(trim(coalesce(p_catatan, '')), ''))
  on conflict (tugas_id, mahasiswa_id) do update
    set waktu_kumpul = excluded.waktu_kumpul,
        file_url = excluded.file_url,
        file_name = excluded.file_name,
        status = excluded.status,
        catatan = excluded.catatan;

  return jsonb_build_object(
    'sukses', true,
    'pesan', case
      when v_status = 'Terlambat'
        then 'Tugas terkirim, tercatat TERLAMBAT karena melewati deadline.'
      else 'Tugas berhasil dikumpulkan. Terima kasih!'
    end
  );
end;
$$;

revoke all on function public.kumpul_tugas_mahasiswa(text, bigint, text, text, text, text, text) from public;
grant execute on function public.kumpul_tugas_mahasiswa(text, bigint, text, text, text, text, text) to anon, authenticated;
