import { AbsoluteFill, Audio } from "remotion";
import { TransitionSeries, linearTiming, springTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import type { CompiledMotionSpec } from "@/lib/website-render-pipeline";
import type { MotionGraphicColors } from "@/components/motion-graphic-renderer";
import { WebsiteBeatComposition } from "./website-beat-composition";

const FPS = 30;
const TRANSITION_FRAMES = 12;
const MATCH_CUT_FRAMES = 6;

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
  /** Background music bed — low volume under VO. */
  bgmUrl?: string | null;
  bgmVolume?: number;
};

function resolveTransition(kind?: WebsiteRemotionBeat["transition_out"]) {
  if (kind === "wipe") return { presentation: wipe(), frames: TRANSITION_FRAMES };
  if (kind === "match_cut") return { presentation: slide({ direction: "from-right" }), frames: MATCH_CUT_FRAMES };
  if (kind === "cross_dissolve") return { presentation: fade(), frames: TRANSITION_FRAMES + 6 };
  return null;
}

export function WebsiteMainComposition({ beats, brandName, colors, bgmUrl, bgmVolume = 0.16 }: WebsiteMainCompositionProps) {
  if (!beats.length) {
    return (
      <WebsiteBeatComposition beatPurpose="No beats" voLine="" brandName={brandName} colors={colors} />
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {bgmUrl ? <Audio src={bgmUrl} volume={bgmVolume} loop /> : null}
      <TransitionSeries>
        {beats.flatMap((beat, index) => {
          const durationInFrames = Math.max(30, Math.round(beat.duration_seconds * FPS));
          const transition = index < beats.length - 1 ? resolveTransition(beat.transition_out) : null;
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
          if (transition) {
            nodes.push(
              <TransitionSeries.Transition
                key={`transition-${beat.beat_id}`}
                presentation={transition.presentation as never}
                timing={
                  beat.transition_out === "match_cut"
                    ? springTiming({ config: { damping: 200 }, durationInFrames: transition.frames })
                    : linearTiming({ durationInFrames: transition.frames })
                }
              />,
            );
          }
          return nodes;
        })}
      </TransitionSeries>
    </AbsoluteFill>
  );
}

export function websiteCompositionDurationFrames(beats: WebsiteRemotionBeat[]) {
  let total = beats.reduce((sum, beat) => sum + Math.max(30, Math.round(beat.duration_seconds * FPS)), 0);
  for (let i = 0; i < beats.length - 1; i++) {
    const kind = beats[i].transition_out;
    const overlap = kind === "match_cut" ? MATCH_CUT_FRAMES : kind === "cross_dissolve" ? TRANSITION_FRAMES + 6 : kind === "wipe" ? TRANSITION_FRAMES : 0;
    total -= overlap;
  }
  return Math.max(30, total);
}
