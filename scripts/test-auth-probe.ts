/** Probe Supabase auth options available for local testing. */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || "https://acecxckmvlaxygbvubub.supabase.co";
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || "";

async function main() {
  const supabase = createClient(url, anonKey, { auth: { persistSession: false } });
  const anon = await supabase.auth.signInAnonymously();
  console.log("anonymous sign-in:", anon.error ? `ERROR: ${anon.error.message}` : `OK user=${anon.data.user?.id}`);

  const settings = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } });
  console.log("settings:", settings.status, await settings.text());
}

main().catch(console.error);
