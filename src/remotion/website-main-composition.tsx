import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { wipe } from "@remotion/transitions/wipe";
import type { CompiledMotionSpec } from "@/lib/website-render-pipeline";
import type { MotionGraphicColors } from "@/components/motion-graphic-renderer";
import { WebsiteBeatComposition } from "./website-beat-composition";

const FPS = 30;
const TRANSITION_FRAMES = 15;

export type WebsiteRemotionBeat = {
  beat_id: string;
  beat_purpose: string;
  vo_line: string;
  duration_seconds: number;
  transition_out?: "cut" | "cross_dissolve" | "wipe" | "match_cut";
  clip_url?: string;
  motion_spec?: CompiledMotionSpec;
  vo_audio_url?: string;
  asset_source?: string;
};

export type WebsiteMainCompositionProps = {
  beats: WebsiteRemotionBeat[];
  brandName: string;
  colors: MotionGraphicColors;
};

function resolveTransition(kind?: WebsiteRemotionBeat["transition_out"]) {
  if (kind === "wipe") return wipe() as ReturnType<typeof fade>;
  if (kind === "cross_dissolve") return fade();
  return null;
}

export function WebsiteMainComposition({ beats, brandName, colors }: WebsiteMainCompositionProps) {
  if (!beats.length) {
    return (
      <WebsiteBeatComposition
        beatPurpose="No beats"
        voLine=""
        brandName={brandName}
        colors={colors}
      />
    );
  }

  return (
    <TransitionSeries>
      {beats.flatMap((beat, index) => {
        const durationInFrames = Math.max(30, Math.round(beat.duration_seconds * FPS));
        const presentation = index < beats.length - 1 ? resolveTransition(beat.transition_out) : null;
        const nodes = [
          <TransitionSeries.Sequence key={beat.beat_id} durationInFrames={durationInFrames}>
            <WebsiteBeatComposition
              beatPurpose={beat.beat_purpose}
              voLine={beat.vo_line}
              brandName={brandName}
              colors={colors}
              clipUrl={beat.clip_url}
              motionSpec={beat.motion_spec}
              audioUrl={beat.vo_audio_url}
              assetSource={beat.asset_source}
            />
          </TransitionSeries.Sequence>,
        ];
        if (presentation) {
          nodes.push(
            <TransitionSeries.Transition
              key={`transition-${beat.beat_id}`}
              presentation={presentation}
              timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
            />,
          );
        }
        return nodes;
      })}
    </TransitionSeries>
  );
}

export function websiteCompositionDurationFrames(beats: WebsiteRemotionBeat[]) {
  const beatFrames = beats.reduce((sum, beat) => sum + Math.max(30, Math.round(beat.duration_seconds * FPS)), 0);
  const transitions = Math.max(0, beats.length - 1);
  return Math.max(30, beatFrames - transitions * TRANSITION_FRAMES);
}
