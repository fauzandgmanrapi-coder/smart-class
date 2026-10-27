// ============================================================
// Edge Function: create-lecturer-account
// Smart Class Online v8 — mengelola akun login dosen dari menu
// Manajemen Akun Dosen (khusus peran Admin/Rektor).
//
// Cara pasang (sekali saja, ±5 menit):
//   Supabase Dashboard > Edge Functions > Create a new function
//   > nama: create-lecturer-account > tempel SELURUH isi file ini
//   > Deploy. (Atau lewat Supabase CLI: supabase functions deploy
//   create-lecturer-account)
//
// Keamanan:
// - Hanya user login dengan peran ADMIN yang boleh memanggil
//   (diperiksa di tabel public.profiles, cadangan app_metadata).
// - Semua operasi Auth memakai service role key yang OTOMATIS
//   tersedia di environment Edge Functions
//   (SUPABASE_SERVICE_ROLE_KEY). Kunci itu TIDAK PERNAH keluar
//   dari server Supabase.
//
// Aksi (POST JSON { action, ... }):
//   list       -> daftar semua akun + tautan profil dosennya
//   create     -> buat akun login untuk profil dosen (dosen_id)
//                 atau sekalian buat profil dosen baru (nama+email)
//   link       -> tautkan akun yang ada ke profil dosen (user_id, dosen_id)
//   unlink     -> lepas tautan profil dari akun (user_id)
//   set_role   -> ubah peran akun (user_id, role: 'dosen'|'admin')
//   set_active -> aktif/nonaktifkan login (user_id, aktif: boolean)
//   reset      -> reset password akun (user_id, password)
// ============================================================

// @ts-ignore — modul Deno untuk Edge Functions Supabase
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// @ts-ignore — Deno tersedia di runtime Edge Functions
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method tidak diizinkan." }, 405);
  }

  try {
    // @ts-ignore — Deno.env tersedia di runtime Edge Functions
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    // @ts-ignore
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    // @ts-ignore
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!url || !anonKey || !serviceKey) {
      return json({ error: "Konfigurasi server tidak lengkap." }, 500);
    }

    // 1) Pastikan pemanggil sudah login (JWT valid).
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Tidak ada sesi login." }, 401);
    }
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await caller.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Sesi login tidak valid." }, 401);
    }
    const callerId = userData.user.id;

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 2) Pastikan pemanggil adalah ADMIN (profiles.role menang;
    //    cadangan: app_metadata.role pada JWT).
    let callerIsAdmin =
      (userData.user.app_metadata as { role?: string } | undefined)?.role ===
      "admin";
    if (!callerIsAdmin) {
      const { data: prof } = await admin
        .from("profiles")
        .select("role")
        .eq("user_id", callerId)
        .maybeSingle();
      callerIsAdmin = prof?.role === "admin";
    }
    if (!callerIsAdmin) {
      return json(
        { error: "Hanya Admin yang dapat mengelola akun dosen." },
        403
      );
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "list");

    // 3) Aksi: daftar akun + tautannya.
    if (action === "list") {
      const { data: list, error: listErr } =
        await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listErr) return json({ error: listErr.message }, 500);
      const { data: profiles, error: pErr } = await admin
        .from("profiles")
        .select("user_id, role, dosen_id, aktif");
      if (pErr) return json({ error: pErr.message }, 500);
      const { data: dosenRows } = await admin
        .from("dosen")
        .select("id, nama");
      const dosenNama = new Map<number, string>(
        (dosenRows ?? []).map((d: { id: number; nama: string }) => [
          d.id,
          d.nama,
        ])
      );
      const profByUser = new Map(
        (profiles ?? []).map(
          (p: { user_id: string; role: string; dosen_id: number | null; aktif: boolean }) => [
            p.user_id,
            p,
          ]
        )
      );
      const accounts = list.users.map(
        (u: {
          id: string;
          email?: string | null;
          created_at?: string;
          banned_until?: string | null;
          app_metadata?: { role?: string };
        }) => {
          const p = profByUser.get(u.id);
          const banned = u.banned_until
            ? new Date(u.banned_until).getTime() > Date.now()
            : false;
          return {
            user_id: u.id,
            email: u.email ?? "",
            created_at: u.created_at ?? null,
            role: p?.role ?? u.app_metadata?.role ?? "dosen",
            dosen_id: p?.dosen_id ?? null,
            dosen_nama: p?.dosen_id
              ? dosenNama.get(p.dosen_id) ?? null
              : null,
            aktif: p ? Boolean(p.aktif) && !banned : !banned,
            banned,
          };
        }
      );
      return json({ ok: true, accounts });
    }

    // 4) Aksi: atur peran akun.
    if (action === "set_role") {
      const userId = String(body.user_id ?? "");
      const newRole = String(body.role ?? "");
      if (!userId) return json({ error: "user_id wajib diisi." }, 400);
      if (newRole !== "admin" && newRole !== "dosen") {
        return json({ error: "Peran harus 'admin' atau 'dosen'." }, 400);
      }
      if (userId === callerId && newRole !== "admin") {
        return json(
          { error: "Anda tidak bisa menurunkan peran akun Anda sendiri." },
          400
        );
      }
      const { error: upErr } = await admin
        .from("profiles")
        .upsert(
          { user_id: userId, role: newRole },
          { onConflict: "user_id" }
        );
      if (upErr) return json({ error: upErr.message }, 500);
      await admin.auth.admin.updateUserById(userId, {
        app_metadata: { role: newRole },
      });
      return json({ ok: true, action: "set_role", role: newRole });
    }

    // 5) Aksi: aktif / nonaktifkan login (ban di Auth + flag profiles).
    if (action === "set_active") {
      const userId = String(body.user_id ?? "");
      const aktif = Boolean(body.aktif);
      if (!userId) return json({ error: "user_id wajib diisi." }, 400);
      if (userId === callerId && !aktif) {
        return json(
          { error: "Anda tidak bisa menonaktifkan akun Anda sendiri." },
          400
        );
      }
      const { error } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: aktif ? "none" : "876000h",
      });
      if (error) return json({ error: error.message }, 500);
      await admin
        .from("profiles")
        .upsert({ user_id: userId, aktif }, { onConflict: "user_id" });
      return json({ ok: true, action: "set_active", aktif });
    }

    // 6) Aksi: reset password.
    if (action === "reset") {
      const userId = String(body.user_id ?? "");
      const password = String(body.password ?? "");
      if (!userId) return json({ error: "user_id wajib diisi." }, 400);
      if (password.length < 8) {
        return json({ error: "Password minimal 8 karakter." }, 400);
      }
      const { error } = await admin.auth.admin.updateUserById(userId, {
        password,
      });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, action: "reset" });
    }

    // 7) Aksi: tautkan akun ke profil dosen.
    if (action === "link") {
      const userId = String(body.user_id ?? "");
      const dosenId = Number(body.dosen_id);
      if (!userId || !dosenId) {
        return json({ error: "user_id dan dosen_id wajib diisi." }, 400);
      }
      const { data: existing } = await admin
        .from("profiles")
        .select("user_id")
        .eq("dosen_id", dosenId)
        .neq("user_id", userId)
        .maybeSingle();
      if (existing) {
        return json(
          { error: "Profil dosen ini sudah tertaut ke akun lain." },
          409
        );
      }
      const { error: upErr } = await admin
        .from("profiles")
        .upsert(
          { user_id: userId, role: "dosen", dosen_id: dosenId, aktif: true },
          { onConflict: "user_id" }
        );
      if (upErr) return json({ error: upErr.message }, 500);
      const { error: ownErr } = await admin
        .from("dosen")
        .update({ owner_id: userId })
        .eq("id", dosenId);
      if (ownErr) return json({ error: ownErr.message }, 500);
      return json({ ok: true, action: "link" });
    }

    // 8) Aksi: lepas tautan profil dari akun (akun tidak dihapus).
    if (action === "unlink") {
      const userId = String(body.user_id ?? "");
      if (!userId) return json({ error: "user_id wajib diisi." }, 400);
      const { error } = await admin
        .from("profiles")
        .update({ dosen_id: null })
        .eq("user_id", userId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, action: "unlink" });
    }

    // 9) Aksi: buat akun login dosen.
    if (action === "create") {
      const password = String(body.password ?? "");
      if (password.length < 8) {
        return json({ error: "Password minimal 8 karakter." }, 400);
      }
      const dosenIdRaw = Number(body.dosen_id ?? 0);
      let dosen: {
        id: number;
        nama: string;
        email: string | null;
        owner_id: string | null;
      } | null = null;

      if (dosenIdRaw) {
        const { data, error } = await admin
          .from("dosen")
          .select("id, nama, email, owner_id")
          .eq("id", dosenIdRaw)
          .maybeSingle();
        if (error) return json({ error: error.message }, 500);
        if (!data) return json({ error: "Profil dosen tidak ditemukan." }, 404);
        dosen = data;
        const { data: linked } = await admin
          .from("profiles")
          .select("user_id")
          .eq("dosen_id", dosenIdRaw)
          .maybeSingle();
        if (linked) {
          return json(
            {
              error:
                "Profil dosen ini sudah memiliki akun login. Gunakan Reset Password bila perlu.",
            },
            409
          );
        }
      }

      const email = String(body.email ?? dosen?.email ?? "")
        .trim()
        .toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: "Format email tidak valid." }, 400);
      }

      // Buat user Auth (atau temukan yang sudah ada dengan email sama).
      let userId: string | null = null;
      let existed = false;
      const namaBaru = String(body.nama ?? dosen?.nama ?? "");
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { name: namaBaru, role: "dosen" },
          app_metadata: { role: "dosen" },
        });
      if (createErr) {
        const { data: list, error: listErr } =
          await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (listErr) return json({ error: createErr.message }, 500);
        const found = list.users.find(
          (u: { email?: string | null }) =>
            (u.email ?? "").toLowerCase() === email
        );
        if (!found) return json({ error: createErr.message }, 500);
        // Akun email itu sudah tertaut ke profil dosen lain?
        const { data: otherLink } = await admin
          .from("profiles")
          .select("dosen_id")
          .eq("user_id", found.id)
          .maybeSingle();
        if (otherLink?.dosen_id && otherLink.dosen_id !== dosen?.id) {
          return json(
            { error: "Email ini sudah dipakai akun profil dosen lain." },
            409
          );
        }
        userId = found.id;
        existed = true;
      } else {
        userId = created.user?.id ?? null;
      }
      if (!userId) {
        return json({ error: "Gagal membuat akun login." }, 500);
      }

      // Bila belum ada profil dosen, buat sekarang (milik akun baru).
      if (!dosen) {
        if (!namaBaru.trim()) {
          return json(
            { error: "Nama dosen wajib diisi bila profil dosen baru dibuat." },
            400
          );
        }
        const { data: newDosen, error: dErr } = await admin
          .from("dosen")
          .insert({
            nama: namaBaru.trim(),
            email,
            nidn: String(body.nidn ?? "").trim() || null,
            prodi: String(body.prodi ?? "").trim() || null,
            fakultas: String(body.fakultas ?? "").trim() || null,
            no_hp: String(body.no_hp ?? "").trim() || null,
            owner_id: userId,
          })
          .select("id, nama, email, owner_id")
          .single();
        if (dErr) return json({ error: dErr.message }, 500);
        dosen = newDosen;
      } else {
        // Profil dosen yang ada menjadi milik akun barunya.
        const { error: ownErr } = await admin
          .from("dosen")
          .update({ owner_id: userId, email: dosen.email ?? email })
          .eq("id", dosen.id);
        if (ownErr) return json({ error: ownErr.message }, 500);
      }

      const { error: pErr } = await admin.from("profiles").upsert(
        {
          user_id: userId,
          role: "dosen",
          dosen_id: dosen.id,
          aktif: true,
        },
        { onConflict: "user_id" }
      );
      if (pErr) return json({ error: pErr.message }, 500);

      return json({
        ok: true,
        action: "create",
        user_id: userId,
        dosen_id: dosen.id,
        existed,
      });
    }

    return json({ error: "Action tidak dikenal." }, 400);
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "Terjadi kesalahan server." },
      500
    );
  }
});
