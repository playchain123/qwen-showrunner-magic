import type { WebsiteBrandKit, WebsiteVideoBeat, WebsiteVideoPlan } from "./website-video";
import { buildFallbackMotionCard } from "./website-render-pipeline";
import { isCaptureApiConfigured } from "./website-browser-api";

export function isBoilerplateSentence(text: string) {
  const lower = text.toLowerCase();
  return (
    /reviewed and used to improve|terms of service|privacy policy|cookie policy|all rights reserved|©|copyright|gdpr|ccpa|do not sell|sign up to|log in to|subscribe to/i.test(lower) ||
    /chats may be reviewed|improve our ai models|by continuing|accept the terms/i.test(lower)
  );
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
  return brandKit;
}

/** When capture worker is not deployed, reroute screen_capture beats to motion_graphic. */
export function repurposePlanForCaptureUnavailable(plan: WebsiteVideoPlan): WebsiteVideoPlan {
  if (isCaptureApiConfigured()) return plan;
  const beats = plan.beats.map((beat) => {
    if (beat.production_method !== "screen_capture") return beat;
    return {
      ...beat,
      production_method: "motion_graphic" as const,
      screen_capture_spec: null,
      motion_graphic_spec: beat.motion_graphic_spec || {
        layout: "split headline plus feature-callout stack using brand colors only",
        elements: [
          { type: "headline", content: beat.beat_purpose, animation: "fade_rise" },
          { type: "supporting_copy", content: beat.vo_line, animation: "mask_wipe" },
        ],
        easing_family: "ease-out-expo",
        colors_used: [],
        typefaces_used: [],
      },
      ai_broll_spec: null,
    };
  });
  return { ...plan, beats };
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
      title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null,
      description:
        html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
        html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
        null,
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
    brandKit.brand.name = meta.title.split(/[|\-–]/)[0].trim() || brandKit.brand.name;
  }
  if (meta.description) {
    brandKit.brand.tagline = meta.description;
    brandKit.product.one_line_description = meta.description;
  }
  if (meta.ogImage) {
    brandKit.brand.logo_asset_path = meta.ogImage;
  }
  brandKit.confidence_flags.push("basic_meta_fallback_applied");
  return brandKit;
}

/** When live capture is blocked, reroute screen_capture beats to motion_graphic. */
export function repurposePlanForBlockedSite(brandKit: WebsiteBrandKit, plan: WebsiteVideoPlan): WebsiteVideoPlan {
  if (!isLiveFetchBlocked(brandKit)) return plan;

  const beats = plan.beats.map((beat) => {
    if (beat.production_method !== "screen_capture") return beat;
    const colors = [
      brandKit.brand.primary_color_hex,
      brandKit.brand.secondary_color_hex,
      brandKit.brand.accent_color_hex,
      brandKit.brand.neutral_color_hex,
    ];
    return {
      ...beat,
      production_method: "motion_graphic" as const,
      screen_capture_spec: null,
      motion_graphic_spec: {
        layout: "full_frame_headline",
        elements: [
          { type: "headline", content: beat.beat_purpose, animation: "fade_rise" },
          { type: "subhead", content: beat.vo_line, animation: "mask_wipe" },
          { type: "cta_button", content: brandKit.brand.name, animation: "scale_overshoot" },
        ],
        easing_family: "ease-out-expo",
        colors_used: colors,
        typefaces_used: [brandKit.brand.heading_typeface, brandKit.brand.body_typeface],
      },
      ai_broll_spec: null,
    };
  });

  if (!brandKit.confidence_flags.includes("screen_capture_rerouted_to_motion")) {
    brandKit.confidence_flags.push("screen_capture_rerouted_to_motion");
  }

  return { ...plan, beats };
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
