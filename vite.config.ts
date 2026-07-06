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

const publicSupabaseUrl =
  env.VITE_SUPABASE_URL || env.SUPABASE_URL || "";
const publicSupabasePublishableKey =
  env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  env.VITE_SUPABASE_ANON_KEY ||
  env.SUPABASE_PUBLISHABLE_KEY ||
  env.SUPABASE_ANON_KEY ||
  "";

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
