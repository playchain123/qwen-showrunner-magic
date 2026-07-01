import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUp, Plus, Check, ChevronLeft, ChevronRight } from "lucide-react";
import scene1 from "@/assets/scene-1.jpg";
import scene2 from "@/assets/scene-2.jpg";
import scene3 from "@/assets/scene-3.jpg";
import scene4 from "@/assets/scene-4.jpg";
import scene5 from "@/assets/scene-5.jpg";
import scene6 from "@/assets/scene-6.jpg";
import char1 from "@/assets/char-1.jpg";
import char2 from "@/assets/char-2.jpg";
import shotA from "@/assets/shot-a.jpg";
import shotB from "@/assets/shot-b.jpg";
import shotC from "@/assets/shot-c.jpg";
import slide1 from "@/assets/slide-1.jpg";
import slide2 from "@/assets/slide-2.jpg";
import slide3 from "@/assets/slide-3.jpg";
import slide4 from "@/assets/slide-4.jpg";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <main className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <Nav />
      <Hero />
      <ScenesGrid />
      <ContextSection />
      <NotebookSection />
      <CinematicSlider />
      <Footer />
    </main>
  );
}

/* ----------------------------- NAV ----------------------------- */
function Nav() {
  return (
    <header className="absolute top-0 left-0 right-0 z-40 px-6 md:px-10 py-5 flex items-center justify-between">
      <a href="#" className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-md bg-gradient-to-br from-[var(--brand-purple)] via-[var(--brand-pink)] to-[var(--brand-blue)]" />
        <span className="text-lg font-semibold tracking-tight">makers</span>
      </a>
      <div className="flex items-center gap-2">
        <button className="px-4 py-2 text-sm text-foreground/80 hover:text-foreground transition-colors">
          Log in
        </button>
        <button className="px-4 py-2 text-sm font-medium rounded-full bg-white text-black hover:bg-white/90 transition-colors">
          Sign up
        </button>
      </div>
    </header>
  );
}

/* ----------------------------- HERO ----------------------------- */
function Hero() {
  return (
    <section className="relative min-h-screen w-full flex items-center justify-center overflow-hidden">
      {/* gradient stripes at top */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_top,rgba(124,92,255,0.35),transparent_60%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[120px] bg-gradient-to-b from-[rgba(124,92,255,0.55)] via-[rgba(255,92,216,0.15)] to-transparent blur-2xl" />
      {/* grid */}
      <div className="absolute inset-0 grid-bg opacity-60" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,var(--background)_90%)]" />

      {/* Floating cursor tags */}
      <CursorTag name="You" color="#7c5cff" style={{ top: "18%", left: "12%" }} />
      <CursorTag name="Andrew" color="#22c55e" style={{ top: "16%", right: "14%" }} />
      <CursorTag name="Anna" color="#ef4444" style={{ bottom: "24%", left: "18%" }} />
      <CursorTag name="Agent One" color="#8b5cf6" style={{ bottom: "26%", right: "16%" }} />

      <div className="relative z-10 text-center px-6 max-w-5xl">
        <h1 className="font-serif-display text-5xl md:text-7xl lg:text-8xl leading-[1.02] tracking-tight">
          The AI showrunner
          <br />
          for short drama
        </h1>
        <p className="mt-8 text-base md:text-lg text-foreground/60 max-w-xl mx-auto">
          Don't waste time on AI you have to babysit. Do what you love while
          Makers' agents write, storyboard, shoot and edit the rest.
        </p>
        <div className="mt-10 flex justify-center">
          <button className="group inline-flex items-center gap-3 pl-6 pr-2 py-2 rounded-full bg-white text-black text-sm font-medium hover:bg-white/90 transition-all">
            Start Creating
            <span className="h-8 w-8 rounded-full bg-black text-white flex items-center justify-center group-hover:translate-x-0.5 transition-transform">
              <ArrowRight className="h-4 w-4" />
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}

function CursorTag({
  name,
  color,
  style,
}: {
  name: string;
  color: string;
  style: React.CSSProperties;
}) {
  return (
    <div
      className="absolute z-20 pointer-events-none animate-[float_6s_ease-in-out_infinite]"
      style={style}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill={color} className="drop-shadow">
        <path d="M4 2 L20 12 L12 13 L8 22 Z" />
      </svg>
      <span
        className="ml-3 -mt-1 inline-block px-2 py-0.5 rounded text-xs text-white font-medium"
        style={{ backgroundColor: color }}
      >
        {name}
      </span>
    </div>
  );
}

/* ------------------------- SCENES GRID ------------------------- */
function ScenesGrid() {
  const [tab, setTab] = useState("Film");
  const tabs = ["Film", "Promo", "Performance Ad", "Product Ad", "Microdrama"];
  const scenes = [scene1, scene2, scene3, scene4, scene5, scene6];

  return (
    <section className="relative py-24 md:py-36 px-6">
      <div className="max-w-6xl mx-auto rounded-2xl border border-white/10 bg-[#0e0e12] shadow-2xl overflow-hidden">
        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-white/10 px-3 pt-3 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-xs md:text-sm rounded-t-md transition-colors whitespace-nowrap ${
                tab === t
                  ? "bg-[#17171d] text-foreground border-t border-x border-white/10"
                  : "text-foreground/50 hover:text-foreground/80"
              }`}
            >
              {t}
            </button>
          ))}
          <button className="px-3 py-2 text-foreground/50 hover:text-foreground">
            <Plus className="h-3.5 w-3.5" />
          </button>
          <div className="ml-auto flex items-center gap-1 pr-3">
            <div className="h-7 w-7 rounded-full bg-fuchsia-500 text-[10px] font-bold flex items-center justify-center">
              A
            </div>
            <div className="h-7 w-7 rounded-full bg-amber-400 text-black text-[10px] font-bold flex items-center justify-center">
              Y
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[320px_1fr]">
          {/* Chat panel */}
          <aside className="border-r border-white/10 p-5 min-h-[560px] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-500" />
                <span className="text-sm font-medium">Agent One</span>
              </div>
              <span className="text-foreground/40 text-xs">⋯</span>
            </div>

            <div className="flex gap-2 mb-3">
              <span className="px-2 py-1 rounded-md bg-white/5 text-[11px] text-foreground/70 truncate">
                📄 Penumbra-sc…
              </span>
              <span className="px-2 py-1 rounded-md bg-white/5 text-[11px] text-foreground/70 truncate">
                📄 Treatment-…
              </span>
            </div>

            <div className="rounded-lg bg-white/5 p-3 text-sm leading-relaxed text-foreground/85">
              I'm developing an action-thriller called "Penumbra" built on
              intense action, espionage and mature themes, all in service of
              the story. Here's the script and treatment doc to start with.
            </div>

            <ul className="mt-5 space-y-2 text-sm">
              {[
                "Reading the script and treatment",
                "Added final script",
                "Added treatment doc",
                "Added Characters & Location",
              ].map((t) => (
                <li key={t} className="flex items-center gap-2 text-foreground/80">
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  {t}
                </li>
              ))}
            </ul>

            <p className="mt-4 text-sm text-foreground/70">
              Do we start creating some options for Isaak?
            </p>

            <div className="mt-auto pt-4">
              <div className="relative">
                <input
                  placeholder="Send a message to Makers"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-11 text-sm outline-none focus:border-white/30"
                />
                <button className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-white text-black flex items-center justify-center">
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
            </div>
          </aside>

          {/* Scenes area */}
          <div className="p-4">
            <div className="flex items-center gap-4 text-xs text-foreground/60 mb-4 px-2">
              <span className="hover:text-foreground cursor-pointer">◲ Context</span>
              <span className="text-foreground border-b border-foreground pb-1">📁 Scenes</span>
              <span className="hover:text-foreground cursor-pointer">🎞 Final</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {scenes.map((src, i) => (
                <SceneCard key={i} src={src} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SceneCard({ src }: { src: string }) {
  return (
    <div className="group relative aspect-video overflow-hidden rounded-lg bg-black">
      <img
        src={src}
        alt="scene"
        loading="lazy"
        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all">
        <span className="text-xs font-medium text-white/90">Scene · Regenerate</span>
        <button className="h-8 w-8 rounded-full bg-white/90 text-black flex items-center justify-center">
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/* ------------------------ CONTEXT SECTION ---------------------- */
function ContextSection() {
  return (
    <section className="px-6 py-24 md:py-36">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
        <div>
          <h2 className="font-serif-display text-5xl md:text-6xl leading-[1.05]">
            Never repeat
            <br />
            yourself
          </h2>
          <p className="mt-6 text-foreground/60 max-w-md leading-relaxed">
            Life's too short for AI that needs constant reminders. Our agents
            store your project's full context in their long term memory, so
            every clip stays consistent.
          </p>
          <a
            href="#"
            className="mt-8 inline-flex items-center gap-2 text-sm border-b border-foreground/40 pb-1 hover:border-foreground transition-colors"
          >
            Add context to your first project <ArrowRight className="h-4 w-4" />
          </a>
        </div>

        <div className="relative rounded-2xl border border-white/10 bg-[#0e0e12] p-6">
          <div className="flex gap-2 mb-3 justify-end">
            <img src={char1} alt="" className="h-14 w-14 rounded-md object-cover" />
            <img src={char2} alt="" className="h-14 w-14 rounded-md object-cover" />
          </div>
          <p className="text-right text-sm text-foreground/70 mb-4">
            Save these in context for the film.
            <br />
            Let's start with the character sheet.
          </p>
          <div className="flex items-center gap-2 mb-3">
            <div className="h-6 w-6 rounded bg-gradient-to-br from-fuchsia-500 to-violet-500" />
            <span className="text-sm font-medium">makers</span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-white/10 text-foreground/70">
              Agent One
            </span>
          </div>
          <p className="text-sm mb-4 flex items-center gap-1 text-foreground/90">
            Context Locked <Check className="h-3.5 w-3.5 text-emerald-400" />
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[char1, char2, char1, char2, char1, char2].map((s, i) => (
              <img
                key={i}
                src={s}
                alt=""
                loading="lazy"
                className="aspect-square w-full object-cover rounded-md hover:scale-105 transition-transform"
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ----------------------- NOTEBOOK SECTION ---------------------- */
function NotebookSection() {
  const [active, setActive] = useState("Location");
  return (
    <section className="px-6 py-24 md:py-36">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
        <div className="relative rounded-2xl border border-white/10 bg-[#0e0e12] p-5">
          <div className="text-[10px] uppercase tracking-widest text-foreground/50 mb-3">
            ● Notebook · Page 1
          </div>
          <p className="text-xs text-foreground/60 mb-2">
            <span className="text-foreground/90 font-medium">#1</span> Locked composition
          </p>
          <img src={shotA} alt="" loading="lazy" className="w-56 rounded-md mb-5" />
          <p className="text-xs text-foreground/60 mb-2">
            <span className="text-foreground/90 font-medium">#2</span> Same shot, new backdrops
          </p>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[shotA, shotB, shotC].map((s, i) => (
              <img
                key={i}
                src={s}
                alt=""
                loading="lazy"
                className="aspect-video w-full object-cover rounded-md hover:scale-105 transition-transform"
              />
            ))}
          </div>
          <div className="rounded-lg bg-white/5 px-3 py-2 text-xs flex items-center justify-between mb-2">
            <span className="flex items-center gap-2">
              <Check className="h-3 w-3 text-emerald-400" /> Done · 3 steps
            </span>
            <span className="text-foreground/50 uppercase text-[10px]">Agent One ⌃</span>
          </div>
          <div className="rounded-lg bg-white/5 px-3 py-2 text-xs flex items-center justify-between">
            <span className="text-foreground/70">→ Change scene location</span>
            <button className="h-6 w-6 rounded-full bg-white text-black flex items-center justify-center">
              <ArrowUp className="h-3 w-3" />
            </button>
          </div>
        </div>

        <div>
          <h2 className="font-serif-display text-5xl md:text-6xl leading-[1.05]">
            Edit multiple
            <br />
            shots in one go
          </h2>
          <p className="mt-6 text-foreground/60 max-w-md leading-relaxed">
            Experiment with new costumes, locations, or characters without
            needing to regenerate dozens of clips. Makers' agents are smart
            enough to handle it.
          </p>
          <p className="mt-8 text-[10px] uppercase tracking-widest text-foreground/50">
            Active agents — 3
          </p>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {["Location", "Character", "Costume"].map((a) => (
              <button
                key={a}
                onClick={() => setActive(a)}
                className={`px-4 py-2 rounded-full text-sm border transition-colors ${
                  active === a
                    ? "bg-white text-black border-white"
                    : "bg-white/5 text-foreground/80 border-white/10 hover:bg-white/10"
                }`}
              >
                <span className="mr-1.5">••</span>
                {a}
              </button>
            ))}
            <button className="h-9 w-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10">
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ----------------------- CINEMATIC SLIDER ---------------------- */
function CinematicSlider() {
  const slides = [
    { src: slide1, title: "Frontier", caption: "Sci-fi drama · 45s" },
    { src: slide2, title: "The Fall", caption: "Nature vignette · 30s" },
    { src: slide3, title: "Nightline", caption: "Cyberpunk short · 60s" },
    { src: slide4, title: "Ronin", caption: "Period piece · 50s" },
  ];
  const [i, setI] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timer.current = setInterval(() => setI((v) => (v + 1) % slides.length), 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [slides.length]);

  const go = (d: number) => setI((v) => (v + d + slides.length) % slides.length);

  return (
    <section className="relative py-24 md:py-32">
      <div className="px-6 max-w-6xl mx-auto flex items-end justify-between mb-8">
        <h2 className="font-serif-display text-4xl md:text-6xl leading-[1.05] max-w-2xl">
          Made with Makers
        </h2>
        <p className="text-foreground/60 max-w-sm text-sm md:text-base hidden md:block">
          A handful of shorts written, storyboarded, and rendered end-to-end by
          our agents.
        </p>
      </div>

      <div className="relative h-[70vh] min-h-[520px] w-full overflow-hidden">
        {slides.map((s, idx) => (
          <div
            key={idx}
            className={`absolute inset-0 transition-opacity duration-1000 ${
              idx === i ? "opacity-100" : "opacity-0"
            }`}
          >
            <img
              src={s.src}
              alt={s.title}
              loading="lazy"
              className={`h-full w-full object-cover transition-transform duration-[8000ms] ease-out ${
                idx === i ? "scale-110" : "scale-100"
              }`}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 px-6 md:px-16 pb-16 max-w-6xl mx-auto">
              <p className="text-xs uppercase tracking-[0.3em] text-white/70 mb-3">
                {s.caption}
              </p>
              <h3 className="font-serif-display text-5xl md:text-7xl text-white">
                {s.title}
              </h3>
            </div>
          </div>
        ))}

        <div className="absolute bottom-6 right-6 md:right-16 z-20 flex items-center gap-3">
          <button
            onClick={() => go(-1)}
            className="h-11 w-11 rounded-full border border-white/30 backdrop-blur bg-black/30 text-white flex items-center justify-center hover:bg-white/10"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => go(1)}
            className="h-11 w-11 rounded-full border border-white/30 backdrop-blur bg-black/30 text-white flex items-center justify-center hover:bg-white/10"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="absolute bottom-8 left-6 md:left-16 z-20 flex gap-2">
          {slides.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setI(idx)}
              className={`h-1 rounded-full transition-all ${
                idx === i ? "w-10 bg-white" : "w-5 bg-white/30"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ----------------------------- FOOTER ---------------------------- */
function Footer() {
  return (
    <footer className="border-t border-white/10 px-6 py-16">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
        <div>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-gradient-to-br from-[var(--brand-purple)] via-[var(--brand-pink)] to-[var(--brand-blue)]" />
            <span className="text-lg font-semibold">makers</span>
          </div>
          <p className="mt-3 text-sm text-foreground/50 max-w-sm">
            The AI showrunner for short drama. Powered by Qwen Cloud.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-10 gap-y-3 text-sm text-foreground/60">
          <a href="#" className="hover:text-foreground">Product</a>
          <a href="#" className="hover:text-foreground">Studio</a>
          <a href="#" className="hover:text-foreground">Resources</a>
          <a href="#" className="hover:text-foreground">Pricing</a>
          <a href="#" className="hover:text-foreground">Enterprise</a>
        </div>
      </div>
      <p className="mt-10 max-w-6xl mx-auto text-xs text-foreground/40">
        © {new Date().getFullYear()} Makers. Built for the Global AI Hackathon
        with Qwen Cloud.
      </p>
    </footer>
  );
}
