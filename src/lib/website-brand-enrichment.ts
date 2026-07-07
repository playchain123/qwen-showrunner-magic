import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { WebsiteBrandKit, WebsiteVideoPlan } from "./website-video";
import { isBoilerplateSentence, isWeakProductCopy } from "./website-site-resilience";
import { MODEL_STRATEGY } from "./model-strategy";

const CHAT_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions";

export function needsBrandEnrichment(kit: WebsiteBrandKit) {
  return (
    kit.confidence_flags.includes("no_logo_detected") ||
    kit.confidence_flags.includes("low_quality_extraction") ||
    kit.confidence_flags.includes("no_clear_tagline_found") ||
    isWeakProductCopy(kit.product.one_line_description, kit.brand.name) ||
    isWeakProductCopy(kit.brand.tagline || "", kit.brand.name) ||
    kit.product.key_features.length < 2
  );
}

async function chatJson(prompt: string, system: string): Promise<Record<string, unknown> | null> {
  const dashKey = process.env.DASHSCOPE_API_KEY;
  if (dashKey) {
    try {
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${dashKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.QWEN_FAST_MODEL || MODEL_STRATEGY.fast,
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.6,
          max_tokens: 2000,
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = json.choices?.[0]?.message?.content;
        if (content) return JSON.parse(content) as Record<string, unknown>;
      }
    } catch {
      // fall through to Lovable gateway
    }
  }

  return null;
}

export async function enrichWebsiteBrandKit(kit: WebsiteBrandKit): Promise<WebsiteBrandKit> {
  if (!needsBrandEnrichment(kit)) return kit;

  const system = `You enrich website brand kits for promo video production. Return JSON only:
{
  "tagline": "compelling one-line product pitch, 12-24 words",
  "one_line_description": "what the product does for users, 20-40 words",
  "primary_use_cases": ["use case 1", "use case 2", "use case 3"],
  "key_features": [{"name": "Feature", "benefit": "clear user benefit"}],
  "social_proof": ["proof point"],
  "voice_tone": "clear, confident, product-focused"
}
Never repeat "X is Y" company identity lines. Write real product marketing copy.`;

  const prompt = `URL: ${kit.source_url}
Brand: ${kit.brand.name}
Current tagline: ${kit.brand.tagline || "none"}
Current description: ${kit.product.one_line_description || "none"}
Site pages: ${kit.site_map.slice(0, 6).map((p) => p.purpose).join(", ") || "homepage"}
Colors: ${kit.brand.primary_color_hex}, ${kit.brand.accent_color_hex}
Improve this into a strong SaaS promo brand kit.`;

  const parsed = await chatJson(prompt, system);
  if (!parsed) return kit;

  if (typeof parsed.tagline === "string" && !isWeakProductCopy(parsed.tagline, kit.brand.name)) {
    kit.brand.tagline = parsed.tagline;
  }
  if (typeof parsed.one_line_description === "string" && !isWeakProductCopy(parsed.one_line_description, kit.brand.name)) {
    kit.product.one_line_description = parsed.one_line_description;
  }
  if (Array.isArray(parsed.primary_use_cases)) {
    kit.product.primary_use_cases = parsed.primary_use_cases.filter((v): v is string => typeof v === "string").slice(0, 5);
  }
  if (Array.isArray(parsed.key_features)) {
    const features = parsed.key_features
      .filter((f): f is { name: string; benefit: string } => typeof f === "object" && f !== null && "name" in f && "benefit" in f)
      .slice(0, 6);
    if (features.length) kit.product.key_features = features;
  }
  if (Array.isArray(parsed.social_proof)) {
    kit.product.social_proof = parsed.social_proof.filter((v): v is string => typeof v === "string").slice(0, 4);
  }
  if (typeof parsed.voice_tone === "string") kit.brand.voice_tone = parsed.voice_tone;
  if (!kit.confidence_flags.includes("llm_brand_enrichment_applied")) {
    kit.confidence_flags.push("llm_brand_enrichment_applied");
  }
  return kit;
}

export const enrichWebsiteBrandKitServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ brandKit: z.custom<WebsiteBrandKit>() }).parse(input))
  .handler(async ({ data }) => enrichWebsiteBrandKit(data.brandKit));

export async function generateWebsiteBeatScripts(
  brandKit: WebsiteBrandKit,
  plan: WebsiteVideoPlan,
): Promise<Record<string, string>> {
  const system = `You write spoken voiceover lines for a website promo video. Return JSON:
{"beats":[{"beat_id":"...","vo_line":"natural spoken script"}]}
Rules:
- Each vo_line must be unique, conversational, and specific to the brand
- Match word count to beat duration (~2.5 words per second)
- No repeated phrases across beats
- No legal boilerplate
- Do not say "using the website as source of truth"`;

  const beatBrief = plan.beats
    .map((b) => `${b.beat_id} | ${b.beat_purpose} | ${b.duration_seconds}s | method: ${b.production_method}`)
    .join("\n");

  const prompt = `Brand: ${brandKit.brand.name}
URL: ${brandKit.source_url}
Tagline: ${brandKit.brand.tagline || brandKit.product.one_line_description}
Tone: ${brandKit.brand.voice_tone}
Features: ${brandKit.product.key_features.map((f) => `${f.name}: ${f.benefit}`).join("; ")}
Use cases: ${brandKit.product.primary_use_cases.join("; ")}

Beats:
${beatBrief}

Write vo_line for each beat_id.`;

  const parsed = await chatJson(prompt, system);
  if (!parsed || !Array.isArray(parsed.beats)) return {};

  const out: Record<string, string> = {};
  for (const item of parsed.beats) {
    if (typeof item === "object" && item !== null && "beat_id" in item && "vo_line" in item) {
      const beatId = String((item as { beat_id: string }).beat_id);
      const voLine = String((item as { vo_line: string }).vo_line).trim();
      if (beatId && voLine && !isBoilerplateSentence(voLine)) out[beatId] = voLine;
    }
  }
  return out;
}

export const generateWebsiteBeatScriptsServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ brandKit: z.custom<WebsiteBrandKit>(), plan: z.custom<WebsiteVideoPlan>() }).parse(input),
  )
  .handler(async ({ data }) => generateWebsiteBeatScripts(data.brandKit, data.plan));

export function applyBeatScripts(plan: WebsiteVideoPlan, scripts: Record<string, string>): WebsiteVideoPlan {
  if (!Object.keys(scripts).length) return plan;
  return {
    ...plan,
    beats: plan.beats.map((beat) => {
      const scripted = scripts[beat.beat_id];
      if (!scripted) return beat;
      const maxWords = Math.max(12, Math.floor(beat.duration_seconds * 2.5));
      const vo_line = scripted.split(/\s+/).slice(0, maxWords).join(" ");
      return { ...beat, vo_line };
    }),
  };
}
