import { generateSceneImage, pollVideo, submitVideo } from "@/lib/qwen.functions";
import type { CompiledMotionSpec, WebsiteBeatRenderAsset } from "@/lib/website-render-pipeline";
import { buildFallbackMotionCard } from "@/lib/website-render-pipeline";
import type { WebsiteBrandKit, WebsiteVideoBeat } from "@/lib/website-video";
import {
  compileBlockedFallbackMotion,
  isLiveFetchBlocked,
} from "@/lib/website-site-resilience";
import { getVideoPollDelayMs, runWithConcurrency } from "@/lib/makers-runtime";

const WEBSITE_VIDEO_SIZE = "1280*720";
const MAX_POLL_ATTEMPTS = 72;
const MAX_PARALLEL_CLIPS = 2;

type VideoModel = "happyhorse-1.1-t2v" | "wan2.2-t2v-plus" | "happyhorse-1.1-i2v" | "wan2.2-i2v-plus";

export type WebsiteClipResult = {
  beat_id: string;
  clip_url?: string;
  poster_url?: string;
  motion_spec?: CompiledMotionSpec;
  asset_status: "ready" | "failed";
  asset_source: WebsiteBeatRenderAsset["asset_source"];
  asset_error?: string;
  motion_only?: boolean;
};

function clipSeconds(beat: WebsiteVideoBeat) {
  return Math.min(8, Math.max(4, Math.round(beat.duration_seconds / 18) || 5));
}

function motionOnlyResult({
  beat_id,
  renderAsset,
  asset_source,
  asset_error,
}: {
  beat_id: string;
  renderAsset: WebsiteBeatRenderAsset;
  asset_source: WebsiteBeatRenderAsset["asset_source"];
  asset_error?: string;
}): WebsiteClipResult {
  const spec = renderAsset.motionGraphicSpec;
  if (!spec) {
    return {
      beat_id,
      asset_status: "failed",
      asset_source: "fallback",
      asset_error: asset_error || "No motion spec compiled",
    };
  }
  return {
    beat_id,
    motion_spec: spec,
    asset_status: "ready",
    asset_source,
    asset_error,
    motion_only: true,
  };
}

function buildStillPrompt(brandKit: WebsiteBrandKit, beat: WebsiteVideoBeat, renderAsset: WebsiteBeatRenderAsset) {
  const colors = `${brandKit.brand.primary_color_hex}, ${brandKit.brand.secondary_color_hex}, ${brandKit.brand.accent_color_hex}`;
  if (beat.production_method === "ai_broll") {
    return [
      renderAsset.brollPromptSpec?.positive_prompt || `Cinematic b-roll for ${brandKit.brand.name}.`,
      `Mood: ${brandKit.brand.voice_tone}. Beat: ${beat.beat_purpose}.`,
      `Photoreal, premium commercial lighting, shallow depth of field, no logos, no UI text.`,
    ].join(" ");
  }
  const motion = renderAsset.motionGraphicSpec;
  return [
    `Branded motion-graphic hero frame for ${brandKit.brand.name}.`,
    `Layout: ${motion?.layout?.replaceAll("_", " ") || "split headline and visual"}.`,
    `Headline concept: ${beat.beat_purpose}. Subhead: ${beat.vo_line}.`,
    `Colors ${colors}. Editorial typography, subtle grain, premium launch video aesthetic.`,
    `No watermarks, no random logos, crisp vector-like composition.`,
  ].join(" ");
}

function buildVideoPrompt(brandKit: WebsiteBrandKit, beat: WebsiteVideoBeat, renderAsset: WebsiteBeatRenderAsset) {
  const seconds = clipSeconds(beat);
  const negative =
    renderAsset.brollPromptSpec?.negative_prompt ||
    "watermark, logo, blurry, low quality, distorted text, UI glitches, random packaging";

  if (beat.production_method === "ai_broll") {
    return [
      renderAsset.brollPromptSpec?.positive_prompt || `Cinematic b-roll supporting ${beat.beat_purpose}.`,
      `One ${seconds}-second continuous shot. Natural camera movement, commercial finish.`,
      `Match ${brandKit.brand.name} tone: ${brandKit.brand.voice_tone}.`,
      `Negative prompt: ${negative}`,
    ].join(" ");
  }
  return [
    `One ${seconds}-second branded motion-graphic video for ${brandKit.brand.name}.`,
    `Animate headline "${beat.beat_purpose}" with elegant kinetic typography and color blocks.`,
    `Palette ${brandKit.brand.primary_color_hex} / ${brandKit.brand.accent_color_hex}.`,
    `Smooth ease-out motion, premium launch video, no stock clichés.`,
    `Negative prompt: ${negative}`,
  ].join(" ");
}

function videoAttempts(stillUrl?: string): Array<{ model: VideoModel; imageUrl?: string }> {
  const attempts: Array<{ model: VideoModel; imageUrl?: string }> = [];
  if (stillUrl) {
    attempts.push({ model: "happyhorse-1.1-i2v", imageUrl: stillUrl });
    attempts.push({ model: "wan2.2-i2v-plus", imageUrl: stillUrl });
  }
  attempts.push({ model: "happyhorse-1.1-t2v" });
  attempts.push({ model: "wan2.2-t2v-plus" });
  return attempts;
}

async function submitAndPollWebsiteClip(prompt: string, attempts: Array<{ model: VideoModel; imageUrl?: string }>) {
  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      const { task_id } = await submitVideo({
        data: {
          prompt,
          size: WEBSITE_VIDEO_SIZE,
          model: attempt.model,
          imageUrl: attempt.imageUrl,
        },
      });
      for (let pollAttempt = 0; pollAttempt < MAX_POLL_ATTEMPTS; pollAttempt++) {
        await new Promise((r) => setTimeout(r, getVideoPollDelayMs(pollAttempt)));
        const status = await pollVideo({ data: { task_id } });
        if (status.status === "SUCCEEDED" && status.video_url) return status.video_url;
        if (status.status === "FAILED") throw new Error(status.error || "Video task failed");
      }
      throw new Error("Timed out waiting for website clip");
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(failures.join(" | ") || "All video engines failed");
}

export async function generateWebsiteBeatClip({
  brandKit,
  beat,
  renderAsset,
  onProgress,
}: {
  brandKit: WebsiteBrandKit;
  beat: WebsiteVideoBeat;
  renderAsset: WebsiteBeatRenderAsset;
  onProgress?: (progress: number) => void;
}): Promise<WebsiteClipResult> {
  // Motion graphics render live in-browser — never burn Qwen video quota on them.
  if (beat.production_method === "motion_graphic") {
    onProgress?.(100);
    return motionOnlyResult({
      beat_id: beat.beat_id,
      renderAsset,
      asset_source: "compiled",
    });
  }

  // Blocked sites cannot be screen-captured — use branded motion fallback immediately.
  if (isLiveFetchBlocked(brandKit) && beat.production_method === "screen_capture") {
    const fallbackSpec = compileBlockedFallbackMotion(brandKit, beat, "site blocked");
    onProgress?.(100);
    return {
      beat_id: beat.beat_id,
      motion_spec: fallbackSpec,
      asset_status: "ready",
      asset_source: "fallback",
      asset_error: "site_blocked",
      motion_only: true,
    };
  }

  try {
    onProgress?.(8);
    const stillPrompt = buildStillPrompt(brandKit, beat, renderAsset);
    const negative =
      renderAsset.brollPromptSpec?.negative_prompt ||
      "watermark, logo, blurry, low quality, garbled text, deformed UI";

    let stillUrl: string | undefined;
    try {
      const still = await generateSceneImage({
        data: {
          prompt: stillPrompt,
          negativePrompt: negative,
          referenceImages: [],
          referenceWeight: 0.65,
        },
      });
      stillUrl = still.image_url;
      onProgress?.(28);
    } catch {
      onProgress?.(22);
    }

    const videoPrompt = buildVideoPrompt(brandKit, beat, renderAsset);
    const clipUrl = await submitAndPollWebsiteClip(videoPrompt, videoAttempts(stillUrl));
    onProgress?.(100);

    return {
      beat_id: beat.beat_id,
      clip_url: clipUrl,
      poster_url: stillUrl,
      asset_status: "ready",
      asset_source: stillUrl ? "generated" : "compiled",
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const fallbackSpec =
      renderAsset.motionGraphicSpec ||
      buildFallbackMotionCard(brandKit, beat, `Clip generation failed: ${reason.slice(0, 80)}`);
    return {
      beat_id: beat.beat_id,
      motion_spec: fallbackSpec,
      asset_status: "ready",
      asset_source: "fallback",
      asset_error: reason,
      motion_only: true,
    };
  }
}

export async function generateWebsiteBeatClips({
  brandKit,
  beats,
  assets,
  onBeatProgress,
}: {
  brandKit: WebsiteBrandKit;
  beats: WebsiteVideoBeat[];
  assets: Record<string, WebsiteBeatRenderAsset>;
  onBeatProgress?: (beatId: string, progress: number, status: "generating" | "ready" | "failed") => void;
}) {
  const results = new Map<string, WebsiteClipResult>();

  await runWithConcurrency(beats, MAX_PARALLEL_CLIPS, async (beat) => {
    const renderAsset = assets[beat.beat_id];
    if (!renderAsset) return;
    onBeatProgress?.(beat.beat_id, 5, "generating");
    const result = await generateWebsiteBeatClip({
      brandKit,
      beat,
      renderAsset,
      onProgress: (progress) => onBeatProgress?.(beat.beat_id, progress, "generating"),
    });
    results.set(beat.beat_id, result);
    onBeatProgress?.(beat.beat_id, 100, result.asset_status === "ready" ? "ready" : "failed");
  });

  return results;
}
