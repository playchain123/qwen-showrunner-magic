import { useEffect, useState, type ReactNode } from "react";
import type { CompiledMotionElement, CompiledMotionSpec, MotionLayout } from "@/lib/website-render-pipeline";

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

function easeOutQuart(t: number) {
  return 1 - Math.pow(1 - t, 4);
}

function darken(hex: string, amount: number) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(parseInt(hex.slice(1, 3), 16) * (1 - amount));
  const g = clamp(parseInt(hex.slice(3, 5), 16) * (1 - amount));
  const b = clamp(parseInt(hex.slice(5, 7), 16) * (1 - amount));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function buildBackground(treatment: string, colors: { primary: string; secondary: string; accent: string; neutral: string }) {
  const hexes = treatment.match(/#[0-9a-fA-F]{6}\b/g) || [];
  const base = hexes[0] || colors.neutral;
  const glow = hexes[1] || colors.primary;
  const accent = hexes[2] || colors.accent;
  if (/mesh/i.test(treatment)) {
    return `radial-gradient(ellipse 80% 60% at 18% 22%, ${glow}40, transparent 55%), radial-gradient(ellipse 70% 50% at 82% 78%, ${accent}35, transparent 50%), linear-gradient(155deg, ${darken(base, 0.15)}, ${base})`;
  }
  if (/radial/i.test(treatment)) {
    return `radial-gradient(circle at 50% 40%, ${glow}30, transparent 55%), linear-gradient(180deg, ${darken(base, 0.2)}, ${base})`;
  }
  return `radial-gradient(circle at 24% 18%, ${glow}26, transparent 46%), radial-gradient(circle at 82% 88%, ${accent}1f, transparent 42%), linear-gradient(160deg, ${base}, ${darken(base, 0.35)})`;
}

function elementOpacity(el: CompiledMotionElement, frame: number, easing: (t: number) => number) {
  const local = frame - el.enter_frame;
  if (local < 0) return 0;
  const fadeIn = Math.min(1, easing(Math.min(1, local / 18)));
  if (el.exit_frame != null && frame > el.exit_frame) {
    const fadeOut = Math.min(1, (frame - el.exit_frame) / 14);
    return Math.max(0, fadeIn * (1 - fadeOut));
  }
  return fadeIn;
}

function elementTransform(el: CompiledMotionElement, frame: number, easing: (t: number) => number) {
  const local = frame - el.enter_frame;
  if (local < 0) {
    if (el.enter_animation === "blur_reveal") return "translateY(16px) scale(0.98)";
    return "translateY(28px) scale(0.96)";
  }
  const t = easing(Math.min(1, local / 22));
  switch (el.enter_animation) {
    case "scale_overshoot": {
      const scale = 0.82 + t * 0.22 + (t > 0.72 ? Math.sin((t - 0.72) * Math.PI) * 0.05 : 0);
      return `scale(${scale})`;
    }
    case "mask_wipe":
      return `translateX(${(1 - t) * -48}px)`;
    case "blur_reveal":
      return `translateY(${(1 - t) * 20}px) scale(${0.96 + t * 0.04})`;
    case "word_stagger":
      return `translateY(${(1 - t) * 32}px)`;
    default:
      return `translateY(${(1 - t) * 28}px)`;
  }
}

function elementBlur(el: CompiledMotionElement, frame: number, easing: (t: number) => number) {
  if (el.enter_animation !== "blur_reveal") return 0;
  const local = frame - el.enter_frame;
  if (local < 0) return 14;
  const t = easing(Math.min(1, local / 22));
  return (1 - t) * 12;
}

function BrandLogo({ src, brandName, className }: { src: string; brandName: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className="font-bold tracking-tight">{brandName}</span>;
  }
  return (
    <img
      src={src}
      alt={brandName}
      crossOrigin="anonymous"
      className={className || "h-14 w-auto object-contain"}
      onError={() => setFailed(true)}
    />
  );
}

function AmbientOrbs({ frame, primary, accent }: { frame: number; primary: string; accent: string }) {
  const drift1 = Math.sin(frame / 45) * 24;
  const drift2 = Math.cos(frame / 38) * 18;
  return (
    <>
      <div
        className="pointer-events-none absolute rounded-full blur-3xl opacity-30"
        style={{
          width: "42%",
          height: "42%",
          left: `${12 + drift1 * 0.1}%`,
          top: `${8 + drift2 * 0.1}%`,
          background: `radial-gradient(circle, ${primary}88, transparent 70%)`,
        }}
      />
      <div
        className="pointer-events-none absolute rounded-full blur-3xl opacity-25"
        style={{
          width: "36%",
          height: "36%",
          right: `${8 - drift1 * 0.08}%`,
          bottom: `${12 - drift2 * 0.08}%`,
          background: `radial-gradient(circle, ${accent}77, transparent 70%)`,
        }}
      />
    </>
  );
}

function KineticHeadline({
  text,
  frame,
  enterFrame,
  easing,
  color,
  fontFamily,
  sizeClass,
}: {
  text: string;
  frame: number;
  enterFrame: number;
  easing: (t: number) => number;
  color: string;
  fontFamily: string;
  sizeClass: string;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <div className={`${sizeClass} font-bold leading-[1.05] tracking-[-0.03em]`} style={{ fontFamily, color }}>
      {words.map((word, i) => {
        const local = frame - enterFrame - i * 4;
        const t = local < 0 ? 0 : easing(Math.min(1, local / 16));
        return (
          <span
            key={`${word}-${i}`}
            className="inline-block mr-[0.28em]"
            style={{
              opacity: t,
              transform: `translateY(${(1 - t) * 28}px)`,
              filter: `blur(${(1 - t) * 6}px)`,
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
}

function ChapterBadge({ label, accent }: { label: string; accent: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-[0.22em]"
      style={{ background: `${accent}18`, color: accent, border: `1px solid ${accent}44` }}
    >
      {label}
    </span>
  );
}

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
  const enter = easing(Math.min(1, frame / 28));
  const duration = spec.duration_frames || 450;
  const kb = Math.min(1, frame / duration);
  const drift = Math.sin(frame / 130) * 0.35;
  const scale = 1.04 + kb * 0.12;
  const translateY = -(kb * 6 + drift);
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
      <AmbientOrbs frame={frame} primary={colors.primary || accent} accent={accent} />
      {spec.beat_chapter ? (
        <div className="absolute left-8 top-8 z-20">
          <ChapterBadge label={spec.beat_chapter} accent={accent} />
        </div>
      ) : null}
      <div
        className="absolute inset-x-[5%] top-[9%] bottom-[22%] rounded-2xl border border-white/12 shadow-2xl shadow-black/70 overflow-hidden"
        style={{
          opacity: enter,
          transform: `translateY(${(1 - enter) * 48}px) scale(${0.96 + enter * 0.04}) perspective(1200px) rotateX(${(1 - enter) * 4}deg)`,
          background: "#0c0c10",
        }}
      >
        <div className="flex h-9 items-center gap-2 border-b border-white/10 bg-black/70 px-3">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 flex-1 truncate rounded-md bg-white/8 px-3 py-1 text-[10px] text-white/55 font-mono">
            {pageLabel}
          </span>
        </div>
        <div className="relative h-[calc(100%-2.25rem)] overflow-hidden">
          <img
            src={spec.screenshot_url || ""}
            alt={pageLabel}
            crossOrigin="anonymous"
            className="absolute inset-0 h-full w-full object-cover object-top"
            style={{ transform: `scale(${scale}) translateY(${translateY}%)`, transformOrigin: "center top" }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent pointer-events-none" />
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 h-[30%] bg-gradient-to-t from-black/90 via-black/50 to-transparent" />
      <div
        className="absolute left-[5%] bottom-[5%] right-[5%] flex items-end justify-between gap-6"
        style={{ opacity: easing(Math.min(1, Math.max(0, frame - 18) / 24)) }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2">
            {logoSrc ? <BrandLogo src={logoSrc} brandName={brandName} className="h-7 w-auto object-contain" /> : null}
            <span className="text-[10px] uppercase tracking-[0.28em] text-white/50">{brandName}</span>
          </div>
          {headline ? (
            <div className="truncate text-xl md:text-3xl font-semibold text-white" style={{ fontFamily: colors.headingFont }}>
              {headline}
            </div>
          ) : null}
          {subhead ? (
            <div className="mt-1 max-w-2xl text-xs md:text-sm leading-relaxed text-white/65 line-clamp-2" style={{ fontFamily: colors.bodyFont }}>
              {subhead}
            </div>
          ) : null}
        </div>
        <span
          className="hidden md:inline-flex shrink-0 items-center rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{ background: `${accent}22`, color: accent, border: `1px solid ${accent}55` }}
        >
          Live site
        </span>
      </div>
    </div>
  );
}

function LayoutShell({
  spec,
  brandName,
  colors,
  frame,
  easing,
  logoSrc,
  children,
}: {
  spec: CompiledMotionSpec;
  brandName: string;
  colors: MotionGraphicColors;
  frame: number;
  easing: (t: number) => number;
  logoSrc?: string | null;
  children: ReactNode;
}) {
  const primary = colors.primary || "#141414";
  const secondary = colors.secondary || "#2a2a2a";
  const accent = colors.accent || "#3b82f6";
  const neutral = colors.neutral || "#0a0a0a";
  const bg = buildBackground(spec.background_treatment, { primary, secondary, accent, neutral });
  const heroBg = colors.heroBackgroundUrl;

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: bg }}>
      {heroBg ? (
        <>
          <img src={heroBg} alt="" crossOrigin="anonymous" className="absolute inset-0 h-full w-full object-cover object-top scale-105 opacity-75" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          <div className="absolute inset-0 bg-black/78" />
        </>
      ) : null}
      <AmbientOrbs frame={frame} primary={primary} accent={accent} />
      <div className="absolute inset-0 opacity-[0.07] bg-[linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:56px_56px]" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/25 pointer-events-none" />
      <div className="absolute inset-0 opacity-[0.04] mix-blend-overlay pointer-events-none" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />

      <div className="absolute left-8 top-8 z-20 flex items-center gap-4">
        {spec.beat_chapter ? <ChapterBadge label={spec.beat_chapter} accent={readableOnDark(accent, "#fff")} /> : null}
        {spec.layout !== "logo_moment" && spec.layout !== "cta_card" ? (
          <div className="flex items-center gap-2 opacity-60">
            {logoSrc ? <BrandLogo src={logoSrc} brandName={brandName} className="h-5 w-auto object-contain" /> : null}
            <span className="text-[10px] uppercase tracking-[0.24em] text-white/45">{brandName}</span>
          </div>
        ) : null}
      </div>

      {children}
    </div>
  );
}

function LogoMomentLayout({ spec, brandName, colors, frame, easing, logoSrc }: LayoutProps) {
  const accent = readableOnDark(colors.accent, "#ffffff");
  const headline = spec.elements.find((e) => e.type === "headline");
  const subhead = spec.elements.find((e) => e.type === "subhead");
  const logoEl = spec.elements.find((e) => e.type === "logo");
  const logoEnter = easing(Math.min(1, Math.max(0, frame - (logoEl?.enter_frame || 4)) / 24));

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-10 text-center">
      {logoSrc ? (
        <div style={{ opacity: logoEnter, transform: `scale(${0.7 + logoEnter * 0.3})`, filter: `blur(${(1 - logoEnter) * 10}px)` }}>
          <BrandLogo src={logoSrc} brandName={brandName} className="h-16 md:h-24 w-auto object-contain mx-auto" />
        </div>
      ) : null}
      {headline ? (
        <div className="mt-8 max-w-4xl">
          <KineticHeadline
            text={headline.content}
            frame={frame}
            enterFrame={headline.enter_frame}
            easing={easing}
            color={accent}
            fontFamily={colors.headingFont || "Georgia, serif"}
            sizeClass="text-4xl md:text-6xl lg:text-7xl"
          />
        </div>
      ) : null}
      {subhead ? (
        <div
          className="mt-5 max-w-2xl text-base md:text-xl leading-relaxed text-white/70"
          style={{
            fontFamily: colors.bodyFont,
            opacity: elementOpacity(subhead, frame, easing),
            transform: elementTransform(subhead, frame, easing),
            filter: `blur(${elementBlur(subhead, frame, easing)}px)`,
          }}
        >
          {subhead.content}
        </div>
      ) : null}
    </div>
  );
}

function StatCalloutLayout({ spec, colors, frame, easing }: LayoutProps) {
  const stats = spec.elements.filter((e) => e.type === "stat_number");
  const labels = spec.elements.filter((e) => e.type === "feature_item");
  const headline = spec.elements.find((e) => e.type === "headline");

  return (
    <div className="absolute inset-0 flex flex-col justify-center px-10 md:px-16">
      {headline ? (
        <div className="mb-10 max-w-2xl">
          <KineticHeadline
            text={headline.content}
            frame={frame}
            enterFrame={headline.enter_frame}
            easing={easing}
            color={readableOnDark(colors.accent, "#fff")}
            fontFamily={colors.headingFont || "Georgia, serif"}
            sizeClass="text-3xl md:text-5xl"
          />
        </div>
      ) : null}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-5xl">
        {stats.map((stat, i) => {
          const opacity = elementOpacity(stat, frame, easing);
          const label = labels[i]?.content || "";
          return (
            <div
              key={`stat-${i}`}
              className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm px-6 py-8"
              style={{ opacity, transform: elementTransform(stat, frame, easing) }}
            >
              <div
                className="text-4xl md:text-5xl font-bold tracking-tight"
                style={{ color: colorForToken(stat.color_token, colors), fontFamily: colors.headingFont }}
              >
                {stat.content}
              </div>
              {label ? <div className="mt-2 text-sm text-white/65 leading-snug" style={{ fontFamily: colors.bodyFont }}>{label}</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FeatureListLayout({ spec, colors, frame, easing }: LayoutProps) {
  const headline = spec.elements.find((e) => e.type === "headline");
  const subhead = spec.elements.find((e) => e.type === "subhead");
  const features = spec.elements.filter((e) => e.type === "feature_item");
  const accent = readableOnDark(colors.accent, "#fff");

  return (
    <div className="absolute inset-0 flex flex-col md:flex-row items-center gap-10 px-10 md:px-16 py-16">
      <div className="md:w-[42%] shrink-0">
        {headline ? (
          <KineticHeadline
            text={headline.content}
            frame={frame}
            enterFrame={headline.enter_frame}
            easing={easing}
            color={accent}
            fontFamily={colors.headingFont || "Georgia, serif"}
            sizeClass="text-3xl md:text-5xl"
          />
        ) : null}
        {subhead ? (
          <div
            className="mt-4 text-base md:text-lg text-white/70 leading-relaxed"
            style={{ fontFamily: colors.bodyFont, opacity: elementOpacity(subhead, frame, easing), transform: elementTransform(subhead, frame, easing) }}
          >
            {subhead.content}
          </div>
        ) : null}
      </div>
      <div className="flex-1 w-full space-y-3">
        {features.map((feat, i) => {
          const opacity = elementOpacity(feat, frame, easing);
          const tokenColor = colorForToken(feat.color_token, colors);
          return (
            <div
              key={`feat-${i}`}
              className="flex items-start gap-4 rounded-xl border border-white/10 bg-black/30 px-5 py-4"
              style={{ opacity, transform: elementTransform(feat, frame, easing) }}
            >
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: tokenColor }} />
              <div className="text-sm md:text-base text-white/85 leading-snug" style={{ fontFamily: colors.bodyFont }}>{feat.content}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CtaCardLayout({ spec, brandName, colors, frame, easing, logoSrc }: LayoutProps) {
  const headline = spec.elements.find((e) => e.type === "headline");
  const subhead = spec.elements.find((e) => e.type === "subhead");
  const cta = spec.elements.find((e) => e.type === "cta_button");
  const accent = readableOnDark(colors.accent, "#ffffff");
  const pulse = 1 + Math.sin(frame / 18) * 0.02;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-10 text-center">
      {logoSrc ? (
        <div style={{ opacity: elementOpacity({ enter_frame: 4, enter_animation: "scale_overshoot" } as CompiledMotionElement, frame, easing), transform: `scale(${0.9 + easeOutQuart(Math.min(1, frame / 30)) * 0.1})` }}>
          <BrandLogo src={logoSrc} brandName={brandName} className="h-14 md:h-20 w-auto object-contain mx-auto mb-6" />
        </div>
      ) : null}
      {headline ? (
        <KineticHeadline
          text={headline.content}
          frame={frame}
          enterFrame={headline.enter_frame}
          easing={easing}
          color={accent}
          fontFamily={colors.headingFont || "Georgia, serif"}
          sizeClass="text-3xl md:text-5xl lg:text-6xl"
        />
      ) : null}
      {subhead ? (
        <div className="mt-4 max-w-xl text-base md:text-lg text-white/70" style={{ fontFamily: colors.bodyFont, opacity: elementOpacity(subhead, frame, easing) }}>
          {subhead.content}
        </div>
      ) : null}
      {cta ? (
        <div
          className="mt-8"
          style={{ opacity: elementOpacity(cta, frame, easing), transform: `scale(${pulse})` }}
        >
          <span
            className="inline-flex rounded-full px-8 py-3.5 text-sm md:text-base font-semibold shadow-lg"
            style={{ background: accent, color: hexLightness(accent) > 0.6 ? "#111" : "#fff", boxShadow: `0 8px 32px ${accent}44` }}
          >
            {cta.content}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function SplitLayout({ spec, colors, frame, easing }: LayoutProps) {
  const headline = spec.elements.find((e) => e.type === "headline");
  const subhead = spec.elements.find((e) => e.type === "subhead");
  const features = spec.elements.filter((e) => e.type === "feature_item");
  const accent = readableOnDark(colors.accent, "#fff");
  const primary = colors.primary || "#333";
  const panelFloat = Math.sin(frame / 24) * 5;

  return (
    <div className="absolute inset-0 flex flex-col md:flex-row items-center gap-8 px-10 md:px-14 py-14">
      <div className="md:w-[46%]">
        {headline ? (
          <KineticHeadline
            text={headline.content}
            frame={frame}
            enterFrame={headline.enter_frame}
            easing={easing}
            color={accent}
            fontFamily={colors.headingFont || "Georgia, serif"}
            sizeClass="text-3xl md:text-5xl"
          />
        ) : null}
        {subhead ? (
          <div className="mt-4 text-base md:text-lg text-white/72 leading-relaxed" style={{ fontFamily: colors.bodyFont, opacity: elementOpacity(subhead, frame, easing), transform: elementTransform(subhead, frame, easing) }}>
            {subhead.content}
          </div>
        ) : null}
      </div>
      <div
        className="flex-1 w-full rounded-2xl border border-white/12 p-6 md:p-8 min-h-[200px]"
        style={{
          background: `linear-gradient(145deg, ${primary}55, ${accent}22)`,
          transform: `translateY(${panelFloat}px)`,
          boxShadow: `0 24px 64px ${primary}33`,
        }}
      >
        <div className="space-y-3">
          {(features.length ? features : spec.elements.filter((e) => e.type === "subhead").slice(0, 2)).map((el, i) => (
            <div key={i} className="rounded-xl bg-black/35 border border-white/8 px-4 py-3.5 text-sm text-white/80" style={{ opacity: elementOpacity(el, frame, easing), transform: elementTransform(el, frame, easing) }}>
              {el.content}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FullFrameLayout({ spec, colors, frame, easing }: LayoutProps) {
  const headline = spec.elements.find((e) => e.type === "headline");
  const subhead = spec.elements.find((e) => e.type === "subhead");
  const cta = spec.elements.find((e) => e.type === "cta_button");

  return (
    <div className="absolute inset-0 flex flex-col justify-center px-10 md:px-16">
      {headline ? (
        <KineticHeadline
          text={headline.content}
          frame={frame}
          enterFrame={headline.enter_frame}
          easing={easing}
          color={readableOnDark(colors.accent, "#fff")}
          fontFamily={colors.headingFont || "Georgia, serif"}
          sizeClass="text-4xl md:text-6xl max-w-4xl"
        />
      ) : null}
      {subhead ? (
        <div className="mt-5 max-w-2xl text-lg md:text-xl text-white/72" style={{ fontFamily: colors.bodyFont, opacity: elementOpacity(subhead, frame, easing), transform: elementTransform(subhead, frame, easing) }}>
          {subhead.content}
        </div>
      ) : null}
      {cta ? (
        <div className="mt-8" style={{ opacity: elementOpacity(cta, frame, easing), transform: elementTransform(cta, frame, easing) }}>
          <span className="inline-flex rounded-full px-6 py-2.5 text-sm font-semibold" style={{ background: readableOnDark(colors.accent, "#fff"), color: "#111" }}>
            {cta.content}
          </span>
        </div>
      ) : null}
    </div>
  );
}

type LayoutProps = {
  spec: CompiledMotionSpec;
  brandName: string;
  colors: MotionGraphicColors;
  frame: number;
  easing: (t: number) => number;
  logoSrc?: string | null;
};

function renderLayout(layout: MotionLayout, props: LayoutProps) {
  switch (layout) {
    case "logo_moment":
      return <LogoMomentLayout {...props} />;
    case "stat_callout":
      return <StatCalloutLayout {...props} />;
    case "feature_list":
      return <FeatureListLayout {...props} />;
    case "cta_card":
      return <CtaCardLayout {...props} />;
    case "split_headline_and_visual":
      return <SplitLayout {...props} />;
    default:
      return <FullFrameLayout {...props} />;
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
  const durationFrames =
    spec.duration_frames ||
    (spec.screenshot_url ? 450 : Math.max(90, ...spec.elements.map((el) => (el.exit_frame ?? el.enter_frame + 45))));

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
  const logoSrc = logoUrl || colors.logoUrl;

  if (spec.screenshot_url) {
    return (
      <>
        {colors.fontUrls?.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        <ScreenshotPresentation spec={spec} brandName={brandName} colors={colors} frame={frame} easing={easing} logoSrc={logoSrc} />
      </>
    );
  }

  return (
    <>
      {colors.fontUrls?.map((href) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      <LayoutShell spec={spec} brandName={brandName} colors={colors} frame={frame} easing={easing} logoSrc={logoSrc}>
        {showFallbackBadge ? (
          <div className="absolute top-4 right-4 z-30 rounded-full border border-amber-300/35 bg-amber-400/12 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-amber-200">
            Fallback visual
          </div>
        ) : null}
        {renderLayout(spec.layout, { spec, brandName, colors, frame, easing, logoSrc })}
      </LayoutShell>
    </>
  );
}
