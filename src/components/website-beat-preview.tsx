import { useEffect, useRef } from "react";
import type { CompiledMotionSpec } from "@/lib/website-render-pipeline";
import { MotionGraphicRenderer, type MotionGraphicColors } from "@/components/motion-graphic-renderer";

export type WebsiteBeatPreviewColors = MotionGraphicColors;

export type WebsiteBeatPreviewProps = {
  brandName: string;
  title?: string;
  description?: string;
  productionMethod?: string;
  beatPurpose: string;
  voLine?: string;
  startSeconds?: number;
  durationSeconds?: number;
  progress?: number;
  colors?: WebsiteBeatPreviewColors;
  assetStatus?: "pending" | "generating" | "ready" | "failed";
  assetSource?: "captured" | "generated" | "compiled" | "fallback";
  clipUrl?: string;
  motionSpec?: CompiledMotionSpec;
  audioUrl?: string;
  autoPlayVideo?: boolean;
  muted?: boolean;
  onEnded?: () => void;
};

export function WebsiteBeatPreview({
  brandName,
  title,
  description,
  productionMethod = "motion_graphic",
  beatPurpose,
  voLine,
  startSeconds = 0,
  durationSeconds = 6,
  progress = 0,
  colors,
  assetStatus = "ready",
  assetSource,
  clipUrl,
  motionSpec,
  audioUrl,
  autoPlayVideo = false,
  muted = false,
  onEnded,
}: WebsiteBeatPreviewProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    audio.muted = muted;
    if (muted) return;
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  }, [audioUrl, muted, assetStatus, clipUrl, motionSpec?.beat_id]);

  const videoMuted = muted || Boolean(audioUrl);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clipUrl) return;
    video.muted = videoMuted;
    if (autoPlayVideo) {
      video.currentTime = 0;
      void video.play().catch(() => undefined);
    }
  }, [clipUrl, autoPlayVideo, videoMuted]);

  if (assetStatus === "pending" || assetStatus === "generating") {
    return (
      <div className="relative h-full w-full overflow-hidden bg-neutral-950 flex items-center justify-center text-center">
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:44px_44px] opacity-30" />
        <div className="relative">
          <div className="mx-auto mb-4 h-10 w-10 rounded-full border border-white/15 border-t-white/80 animate-spin" />
          <div className="text-sm font-medium text-white">Generating visuals...</div>
          <div className="mt-1 text-xs text-white/45">{beatPurpose}</div>
        </div>
        {audioUrl && <audio ref={audioRef} src={audioUrl} preload="auto" />}
      </div>
    );
  }

  const showFallbackBadge = assetSource === "fallback";

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {clipUrl ? (
        <video
          ref={videoRef}
          src={clipUrl}
          autoPlay={autoPlayVideo}
          muted={videoMuted}
          loop={!onEnded}
          playsInline
          preload="metadata"
          onEnded={onEnded}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : motionSpec ? (
        <MotionGraphicRenderer
          spec={motionSpec}
          brandName={brandName}
          colors={colors}
          progress={progress}
          animate={autoPlayVideo || progress > 0}
          showFallbackBadge={showFallbackBadge}
        />
      ) : (
        <MotionGraphicRenderer
          spec={buildEmergencyMotionSpec(beatPurpose, voLine || brandName)}
          brandName={brandName}
          colors={colors}
          progress={progress}
          animate
          showFallbackBadge
        />
      )}

      {clipUrl && (
        <CaptionOverlay
          brandName={brandName}
          title={title}
          productionMethod={productionMethod}
          beatPurpose={beatPurpose}
          voLine={voLine}
          startSeconds={startSeconds}
          durationSeconds={durationSeconds}
          description={description}
        />
      )}

      {showFallbackBadge && clipUrl && (
        <div className="absolute top-4 left-4 z-20 rounded-full border border-amber-300/35 bg-amber-400/15 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-amber-200">
          Fallback visual
        </div>
      )}

      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="auto" muted={muted} />}
    </div>
  );
}

function buildEmergencyMotionSpec(beatPurpose: string, voLine: string): CompiledMotionSpec {
  return {
    beat_id: "emergency",
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
  };
}

function CaptionOverlay({
  brandName,
  title,
  productionMethod,
  beatPurpose,
  voLine,
  startSeconds,
  durationSeconds,
  description,
}: Pick<WebsiteBeatPreviewProps, "brandName" | "title" | "productionMethod" | "beatPurpose" | "voLine" | "startSeconds" | "durationSeconds" | "description">) {
  return (
    <>
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/25 pointer-events-none" />
      <div className="absolute left-8 right-8 bottom-8 pointer-events-none">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-white/55">
          <span>{productionMethod?.replace("_", " ")}</span>
          <span>-</span>
          <span>
            {formatTime(startSeconds || 0)} / {formatTime((startSeconds || 0) + (durationSeconds || 0))}
          </span>
        </div>
        <div className="text-4xl font-semibold">{brandName}</div>
        <div className="mt-2 text-2xl text-white/85">{beatPurpose}</div>
        {voLine && <div className="mt-4 max-w-3xl text-lg text-white/75">{voLine}</div>}
      </div>
      <div className="absolute right-8 top-8 max-w-[34%] text-right pointer-events-none">
        {title && <div className="text-sm font-medium text-white/80">{title}</div>}
        {description && <div className="mt-3 text-xs text-white/45 line-clamp-3">{description}</div>}
      </div>
    </>
  );
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
