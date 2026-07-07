import type { WebsiteBrandKit, WebsiteVideoBeat, WebsiteVideoPlan } from "./website-video";
import { buildFallbackMotionCard } from "./website-render-pipeline";

export function isBoilerplateSentence(text: string) {
  const lower = text.toLowerCase();
  return (
    /reviewed and used to improve|terms of service|privacy policy|cookie policy|all rights reserved|©|copyright|gdpr|ccpa|do not sell|sign up to|log in to|subscribe to/i.test(lower) ||
    /chats may be reviewed|improve our ai models|by continuing|accept the terms/i.test(lower)
  );
}

/** Reject thin corporate identity lines like "Claude is Anthropic". */
export function isWeakProductCopy(text: string | null | undefined, brandName: string) {
  const value = (text || "").trim();
  if (!value || value.length < 24) return true;
  if (isBoilerplateSentence(value)) return true;
  const brand = brandName.trim();
  if (value.toLowerCase() === brand.toLowerCase()) return true;
  if (new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+is\\s+`, "i").test(value) && value.split(/\s+/).length < 8) return true;
  if (/^[\w\s.'-]+\s+is\s+[\w\s.'-]+$/i.test(value) && value.length < 40) return true;
  return false;
}

function decodeMetaText(value: string | null | undefined) {
  if (!value) return null;
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function extractJsonLdFields(html: string) {
  const blocks = Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi));
  for (const block of blocks) {
    try {
      const raw = JSON.parse(block[1]) as Record<string, unknown> | Array<Record<string, unknown>>;
      const items = Array.isArray(raw) ? raw : [raw];
      for (const item of items) {
        const desc = typeof item.description === "string" ? item.description : null;
        const name = typeof item.name === "string" ? item.name : null;
        if (desc || name) return { description: desc, name };
      }
    } catch {
      continue;
    }
  }
  return null;
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export function isLiveFetchBlocked(brandKit: WebsiteBrandKit): boolean {
  return brandKit.confidence_flags.some(
    (flag) =>
      flag === "live_fetch_failed" ||
      flag === "site_blocked" ||
      flag === "low_quality_extraction" ||
      flag.startsWith("blocked_http_") ||
      flag.includes("HTTP 403") ||
      flag.includes("HTTP 429"),
  );
}

/**
 * Stricter check for capture routing: only hard blocks (403/429/fetch failed)
 * should skip the recording worker. Low-quality copy extraction is not a
 * reason to avoid capturing the site.
 */
export function isSiteCaptureBlocked(brandKit: WebsiteBrandKit): boolean {
  return brandKit.confidence_flags.some(
    (flag) =>
      flag === "live_fetch_failed" ||
      flag === "site_blocked" ||
      flag.startsWith("blocked_http_") ||
      flag.includes("HTTP 403") ||
      flag.includes("HTTP 429"),
  );
}

/** Flag kits where extracted copy is mostly legal boilerplate or disclaimers. */
export function auditBrandKitQuality(brandKit: WebsiteBrandKit) {
  const features = brandKit.product.key_features.map((f) => f.benefit).filter(Boolean);
  if (features.length === 0) return brandKit;
  const boilerplateCount = features.filter((f) => isBoilerplateSentence(f)).length;
  if (boilerplateCount / features.length > 0.5) {
    if (!brandKit.confidence_flags.includes("low_quality_extraction")) {
      brandKit.confidence_flags.push("low_quality_extraction");
    }
    brandKit.product.key_features = brandKit.product.key_features.filter((f) => !isBoilerplateSentence(f.benefit));
    if (brandKit.product.key_features.length === 0 && brandKit.brand.tagline && !isBoilerplateSentence(brandKit.brand.tagline)) {
      brandKit.product.key_features = [{ name: brandKit.brand.name, benefit: brandKit.brand.tagline }];
    }
  }
  if (isBoilerplateSentence(brandKit.product.one_line_description) && brandKit.brand.tagline && !isBoilerplateSentence(brandKit.brand.tagline)) {
    brandKit.product.one_line_description = brandKit.brand.tagline;
  }
  if (isWeakProductCopy(brandKit.product.one_line_description, brandKit.brand.name)) {
    if (!brandKit.confidence_flags.includes("weak_product_copy")) {
      brandKit.confidence_flags.push("weak_product_copy");
    }
  }
  if (isWeakProductCopy(brandKit.brand.tagline, brandKit.brand.name)) {
    brandKit.brand.tagline = null;
  }
  return brandKit;
}

/**
 * Screen-capture beats are kept even without the FC recording worker: the clip
 * generator falls back to real website screenshots (keyless providers) with
 * Ken Burns motion, and only degrades to branded motion cards if screenshots
 * also fail. Plan-level downgrading is no longer needed.
 */
export function repurposePlanForCaptureUnavailable(plan: WebsiteVideoPlan): WebsiteVideoPlan {
  return plan;
}

export function classifyFetchFailure(status: number): "blocked" | "http_error" | "ok" {
  if (status === 403 || status === 429) return "blocked";
  if (status >= 400) return "http_error";
  return "ok";
}

export async function fetchBasicMetaFallback(url: string): Promise<{
  title: string | null;
  description: string | null;
  ogImage: string | null;
} | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (!html.trim()) return null;
    return {
      title: decodeMetaText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null),
      description: decodeMetaText(
        html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
        html.match(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
        html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
        extractJsonLdFields(html)?.description ??
        null,
      ),
      ogImage:
        html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
        null,
    };
  } catch {
    return null;
  }
}

export function mergeMetaIntoBrandKit(brandKit: WebsiteBrandKit, meta: NonNullable<Awaited<ReturnType<typeof fetchBasicMetaFallback>>>) {
  if (meta.title && brandKit.confidence_flags.includes("fallback_brand_kit_used")) {
    const title = decodeMetaText(meta.title);
    if (title) brandKit.brand.name = title.split(/[|\-–]/)[0].trim() || brandKit.brand.name;
  }
  if (meta.description) {
    const desc = decodeMetaText(meta.description);
    if (desc && !isWeakProductCopy(desc, brandKit.brand.name)) {
      brandKit.brand.tagline = desc;
      brandKit.product.one_line_description = desc;
    }
  }
  if (meta.ogImage && !brandKit.hero_screenshot_url) {
    // og:image is a social banner — use it as a hero background, never a logo.
    brandKit.hero_screenshot_url = meta.ogImage;
  }
  brandKit.confidence_flags.push("basic_meta_fallback_applied");
  return brandKit;
}

/**
 * Blocked sites keep their screen_capture beats: the screenshot providers
 * render pages through their own real browsers and usually succeed where a
 * plain server fetch got 403/429. The per-beat fallback ladder still degrades
 * to branded motion cards when every provider fails.
 */
export function repurposePlanForBlockedSite(_brandKit: WebsiteBrandKit, plan: WebsiteVideoPlan): WebsiteVideoPlan {
  return plan;
}

export function buildBlockedCaptureFallbackNote(beat: WebsiteVideoBeat, reason: string) {
  return `Branded title card for "${beat.beat_purpose}". Live site capture unavailable (${reason}).`;
}

export function compileBlockedFallbackMotion(brandKit: WebsiteBrandKit, beat: WebsiteVideoBeat, reason: string) {
  return buildFallbackMotionCard(
    brandKit,
    { ...beat, production_method: "motion_graphic" },
    buildBlockedCaptureFallbackNote(beat, reason),
  );
}

export { BROWSER_UA };
