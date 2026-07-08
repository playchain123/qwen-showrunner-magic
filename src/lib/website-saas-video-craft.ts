import { pickBgm } from "./free-sounds";
import type { WebsiteBrandKit, WebsiteVideoBeat, WebsiteVideoType } from "./website-video";

/** Narrative chapter label shown on each beat (SaaS promo arc). */
export function beatChapterLabel(index: number, purpose: string): string {
  const lower = purpose.toLowerCase();
  if (/hook|cold open|intro/.test(lower)) return "01 — Hook";
  if (/problem|pain/.test(lower)) return "02 — Problem";
  if (/reveal|value|differentiation/.test(lower)) return "03 — Value";
  if (/walkthrough|tour|demo|steps|manual|feature/.test(lower)) return "04 — Product";
  if (/proof|social|trust/.test(lower)) return "05 — Proof";
  if (/cta|call to action/.test(lower)) return "06 — CTA";
  return `${String(index + 1).padStart(2, "0")} — ${purpose.split(" ").slice(0, 2).join(" ")}`;
}

/** On-screen headline copy — brand story, not internal beat labels. */
export function beatDisplayHeadline(kit: WebsiteBrandKit, beat: WebsiteVideoBeat, index: number): string {
  const lower = beat.beat_purpose.toLowerCase();
  const brand = kit.brand.name;
  const tagline = kit.brand.tagline || kit.product.one_line_description;
  const feature = kit.product.key_features[index % Math.max(1, kit.product.key_features.length)];

  if (/hook|cold open|brand hook/.test(lower)) {
    return tagline && tagline.length < 72 ? tagline : brand;
  }
  if (/problem/.test(lower)) {
    const pain = kit.product.primary_use_cases[0];
    return pain ? `The problem: ${pain}` : `Why teams choose ${brand}`;
  }
  if (/reveal|value proposition/.test(lower)) {
    return feature?.name || `What ${brand} does`;
  }
  if (/walkthrough|tour|visual identity/.test(lower)) {
    return `See ${brand} in action`;
  }
  if (/proof|social|differentiation/.test(lower)) {
    return kit.product.social_proof[0] ? "Trusted worldwide" : `Built for scale`;
  }
  if (/cta|call to action/.test(lower)) {
    return `Get started with ${brand}`;
  }
  if (/manual|accomplish|recap/.test(lower)) {
    return beat.beat_purpose;
  }
  return feature?.name || beat.beat_purpose;
}

/** Supporting line under the headline — pulled from VO, trimmed. */
export function beatDisplaySubhead(beat: WebsiteVideoBeat, max = 120): string {
  const line = beat.vo_line.trim();
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1).trim()}…`;
}

/** Extract stat callouts from social proof strings (e.g. "10M+ users", "99.9% uptime"). */
export function extractStatCallouts(kit: WebsiteBrandKit): Array<{ value: string; label: string }> {
  const stats: Array<{ value: string; label: string }> = [];
  const sources = [...kit.product.social_proof, ...kit.product.key_features.map((f) => f.benefit)].filter(Boolean);

  for (const raw of sources) {
    const match = raw.match(/(\d[\d,.]*\+?%?)\s*([a-z][\w\s]{2,40})/i);
    if (match) {
      stats.push({ value: match[1], label: match[2].trim() });
      if (stats.length >= 3) break;
    }
  }

  if (stats.length === 0 && kit.product.key_features.length >= 2) {
    return kit.product.key_features.slice(0, 3).map((f) => ({
      value: f.name.split(" ").slice(0, 2).join(" "),
      label: f.benefit.slice(0, 48),
    }));
  }
  return stats;
}

/** Background music mood from video type + brand voice. */
export function pickWebsiteBgm(videoType: WebsiteVideoType, voiceTone?: string): string {
  const tone = (voiceTone || "").toLowerCase();
  if (videoType === "user_manual") return pickBgm("calm ambient soft");
  if (videoType === "saas_launch") return pickBgm("saas upbeat product launch");
  if (/calm|enterprise|trust|serious|financial/.test(tone)) return pickBgm("saas corporate cinematic");
  return pickBgm("saas promo upbeat");
}

/** CTA button label from brand + hostname. */
export function beatCtaLabel(kit: WebsiteBrandKit): string {
  try {
    const host = new URL(kit.source_url).hostname.replace(/^www\./, "");
    return `Visit ${host}`;
  } catch {
    return kit.brand.tagline || `Try ${kit.brand.name}`;
  }
}
