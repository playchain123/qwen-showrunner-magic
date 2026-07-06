import { useEffect, useState } from "react";
import type { CompiledMotionElement, CompiledMotionSpec } from "@/lib/website-render-pipeline";

export type MotionGraphicColors = {
  primary?: string;
  secondary?: string;
  accent?: string;
  neutral?: string;
  headingFont?: string;
  bodyFont?: string;
  logoUrl?: string | null;
  fontUrls?: string[];
};

const FPS = 30;

function colorForToken(token: CompiledMotionElement["color_token"], colors: MotionGraphicColors) {
  switch (token) {
    case "primary":
      return colors.primary || "#ffffff";
    case "secondary":
      return colors.secondary || "#2a2a2a";
    case "accent":
      return colors.accent || "#3b82f6";
    default:
      return colors.neutral || "#a3a3a3";
  }
}

function easeOutExpo(t: number) {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function elementOpacity(el: CompiledMotionElement, frame: number, easing: (t: number) => number) {
  const local = frame - el.enter_frame;
  if (local < 0) return 0;
  const fadeIn = Math.min(1, easing(Math.min(1, local / 15)));
  if (el.exit_frame != null && frame > el.exit_frame) {
    const fadeOut = Math.min(1, (frame - el.exit_frame) / 12);
    return Math.max(0, fadeIn * (1 - fadeOut));
  }
  return fadeIn;
}

function elementTransform(el: CompiledMotionElement, frame: number, easing: (t: number) => number) {
  const local = frame - el.enter_frame;
  if (local < 0) return "translateY(24px) scale(0.96)";
  const t = easing(Math.min(1, local / 18));
  switch (el.enter_animation) {
    case "scale_overshoot": {
      const scale = 0.85 + t * 0.2 + (t > 0.7 ? Math.sin((t - 0.7) * Math.PI) * 0.04 : 0);
      return `scale(${scale})`;
    }
    case "mask_wipe":
      return `translateX(${(1 - t) * -40}px)`;
    case "path_draw":
      return `translateY(${(1 - t) * 12}px)`;
    default:
      return `translateY(${(1 - t) * 28}px)`;
  }
}

export function MotionGraphicRenderer({
  spec,
  brandName,
  colors = {},
  progress,
  frameOverride,
  animate = true,
  showFallbackBadge = false,
  logoUrl,
}: {
  spec: CompiledMotionSpec;
  brandName: string;
  colors?: MotionGraphicColors;
  progress?: number;
  frameOverride?: number;
  animate?: boolean;
  showFallbackBadge?: boolean;
  logoUrl?: string | null;
}) {
  const [frame, setFrame] = useState(frameOverride ?? 0);
  const durationFrames = Math.max(
    90,
    ...spec.elements.map((el) => (el.exit_frame ?? el.enter_frame + 45)),
  );

  useEffect(() => {
    if (typeof frameOverride === "number") {
      setFrame(frameOverride);
      return;
    }
    if (!animate) return;
    if (typeof progress === "number") {
      setFrame(Math.round(progress * durationFrames));
      return;
    }
    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - started) / 1000;
      setFrame(Math.round((elapsed * FPS) % durationFrames));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate, progress, durationFrames, frameOverride]);

  const easing = spec.easing_family === "ease_in_out_cubic" ? easeInOutCubic : easeOutExpo;
  const primary = colors.primary || "#141414";
  const secondary = colors.secondary || "#2a2a2a";
  const accent = colors.accent || "#3b82f6";
  const neutral = colors.neutral || "#0a0a0a";
  const bg = spec.background_treatment.includes("#")
    ? spec.background_treatment
    : `radial-gradient(circle at 22% 18%, ${accent}22, transparent 42%), linear-gradient(135deg, ${primary}, ${neutral} 58%, ${secondary})`;

  const headingFont = colors.headingFont || "Georgia, serif";
  const bodyFont = colors.bodyFont || "system-ui, sans-serif";
  const logoSrc = logoUrl || colors.logoUrl;

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: bg }}>
      {colors.fontUrls?.map((href) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      <div className="absolute inset-0 opacity-[0.12] bg-[linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:48px_48px]" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30" />

      {showFallbackBadge && (
        <div className="absolute top-4 left-4 z-20 rounded-full border border-amber-300/35 bg-amber-400/15 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-amber-200">
          Fallback visual
        </div>
      )}

      <div className="absolute left-8 top-8 text-[10px] uppercase tracking-[0.28em] text-white/45">
        {brandName}
      </div>

      <div
        className={`absolute inset-0 flex flex-col justify-center px-8 md:px-16 ${
          spec.layout === "split_headline_and_visual" ? "md:flex-row md:items-center md:gap-12" : ""
        }`}
      >
        <div className={`max-w-3xl ${spec.layout === "split_headline_and_visual" ? "md:flex-1" : "w-full"}`}>
          {spec.elements.map((el, index) => {
            const opacity = elementOpacity(el, frame, easing);
            if (opacity <= 0.01) return null;
            const color = colorForToken(el.color_token, colors);
            const transform = elementTransform(el, frame, easing);
            const isHeadline = el.type === "headline" || el.type === "logo";
            const isCta = el.type === "cta_button";
            const isLogo = el.type === "logo";
            return (
              <div
                key={`${el.type}-${index}`}
                className={`mb-4 ${isCta ? "inline-block" : ""}`}
                style={{ opacity, transform, color: isCta ? "#000" : color }}
              >
                {isLogo && logoSrc ? (
                  <img src={logoSrc} alt={brandName} className="h-14 md:h-20 w-auto object-contain" />
                ) : isCta ? (
                  <span
                    className="inline-flex rounded-full px-5 py-2.5 text-sm font-semibold"
                    style={{ background: accent, color: "#000" }}
                  >
                    {el.content}
                  </span>
                ) : (
                  <div
                    className={
                      isHeadline
                        ? "text-3xl md:text-5xl font-bold leading-tight tracking-tight"
                        : el.type === "feature_item"
                          ? "text-lg md:text-xl font-medium text-white/85"
                          : "text-base md:text-xl leading-relaxed text-white/75"
                    }
                    style={{ fontFamily: el.typeface_token === "heading" ? headingFont : bodyFont }}
                  >
                    {el.content}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {spec.layout === "split_headline_and_visual" && (
          <div
            className="hidden md:block md:flex-1 rounded-2xl border border-white/15 p-6"
            style={{
              background: `linear-gradient(145deg, ${accent}33, ${primary}55)`,
              transform: `translateY(${Math.sin(frame / 20) * 6}px)`,
            }}
          >
            <div className="text-xs uppercase tracking-widest text-white/50 mb-3">{spec.layout.replaceAll("_", " ")}</div>
            <div className="space-y-3">
              {spec.elements
                .filter((el) => el.type === "feature_item" || el.type === "subhead")
                .slice(0, 2)
                .map((el, i) => (
                  <div key={i} className="rounded-lg bg-black/30 px-4 py-3 text-sm text-white/80">
                    {el.content}
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
