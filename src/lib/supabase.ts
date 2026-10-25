import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True bila kedua environment variable Supabase sudah diisi. */
export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

/**
 * Mengembalikan client Supabase, atau null bila belum dikonfigurasi.
 * Aplikasi tidak crash tanpa env vars — halaman akan menampilkan
 * petunjuk setup sebagai gantinya.
 */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (!client) {
    client = createClient(url as string, anonKey as string);
  }
  return client;
}
