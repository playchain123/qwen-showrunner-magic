import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  BROWSER_UA,
  classifyFetchFailure,
  fetchBasicMetaFallback,
  mergeMetaIntoBrandKit,
} from "./website-site-resilience";

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
  production_value_self_check: LintResult & {
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

export const extractWebsiteBrandKit = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ url: z.string().url() }).parse(input))
  .handler(async ({ data }): Promise<WebsiteBrandKit> => {
    const normalizedUrl = normalizeUrl(data.url);
    const candidates = buildFetchCandidates(normalizedUrl);
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
        if (!/html|text|xml/i.test(contentType)) kit.confidence_flags.push("content_type_not_html");
        return kit;
      } catch (err) {
        failures.push(`${candidate} ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const meta = await fetchBasicMetaFallback(normalizedUrl);
    if (meta) {
      const kit = buildFallbackBrandKit(normalizedUrl, failures);
      if (sawBlocked) kit.confidence_flags.push("site_blocked", "blocked_http_403_or_429");
      return mergeMetaIntoBrandKit(kit, meta);
    }
    const fallback = buildFallbackBrandKit(normalizedUrl, failures);
    if (sawBlocked) fallback.confidence_flags.push("site_blocked", "blocked_http_403_or_429");
    return fallback;
  });

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
    matchFirst(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    matchFirst(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
    "",
  );
  const colors = extractColors(html);
  const fonts = extractFonts(html);
  const navLinks = extractNavLinks(url, html);
  const logo = absolutizeUrl(url, matchFirst(html, /<img[^>]+(?:alt=["'][^"']*logo[^"']*["'][^>]+src|src)=["']([^"']+)["']/i));
  const features = extractFeatureCandidates(text);
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
      logo_asset_path: null,
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

function chooseProductionMethod(method: ProductionMethod, availableAiBroll: boolean, index: number) {
  if (method === "ai_broll" && !availableAiBroll) return index % 2 === 0 ? "motion_graphic" : "screen_capture";
  return method;
}

function buildVoiceLine(kit: WebsiteBrandKit, type: WebsiteVideoType, purpose: string, index: number) {
  const brand = kit.brand.name;
  const feature = kit.product.key_features[index % Math.max(1, kit.product.key_features.length)]?.benefit || kit.product.one_line_description;
  if (purpose.toLowerCase().includes("cta")) return `Visit ${brand} to explore the product, compare the details, and take the next step when you are ready.`;
  if (purpose.toLowerCase().includes("walkthrough") || purpose.toLowerCase().includes("steps")) return `Now we move through the actual site experience, showing the pages and interactions that matter most for ${feature}.`;
  if (type === "user_manual") return `In this section, follow the on-screen steps carefully and use the site structure to complete the task with confidence.`;
  return `${brand} presents ${feature}, using the website itself as the source of truth for the story, visuals, and product flow.`;
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
  const maxWords = Math.max(8, Math.floor(durationSeconds * 2.8));
  return line.split(/\s+/).slice(0, maxWords).join(" ");
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

function extractFeatureCandidates(text: string) {
  const sentences = text.split(/[.!?]\s+/).map((s) => cleanText(s)).filter((s) => s.length > 32 && s.length < 160);
  const ranked = sentences.filter((s) => /create|manage|automate|build|generate|track|collaborate|secure|integrate|launch|analyze|design|video|ai|team|customer|product/i.test(s));
  return unique((ranked.length ? ranked : sentences).slice(0, 8));
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
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, " ");
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
