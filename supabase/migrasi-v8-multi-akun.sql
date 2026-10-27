-- ============================================================
-- Smart Class Online v2026-10-27-v8 — Migrasi: Multi-Akun Dua Peran
-- Jalankan SELURUH file ini SEKALI di proyek Supabase "smart-class":
-- SQL Editor > New query > paste > Run.
-- File ini diusahakan idempotent: aman dijalankan berulang.
--
-- LATAR BELAKANG
-- Versi <= v7 dirancang untuk SATU dosen: semua akun login berbagi
-- satu dataset yang sama dan satu penunjuk global "dosen aktif"
-- (pengaturan.dosen_aktif_id). Akibatnya akun kedua yang masuk
-- bisa menimpa konteks/profil dosen pertama (insiden 27 Okt 2026).
--
-- YANG DILAKUKAN MIGRASI INI
-- 1. Kolom owner_id (uuid akun Auth) ditambahkan ke SEMUA tabel
--    data. Setiap baris kini milik tepat satu akun dosen.
-- 2. Seluruh data lama di-backfill menjadi milik akun pemilik
--    pertama: nurfauzan79@gmail.com (uid diambil dari auth.users).
-- 3. Tabel profiles diperluas menjadi tabel penghubung akun:
--    user_id, role ('dosen' | 'admin'), dosen_id, aktif, photo.
-- 4. RLS ditulis ulang:
--      - dosen : CRUD hanya baris miliknya (owner_id = auth.uid())
--      - admin : SELECT semua data (monitoring) + mengelola
--                profiles, tetapi TIDAK bisa menulis tabel kerja
--                dosen (kelas, absensi, nilai, dst.)
-- 5. Batasan unik global diubah menjadi unik per pemilik
--    (dua dosen boleh punya NIM/kode MK/NIDN yang sama).
-- 6. Fungsi publik Halaman Mahasiswa (halaman_mahasiswa dan
--    kumpul_tugas_mahasiswa) disesuaikan agar TETAP bekerja
--    untuk pengunjung anon lewat token kelas.
-- 7. Trigger assign_owner_id mengisi owner_id otomatis dari
--    auth.uid() setiap kali akun dosen menyisipkan baris baru.
--
-- PRASYARAT: jalankan SETELAH migrasi v2 dan v5, dan setelah
-- membuat Export Backup JSON dari menu Pengaturan aplikasi.
-- ============================================================

-- ---------- 0. Pemeriksaan akun pemilik lama ----------
-- Migrasi berhenti dengan pesan jelas bila akun pemilik tidak ada.
do $$
begin
  if not exists (
    select 1 from auth.users where lower(email) = lower('nurfauzan79@gmail.com')
  ) then
    raise exception 'Akun nurfauzan79@gmail.com tidak ditemukan di auth.users. Buat dulu user itu di Authentication > Users, atau sesuaikan alamat email pada file migrasi ini.';
  end if;
end $$;

-- ---------- 1. Kolom owner_id di semua tabel data ----------
alter table public.dosen             add column if not exists owner_id uuid;
alter table public.tahun_akademik    add column if not exists owner_id uuid;
alter table public.mata_kuliah       add column if not exists owner_id uuid;
alter table public.kelas             add column if not exists owner_id uuid;
alter table public.mahasiswa         add column if not exists owner_id uuid;
alter table public.anggota_kelas     add column if not exists owner_id uuid;
alter table public.pertemuan         add column if not exists owner_id uuid;
alter table public.absensi           add column if not exists owner_id uuid;
alter table public.komponen_nilai    add column if not exists owner_id uuid;
alter table public.nilai             add column if not exists owner_id uuid;
alter table public.materi            add column if not exists owner_id uuid;
alter table public.tugas             add column if not exists owner_id uuid;
alter table public.pengumpulan_tugas add column if not exists owner_id uuid;
alter table public.pengaturan        add column if not exists owner_id uuid;

-- Indeks owner_id untuk menyaring RLS dengan cepat.
create index if not exists idx_dosen_owner             on public.dosen (owner_id);
create index if not exists idx_tahun_akademik_owner    on public.tahun_akademik (owner_id);
create index if not exists idx_mata_kuliah_owner       on public.mata_kuliah (owner_id);
create index if not exists idx_kelas_owner             on public.kelas (owner_id);
create index if not exists idx_mahasiswa_owner         on public.mahasiswa (owner_id);
create index if not exists idx_anggota_kelas_owner     on public.anggota_kelas (owner_id);
create index if not exists idx_pertemuan_owner         on public.pertemuan (owner_id);
create index if not exists idx_absensi_owner           on public.absensi (owner_id);
create index if not exists idx_komponen_nilai_owner    on public.komponen_nilai (owner_id);
create index if not exists idx_nilai_owner             on public.nilai (owner_id);
create index if not exists idx_materi_owner            on public.materi (owner_id);
create index if not exists idx_tugas_owner             on public.tugas (owner_id);
create index if not exists idx_pengumpulan_tugas_owner on public.pengumpulan_tugas (owner_id);
create index if not exists idx_pengaturan_owner        on public.pengaturan (owner_id);

-- ---------- 2. Tabel profiles menjadi tabel penghubung akun ----------
-- profiles lama hanya menyimpan foto profil per akun (user_id PK).
-- Kolom peran ditambahkan TANPA menghapus foto yang sudah ada.
alter table public.profiles
  add column if not exists role text not null default 'dosen';
alter table public.profiles
  add column if not exists dosen_id bigint references public.dosen(id) on delete set null;
alter table public.profiles
  add column if not exists aktif boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'profiles_role_check' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_role_check check (role in ('dosen', 'admin'));
  end if;
end $$;

-- ---------- 3. Backfill: semua data lama menjadi milik pemilik pertama ----------
do $$
declare
  v_owner uuid;
  t text;
begin
  select id into v_owner
    from auth.users
   where lower(email) = lower('nurfauzan79@gmail.com')
   limit 1;

  foreach t in array array[
    'dosen','tahun_akademik','mata_kuliah','kelas','mahasiswa',
    'anggota_kelas','pertemuan','absensi','komponen_nilai','nilai',
    'materi','tugas','pengumpulan_tugas','pengaturan'
  ] loop
    execute format('update public.%I set owner_id = $1 where owner_id is null', t)
      using v_owner;
    execute format('alter table public.%I alter column owner_id set not null', t);
  end loop;
end $$;

-- Profil akun pemilik pertama: peran dosen + tertaut ke profil
-- dosen yang dulu ditunjuk pengaturan.dosen_aktif_id (bila ada),
-- selain itu ke baris dosen pertama miliknya.
insert into public.profiles (user_id, photo, role, dosen_id, aktif)
select
  u.id,
  '',
  'dosen',
  coalesce(
    (select nullif(p.nilai, '')::bigint
       from public.pengaturan p
      where p.kunci = 'dosen_aktif_id' and p.owner_id = u.id
      limit 1),
    (select d.id from public.dosen d where d.owner_id = u.id order by d.id limit 1)
  ),
  true
from auth.users u
where lower(u.email) = lower('nurfauzan79@gmail.com')
on conflict (user_id) do nothing;

-- Bila baris profiles pemilik sudah ada sebelumnya (mis. hanya
-- berisi foto), lengkapi peran + tautan dosennya tanpa menimpa
-- tautan yang sudah terisi.
update public.profiles p
   set role = 'dosen',
       dosen_id = coalesce(
         p.dosen_id,
         (select nullif(s.nilai, '')::bigint
            from public.pengaturan s
           where s.kunci = 'dosen_aktif_id' and s.owner_id = p.user_id
           limit 1),
         (select d.id from public.dosen d where d.owner_id = p.user_id order by d.id limit 1)
       )
 where p.user_id = (select id from auth.users where lower(email) = lower('nurfauzan79@gmail.com') limit 1);

-- ---------- 4. Primary key pengaturan menjadi per pemilik ----------
-- Dulu: primary key (kunci) — satu nilai global untuk semua akun.
-- Kini: primary key (owner_id, kunci) — setiap dosen punya
-- pengaturannya sendiri (nama aplikasi, tanda tangan, dst.).
do $$
declare
  v_cols text;
begin
  select string_agg(a.attname, ',' order by k.ord)
    into v_cols
    from pg_index i
    join lateral unnest(i.indkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
   where i.indrelid = 'public.pengaturan'::regclass and i.indisprimary;

  if v_cols is distinct from 'owner_id,kunci' then
    alter table public.pengaturan drop constraint if exists pengaturan_pkey;
    alter table public.pengaturan add primary key (owner_id, kunci);
  end if;
end $$;

-- ---------- 5. Batasan unik per pemilik ----------
-- Nama constraint bawaan Postgres dari schema.sql awal. Bila pada
-- database Anda namanya berbeda, blok ini tetap aman (IF EXISTS)
-- dan constraint unik per pemilik di bawah tetap dibuat.
alter table public.dosen         drop constraint if exists dosen_nidn_key;
alter table public.mata_kuliah   drop constraint if exists mata_kuliah_kode_key;
alter table public.mahasiswa     drop constraint if exists mahasiswa_nim_key;
alter table public.tahun_akademik drop constraint if exists tahun_akademik_tahun_semester_key;
alter table public.kelas         drop constraint if exists kelas_kode_kelas_mata_kuliah_id_dosen_id_tahun_akademik_id_key;

create unique index if not exists dosen_owner_nidn_unik
  on public.dosen (owner_id, nidn);
create unique index if not exists mata_kuliah_owner_kode_unik
  on public.mata_kuliah (owner_id, kode);
create unique index if not exists mahasiswa_owner_nim_unik
  on public.mahasiswa (owner_id, nim);
create unique index if not exists tahun_akademik_owner_unik
  on public.tahun_akademik (owner_id, tahun, semester);
create unique index if not exists kelas_owner_unik
  on public.kelas (owner_id, kode_kelas, mata_kuliah_id, dosen_id, tahun_akademik_id);
-- Token Halaman Mahasiswa tetap unik global (dipakai pengunjung anon).
create unique index if not exists kelas_token_bagikan_unik
  on public.kelas (token_bagikan);

-- ---------- 6. Fungsi pembantu peran ----------
-- SECURITY DEFINER agar bisa membaca profiles tanpa terkena RLS
-- (pola yang sama dengan is_admin() di Dashboard Sekolah Premium).
-- Urutan penentuan peran:
--   1. profiles.role milik user yang login.
--   2. app_metadata.role pada JWT (diatur Edge Function / Supabase).
--   3. Bawaan: 'dosen'.
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.role from public.profiles p where p.user_id = auth.uid()),
    nullif(auth.jwt() -> 'app_metadata' ->> 'role', ''),
    'dosen'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.my_role() = 'admin';
$$;

-- ---------- 7. Trigger: owner_id otomatis + penjaga profiles ----------
-- Setiap INSERT oleh akun login yang tidak mengisi owner_id akan
-- diisi auth.uid(). Penulisan oleh service role (Edge Function)
-- mengisi owner_id secara eksplisit dan tidak diubah trigger ini.
create or replace function public.assign_owner_id()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id is null then
    new.owner_id := auth.uid();
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'dosen','tahun_akademik','mata_kuliah','kelas','mahasiswa',
    'anggota_kelas','pertemuan','absensi','komponen_nilai','nilai',
    'materi','tugas','pengumpulan_tugas','pengaturan'
  ] loop
    execute format('drop trigger if exists trg_assign_owner on public.%I', t);
    execute format(
      'create trigger trg_assign_owner before insert on public.%I
         for each row execute function public.assign_owner_id()', t);
  end loop;
end $$;

-- Akun non-admin TIDAK boleh mengubah role/dosen_id/aktif pada
-- profiles lewat API biasa (mis. hanya boleh mengganti foto).
-- Perubahan peran hanya oleh admin atau service role (Edge Function).
create or replace function public.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if not public.is_admin() then
    new.role := old.role;
    new.dosen_id := old.dosen_id;
    new.aktif := old.aktif;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------- 8. RLS ditulis ulang ----------
-- Semua policy lama pada tabel data dihapus dulu (daftar nama dari
-- pg_policies, jadi versi policy apa pun ikut bersih), lalu dibuat
-- policy per-pemilik yang baru.
do $$
declare
  t text;
  pol record;
begin
  foreach t in array array[
    'dosen','tahun_akademik','mata_kuliah','kelas','mahasiswa',
    'anggota_kelas','pertemuan','absensi','komponen_nilai','nilai',
    'materi','tugas','pengumpulan_tugas','pengaturan','profiles'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    for pol in
      select policyname from pg_policies
       where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;
  end loop;
end $$;

-- Tabel data akademik (termasuk pengaturan): dosen hanya miliknya,
-- admin hanya membaca semuanya.
do $$
declare t text;
begin
  foreach t in array array[
    'dosen','tahun_akademik','mata_kuliah','kelas','mahasiswa',
    'anggota_kelas','pertemuan','absensi','komponen_nilai','nilai',
    'materi','tugas','pengumpulan_tugas','pengaturan'
  ] loop
    execute format(
      'create policy "owner select" on public.%I
         for select to authenticated
         using (owner_id = auth.uid() or public.is_admin())', t);
    execute format(
      'create policy "owner insert" on public.%I
         for insert to authenticated
         with check (owner_id = auth.uid())', t);
    execute format(
      'create policy "owner update" on public.%I
         for update to authenticated
         using (owner_id = auth.uid())
         with check (owner_id = auth.uid())', t);
    execute format(
      'create policy "owner delete" on public.%I
         for delete to authenticated
         using (owner_id = auth.uid())', t);
  end loop;
end $$;

-- Tabel penghubung akun (profiles):
-- - membaca: baris sendiri, atau semua baris bila admin.
-- - membuat baris sendiri: hanya sebagai dosen (bootstrap akun baru;
--   penetapan admin dilakukan lewat SQL/Edge Function, bukan API).
-- - mengubah: baris sendiri (foto) atau admin (mengelola akun);
--   perubahan role/dosen_id/aktif untuk non-admin dibatalkan
--   oleh trigger profiles_guard di atas.
-- - menghapus: hanya admin.
create policy "profiles select own or admin" on public.profiles
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "profiles insert own as dosen" on public.profiles
  for insert to authenticated
  with check (user_id = auth.uid() and role = 'dosen');
create policy "profiles update own or admin" on public.profiles
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
create policy "profiles delete admin" on public.profiles
  for delete to authenticated
  using (public.is_admin());

-- ---------- 9. Fungsi publik Halaman Mahasiswa (disesuaikan) ----------
-- Perubahan dari versi v2/v5:
-- a) halaman_mahasiswa kini membaca pengaturan (nama aplikasi &
--    institusi) MILIK PEMILIK KELAS, bukan pengaturan global.
-- b) kumpul_tugas_mahasiswa menulis owner_id pemilik kelas pada
--    baris pengumpulan baru (fungsi berjalan sebagai anon tanpa
--    auth.uid(), sehingga owner harus diisi eksplisit).
-- Selebihnya perilaku kedua fungsi ini TIDAK berubah.
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
       where owner_id = v_kelas.owner_id
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
  v_owner_id uuid;
  v_mhs_id bigint;
  v_deadline text;
  v_existing public.pengumpulan_tugas%rowtype;
  v_status text := 'Belum Dinilai';
  v_now timestamptz := now();
  v_dl timestamptz;
begin
  select id, owner_id into v_kelas_id, v_owner_id
    from public.kelas
   where token_bagikan = p_token
     and bagikan_aktif is true
   limit 1;
  if v_kelas_id is null then
    return jsonb_build_object('sukses', false, 'pesan', 'Tautan kelas tidak aktif. Minta tautan terbaru kepada dosen Anda.');
  end if;

  select deadline into v_deadline
    from public.tugas
   where id = p_tugas_id and kelas_id = v_kelas_id;
  if not found then
    return jsonb_build_object('sukses', false, 'pesan', 'Tugas tidak ditemukan untuk kelas ini.');
  end if;

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

  if p_file_url is null or trim(p_file_url) = '' or trim(p_file_url) not ilike 'http%' then
    return jsonb_build_object('sukses', false, 'pesan', 'Tautan file wajib diisi dan harus diawali http (mis. tautan Google Drive).');
  end if;
  if length(p_file_url) > 1000 or length(coalesce(p_nama, '')) > 120
     or length(coalesce(p_nim, '')) > 30 or length(coalesce(p_catatan, '')) > 500 then
    return jsonb_build_object('sukses', false, 'pesan', 'Isian terlalu panjang. Periksa kembali tautan/catatan Anda.');
  end if;

  select * into v_existing
    from public.pengumpulan_tugas
   where tugas_id = p_tugas_id and mahasiswa_id = v_mhs_id;
  if found and v_existing.status = 'Sudah Dinilai' then
    return jsonb_build_object('sukses', false, 'pesan', 'Tugas Anda sudah dinilai dosen. Hubungi dosen bila perlu mengumpulkan ulang.');
  end if;

  if v_deadline is not null and trim(v_deadline) <> '' then
    begin
      v_dl := (trim(v_deadline))::timestamp at time zone 'Asia/Makassar';
      if v_now > v_dl then
        v_status := 'Terlambat';
      end if;
    exception when others then
      v_dl := null;
    end;
  end if;

  insert into public.pengumpulan_tugas
    (tugas_id, mahasiswa_id, waktu_kumpul, file_url, file_name, status, catatan, owner_id)
  values
    (p_tugas_id, v_mhs_id,
     to_char(v_now at time zone 'Asia/Makassar', 'DD Mon YYYY • HH24:MI') || ' WITA',
     trim(p_file_url), nullif(trim(coalesce(p_file_name, '')), ''),
     v_status, nullif(trim(coalesce(p_catatan, '')), ''), v_owner_id)
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

-- ============================================================
-- MENETAPKAN ADMIN PERTAMA (jalankan terpisah setelah migrasi)
-- ------------------------------------------------------------
-- 1. Buat user admin di Supabase: Authentication > Users >
--    Add user (email + password Rektor/Admin).
-- 2. Jalankan SQL berikut dengan email admin tersebut:
--
--    insert into public.profiles (user_id, photo, role, dosen_id, aktif)
--    select id, '', 'admin', null, true
--      from auth.users
--     where lower(email) = lower('EMAIL_ADMIN@KAMPUS.AC.ID')
--    on conflict (user_id) do update
--      set role = 'admin', dosen_id = null, aktif = true;
--
-- 3. Admin masuk ke aplikasi: menu yang tampil adalah
--    Dashboard Admin + Manajemen Akun Dosen. Admin TIDAK punya
--    menu kerja dosen dan tidak bisa menulis data dosen.
--
-- PEMERIKSAAN HASIL (opsional, jalankan terpisah):
--    select owner_id, count(*) from public.kelas group by owner_id;
--    select user_id, role, dosen_id, aktif from public.profiles;
--    select public.my_role();  -- jalankan sebagai user login (SQL biasa mengembalikan 'dosen')
-- ============================================================
