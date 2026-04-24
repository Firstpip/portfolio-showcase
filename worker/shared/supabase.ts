// Supabase 공용 클라이언트. service role 사용 (RLS 우회, 워커 전용).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function supabaseClient(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정. worker/.env.local에서 정의하세요.",
    );
  }
  _client = createClient(url, key, {
    auth: { persistSession: false },
  });
  return _client;
}
