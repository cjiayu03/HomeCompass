export function getSupabasePublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const values = `${url} ${key}`.toLowerCase();
  if (["your-project", "replace-me", "changeme"].some((marker) => values.includes(marker))) return null;
  return { url, key };
}
