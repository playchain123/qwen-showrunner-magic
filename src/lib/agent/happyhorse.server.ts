// Happyhorse fallback client (image + video). Only invoked from tool bodies
// when the primary Qwen/Wan call fails. The API key is optional at boot;
// callers get a structured error if the secret is missing so the planner
// can decide what to do next.

const HH_BASE = process.env.HAPPYHORSE_BASE_URL || "https://api.happyhorse.ai/v1";

function hhKey(): string | null {
  return process.env.HAPPYHORSE_API_KEY || null;
}

export async function happyhorseImage(prompt: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const key = hhKey();
  if (!key) return { ok: false, error: "HAPPYHORSE_API_KEY not configured" };
  try {
    const res = await fetch(`${HH_BASE}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, size: "1664x928" }),
    });
    if (!res.ok) return { ok: false, error: `happyhorse image ${res.status}` };
    const j = (await res.json()) as { data?: Array<{ url?: string }>; url?: string };
    const url = j.data?.[0]?.url || j.url;
    if (!url) return { ok: false, error: "happyhorse: no image url in response" };
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function happyhorseVideo(imageUrl: string, prompt: string, durationSeconds: number): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const key = hhKey();
  if (!key) return { ok: false, error: "HAPPYHORSE_API_KEY not configured" };
  try {
    const res = await fetch(`${HH_BASE}/videos/i2v`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl, prompt, duration: durationSeconds }),
    });
    if (!res.ok) return { ok: false, error: `happyhorse video ${res.status}` };
    const j = (await res.json()) as { url?: string; video_url?: string };
    const url = j.video_url || j.url;
    if (!url) return { ok: false, error: "happyhorse: no video url in response" };
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}