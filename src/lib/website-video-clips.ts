import { generateSceneImage, isSafeExternalUrl, pollVideo, submitVideo } from "@/lib/qwen.functions";
import type { CompiledMotionSpec, WebsiteBeatRenderAsset } from "@/lib/website-render-pipeline";
import { buildFallbackMotionCard, compileMotionGraphic } from "@/lib/website-render-pipeline";
import type { WebsiteBrandKit, WebsiteVideoBeat } from "@/lib/website-video";
import {
  compileBlockedFallbackMotion,
  isLiveFetchBlocked,
} from "@/lib/website-site-resilience";
import { captureBeatRemote } from "@/lib/website-screen-capture";
import { getVideoPollDelayMs, runWithConcurrency } from "@/lib/makers-runtime";

const WEBSITE_VIDEO_SIZE = "1920*1080";
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
  return [
    renderAsset.brollPromptSpec?.positive_prompt || `Cinematic b-roll for ${brandKit.brand.name}.`,
    `Mood: ${brandKit.brand.voice_tone}. Beat: ${beat.beat_purpose}.`,
    `Photoreal, premium commercial lighting, shallow depth of field, no logos, no UI text.`,
    `Brand colors ${colors}.`,
  ].join(" ");
}

function buildVideoPrompt(brandKit: WebsiteBrandKit, beat: WebsiteVideoBeat, renderAsset: WebsiteBeatRenderAsset) {
  const seconds = clipSeconds(beat);
  const negative =
    renderAsset.brollPromptSpec?.negative_prompt ||
    "watermark, logo, blurry, low quality, distorted text, UI glitches, random packaging, product UI";

  return [
    renderAsset.brollPromptSpec?.positive_prompt || `Cinematic b-roll supporting ${beat.beat_purpose}.`,
    `One ${seconds}-second continuous shot. Natural camera movement, commercial finish.`,
    `Match ${brandKit.brand.name} tone: ${brandKit.brand.voice_tone}.`,
    `Negative prompt: ${negative}`,
  ].join(" ");
}

function isAiVideoUnavailableError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("arrearage") ||
    lower.includes("allowlist") ||
    lower.includes("size must be") ||
    lower.includes("access denied") ||
    lower.includes("dashscope_api_key not configured")
  );
}

function videoAttempts(stillUrl?: string): Array<{ model: VideoModel; imageUrl?: string }> {
  const attempts: Array<{ model: VideoModel; imageUrl?: string }> = [];
  const safeStill = stillUrl && isSafeExternalUrl(stillUrl) ? stillUrl : undefined;
  if (safeStill) {
    attempts.push({ model: "happyhorse-1.1-i2v", imageUrl: safeStill });
    attempts.push({ model: "wan2.2-i2v-plus", imageUrl: safeStill });
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
      const message = err instanceof Error ? err.message : String(err);
      failures.push(message);
      if (isAiVideoUnavailableError(message)) break;
    }
  }
  throw new Error(failures.join(" | ") || "All video engines failed");
}

export async function generateWebsiteBeatClip({
  brandKit,
  beat,
  renderAsset,
  onProgress,
  userId,
  projectId,
  authToken,
}: {
  brandKit: WebsiteBrandKit;
  beat: WebsiteVideoBeat;
  renderAsset: WebsiteBeatRenderAsset;
  onProgress?: (progress: number) => void;
  userId?: string;
  projectId?: string;
  authToken?: string;
}): Promise<WebsiteClipResult> {
  if (beat.production_method === "motion_graphic") {
    onProgress?.(100);
    return motionOnlyResult({
      beat_id: beat.beat_id,
      renderAsset,
      asset_source: "compiled",
    });
  }

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

  if (beat.production_method === "screen_capture") {
    onProgress?.(12);
    const choreography = renderAsset.captureChoreography;
    if (!choreography) {
      const fallbackSpec =
        renderAsset.motionGraphicSpec ||
        buildFallbackMotionCard(brandKit, beat, "No capture choreography compiled");
      return {
        beat_id: beat.beat_id,
        motion_spec: fallbackSpec,
        asset_status: "ready",
        asset_source: "fallback",
        asset_error: "missing_choreography",
        motion_only: true,
      };
    }

    const capture = await captureBeatRemote({
      spec: choreography,
      userId: userId || "anonymous",
      projectId: projectId || `website-${Date.now()}`,
      authToken,
    });

    if (capture.ok) {
      onProgress?.(100);
      return {
        beat_id: beat.beat_id,
        clip_url: capture.clip_url,
        poster_url: brandKit.hero_screenshot_url || brandKit.brand.logo_asset_path || undefined,
        asset_status: "ready",
        asset_source: "captured",
      };
    }

    const reason = capture.blocked ? "site blocked" : capture.reason;
    const fallbackSpec = compileBlockedFallbackMotion(brandKit, beat, reason);
    onProgress?.(100);
    return {
      beat_id: beat.beat_id,
      motion_spec: fallbackSpec,
      asset_status: "ready",
      asset_source: "fallback",
      asset_error: reason,
      motion_only: true,
    };
  }

  // ai_broll only — Qwen video generation
  try {
    onProgress?.(8);
    const stillPrompt = buildStillPrompt(brandKit, beat, renderAsset);
    const negative =
      renderAsset.brollPromptSpec?.negative_prompt ||
      "watermark, logo, blurry, low quality, garbled text, deformed UI, product UI";

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
      asset_source: "generated",
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const shortReason = isAiVideoUnavailableError(reason) ? "ai_video_unavailable" : reason.slice(0, 80);
    const fallbackSpec =
      compileMotionGraphic(brandKit, beat) ||
      renderAsset.motionGraphicSpec ||
      buildFallbackMotionCard(brandKit, beat, shortReason);
    return {
      beat_id: beat.beat_id,
      motion_spec: fallbackSpec,
      asset_status: "ready",
      asset_source: "fallback",
      asset_error: shortReason,
      motion_only: true,
    };
  }
}

export async function generateWebsiteBeatClips({
  brandKit,
  beats,
  assets,
  onBeatProgress,
  userId,
  projectId,
  authToken,
}: {
  brandKit: WebsiteBrandKit;
  beats: WebsiteVideoBeat[];
  assets: Record<string, WebsiteBeatRenderAsset>;
  onBeatProgress?: (beatId: string, progress: number, status: "generating" | "ready" | "failed") => void;
  userId?: string;
  projectId?: string;
  authToken?: string;
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
      userId,
      projectId,
      authToken,
      onProgress: (progress) => onBeatProgress?.(beat.beat_id, progress, "generating"),
    });
    results.set(beat.beat_id, result);
    onBeatProgress?.(beat.beat_id, 100, result.asset_status === "ready" ? "ready" : "failed");
  });

  return results;
}
