import { canRenderMediaOnWeb, renderMediaOnWeb } from "@remotion/web-renderer";
import {
  WebsiteMainComposition,
  type WebsiteRemotionBeat,
  websiteCompositionDurationFrames,
} from "@/remotion/website-main-composition";
import type { MotionGraphicColors } from "@/components/motion-graphic-renderer";

export type WebsiteExportBeat = {
  beat_id: string;
  beat_purpose: string;
  vo_line: string;
  duration_seconds: number;
  transition_out?: "cut" | "cross_dissolve" | "wipe" | "match_cut";
  clipUrl?: string;
  motionSpec?: WebsiteRemotionBeat["motion_spec"];
  audioUrl?: string;
  assetSource?: string;
};

export async function exportWebsiteVideoRemotion({
  brandName,
  colors,
  beats,
  title,
  onProgress,
}: {
  brandName: string;
  colors: MotionGraphicColors;
  beats: WebsiteExportBeat[];
  title: string;
  onProgress?: (progress: number) => void;
}) {
  const remotionBeats: WebsiteRemotionBeat[] = beats.map((beat) => ({
    beat_id: beat.beat_id,
    beat_purpose: beat.beat_purpose,
    vo_line: beat.vo_line,
    duration_seconds: beat.duration_seconds,
    transition_out: beat.transition_out,
    clip_url: beat.clipUrl,
    motion_spec: beat.motionSpec,
    vo_audio_url: beat.audioUrl,
    asset_source: beat.assetSource,
  }));

  const durationInFrames = websiteCompositionDurationFrames(remotionBeats);
  const width = 1280;
  const height = 720;

  const capability = await canRenderMediaOnWeb({
    container: "mp4",
    videoCodec: "h264",
    width,
    height,
  });

  if (!capability.canRender) {
    const reason = capability.issues.map((issue) => issue.message).join("; ") || "WebCodecs export unavailable";
    throw new Error(reason);
  }

  const inputProps = { beats: remotionBeats, brandName, colors };
  const { getBlob } = await renderMediaOnWeb({
    composition: {
      component: WebsiteMainComposition,
      durationInFrames,
      fps: 30,
      width,
      height,
      id: "WebsiteMainComposition",
      defaultProps: inputProps,
    },
    inputProps,
    container: "mp4",
    videoCodec: capability.resolvedVideoCodec ?? "h264",
    audioCodec: capability.resolvedAudioCodec ?? "aac",
    onProgress: onProgress
      ? ({ progress }) => onProgress(Math.round(progress * 100))
      : undefined,
  });

  const blob = await getBlob();
  downloadBlob(blob, `${slugify(title)}.mp4`);
  return { format: "mp4" as const, size: blob.size };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "website-video";
}
