import { fetchWithTimeout, isSafePublicHttpUrl } from "./website-url-safety";
import { uploadWebsiteAsset, dataUrlFromBase64 } from "./website-storage";

/**
 * Keyless website screenshot fallback.
 *
 * When the Playwright FC worker (VITE_API_BASE_URL) is not deployed, capture
 * beats used to silently degrade to generic branded motion cards. This module
 * grabs real screenshots of the target pages through free, no-API-key
 * services so capture beats still show the actual website:
 *
 *   1. WordPress mShots  — s0.wp.com/mshots (real headless render, needs polling)
 *   2. thum.io           — image.thum.io (instant, rate limited)
 *   3. microlink.io      — api.microlink.io (50/day keyless)
 */

export type ScreenshotFetchResult = {
  bytes: Uint8Array;
  contentType: string;
  provider: "mshots" | "thumio" | "microlink";
};

const FETCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MIN_IMAGE_BYTES = 4000;
const MSHOTS_POLL_DELAY_MS = 2600;

/** Screenshot URL cache so multiple beats over the same page reuse one upload. */
const screenshotUrlCache = new Map<string, string>();

export function mshotsUrl(target: string, width = 1440, height = 900) {
  return `https://s0.wp.com/mshots/v1/${encodeURIComponent(target)}?w=${width}&h=${height}`;
}

function thumioUrl(target: string, width = 1440, height = 900) {
  return `https://image.thum.io/get/width/${width}/crop/${height}/noanimate/${target}`;
}

function microlinkUrl(target: string) {
  return `https://api.microlink.io/?url=${encodeURIComponent(target)}&screenshot=true&meta=false`;
}

/**
 * Fire-and-forget request that queues mShots generation server-side, so the
 * screenshot is usually ready by the time beat clips are generated.
 */
export function warmScreenshot(target: string, width = 1440, height = 900) {
  if (!isSafePublicHttpUrl(target)) return;
  void fetchWithTimeout(mshotsUrl(target, width, height), {
    timeoutMs: 6000,
    headers: { "User-Agent": FETCH_UA },
  }).catch(() => undefined);
}

async function readImageResponse(res: Response | null): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!res?.ok) return null;
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength < MIN_IMAGE_BYTES) return null;
  return { bytes, contentType };
}

async function tryMshots(target: string, width: number, height: number, budgetMs: number): Promise<ScreenshotFetchResult | null> {
  const url = mshotsUrl(target, width, height);
  const started = Date.now();
  // mShots serves a placeholder GIF while the real JPEG is being rendered.
  for (let attempt = 0; attempt < 8; attempt++) {
    if (Date.now() - started > budgetMs) return null;
    const res = await fetchWithTimeout(url, { timeoutMs: 9000, headers: { "User-Agent": FETCH_UA } });
    const image = await readImageResponse(res);
    if (image && !image.contentType.includes("gif")) {
      return { ...image, provider: "mshots" };
    }
    if (Date.now() - started + MSHOTS_POLL_DELAY_MS > budgetMs) return null;
    await new Promise((resolve) => setTimeout(resolve, MSHOTS_POLL_DELAY_MS));
  }
  return null;
}

async function tryThumio(target: string, width: number, height: number): Promise<ScreenshotFetchResult | null> {
  const res = await fetchWithTimeout(thumioUrl(target, width, height), {
    timeoutMs: 15000,
    headers: { "User-Agent": FETCH_UA },
  });
  const image = await readImageResponse(res);
  return image ? { ...image, provider: "thumio" } : null;
}

async function tryMicrolink(target: string): Promise<ScreenshotFetchResult | null> {
  const res = await fetchWithTimeout(microlinkUrl(target), { timeoutMs: 20000 });
  if (!res?.ok) return null;
  try {
    const json = (await res.json()) as { status?: string; data?: { screenshot?: { url?: string } } };
    const screenshotUrl = json.data?.screenshot?.url;
    if (json.status !== "success" || !screenshotUrl) return null;
    const imageRes = await fetchWithTimeout(screenshotUrl, { timeoutMs: 15000 });
    const image = await readImageResponse(imageRes);
    return image ? { ...image, provider: "microlink" } : null;
  } catch {
    return null;
  }
}

export async function fetchWebsiteScreenshot({
  url,
  width = 1440,
  height = 900,
  budgetMs = 30000,
}: {
  url: string;
  width?: number;
  height?: number;
  budgetMs?: number;
}): Promise<ScreenshotFetchResult | null> {
  if (!isSafePublicHttpUrl(url)) return null;
  const mshots = await tryMshots(url, width, height, Math.max(4000, budgetMs - 8000));
  if (mshots) return mshots;
  const thumio = await tryThumio(url, width, height);
  if (thumio) return thumio;
  return tryMicrolink(url);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Fetch a screenshot for a page and return a persistent (Supabase Storage) or
 * inline (data URL) image URL, caching per page+viewport for the process.
 */
export async function getScreenshotImageUrl({
  url,
  width = 1440,
  height = 900,
  userId,
  projectId,
  beatId,
  budgetMs = 30000,
}: {
  url: string;
  width?: number;
  height?: number;
  userId: string;
  projectId: string;
  beatId: string;
  budgetMs?: number;
}): Promise<string | null> {
  const cacheKey = `${url}::${width}x${height}`;
  const cached = screenshotUrlCache.get(cacheKey);
  if (cached) return cached;

  const shot = await fetchWebsiteScreenshot({ url, width, height, budgetMs });
  if (!shot) return null;

  const uploaded = await uploadWebsiteAsset({
    userId,
    projectId,
    beatId,
    buffer: shot.bytes,
    contentType: shot.contentType,
    kind: "screenshot",
  });
  const finalUrl = uploaded || dataUrlFromBase64(bytesToBase64(shot.bytes), shot.contentType);
  screenshotUrlCache.set(cacheKey, finalUrl);
  return finalUrl;
}
