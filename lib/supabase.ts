import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const hasEnv = Boolean(url && key);

// Falls back to harmless placeholders so the app can render a setup hint
// instead of crashing when env vars are missing.
export const supabase = createClient(
  url ?? "https://placeholder.supabase.co",
  key ?? "placeholder-anon-key"
);
