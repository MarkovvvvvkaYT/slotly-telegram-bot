import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim().replace(/^Bearer\s+/i, "");
  if (!url || !serviceRoleKey) throw new Error("Supabase service role is not configured");
  const isSecretKey = serviceRoleKey.startsWith("sb_secret_");
  adminClient ??= createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: isSecretKey
      ? {
          headers: { apikey: serviceRoleKey },
          fetch: async (input, init) => {
            const headers = new Headers(init?.headers);
            if (headers.get("authorization") === `Bearer ${serviceRoleKey}`) {
              headers.delete("authorization");
            }
            return fetch(input, { ...init, headers });
          },
        }
      : undefined,
  });
  return adminClient;
}
