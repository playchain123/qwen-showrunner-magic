# Deploy FC Capture Worker

Real screen recordings and browser brand extraction require the Alibaba FC worker in `deploy/`.

## Steps

1. Install and build:
   ```bash
   cd deploy
   npm install
   npm run build
   ```

2. Deploy with Serverless Devs (`s deploy` per `deploy/s.yaml`).

3. Note the public HTTP URL of the deployed function.

4. Set environment variables (Lovable secrets + local `.env`):
   ```
   VITE_API_BASE_URL=https://<your-fc-url>
   CAPTURE_API_BASE_URL=https://<your-fc-url>
   ```

5. Republish the Lovable app so `VITE_API_BASE_URL` is baked into the client bundle.

6. Apply Supabase migration: `supabase/migrations/20260706120000_website_assets_bucket.sql`

## Verify

```bash
curl https://<your-fc-url>/api/health
```

Expected: `{ "success": true, "stage": "health", "playwright_enabled": true }`

Test capture on a reachable site (e.g. `iboyhub.com`) — walkthrough beat should show `asset_source: "captured"`.
