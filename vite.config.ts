// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";

const mode = process.env.MODE || process.env.NODE_ENV || "development";
const env = loadEnv(mode, process.cwd(), "");

// Public browser auth config. These values are publishable client config, not
// private backend secrets, and keep the login form usable even when build-time
// VITE_* values are not injected by the deployment environment.
const fallbackSupabaseUrl = "https://acecxckmvlaxygbvubub.supabase.co";
const fallbackSupabasePublishableKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjZWN4Y2ttdmxheHlnYnZ1YnViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5MzI2MzksImV4cCI6MjA5ODUwODYzOX0.T1B7jnNAmDeB8pWGq4cmmct6Fa7mS-oJjW2szcUlxBE";

const publicSupabaseUrl =
  env.VITE_SUPABASE_URL || env.SUPABASE_URL || fallbackSupabaseUrl;
const publicSupabasePublishableKey =
  env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  env.VITE_SUPABASE_ANON_KEY ||
  env.SUPABASE_PUBLISHABLE_KEY ||
  env.SUPABASE_ANON_KEY ||
  fallbackSupabasePublishableKey;

const supabaseDefine =
  publicSupabaseUrl && publicSupabasePublishableKey
    ? {
        "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(publicSupabaseUrl),
        "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(publicSupabasePublishableKey),
        "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(publicSupabasePublishableKey),
      }
    : {};

export default defineConfig({
  vite: {
    define: supabaseDefine,
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
