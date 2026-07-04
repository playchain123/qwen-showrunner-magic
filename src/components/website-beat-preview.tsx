import type { CompiledMotionSpec } from "@/lib/website-render-pipeline";

export type WebsiteBeatPreviewColors = {
  primary?: string;
  secondary?: string;
  accent?: string;
  neutral?: string;
};

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
  clipUrl?: string;
  motionSpec?: CompiledMotionSpec;
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
  clipUrl,
  motionSpec,
  autoPlayVideo = false,
  muted = true,
  onEnded,
}: WebsiteBeatPreviewProps) {
  if (assetStatus === "pending" || assetStatus === "generating") {
    return (
      <div className="relative h-full w-full overflow-hidden bg-neutral-950 flex items-center justify-center text-center">
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:44px_44px] opacity-30" />
        <div className="relative">
          <div className="mx-auto mb-4 h-10 w-10 rounded-full border border-white/15 border-t-white/80 animate-spin" />
          <div className="text-sm font-medium text-white">Generating visuals...</div>
          <div className="mt-1 text-xs text-white/45">{beatPurpose}</div>
        </div>
      </div>
    );
  }

  if (clipUrl) {
    return (
      <div className="relative h-full w-full overflow-hidden bg-black">
        <video
          src={clipUrl}
          autoPlay={autoPlayVideo}
          muted={muted}
          loop={!onEnded}
          playsInline
          preload="metadata"
          onEnded={onEnded}
          className="absolute inset-0 h-full w-full object-cover"
        />
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
      </div>
    );
  }

  return (
    <MotionBeatCard
      brandName={brandName}
      title={title}
      description={description}
      productionMethod={productionMethod}
      beatPurpose={beatPurpose}
      voLine={voLine}
      startSeconds={startSeconds}
      durationSeconds={durationSeconds}
      progress={progress}
      colors={colors}
      motionSpec={motionSpec}
    />
  );
}

function MotionBeatCard({
  brandName,
  title,
  description,
  productionMethod,
  beatPurpose,
  voLine,
  startSeconds,
  durationSeconds,
  progress,
  colors,
  motionSpec,
}: Required<Pick<WebsiteBeatPreviewProps, "brandName" | "productionMethod" | "beatPurpose" | "startSeconds" | "durationSeconds" | "progress">> &
  Pick<WebsiteBeatPreviewProps, "title" | "description" | "voLine" | "colors" | "motionSpec">) {
  const primary = validColor(colors?.primary, "#141414");
  const secondary = validColor(colors?.secondary, "#2a2a2a");
  const accent = validColor(colors?.accent, "#ffffff");
  const neutral = validColor(colors?.neutral, "#080808");
  const shift = Math.round(progress * 28);
  const headline = motionSpec?.elements.find((item) => item.type === "headline")?.content || beatPurpose;
  const subhead = motionSpec?.elements.find((item) => item.type === "subhead")?.content || voLine;
  const feature = motionSpec?.elements.find((item) => item.type === "feature_item" || item.type === "cta_button")?.content;
  const logo = motionSpec?.elements.find((item) => item.type === "logo")?.content || brandName;
  const fallbackNote = motionSpec?.background_treatment?.toLowerCase().includes("fallback");

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{
        background:
          productionMethod === "screen_capture"
            ? `linear-gradient(135deg, ${neutral}, ${primary} 56%, ${secondary})`
            : `radial-gradient(circle at ${30 + shift}% ${25 + shift / 2}%, ${accent}33, transparent 28%), linear-gradient(135deg, ${primary}, ${neutral} 62%, ${secondary})`,
      }}
    >
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.07)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:42px_42px] opacity-20" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/25" />
      <div
        className="absolute rounded-2xl border border-white/15 bg-black/35 p-5 shadow-2xl shadow-black/50 backdrop-blur-sm"
        style={{
          left: productionMethod === "screen_capture" ? `${8 + shift / 3}%` : `${55 - shift / 5}%`,
          top: productionMethod === "screen_capture" ? `${15 + shift / 6}%` : "14%",
          width: productionMethod === "screen_capture" ? "52%" : "34%",
          minHeight: productionMethod === "screen_capture" ? "44%" : "48%",
          transform: `translateY(${Math.sin(progress * Math.PI) * -10}px)`,
        }}
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold uppercase tracking-[0.22em] text-white/55">{logo}</div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-white/35">
              {fallbackNote ? "Fallback motion graphic" : motionSpec?.layout?.replaceAll("_", " ") || "Compiled motion graphic"}
            </div>
          </div>
          <div className="h-10 w-10 shrink-0 rounded-full border border-white/20 flex items-center justify-center text-sm font-semibold" style={{ color: accent }}>
            {brandName.slice(0, 1).toUpperCase()}
          </div>
        </div>
        <div className="space-y-3">
          {[headline, feature || subhead, fallbackNote ? "Live capture unavailable - using branded motion fallback" : description].filter(Boolean).slice(0, 3).map((item, index) => (
            <div
              key={`${item}-${index}`}
              className="rounded-xl border border-white/10 p-3"
              style={{
                background: index === 0 ? `linear-gradient(90deg, ${accent}33, ${primary}44)` : "rgba(255,255,255,0.06)",
                transform: `translateX(${Math.sin(progress * Math.PI + index) * 8}px)`,
              }}
            >
              <div className="text-[10px] uppercase tracking-[0.2em] text-white/35">Layer {index + 1}</div>
              <div className={`mt-1 leading-snug ${index === 0 ? "text-lg font-semibold text-white" : "text-sm text-white/72"}`}>
                {item}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="absolute left-8 right-8 bottom-8 md:left-12 md:right-12 md:bottom-12">
        <div className="mb-5 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-white/55">
          <span>{productionMethod.replace("_", " ")}</span>
          <span>-</span>
          <span>{formatTime(startSeconds)} / {formatTime(startSeconds + durationSeconds)}</span>
        </div>
        <div className="max-w-3xl">
          <div className="text-3xl md:text-5xl font-semibold leading-tight">{brandName}</div>
          <div className="mt-2 text-xl md:text-3xl text-white/90 leading-tight">{headline}</div>
          {subhead && <div className="mt-4 max-w-2xl text-sm md:text-lg leading-relaxed text-white/72">{subhead}</div>}
          {feature && <div className="mt-4 inline-flex rounded-full bg-white px-4 py-2 text-xs font-medium text-black">{feature}</div>}
        </div>
      </div>
      <div className="absolute right-8 top-8 max-w-[34%] text-right">
        <div className="text-[10px] uppercase tracking-[0.24em] text-white/45">Website Video</div>
        {title && <div className="mt-1 text-sm font-medium text-white/80">{title}</div>}
        {description && <div className="mt-3 text-xs text-white/45 line-clamp-3">{description}</div>}
      </div>
    </div>
  );
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
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/25" />
      <div className="absolute left-8 right-8 bottom-8">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-white/55">
          <span>{productionMethod?.replace("_", " ")}</span>
          <span>-</span>
          <span>{formatTime(startSeconds || 0)} / {formatTime((startSeconds || 0) + (durationSeconds || 0))}</span>
        </div>
        <div className="text-4xl font-semibold">{brandName}</div>
        <div className="mt-2 text-2xl text-white/85">{beatPurpose}</div>
        {voLine && <div className="mt-4 max-w-3xl text-lg text-white/75">{voLine}</div>}
      </div>
      <div className="absolute right-8 top-8 max-w-[34%] text-right">
        {title && <div className="text-sm font-medium text-white/80">{title}</div>}
        {description && <div className="mt-3 text-xs text-white/45 line-clamp-3">{description}</div>}
      </div>
    </>
  );
}

function validColor(value: string | null | undefined, fallback: string) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
