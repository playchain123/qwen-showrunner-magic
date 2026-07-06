# Fix Supabase "Not Configured" in Lovable

Copy the prompt below into Lovable to fix the **"Supabase is not configured. Please connect Supabase or add the required environment variables."** error on `/auth` and dashboard routes.

---

```
Fix the "Supabase is not configured. Please connect Supabase or add the required environment variables." error on /auth and across all dashboard routes.

## Root cause
The browser client in src/integrations/supabase/client.ts sets isSupabaseConfigured=false when EITHER of these is empty at BUILD time:
- import.meta.env.VITE_SUPABASE_URL
- import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY legacy fallback)

When false, supabase=null and auth.tsx shows the setup message and disables login.

Server functions also fail separately if auth-middleware.ts cannot find SUPABASE_URL + a publishable/anon key, or if client.server.ts is missing SUPABASE_SERVICE_ROLE_KEY.

## Required fix steps

### 1. Connect Supabase in Lovable Cloud
Settings → Integrations → Supabase → Connect this project.
This must auto-create/populate secrets. After connecting, REPUBLISH the app so VITE_* values are baked into the client bundle.

### 2. Verify ALL of these secrets are non-empty after connect
Frontend (browser — must start with VITE_):
- VITE_SUPABASE_URL=https://<project-ref>.supabase.co
- VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... OR legacy anon key eyJ...

Backend (server only — NEVER prefix with VITE_):
- SUPABASE_URL=(same URL as above)
- SUPABASE_SERVICE_ROLE_KEY=sb_secret_... OR legacy service_role eyJ...
- SUPABASE_PUBLISHABLE_KEY or ensure VITE_SUPABASE_PUBLISHABLE_KEY is also available server-side for JWT validation in auth-middleware.ts

### 3. Local dev (.env)
Copy .env.example to .env and paste the same values from Lovable Cloud secrets.
Restart dev server after editing .env (vite.config.ts loadEnv only runs at startup).

### 4. Do NOT break vite.config.ts bridge
vite.config.ts maps SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY → import.meta.env.VITE_* via define{} ONLY when BOTH are non-empty. If only one is set, the bridge is skipped and the client stays unconfigured.

### 5. Files to verify (do not delete auto-generated client.ts)
- src/integrations/supabase/client.ts — isSupabaseConfigured gate
- src/routes/auth.tsx — user-facing error at lines ~59-61, 97-99, 193-195
- vite.config.ts — env bridge (lines 10-34)
- src/integrations/supabase/auth-middleware.ts — server JWT validation
- src/integrations/supabase/client.server.ts — admin client for server ops
- .env.example — document all required keys

### 6. Acceptance criteria
- /auth loads WITHOUT amber "Supabase is not configured" warning
- Sign up / login works and persists session
- Dashboard routes (website, library, agent) do not redirect to /auth when logged in
- Server functions (generateVoice, extractWebsiteBrandKit) do not throw "Missing Supabase environment variable"
- Browser console does NOT show "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY" in dev

### 7. Security rule
NEVER put SUPABASE_SERVICE_ROLE_KEY in any VITE_* variable. Service role is server-only.
```

## Quick diagnostic for local `.env`

If you already have `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in local `.env` but still see the error:

1. Restart `npm run dev` (env not hot-reloaded)
2. Confirm both values are non-empty strings (no trailing spaces)
3. On Lovable hosted preview: secrets must be set in Lovable Cloud **and** app republished — local `.env` does not affect deployed builds
4. If login works but API calls fail: add `SUPABASE_SERVICE_ROLE_KEY` to Lovable secrets (server-side only)

## Website capture API (separate from Supabase)

Screen capture and browser brand extraction run on the Alibaba FC deploy worker (Playwright). Set:

- `VITE_API_BASE_URL` — public URL of the deployed FC worker
- `CAPTURE_API_BASE_URL` — server-side override (optional)

Without these, the app falls back to HTTP fetch for brand extraction and motion graphics for screen-capture beats.
