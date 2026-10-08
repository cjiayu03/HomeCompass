'use client';

import { createBrowserClient } from '@supabase/ssr';
import { getSupabasePublicConfig } from '@/lib/supabase/config';

let browserClient;

export function getSupabaseBrowserClient() {
  const config = getSupabasePublicConfig();
  if (!config) return null;
  browserClient ??= createBrowserClient(config.url, config.key);
  return browserClient;
}
