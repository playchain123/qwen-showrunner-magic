import type { WebsiteVideoBeat } from "./website-video";
import { reconcileWebsiteTimeline } from "./website-render-pipeline";
import type { WebsiteExportBeat } from "./website-remotion-export";

export type BeatPreviewForExport = WebsiteVideoBeat & {
  audioUrl?: string;
  actualVoDurationSeconds?: number;
  clipUrl?: string;
  motionSpec?: WebsiteExportBeat["motionSpec"];
  assetSource?: WebsiteExportBeat["assetSource"];
  renderAsset?: { motionGraphicSpec?: WebsiteExportBeat["motionSpec"] };
};

export function buildExportBeats(beats: BeatPreviewForExport[]): WebsiteExportBeat[] {
  const reconciled = reconcileWebsiteTimeline(
    beats.map((beat) => {
      const motionSpec = beat.motionSpec ?? beat.renderAsset?.motionGraphicSpec;
      return {
        ...beat,
        planned_duration_seconds: beat.duration_seconds,
        actual_vo_duration_seconds: beat.actualVoDurationSeconds || beat.duration_seconds,
        asset_status: "ready" as const,
        clip_url: beat.clipUrl,
        motion_spec: motionSpec,
        vo_audio_url: beat.audioUrl,
        render_asset: {
          beat_id: beat.beat_id,
          production_method: beat.production_method,
          asset_status: "ready",
          asset_source: (beat.assetSource || "compiled") as "captured" | "compiled" | "fallback" | "generated",
          clip_url: beat.clipUrl,
          motionGraphicSpec: motionSpec,
        },
      };
    }),
  );

  return reconciled.map((beat, index) => {
    const source = beats[index];
    return {
      beat_id: beat.beat_id,
      beat_purpose: beat.beat_purpose,
      vo_line: beat.vo_line,
      duration_seconds: beat.duration_seconds,
      transition_out: beat.transition_out,
      clipUrl: source.clipUrl,
      motionSpec: source.motionSpec ?? source.renderAsset?.motionGraphicSpec,
      audioUrl: source.audioUrl,
      assetSource: source.assetSource,
    };
  });
}
