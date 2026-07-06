import { AbsoluteFill, Audio, useCurrentFrame } from "remotion";
import { Video } from "@remotion/media";
import type { CompiledMotionSpec } from "@/lib/website-render-pipeline";
import { MotionGraphicRenderer, type MotionGraphicColors } from "@/components/motion-graphic-renderer";

export type WebsiteRemotionBeatProps = {
  beatPurpose: string;
  voLine: string;
  brandName: string;
  colors: MotionGraphicColors;
  clipUrl?: string;
  motionSpec?: CompiledMotionSpec;
  audioUrl?: string;
  assetSource?: string;
};

export function WebsiteBeatComposition({
  beatPurpose,
  voLine,
  brandName,
  colors,
  clipUrl,
  motionSpec,
  audioUrl,
  assetSource,
}: WebsiteRemotionBeatProps) {
  const frame = useCurrentFrame();
  const spec =
    motionSpec ||
    ({
      beat_id: "remotion-fallback",
      layout: "full_frame_headline",
      elements: [
        {
          type: "headline",
          content: beatPurpose,
          enter_animation: "fade_rise",
          enter_frame: 4,
          exit_frame: null,
          color_token: "accent",
          typeface_token: "heading",
        },
        {
          type: "subhead",
          content: voLine,
          enter_animation: "mask_wipe",
          enter_frame: 18,
          exit_frame: null,
          color_token: "neutral",
          typeface_token: "body",
        },
      ],
      easing_family: "ease_out_expo",
      background_treatment: "solid #0a0a0a",
    } satisfies CompiledMotionSpec);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {clipUrl ? (
        <Video src={clipUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <MotionGraphicRenderer
          spec={spec}
          brandName={brandName}
          colors={colors}
          logoUrl={colors.logoUrl}
          frameOverride={frame}
          animate={false}
          showFallbackBadge={assetSource === "fallback"}
        />
      )}
      {audioUrl ? <Audio src={audioUrl} /> : null}
    </AbsoluteFill>
  );
}
