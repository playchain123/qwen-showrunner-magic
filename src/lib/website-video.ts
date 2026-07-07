import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  BROWSER_UA,
  classifyFetchFailure,
  fetchBasicMetaFallback,
  mergeMetaIntoBrandKit,
  auditBrandKitQuality,
  isBoilerplateSentence,
  isWeakProductCopy,
} from "./website-site-resilience";
import { enrichWebsiteBrandKit } from "./website-brand-enrichment";
import { requestBrowserExtract, isCaptureApiConfigured } from "./website-browser-api";
import { persistHeroScreenshot, persistRemoteImage } from "./website-storage";
import { isSafePublicHttpUrl } from "./website-url-safety";
import { extractDeepBrandSignals, faviconServiceUrl, type DeepBrandSignals } from "./website-brand-extract-deep";
import { extractDominantLogoColors, kitHasChromaticColor } from "./website-logo-color";
import { getScreenshotImageUrl, warmScreenshot } from "./website-screenshot-fallback";

export type WebsiteVideoType = "saas_launch" | "website_promo" | "user_demo" | "user_manual";
export type ProductionMethod = "screen_capture" | "motion_graphic" | "ai_broll";

export type WebsiteBrandKit = {
  brand: {
    name: string;
    tagline: string | null;
    primary_color_hex: string;
    secondary_color_hex: string;
    accent_color_hex: string;
    neutral_color_hex: string;
    heading_typeface: string;
    body_typeface: string;
    logo_asset_path: string | null;
    voice_tone: string;
  };
  product: {
    one_line_description: string;
    primary_use_cases: string[];
    key_features: Array<{ name: string; benefit: string }>;
    pricing_signal: "freemium" | "tiered" | "enterprise/contact" | null;
    social_proof: string[];
  };
  site_map: Array<{
    page: string;
    purpose: string;
    capture_worthy: boolean;
  }>;
  confidence_flags: string[];
  source_url: string;
  extracted_at: string;
  extraction_method?: "browser" | "fetch" | "fallback";
  hero_screenshot_url?: string;
  font_urls?: string[];
};

export type WebsiteVideoBeat = {
  beat_id: string;
  beat_purpose: string;
  start_seconds: number;
  duration_seconds: number;
  production_method: ProductionMethod;
  screen_capture_spec: {
    source_page: string;
    interaction_sequence: string[];
    framing: "full_browser" | "cropped_ui" | "device_mockup_laptop" | "device_mockup_phone";
  } | null;
  motion_graphic_spec: {
    layout: string;
    elements: Array<{ type: string; content: string; animation: string }>;
    easing_family: string;
    colors_used: string[];
    typefaces_used: string[];
  } | null;
  ai_broll_spec: Record<string, unknown> | null;
  vo_line: string;
  transition_out: "cut" | "cross_dissolve" | "wipe" | "match_cut";
};

export type WebsiteVideoPlan = {
  video_type: WebsiteVideoType;
  total_duration_seconds: number;
  beats: WebsiteVideoBeat[];
  music_plan: {
    bpm_range: string;
    energy_curve: string;
    downbeat_aligned_beats: string[];
  };
  production_value_self_check: Omit<LintResult, "verdict"> & {
    colors_used_total: number;
    typefaces_used_total: number;
    easing_families_used: number;
    transition_types_used: number;
    verdict: "pass" | "needs_revision";
  };
};

type MotionCompositionSpec = {
  colorsUsed: string[];
  easingCurvesUsed: string[];
  typefacesUsed: string[];
  transitionTypesUsed: string[];
};

type LintResult = {
  score: number;
  flags: string[];
  verdict: "ship" | "revise" | "redesign";
};

export { isSafePublicHttpUrl };

export const extractWebsiteBrandKit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        url: z
          .string()
          .url()
          .max(2048)
          .refine(isSafePublicHttpUrl, {
            message: "URL must point to a public http(s) host (private, loopback, and metadata addresses are blocked)",
          }),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<WebsiteBrandKit> => {
    const normalizedUrl = normalizeUrl(data.url);
    const userId = (context as { userId?: string }).userId || "anonymous";
    const request = getRequest();
    const authToken = request?.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || undefined;

    // Queue a real screenshot render early so it is ready by the time we need
    // a hero background or per-beat capture visuals.
    warmScreenshot(normalizedUrl);

    // 1) Playwright browser extract via capture API (FC worker)
    const browserExtract = await requestBrowserExtract(normalizedUrl, authToken);
    if (browserExtract?.success) {
      return enrichWebsiteBrandKit(await buildBrandKitFromBrowserExtract(normalizedUrl, browserExtract, userId));
    }
    if (browserExtract?.blocked) {
      const fallback = buildFallbackBrandKit(normalizedUrl, [`${normalizedUrl} blocked in browser`]);
      fallback.confidence_flags.push("site_blocked", "blocked_http_403_or_429", "browser_extract_blocked");
      const meta = await fetchBasicMetaFallback(normalizedUrl);
      const merged = meta ? mergeMetaIntoBrandKit(fallback, meta) : fallback;
      await enrichColorsFromLogo(merged);
      await Promise.all([attachHeroScreenshot(merged, userId, 14000), persistBrandLogo(merged, userId)]);
      if (!process.env.DASHSCOPE_API_KEY) merged.confidence_flags.push("ai_broll_unavailable");
      return enrichWebsiteBrandKit(merged);
    }

    // 2) Plain HTTP fetch fallback
    const candidates = buildFetchCandidates(normalizedUrl).filter(isSafePublicHttpUrl);
    if (candidates.length === 0) {
      throw new Error("Refusing to fetch: URL resolves to a blocked address");
    }
    const failures: string[] = [];
    let sawBlocked = false;
    for (const candidate of candidates) {
      try {
        const res = await fetch(candidate, {
          redirect: "follow",
          headers: {
            "User-Agent": BROWSER_UA,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
        });
        if (!res.ok) {
          const kind = classifyFetchFailure(res.status);
          failures.push(`${candidate} HTTP ${res.status}`);
          if (kind === "blocked") sawBlocked = true;
          continue;
        }
        const contentType = res.headers.get("content-type") || "";
        const html = await res.text();
        if (!html.trim()) {
          failures.push(`${candidate} returned empty body`);
          continue;
        }
        const kit = extractBrandKitFromHtml(candidate, html);
        kit.extraction_method = "fetch";
        // Deep pass: external CSS, CSS variables, theme-color, manifest,
        // Google Fonts, and the logo ladder. This is what makes the video
        // actually use the site's own colors and logo without a browser worker.
        try {
          const deep = await extractDeepBrandSignals(candidate, html);
          applyDeepBrandSignals(kit, deep);
        } catch {
          kit.confidence_flags.push("deep_extraction_failed");
        }
        await enrichColorsFromLogo(kit);
        await Promise.all([attachHeroScreenshot(kit, userId, 14000), persistBrandLogo(kit, userId)]);
        auditBrandKitQuality(kit);
        if (!isCaptureApiConfigured()) kit.confidence_flags.push("capture_api_unconfigured");
        if (!/html|text|xml/i.test(contentType)) kit.confidence_flags.push("content_type_not_html");
        if (!process.env.DASHSCOPE_API_KEY) kit.confidence_flags.push("ai_broll_unavailable");
        warmCapturePages(kit);
        return enrichWebsiteBrandKit(kit);
      } catch (err) {
        failures.push(`${candidate} ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const meta = await fetchBasicMetaFallback(normalizedUrl);
    if (meta) {
      const kit = buildFallbackBrandKit(normalizedUrl, failures);
      if (sawBlocked) kit.confidence_flags.push("site_blocked", "blocked_http_403_or_429");
      const merged = mergeMetaIntoBrandKit(kit, meta);
      await enrichColorsFromLogo(merged);
      await Promise.all([attachHeroScreenshot(merged, userId, 14000), persistBrandLogo(merged, userId)]);
      if (!process.env.DASHSCOPE_API_KEY) merged.confidence_flags.push("ai_broll_unavailable");
      return enrichWebsiteBrandKit(merged);
    }
    const fallback = buildFallbackBrandKit(normalizedUrl, failures);
    fallback.extraction_method = "fallback";
    if (sawBlocked) fallback.confidence_flags.push("site_blocked", "blocked_http_403_or_429");
    if (!isCaptureApiConfigured()) fallback.confidence_flags.push("capture_api_unconfigured");
    if (!process.env.DASHSCOPE_API_KEY) fallback.confidence_flags.push("ai_broll_unavailable");
    await enrichColorsFromLogo(fallback);
    await Promise.all([attachHeroScreenshot(fallback, userId, 14000), persistBrandLogo(fallback, userId)]);
    auditBrandKitQuality(fallback);
    return enrichWebsiteBrandKit(fallback);
  });

/**
 * Merge deep-extracted signals into the kit, preferring real signals over the
 * weak raw-HTML regex results.
 */
function applyDeepBrandSignals(kit: WebsiteBrandKit, deep: DeepBrandSignals) {
  if (deep.colors.length >= 2) {
    kit.brand.primary_color_hex = deep.colors[0] || kit.brand.primary_color_hex;
    kit.brand.secondary_color_hex = deep.colors[1] || kit.brand.secondary_color_hex;
    kit.brand.accent_color_hex = deep.colors[2] || deep.colors[0] || kit.brand.accent_color_hex;
    kit.brand.neutral_color_hex = deep.colors[3] || kit.brand.neutral_color_hex;
    kit.confidence_flags = kit.confidence_flags.filter((flag) => flag !== "color_extraction_low_confidence");
    kit.confidence_flags.push("site_colors_extracted");
  } else if (deep.themeColor) {
    kit.brand.primary_color_hex = deep.themeColor;
    kit.confidence_flags.push("theme_color_only");
  }
  if (deep.fonts.length > 0) {
    kit.brand.heading_typeface = deep.fonts[0];
    kit.brand.body_typeface = deep.fonts[1] || deep.fonts[0];
    kit.confidence_flags.push("site_fonts_extracted");
  }
  if (deep.fontUrls.length > 0) {
    kit.font_urls = deep.fontUrls;
  }
  if (deep.logoUrl) {
    // Deep ladder logos (header <img>, JSON-LD, apple-touch-icon) beat the
    // og:image guess from raw HTML parsing.
    const deepLogoIsStrong = deep.logoSource !== "favicon_service";
    if (deepLogoIsStrong || !kit.brand.logo_asset_path) {
      kit.brand.logo_asset_path = deep.logoUrl;
    }
    kit.confidence_flags = kit.confidence_flags.filter((flag) => flag !== "no_logo_detected");
    kit.confidence_flags.push(`logo_${deep.logoSource || "detected"}`);
  }
  if (!kit.hero_screenshot_url && deep.ogImage && !/logo|icon/i.test(deep.ogImage)) {
    kit.hero_screenshot_url = deep.ogImage;
  }
  return kit;
}

/**
 * When neither the page nor its CSS exposed a real (chromatic) brand color —
 * common with CSS-in-JS apps — pull the dominant colors out of the logo
 * image itself. The logo always carries the brand color.
 */
async function enrichColorsFromLogo(kit: WebsiteBrandKit) {
  const current = [kit.brand.primary_color_hex, kit.brand.secondary_color_hex, kit.brand.accent_color_hex];
  if (kitHasChromaticColor(current)) return;
  const logo = kit.brand.logo_asset_path;
  if (!logo || logo.startsWith("data:")) return;
  try {
    const dominant = await extractDominantLogoColors(logo);
    if (dominant.length === 0) return;
    kit.brand.primary_color_hex = dominant[0];
    kit.brand.accent_color_hex = dominant[1] || dominant[0];
    kit.confidence_flags = kit.confidence_flags.filter((flag) => flag !== "color_extraction_low_confidence");
    kit.confidence_flags.push("logo_colors_extracted");
  } catch {
    // logo color extraction is best-effort
  }
}

/**
 * Re-host the logo on Supabase Storage so the Remotion export (which needs
 * CORS-clean images) and previews render it reliably.
 */
async function persistBrandLogo(kit: WebsiteBrandKit, userId: string) {
  const logo = kit.brand.logo_asset_path;
  if (!logo || logo.startsWith("data:")) return;
  const hosted = await persistRemoteImage({
    url: logo,
    userId,
    projectId: `brand-${Date.now()}`,
    beatId: "logo",
    kind: "logo",
  });
  if (hosted) kit.brand.logo_asset_path = hosted;
}

/**
 * Queue screenshot renders for the capture-worthy pages so the per-beat
 * screenshot fallback is usually ready by the time clip generation runs.
 */
function warmCapturePages(kit: WebsiteBrandKit) {
  const pages = kit.site_map.filter((page) => page.capture_worthy).slice(0, 4);
  for (const page of pages) {
    warmScreenshot(page.page);
  }
}

/**
 * Attach a real homepage screenshot as the hero background. warmScreenshot()
 * has already queued the render, so this usually resolves within the budget.
 */
async function attachHeroScreenshot(kit: WebsiteBrandKit, userId: string, budgetMs: number) {
  try {
    const heroUrl = await getScreenshotImageUrl({
      url: kit.source_url,
      userId,
      projectId: `brand-${Date.now()}`,
      beatId: "hero",
      budgetMs,
    });
    if (heroUrl) {
      kit.hero_screenshot_url = heroUrl;
      kit.confidence_flags.push("hero_screenshot_captured");
    }
  } catch {
    // hero background is optional
  }
}

export function buildWebsiteVideoPlan({
  brandKit,
  videoType,
  targetDurationSeconds,
  availableAiBroll = true,
  clientStyleProfile = "",
}: {
  brandKit: WebsiteBrandKit;
  videoType: WebsiteVideoType;
  targetDurationSeconds: number;
  availableAiBroll?: boolean;
  clientStyleProfile?: string;
}): WebsiteVideoPlan {
  const duration = clamp(targetDurationSeconds, 180, 240);
  const template = getTemplate(videoType);
  const totalWeight = template.reduce((sum, beat) => sum + beat.weight, 0);
  let cursor = 0;
  const capturePages = brandKit.site_map.filter((page) => page.capture_worthy);
  const easing = clientStyleProfile.includes("cubic") ? "ease-in-out-cubic" : "ease-out-expo";
  const typefaces = unique([brandKit.brand.heading_typeface, brandKit.brand.body_typeface]).slice(0, 2);
  const colors = unique([
    brandKit.brand.primary_color_hex,
    brandKit.brand.secondary_color_hex,
    brandKit.brand.accent_color_hex,
    brandKit.brand.neutral_color_hex,
  ]).slice(0, 4);

  const beats = template.map((beat, index): WebsiteVideoBeat => {
    const isLast = index === template.length - 1;
    const beatDuration = isLast ? duration - cursor : Math.max(8, Math.round((duration * beat.weight) / totalWeight));
    const start = cursor;
    cursor += beatDuration;
    const method = chooseProductionMethod(beat.defaultMethod, availableAiBroll, index);
    const page = capturePages[index % Math.max(1, capturePages.length)] || {
      page: brandKit.source_url,
      purpose: "homepage overview",
      capture_worthy: true,
    };
    const voLine = fitVoiceover(buildVoiceLine(brandKit, videoType, beat.purpose, index), beatDuration);
    const transition = index === template.length - 1 ? "cross_dissolve" : method === "screen_capture" ? "match_cut" : "wipe";

    return {
      beat_id: `${videoType}-${index + 1}`,
      beat_purpose: beat.purpose,
      start_seconds: start,
      duration_seconds: beatDuration,
      production_method: method,
      screen_capture_spec: method === "screen_capture"
        ? {
            source_page: page.page,
            interaction_sequence: buildInteractionSequence(beat.purpose, page.page),
            framing: beat.purpose.toLowerCase().includes("mobile") ? "device_mockup_phone" : "device_mockup_laptop",
          }
        : null,
      motion_graphic_spec: method === "motion_graphic"
        ? {
            layout: buildMotionLayout(beat.purpose, index),
            elements: buildMotionElements(brandKit, beat.purpose, index),
            easing_family: easing,
            colors_used: colors,
            typefaces_used: typefaces,
          }
        : null,
      ai_broll_spec: method === "ai_broll"
        ? {
            subject: `real customers using ${brandKit.brand.name}`,
            style: `${brandKit.brand.voice_tone}, brand colors ${colors.join(", ")}`,
            continuity: "minority context shot only; do not invent product UI claims",
          }
        : null,
      vo_line: voLine,
      transition_out: transition,
    };
  });

  const lint = scoreProductionValue({
    colorsUsed: beats.flatMap((beat) => beat.motion_graphic_spec?.colors_used || []),
    easingCurvesUsed: beats.flatMap((beat) => beat.motion_graphic_spec?.easing_family || []),
    typefacesUsed: beats.flatMap((beat) => beat.motion_graphic_spec?.typefaces_used || []),
    transitionTypesUsed: beats.map((beat) => beat.transition_out),
  });

  return {
    video_type: videoType,
    total_duration_seconds: beats.reduce((sum, beat) => sum + beat.duration_seconds, 0),
    beats,
    music_plan: {
      bpm_range: videoType === "user_manual" ? "84-100 BPM" : videoType === "saas_launch" ? "118-132 BPM" : "96-118 BPM",
      energy_curve:
        videoType === "user_manual"
          ? "steady, calm, chaptered"
          : videoType === "saas_launch"
            ? "steady build, peak at feature reveal, confident CTA resolve"
            : "polished mid-energy arc with a clean final brand resolve",
      downbeat_aligned_beats: beats.filter((_, index) => index === 0 || index === beats.length - 1 || index % 2 === 0).map((beat) => beat.beat_id),
    },
    production_value_self_check: {
      ...lint,
      colors_used_total: new Set(beats.flatMap((beat) => beat.motion_graphic_spec?.colors_used || [])).size,
      typefaces_used_total: new Set(beats.flatMap((beat) => beat.motion_graphic_spec?.typefaces_used || [])).size,
      easing_families_used: new Set(beats.flatMap((beat) => beat.motion_graphic_spec?.easing_family || [])).size,
      transition_types_used: new Set(beats.map((beat) => beat.transition_out)).size,
      verdict: lint.verdict === "ship" ? "pass" : "needs_revision",
    },
  };
}

export function scoreProductionValue(spec: MotionCompositionSpec): LintResult {
  const flags: string[] = [];
  if (new Set(spec.colorsUsed).size > 4) flags.push("too_many_colors");
  if (new Set(spec.easingCurvesUsed).size > 2) flags.push("inconsistent_easing_family");
  if (new Set(spec.typefacesUsed).size > 2) flags.push("too_many_typefaces");
  if (new Set(spec.transitionTypesUsed).size > 3) flags.push("inconsistent_transitions");
  const score = Math.max(0, 1 - flags.length * 0.15);
  const verdict = flags.length === 0 ? "ship" : flags.length <= 2 ? "revise" : "redesign";
  return { score, flags, verdict };
}

function extractBrandKitFromHtml(url: string, html: string): WebsiteBrandKit {
  const text = cleanText(stripTags(html));
  const title = decodeHtml(matchFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || new URL(url).hostname.replace(/^www\./, ""));
  const description = decodeHtml(
    matchFirst(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
    matchFirst(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    "",
  );
  const colors = extractColors(html);
  const fonts = extractFonts(html);
  const navLinks = extractNavLinks(url, html);
  // Prefer explicit logo images over icons; og:image is a social banner, not
  // a logo, so it is only a last resort here (deep extraction refines this).
  const logo =
    absolutizeUrl(url, matchFirst(html, /<img[^>]+class=["'][^"']*logo[^"']*["'][^>]+src=["']([^"']+)["']/i)) ||
    absolutizeUrl(url, matchFirst(html, /<img[^>]+src=["']([^"']+)["'][^>]+class=["'][^"']*logo[^"']*["']/i)) ||
    absolutizeUrl(url, matchFirst(html, /<img[^>]+alt=["'][^"']*logo[^"']*["'][^>]+src=["']([^"']+)["']/i)) ||
    absolutizeUrl(url, matchFirst(html, /<img[^>]+src=["']([^"']*logo[^"']*)["']/i)) ||
    absolutizeUrl(url, matchFirst(html, /<link[^>]+rel=["']apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i)) ||
    absolutizeUrl(url, matchFirst(html, /<link[^>]+rel=["'](?:icon|shortcut icon)["'][^>]+href=["']([^"']+)["']/i)) ||
    faviconServiceUrl(url, 128);
  const features = extractFeatureCandidates(text, description);
  const flags: string[] = [];
  if (colors.length < 3) flags.push("color_extraction_low_confidence");
  if (!description) flags.push("no_clear_tagline_found");
  if (!logo) flags.push("no_logo_detected");

  return {
    brand: {
      name: normalizeBrandName(title, url),
      tagline: description || null,
      primary_color_hex: colors[0] || "#ffffff",
      secondary_color_hex: colors[1] || "#111111",
      accent_color_hex: colors[2] || "#3b82f6",
      neutral_color_hex: colors[3] || "#0a0a0a",
      heading_typeface: fonts[0] || "Inter",
      body_typeface: fonts[1] || fonts[0] || "Inter",
      logo_asset_path: logo,
      voice_tone: inferVoiceTone(text),
    },
    product: {
      one_line_description: description || firstSentence(text) || `${normalizeBrandName(title, url)} website video`,
      primary_use_cases: features.slice(0, 5),
      key_features: features.slice(0, 6).map((feature) => ({ name: titleCase(feature.split(" ").slice(0, 4).join(" ")), benefit: feature })),
      pricing_signal: inferPricing(text),
      social_proof: inferSocialProof(text),
    },
    site_map: navLinks.length ? navLinks : [{ page: url, purpose: "homepage overview", capture_worthy: true }],
    confidence_flags: flags,
    source_url: url,
    extracted_at: new Date().toISOString(),
  };
}

async function buildBrandKitFromBrowserExtract(
  url: string,
  extract: NonNullable<Awaited<ReturnType<typeof requestBrowserExtract>>>,
  userId: string,
): Promise<WebsiteBrandKit> {
  const colors = extract.colors.length >= 3 ? extract.colors : ["#ffffff", "#111111", "#3b82f6", "#0a0a0a"];
  const fonts = extract.fonts.length ? extract.fonts : ["Inter", "Inter"];
  const flags: string[] = ["browser_extract_used"];
  if (colors.length < 3) flags.push("color_extraction_low_confidence");
  if (!extract.logo_url) flags.push("no_logo_detected");
  if (!extract.description) flags.push("no_clear_tagline_found");

  let heroUrl: string | undefined;
  if (extract.hero_screenshot_base64) {
    heroUrl =
      (await persistHeroScreenshot({
        userId,
        projectId: `brand-${Date.now()}`,
        imageBase64: extract.hero_screenshot_base64,
      })) || undefined;
  }

  const navLinks = extract.nav_links
    .filter((link) => link.label && link.href)
    .map((link) => ({
      page: link.href,
      purpose: link.label.toLowerCase(),
      capture_worthy: !/login|legal|privacy|terms|cookie/i.test(`${link.label} ${link.href}`),
    }));

  const text = extract.description || extract.title || "";
  const kit: WebsiteBrandKit = {
    brand: {
      name: normalizeBrandName(extract.title || "", url),
      tagline: extract.description || null,
      primary_color_hex: colors[0] || "#ffffff",
      secondary_color_hex: colors[1] || "#111111",
      accent_color_hex: colors[2] || "#3b82f6",
      neutral_color_hex: colors[3] || "#0a0a0a",
      heading_typeface: fonts[0] || "Inter",
      body_typeface: fonts[1] || fonts[0] || "Inter",
      // Never use the hero screenshot as a logo — favicon service is a better last resort.
      logo_asset_path: extract.logo_url || faviconServiceUrl(url, 128),
      voice_tone: inferVoiceTone(text),
    },
    product: {
      one_line_description: extract.description || `${normalizeBrandName(extract.title || "", url)} website video`,
      primary_use_cases: navLinks.slice(0, 5).map((p) => p.purpose),
      key_features: navLinks.slice(0, 4).map((p) => ({ name: titleCase(p.purpose), benefit: `Explore ${p.purpose} on the live site.` })),
      pricing_signal: null,
      social_proof: [],
    },
    site_map: navLinks.length ? navLinks : [{ page: url, purpose: "homepage overview", capture_worthy: true }],
    confidence_flags: flags,
    source_url: url,
    extracted_at: new Date().toISOString(),
    extraction_method: "browser",
    hero_screenshot_url: heroUrl,
    font_urls: extract.font_urls,
  };
  if (!isCaptureApiConfigured()) kit.confidence_flags.push("capture_api_unconfigured");
  await enrichColorsFromLogo(kit);
  await persistBrandLogo(kit, userId);
  return auditBrandKitQuality(kit);
}

function buildFallbackBrandKit(url: string, failures: string[]): WebsiteBrandKit {
  const parsed = new URL(url);
  const domain = parsed.hostname.replace(/^www\./, "");
  const brandName = titleCase(domain.split(".")[0].replace(/[-_]+/g, " "));
  return {
    brand: {
      name: brandName,
      tagline: null,
      primary_color_hex: "#ffffff",
      secondary_color_hex: "#111111",
      accent_color_hex: "#3b82f6",
      neutral_color_hex: "#0a0a0a",
      heading_typeface: "Inter",
      body_typeface: "Inter",
      // Google's favicon service resolves even when the site blocks us.
      logo_asset_path: faviconServiceUrl(url, 128),
      voice_tone: "clear, confident, product-focused",
    },
    product: {
      one_line_description: `${brandName} website video plan generated from the submitted URL. Live content extraction was unavailable, so verify claims before final render.`,
      primary_use_cases: [
        "Introduce the website and brand promise",
        "Walk viewers through the visible product pages",
        "Create a polished promo structure ready for screen capture",
      ],
      key_features: [
        { name: "Website Overview", benefit: "Use the homepage and available pages as the source of truth during capture." },
        { name: "Brand Promo", benefit: "Build a consistent motion-graphics and screen-capture plan around the submitted domain." },
        { name: "CTA Flow", benefit: "End with a clear visit-and-explore call to action." },
      ],
      pricing_signal: null,
      social_proof: [],
    },
    site_map: [
      { page: url, purpose: "homepage overview", capture_worthy: true },
      { page: new URL("/pricing", url).toString(), purpose: "pricing or plan check", capture_worthy: true },
      { page: new URL("/features", url).toString(), purpose: "feature deep-dive", capture_worthy: true },
    ],
    confidence_flags: [
      "live_fetch_failed",
      "fallback_brand_kit_used",
      "verify_claims_before_render",
      ...failures.slice(0, 3).map((failure) => `fetch_attempt: ${failure.slice(0, 120)}`),
    ],
    source_url: url,
    extracted_at: new Date().toISOString(),
    extraction_method: "fallback" as const,
  };
}

function buildFetchCandidates(url: string) {
  const parsed = new URL(url);
  const variants = new Set<string>();
  variants.add(parsed.toString());
  const https = new URL(parsed.toString());
  https.protocol = "https:";
  variants.add(https.toString());
  const http = new URL(parsed.toString());
  http.protocol = "http:";
  variants.add(http.toString());
  if (!parsed.hostname.startsWith("www.")) {
    const withWww = new URL(parsed.toString());
    withWww.hostname = `www.${parsed.hostname}`;
    variants.add(withWww.toString());
    const withWwwHttp = new URL(withWww.toString());
    withWwwHttp.protocol = "http:";
    variants.add(withWwwHttp.toString());
  }
  return Array.from(variants);
}

function getTemplate(type: WebsiteVideoType) {
  if (type === "saas_launch") {
    return [
      { purpose: "Cold open hook", weight: 10, defaultMethod: "motion_graphic" as ProductionMethod },
      { purpose: "Problem framing", weight: 30, defaultMethod: "ai_broll" as ProductionMethod },
      { purpose: "Product reveal", weight: 20, defaultMethod: "motion_graphic" as ProductionMethod },
      { purpose: "Feature walkthrough", weight: 90, defaultMethod: "screen_capture" as ProductionMethod },
      { purpose: "Differentiation and social proof", weight: 30, defaultMethod: "motion_graphic" as ProductionMethod },
      { purpose: "Call to action", weight: 20, defaultMethod: "motion_graphic" as ProductionMethod },
    ];
  }
  if (type === "user_demo") {
    return [
      { purpose: "Problem statement", weight: 20, defaultMethod: "motion_graphic" as ProductionMethod },
      { purpose: "Step-by-step walkthrough", weight: 140, defaultMethod: "screen_capture" as ProductionMethod },
      { purpose: "Outcome result", weight: 20, defaultMethod: "screen_capture" as ProductionMethod },
      { purpose: "Call to action", weight: 15, defaultMethod: "motion_graphic" as ProductionMethod },
    ];
  }
  if (type === "user_manual") {
    return [
      { purpose: "What you will accomplish", weight: 15, defaultMethod: "motion_graphic" as ProductionMethod },
      { purpose: "Numbered chaptered steps", weight: 195, defaultMethod: "screen_capture" as ProductionMethod },
      { purpose: "Recap and help", weight: 20, defaultMethod: "motion_graphic" as ProductionMethod },
    ];
  }
  return [
    { purpose: "Brand hook", weight: 15, defaultMethod: "motion_graphic" as ProductionMethod },
    { purpose: "Visual identity tour", weight: 105, defaultMethod: "screen_capture" as ProductionMethod },
    { purpose: "Value proposition", weight: 40, defaultMethod: "motion_graphic" as ProductionMethod },
    { purpose: "Call to action", weight: 20, defaultMethod: "motion_graphic" as ProductionMethod },
  ];
}

function chooseProductionMethod(method: ProductionMethod, availableAiBroll: boolean, _index: number) {
  if (method === "ai_broll" && !availableAiBroll) return "motion_graphic";
  return method;
}

function buildVoiceLine(kit: WebsiteBrandKit, type: WebsiteVideoType, purpose: string, index: number) {
  const brand = kit.brand.name;
  const tagline =
    kit.brand.tagline && !isWeakProductCopy(kit.brand.tagline, brand)
      ? kit.brand.tagline
      : !isWeakProductCopy(kit.product.one_line_description, brand)
        ? kit.product.one_line_description
        : null;
  const feature = kit.product.key_features[index % Math.max(1, kit.product.key_features.length)];
  const page = kit.site_map[index % Math.max(1, kit.site_map.length)];
  const hostname = (() => {
    try {
      return new URL(kit.source_url).hostname.replace(/^www\./, "");
    } catch {
      return brand.toLowerCase().replace(/\s+/g, "");
    }
  })();
  const lower = purpose.toLowerCase();

  if (/hook|brand hook|cold open/.test(lower)) {
    return tagline ? `${brand}. ${tagline}` : `Meet ${brand} — the AI assistant built for thoughtful, high-quality work.`;
  }
  if (/problem/.test(lower)) {
    const pain = kit.product.primary_use_cases[0] || feature?.benefit;
    return pain && !isWeakProductCopy(pain, brand)
      ? `Most teams waste hours on busywork. ${brand} helps you ${pain.toLowerCase()}.`
      : `Here's the everyday problem ${brand} was designed to solve.`;
  }
  if (/reveal|value proposition/.test(lower)) {
    return feature ? `Introducing ${feature.name}: ${feature.benefit}` : `${brand} brings powerful AI assistance into your daily workflow.`;
  }
  if (/walkthrough|tour|steps|demo/.test(lower)) {
    const pageLabel = page?.purpose && page.purpose !== "homepage overview" ? page.purpose : "the product";
    return `Let's explore ${pageLabel} on ${hostname} and see the experience in action.`;
  }
  if (/proof|social|differentiation/.test(lower)) {
    const proof = kit.product.social_proof[0] || feature?.benefit;
    return proof && !isWeakProductCopy(proof, brand)
      ? `${brand} earns trust: ${proof}.`
      : `See why professionals rely on ${brand} for serious work.`;
  }
  if (/cta|call to action/.test(lower)) {
    return `Ready to try ${brand}? Visit ${hostname} and start your first conversation today.`;
  }
  if (type === "user_manual") {
    return `Follow each on-screen step on ${hostname} to complete this section with confidence.`;
  }
  return feature ? `${beatPurposeFallback(purpose)}: ${feature.benefit}` : tagline || `${brand} — see it in action.`;
}

function beatPurposeFallback(purpose: string) {
  return purpose.split(" ").slice(0, 4).join(" ");
}

function buildInteractionSequence(purpose: string, page: string) {
  const lower = `${purpose} ${page}`.toLowerCase();
  if (/pricing|compare/.test(lower)) return ["wait:900", "scroll:650", "hover:a", "wait:900", "scroll:650"];
  if (/walkthrough|steps|demo|feature/.test(lower)) return ["wait:800", "scroll:520", "wait:500", "scroll:720", "hover:button", "wait:700"];
  return ["wait:900", "scroll:700", "wait:600", "scroll:700"];
}

function buildMotionLayout(purpose: string, index: number) {
  if (index === 0) return "full-frame kinetic headline with small logo lockup and one brand-color glow";
  if (purpose.toLowerCase().includes("proof")) return "three-column proof cards with restrained number/logo placeholders";
  if (purpose.toLowerCase().includes("cta")) return "centered logo, URL, and one clear call-to-action line";
  return "split headline plus feature-callout stack using brand colors only";
}

function buildMotionElements(kit: WebsiteBrandKit, purpose: string, index: number) {
  const feature = kit.product.key_features[index % Math.max(1, kit.product.key_features.length)]?.name || kit.product.one_line_description;
  return [
    { type: "logo", content: kit.brand.logo_asset_path || kit.brand.name, animation: "scale-in with slight overshoot reserved for brand moments" },
    { type: "headline", content: purpose, animation: "mask-wipe then settle using ease-out-expo" },
    { type: "supporting_copy", content: feature, animation: "staggered fade-rise after headline settles" },
  ];
}

function fitVoiceover(line: string, durationSeconds: number) {
  const minWords = Math.max(12, Math.floor(durationSeconds * 2.2));
  const maxWords = Math.max(minWords, Math.floor(durationSeconds * 2.8));
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length < minWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ");
}

function extractNavLinks(baseUrl: string, html: string) {
  const links: Array<{ page: string; purpose: string; capture_worthy: boolean }> = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && links.length < 12) {
    const label = cleanText(stripTags(match[2]));
    const href = absolutizeUrl(baseUrl, match[1]);
    if (!href || !label || label.length > 42) continue;
    const lower = `${label} ${href}`.toLowerCase();
    if (/privacy|terms|login|sign in|cookie|legal|facebook|twitter|linkedin|instagram/.test(lower)) continue;
    links.push({
      page: href,
      purpose: inferPagePurpose(label, href),
      capture_worthy: !/privacy|terms|login|signin|legal|footer/.test(lower),
    });
  }
  return uniqueBy(links, (item) => item.page);
}

function extractFeatureCandidates(text: string, preferredDescription?: string) {
  const sentences = text
    .split(/[.!?]\s+/)
    .map((s) => cleanText(s))
    .filter((s) => s.length > 32 && s.length < 160 && !isBoilerplateSentence(s));
  const ranked = sentences.filter((s) =>
    /create|manage|automate|build|generate|track|collaborate|secure|integrate|launch|analyze|design|video|ai|team|customer|product|scale|platform|service/i.test(s),
  );
  const base = unique((ranked.length ? ranked : sentences).slice(0, 8));
  if (preferredDescription && !isBoilerplateSentence(preferredDescription)) {
    return unique([preferredDescription, ...base]).slice(0, 8);
  }
  return base;
}

function extractColors(html: string) {
  const matches = html.match(/#[0-9a-fA-F]{6}\b/g) || [];
  const colors = unique(matches.map((color) => color.toLowerCase())).filter((color) => !["#ffffff", "#000000"].includes(color));
  return colors.slice(0, 5);
}

function extractFonts(html: string) {
  const fonts = Array.from(html.matchAll(/font-family\s*:\s*([^;"'}]+)/gi)).map((match) => match[1].split(",")[0].replace(/["']/g, "").trim());
  return unique(fonts).filter(Boolean).slice(0, 3);
}

function inferPagePurpose(label: string, href: string) {
  const lower = `${label} ${href}`.toLowerCase();
  if (/pricing/.test(lower)) return "pricing comparison";
  if (/feature|product|platform/.test(lower)) return "feature deep-dive";
  if (/case|customer|story|testimonial/.test(lower)) return "social proof";
  if (/docs|learn|guide|help/.test(lower)) return "education and support";
  if (/about|company/.test(lower)) return "brand credibility";
  return `${label} page`;
}

function inferPricing(text: string): WebsiteBrandKit["product"]["pricing_signal"] {
  const lower = text.toLowerCase();
  if (/free trial|free plan|freemium/.test(lower)) return "freemium";
  if (/pricing|starter|pro|enterprise|month|year/.test(lower)) return "tiered";
  if (/contact sales|talk to sales|enterprise/.test(lower)) return "enterprise/contact";
  return null;
}

function inferSocialProof(text: string) {
  const proof: string[] = [];
  if (/trusted by/i.test(text)) proof.push("trusted-by customer section detected");
  if (/testimonial|customers say|case study/i.test(text)) proof.push("customer proof content detected");
  if (/\b\d+[kKmM+]?\s+(customers|users|teams|companies)/i.test(text)) proof.push("usage scale claim detected");
  return proof.slice(0, 4);
}

function inferVoiceTone(text: string) {
  const lower = text.toLowerCase();
  if (/developer|api|docs|code|security/.test(lower)) return "confident, technical, minimal jargon";
  if (/creative|design|story|brand|video/.test(lower)) return "cinematic, creative, polished";
  if (/enterprise|secure|compliance|scale/.test(lower)) return "authoritative, calm, enterprise-ready";
  return "clear, confident, product-focused";
}

function normalizeUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

function absolutizeUrl(base: string, value?: string | null) {
  if (!value || value.startsWith("data:")) return null;
  try {
    return new URL(value, base).toString();
  } catch {
    return null;
  }
}

function stripTags(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function cleanText(value: string) {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function matchFirst(value: string, pattern: RegExp) {
  return value.match(pattern)?.[1]?.trim() || "";
}

function normalizeBrandName(title: string, url: string) {
  const cleaned = title.split(/[|\-–—]/)[0]?.trim();
  return cleaned || new URL(url).hostname.replace(/^www\./, "").split(".")[0] || "Website";
}

function firstSentence(text: string) {
  return text.split(/[.!?]\s+/).find((sentence) => sentence.length > 24 && sentence.length < 180) || "";
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function uniqueBy<T>(values: T[], key: (value: T) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
