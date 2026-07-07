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
  heroBackgroundUrl?: string | null;
};

const FPS = 30;

function hexLightness(hex: string | undefined): number {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return 0.5;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

/** Compositions render on dark backgrounds — dark token colors would vanish. */
function readableOnDark(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  return hexLightness(color) < 0.38 ? fallback : color;
}

function colorForToken(token: CompiledMotionElement["color_token"], colors: MotionGraphicColors) {
  switch (token) {
    case "primary":
      return readableOnDark(colors.primary, "#ffffff");
    case "secondary":
      return readableOnDark(colors.secondary, "rgba(255,255,255,0.82)");
    case "accent":
      return readableOnDark(colors.accent, "#ffffff");
    default:
      return readableOnDark(colors.neutral, "rgba(255,255,255,0.78)");
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

/** Build a valid CSS background from the spec's descriptive treatment string. */
function buildBackground(treatment: string, colors: { primary: string; secondary: string; accent: string; neutral: string }) {
  const hexes = treatment.match(/#[0-9a-fA-F]{6}\b/g) || [];
  const base = hexes[0] || colors.neutral;
  const glow = hexes[1] || colors.primary;
  return `radial-gradient(circle at 24% 18%, ${glow}26, transparent 46%), radial-gradient(circle at 82% 88%, ${colors.accent}1f, transparent 42%), linear-gradient(160deg, ${base}, ${darken(base, 0.35)})`;
}

function darken(hex: string, amount: number) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(parseInt(hex.slice(1, 3), 16) * (1 - amount));
  const g = clamp(parseInt(hex.slice(3, 5), 16) * (1 - amount));
  const b = clamp(parseInt(hex.slice(5, 7), 16) * (1 - amount));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function BrandLogo({ src, brandName, className }: { src: string; brandName: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className="text-2xl md:text-4xl font-bold tracking-tight">{brandName}</span>;
  }
  return (
    <img
      src={src}
      alt={brandName}
      crossOrigin="anonymous"
      className={className || "h-14 md:h-20 w-auto object-contain"}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Real website screenshot inside a browser frame with slow Ken Burns motion,
 * plus a compact lower-third so the site itself stays the hero.
 */
function ScreenshotPresentation({
  spec,
  brandName,
  colors,
  frame,
  easing,
  logoSrc,
}: {
  spec: CompiledMotionSpec;
  brandName: string;
  colors: MotionGraphicColors;
  frame: number;
  easing: (t: number) => number;
  logoSrc?: string | null;
}) {
  const accent = readableOnDark(colors.accent, "#7dd3fc");
  const neutral = colors.neutral && hexLightness(colors.neutral) < 0.5 ? colors.neutral : "#0a0a0a";
  const enter = easing(Math.min(1, frame / 24));
  const kb = Math.min(1, frame / 450);
  const drift = Math.sin(frame / 130) * 0.35;
  const scale = 1.05 + kb * 0.11;
  const translateY = -(kb * 5 + drift);
  const headline = spec.elements.find((el) => el.type === "headline")?.content;
  const subhead = spec.elements.find((el) => el.type === "subhead")?.content;
  const pageLabel = (() => {
    try {
      const parsed = new URL(spec.screenshot_page_url || "");
      return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname === "/" ? "" : parsed.pathname}`;
    } catch {
      return brandName;
    }
  })();

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ background: `radial-gradient(circle at 30% 12%, ${accent}22, transparent 46%), linear-gradient(165deg, ${neutral}, ${darken(neutral, 0.4)})` }}
    >
      <div
        className="absolute inset-x-[6%] top-[7%] bottom-[20%] rounded-xl border border-white/15 shadow-2xl shadow-black/60 overflow-hidden"
        style={{
          opacity: enter,
          transform: `translateY(${(1 - enter) * 40}px) scale(${0.97 + enter * 0.03})`,
          background: "#101014",
        }}
      >
        <div className="flex h-8 items-center gap-2 border-b border-white/10 bg-black/60 px-3">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 flex-1 truncate rounded-md bg-white/10 px-3 py-0.5 text-[10px] text-white/60">
            {pageLabel}
          </span>
        </div>
        <div className="relative h-[calc(100%-2rem)] overflow-hidden">
          <img
            src={spec.screenshot_url || ""}
            alt={pageLabel}
            crossOrigin="anonymous"
            className="absolute inset-0 h-full w-full object-cover object-top"
            style={{ transform: `scale(${scale}) translateY(${translateY}%)`, transformOrigin: "center top" }}
          />
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 h-[26%] bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
      <div
        className="absolute left-[6%] bottom-[5%] right-[6%] flex items-end justify-between gap-6"
        style={{ opacity: easing(Math.min(1, Math.max(0, frame - 14) / 20)) }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            {logoSrc ? <BrandLogo src={logoSrc} brandName={brandName} className="h-7 md:h-9 w-auto object-contain" /> : null}
            <span className="text-[10px] uppercase tracking-[0.3em] text-white/55">{brandName}</span>
          </div>
          {headline ? (
            <div
              className="mt-2 truncate text-xl md:text-3xl font-semibold text-white"
              style={{ fontFamily: colors.headingFont }}
            >
              {headline}
            </div>
          ) : null}
          {subhead ? (
            <div className="mt-1 max-w-2xl text-xs md:text-sm leading-relaxed text-white/70 line-clamp-2" style={{ fontFamily: colors.bodyFont }}>
              {subhead}
            </div>
          ) : null}
        </div>
        <span
          className="hidden md:inline-flex shrink-0 items-center rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-wider"
          style={{ background: `${accent}26`, color: accent, border: `1px solid ${accent}55` }}
        >
          Live site
        </span>
      </div>
    </div>
  );
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
  const durationFrames = spec.screenshot_url
    ? 450
    : Math.max(90, ...spec.elements.map((el) => (el.exit_frame ?? el.enter_frame + 45)));

  useEffect(() => {
    if (typeof frameOverride === "number") {
      setFrame(frameOverride);
      return;
    }
    if (!animate) return;
    if (typeof progress === "number" && !spec.screenshot_url) {
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
  }, [animate, progress, durationFrames, frameOverride, spec.screenshot_url]);

  const easing = spec.easing_family === "ease_in_out_cubic" ? easeInOutCubic : easeOutExpo;
  const primary = colors.primary || "#141414";
  const secondary = colors.secondary || "#2a2a2a";
  const accent = colors.accent || "#3b82f6";
  const neutral = colors.neutral || "#0a0a0a";
  const headingFont = colors.headingFont || "Georgia, serif";
  const bodyFont = colors.bodyFont || "system-ui, sans-serif";
  const logoSrc = logoUrl || colors.logoUrl;

  if (spec.screenshot_url) {
    return (
      <>
        {colors.fontUrls?.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        <ScreenshotPresentation
          spec={spec}
          brandName={brandName}
          colors={colors}
          frame={frame}
          easing={easing}
          logoSrc={logoSrc}
        />
      </>
    );
  }

  const bg = buildBackground(spec.background_treatment, { primary, secondary, accent, neutral });
  const heroBg = colors.heroBackgroundUrl;

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: bg }}>
      {heroBg ? (
        <>
          <img src={heroBg} alt="" crossOrigin="anonymous" className="absolute inset-0 h-full w-full object-cover object-top scale-105 opacity-90" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          <div className="absolute inset-0 bg-black/72" />
        </>
      ) : null}
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

      <div className="absolute left-8 top-8 flex items-center gap-3">
        {logoSrc ? <BrandLogo src={logoSrc} brandName={brandName} className="h-6 w-auto object-contain" /> : null}
        <span className="text-[10px] uppercase tracking-[0.28em] text-white/45">{brandName}</span>
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
                  <BrandLogo src={logoSrc} brandName={brandName} />
                ) : isCta ? (
                  <span
                    className="inline-flex rounded-full px-5 py-2.5 text-sm font-semibold"
                    style={{ background: readableOnDark(accent, "#ffffff"), color: "#000" }}
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
