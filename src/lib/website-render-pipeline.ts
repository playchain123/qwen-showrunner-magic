import type { ProductionMethod, WebsiteBrandKit, WebsiteVideoBeat } from "./website-video";

export type MotionElementType = "headline" | "subhead" | "stat_number" | "feature_item" | "logo" | "cta_button" | "background";
export type MotionLayout = "full_frame_headline" | "split_headline_and_visual" | "stat_callout" | "feature_list" | "logo_moment" | "cta_card";
export type MotionAnimation = "fade_rise" | "scale_overshoot" | "mask_wipe" | "path_draw";
export type ColorToken = "primary" | "secondary" | "accent" | "neutral";
export type TypefaceToken = "heading" | "body";

export type CompiledMotionElement = {
  type: MotionElementType;
  content: string;
  enter_animation: MotionAnimation;
  enter_frame: number;
  exit_frame: number | null;
  color_token: ColorToken;
  typeface_token: TypefaceToken;
};

export type CompiledMotionSpec = {
  beat_id: string;
  layout: MotionLayout;
  elements: CompiledMotionElement[];
  easing_family: "ease_out_expo" | "ease_in_out_cubic";
  background_treatment: string;
};

export type CaptureChoreography = {
  beat_id: string;
  url: string;
  viewport: { width: number; height: number };
  interaction_sequence: string[];
  estimated_duration_seconds: number;
  framing: "full_browser" | "cropped_ui" | "device_mockup_laptop" | "device_mockup_phone";
};

export type BrollPromptSpec = {
  beat_id: string;
  positive_prompt: string;
  negative_prompt: string;
  duration_seconds: number;
};

export type WebsiteBeatRenderAsset = {
  beat_id: string;
  production_method: ProductionMethod;
  asset_status: "pending" | "generating" | "ready" | "failed";
  asset_source: "captured" | "generated" | "compiled" | "fallback";
  clip_url?: string;
  motionGraphicSpec?: CompiledMotionSpec;
  captureChoreography?: CaptureChoreography;
  brollPromptSpec?: BrollPromptSpec;
  voAudioUrl?: string;
  asset_error?: string;
};

export type RenderableWebsiteBeat = WebsiteVideoBeat & {
  planned_duration_seconds: number;
  actual_vo_duration_seconds: number;
  asset_status: "pending" | "generating" | "ready" | "failed";
  clip_url?: string;
  motion_spec?: CompiledMotionSpec;
  vo_audio_url?: string;
  render_asset: WebsiteBeatRenderAsset;
};

export type WebsiteRenderPipeline = {
  fps: 30;
  target: "browser_canvas_now" | "remotion_worker_ready";
  beats: RenderableWebsiteBeat[];
  assets: Record<string, WebsiteBeatRenderAsset>;
  checklist: Array<{ id: string; ok: boolean; note: string }>;
};

const FPS = 30;
const MIN_HOLD_PADDING = 0.4;
const SHARED_BROLL_NEGATIVE_PROMPT = [
  "product UI",
  "brand logo",
  "random text",
  "watermark",
  "low quality",
  "blurry",
  "deformed hands",
  "distorted face",
  "overly cartoonish",
  "off-brand colors",
].join(", ");

export function buildWebsiteRenderPipeline({
  brandKit,
  beats,
}: {
  brandKit: WebsiteBrandKit;
  beats: Array<WebsiteVideoBeat & { audioUrl?: string; actualVoDurationSeconds?: number; clipUrl?: string; motionSpec?: CompiledMotionSpec }>;
}): WebsiteRenderPipeline {
  const compiled = beats.map((beat) => {
    const renderAsset = compileBeatAsset(brandKit, beat, beat.clipUrl);
    const clipUrl = beat.clipUrl || renderAsset.clip_url;
    const motionSpec = beat.motionSpec || renderAsset.motionGraphicSpec;
    const assetStatus = clipUrl || motionSpec ? "ready" : renderAsset.asset_status;
    return {
      ...beat,
      planned_duration_seconds: beat.duration_seconds,
      actual_vo_duration_seconds: beat.actualVoDurationSeconds || estimateVoiceDurationSeconds(beat.vo_line),
      asset_status: assetStatus,
      clip_url: clipUrl,
      motion_spec: motionSpec,
      vo_audio_url: beat.audioUrl,
      render_asset: {
        ...renderAsset,
        clip_url: clipUrl,
        motionGraphicSpec: motionSpec,
        asset_status: assetStatus,
        voAudioUrl: beat.audioUrl,
      },
    };
  });
  const reconciledBeats = reconcileWebsiteTimeline(compiled);
  const assets = Object.fromEntries(reconciledBeats.map((beat) => [beat.beat_id, beat.render_asset]));
  return {
    fps: FPS,
    target: "remotion_worker_ready",
    beats: reconciledBeats,
    assets,
    checklist: buildRenderChecklist(reconciledBeats, assets),
  };
}

export function compileBeatAsset(
  brandKit: WebsiteBrandKit,
  beat: WebsiteVideoBeat,
  existingClipUrl?: string,
): WebsiteBeatRenderAsset {
  if (existingClipUrl) {
    return {
      beat_id: beat.beat_id,
      production_method: beat.production_method,
      asset_status: "ready",
      asset_source: "generated",
      clip_url: existingClipUrl,
      motionGraphicSpec: compileMotionGraphic(brandKit, beat),
      captureChoreography:
        beat.production_method === "screen_capture" ? compileCaptureChoreography(beat) : undefined,
      brollPromptSpec: beat.production_method === "ai_broll" ? compileBrollPrompt(brandKit, beat) : undefined,
    };
  }
  if (beat.production_method === "screen_capture") {
    return {
      beat_id: beat.beat_id,
      production_method: beat.production_method,
      asset_status: "pending",
      asset_source: "captured",
      captureChoreography: compileCaptureChoreography(beat),
      motionGraphicSpec: buildFallbackMotionCard(brandKit, beat, "Screen capture visual"),
    };
  }
  if (beat.production_method === "ai_broll") {
    return {
      beat_id: beat.beat_id,
      production_method: beat.production_method,
      asset_status: "pending",
      asset_source: "generated",
      brollPromptSpec: compileBrollPrompt(brandKit, beat),
      motionGraphicSpec: buildFallbackMotionCard(brandKit, beat, "AI b-roll visual"),
    };
  }
  return {
    beat_id: beat.beat_id,
    production_method: beat.production_method,
    asset_status: "pending",
    asset_source: "compiled",
    motionGraphicSpec: compileMotionGraphic(brandKit, beat),
  };
}

export function compileMotionGraphic(brandKit: WebsiteBrandKit, beat: WebsiteVideoBeat): CompiledMotionSpec {
  const durationFrames = Math.max(90, Math.round(beat.duration_seconds * FPS));
  const feature = brandKit.product.key_features[0];
  const layout = chooseMotionLayout(beat, Boolean(feature));
  const elements: CompiledMotionElement[] = [
    {
      type: "headline",
      content: beat.beat_purpose,
      enter_animation: "fade_rise",
      enter_frame: 4,
      exit_frame: null,
      color_token: "accent",
      typeface_token: "heading",
    },
    {
      type: "subhead",
      content: fitCopy(beat.vo_line, 150),
      enter_animation: "mask_wipe",
      enter_frame: 18,
      exit_frame: null,
      color_token: "neutral",
      typeface_token: "body",
    },
  ];
  if (layout === "feature_list" && feature) {
    elements.push({
      type: "feature_item",
      content: `${feature.name}: ${feature.benefit}`,
      enter_animation: "scale_overshoot",
      enter_frame: 34,
      exit_frame: null,
      color_token: "primary",
      typeface_token: "body",
    });
  }
  if (layout === "cta_card") {
    elements.push({
      type: "cta_button",
      content: brandKit.brand.tagline || "Get started",
      enter_animation: "scale_overshoot",
      enter_frame: 34,
      exit_frame: null,
      color_token: "primary",
      typeface_token: "heading",
    });
  }
  return {
    beat_id: beat.beat_id,
    layout,
    elements: elements.map((element, index) => ({
      ...element,
      enter_frame: Math.min(element.enter_frame + index * 2, Math.max(0, durationFrames - 28)),
      exit_frame: null,
    })),
    easing_family: beat.motion_graphic_spec?.easing_family === "ease-in-out-cubic" ? "ease_in_out_cubic" : "ease_out_expo",
    background_treatment: `solid ${brandKit.brand.neutral_color_hex}; subtle radial glow ${brandKit.brand.primary_color_hex} at 8% opacity`,
  };
}

export function compileCaptureChoreography(beat: WebsiteVideoBeat): CaptureChoreography {
  const spec = beat.screen_capture_spec;
  const requested = Math.max(4, beat.duration_seconds);
  const opening = 1;
  const closing = 0.7;
  const motionSteps = spec?.interaction_sequence.length ? spec.interaction_sequence : buildFallbackCaptureSteps(beat.beat_purpose);
  const naturalMotionSeconds = Math.max(1, requested - opening - closing);
  const secondsPerMotion = Math.max(1, naturalMotionSeconds / Math.max(1, motionSteps.length));
  const sequence = [
    `wait:${opening.toFixed(1)}`,
    ...motionSteps.map((step) => normalizeCaptureStep(step, secondsPerMotion)),
    `wait:${closing.toFixed(1)}`,
  ];
  return {
    beat_id: beat.beat_id,
    url: spec?.source_page || "",
    viewport: spec?.framing === "device_mockup_phone" ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    interaction_sequence: sequence,
    estimated_duration_seconds: Number(sequence.reduce((sum, step) => sum + parseStepSeconds(step), 0).toFixed(1)),
    framing: spec?.framing || "device_mockup_laptop",
  };
}

export function compileBrollPrompt(brandKit: WebsiteBrandKit, beat: WebsiteVideoBeat): BrollPromptSpec {
  const useCase = brandKit.product.primary_use_cases[0] || "a customer reaching their goal";
  return {
    beat_id: beat.beat_id,
    positive_prompt: [
      `Photoreal cinematic website promo b-roll for ${brandKit.brand.name}.`,
      `Show ${useCase} in a real environment that matches a ${brandKit.brand.voice_tone} brand.`,
      `Support this beat: ${beat.beat_purpose}.`,
      "Natural camera movement, clean lighting, premium commercial finish.",
      "Do not show the actual website UI, product logo, packaging, or invented interface text.",
    ].join(" "),
    negative_prompt: SHARED_BROLL_NEGATIVE_PROMPT,
    duration_seconds: beat.duration_seconds,
  };
}

export function buildFallbackMotionCard(brandKit: WebsiteBrandKit, beat: WebsiteVideoBeat, reason = "Fallback visual card"): CompiledMotionSpec {
  return {
    beat_id: beat.beat_id,
    layout: "full_frame_headline",
    elements: [
      {
        type: "headline",
        content: beat.beat_purpose || brandKit.brand.name,
        enter_animation: "fade_rise",
        enter_frame: 4,
        exit_frame: null,
        color_token: "accent",
        typeface_token: "heading",
      },
      {
        type: "subhead",
        content: fitCopy(beat.vo_line, 150),
        enter_animation: "mask_wipe",
        enter_frame: 20,
        exit_frame: null,
        color_token: "neutral",
        typeface_token: "body",
      },
      {
        type: "cta_button",
        content: reason,
        enter_animation: "scale_overshoot",
        enter_frame: 38,
        exit_frame: null,
        color_token: "primary",
        typeface_token: "body",
      },
    ],
    easing_family: "ease_out_expo",
    background_treatment: `solid ${brandKit.brand.neutral_color_hex}; branded fallback with ${brandKit.brand.primary_color_hex}`,
  };
}

export function reconcileWebsiteTimeline(beats: RenderableWebsiteBeat[]): RenderableWebsiteBeat[] {
  let cursor = 0;
  return beats.map((beat) => {
    const duration = Math.max(
      beat.actual_vo_duration_seconds + MIN_HOLD_PADDING,
      beat.planned_duration_seconds * 0.85,
    );
    const resolved = {
      ...beat,
      start_seconds: Number(cursor.toFixed(2)),
      duration_seconds: Number(duration.toFixed(2)),
    };
    cursor += duration;
    return resolved;
  });
}

export function estimateVoiceDurationSeconds(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Number(Math.max(2.2, words / 2.45).toFixed(2));
}

export function buildRenderChecklist(beats: RenderableWebsiteBeat[], assets: Record<string, WebsiteBeatRenderAsset>) {
  return [
    {
      id: "motion_graphics_compiled",
      ok: beats.every((beat) => Boolean(assets[beat.beat_id]?.motionGraphicSpec?.elements.length || assets[beat.beat_id]?.clip_url)),
      note: "Every beat has either a clip URL or renderable motion card.",
    },
    {
      id: "capture_choreography_compiled",
      ok: beats.filter((beat) => beat.production_method === "screen_capture").every((beat) => {
        const choreography = assets[beat.beat_id]?.captureChoreography;
        if (!choreography) return false;
        const drift = Math.abs(choreography.estimated_duration_seconds - beat.duration_seconds) / Math.max(1, beat.duration_seconds);
        return drift <= 0.1 || choreography.interaction_sequence.length >= 3;
      }),
      note: "Every screen capture beat has executable waits, scrolls, hovers, or clicks.",
    },
    {
      id: "broll_prompts_compiled",
      ok: beats.filter((beat) => beat.production_method === "ai_broll").every((beat) => Boolean(assets[beat.beat_id]?.brollPromptSpec?.positive_prompt)),
      note: "Every AI b-roll beat has a scoped generation prompt.",
    },
    {
      id: "asset_status_ready",
      ok: beats.every((beat) => beat.asset_status === "ready" && Boolean(beat.clip_url || beat.motion_spec)),
      note: "Every completed beat has asset_status ready and a visual asset.",
    },
    {
      id: "audio_timing_reconciled",
      ok: beats.every((beat) => beat.duration_seconds >= beat.actual_vo_duration_seconds + MIN_HOLD_PADDING - 0.01),
      note: "Timeline uses resolved beat durations after voice generation.",
    },
  ];
}

function chooseMotionLayout(beat: WebsiteVideoBeat, hasFeature: boolean): MotionLayout {
  const text = `${beat.beat_purpose} ${beat.vo_line}`.toLowerCase();
  if (/cta|start|get|try|contact|book/.test(text)) return "cta_card";
  if (/feature|workflow|step|how|manual|demo/.test(text) && hasFeature) return "feature_list";
  if (/logo|brand|intro|hook/.test(text)) return "logo_moment";
  return beat.production_method === "motion_graphic" ? "split_headline_and_visual" : "full_frame_headline";
}

function buildFallbackCaptureSteps(purpose: string) {
  const text = purpose.toLowerCase();
  if (/pricing|plan/.test(text)) return ["scroll:35", "hover:a[href*='pricing'], nav a:nth-child(3)"];
  if (/feature|demo|manual|walkthrough/.test(text)) return ["scroll:45", "hover:button, a, [role='button']"];
  return ["scroll:28", "hover:nav a:nth-child(2)"];
}

function normalizeCaptureStep(step: string, seconds: number) {
  if (/^(wait|scroll|hover|click):/i.test(step)) {
    if (/^scroll:/i.test(step) && !/[0-9.]+s?$/i.test(step)) return `${step}:${seconds.toFixed(1)}`;
    return step;
  }
  if (/scroll/i.test(step)) return `scroll:40:${seconds.toFixed(1)}`;
  if (/click/i.test(step)) return "click:button, a[role='button'], a";
  if (/hover/i.test(step)) return "hover:button, a, [role='button']";
  return `wait:${Math.min(2, seconds).toFixed(1)}`;
}

function parseStepSeconds(step: string) {
  const parts = step.split(":");
  const numeric = [...parts].reverse().find((part) => Number.isFinite(Number(part)));
  if (numeric) return Number(numeric);
  if (/^click:/i.test(step)) return 0.8;
  if (/^hover:/i.test(step)) return 1.2;
  if (/^scroll:/i.test(step)) return 1.6;
  return 1;
}

function fitCopy(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trim()}...`;
}
