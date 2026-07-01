import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { ArrowRight, ArrowUp, Plus, Check } from "lucide-react";
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
import vid1 from "@/assets/vid-1.mp4.asset.json";
import vid2 from "@/assets/vid-2.mp4.asset.json";
import vid3 from "@/assets/vid-3.mp4.asset.json";
import vid4 from "@/assets/vid-4.mp4.asset.json";
import vid5 from "@/assets/vid-5.mp4.asset.json";
import vid6 from "@/assets/vid-6.mp4.asset.json";
import mwm1 from "@/assets/mwm-1.mp4.asset.json";
import mwm2 from "@/assets/mwm-2.mp4.asset.json";
import mwm3 from "@/assets/mwm-3.mp4.asset.json";
import mwm4 from "@/assets/mwm-4.mp4.asset.json";

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
      <IntroducingMakers />
      <MadeWithMakers />
      <Footer />
    </main>
  );
}

function MakersMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-label="Makers"
      role="img"
      fill="none"
    >
      <rect x="1" y="1" width="30" height="30" rx="7" fill="#ffffff" />
      <path
        d="M8 23 V9 L16 19 L24 9 V23"
        stroke="#000000"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function Nav() {
  return (
    <header className="absolute top-0 left-0 right-0 z-40 px-6 md:px-10 py-5 flex items-center justify-between">
      <a href="#" className="flex items-center gap-2">
        <MakersMark />
        <span className="text-lg font-semibold tracking-tight">makers</span>
      </a>
      <div className="flex items-center gap-2">
        <Link
          to="/auth"
          search={{ mode: "login" }}
          className="px-4 py-2 text-sm text-foreground/80 hover:text-foreground transition-colors"
        >
          Log in
        </Link>
        <Link
          to="/auth"
          search={{ mode: "signup" }}
          className="px-4 py-2 text-sm font-medium rounded-full bg-white text-black hover:bg-white/90 transition-colors"
        >
          Sign up
        </Link>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative min-h-screen w-full flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 grid-bg" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,var(--background)_95%)]" />

      <CursorTag name="You" color="#ffffff" style={{ top: "18%", left: "12%" }} />
      <CursorTag name="Andrew" color="#e5e5e5" style={{ top: "16%", right: "14%" }} />
      <CursorTag name="Anna" color="#a3a3a3" style={{ bottom: "24%", left: "18%" }} />
      <CursorTag name="Makers" color="#ffffff" style={{ bottom: "26%", right: "16%" }} />

      <div className="relative z-10 text-center px-6 max-w-3xl">
        <h1 className="font-serif-display text-3xl md:text-5xl leading-[1.05] tracking-tight">
          The platform for creative
          <br />
          short drama
        </h1>
        <p className="mt-5 text-xs md:text-sm text-foreground/60 max-w-md mx-auto">
          Don't waste time on AI you have to babysit. Do what you love while
          Makers' agents write, storyboard, shoot and edit the rest.
        </p>
        <div className="mt-8 flex justify-center">
          <Link
            to="/auth"
            search={{ mode: "signup" }}
            className="group inline-flex items-center gap-3 pl-5 pr-2 py-1.5 rounded-full bg-white text-black text-sm font-medium hover:bg-white/90 transition-all"
          >
            Start Creating
            <span className="h-7 w-7 rounded-full bg-black text-white flex items-center justify-center group-hover:translate-x-0.5 transition-transform">
              <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
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
        className="ml-3 -mt-1 inline-block px-2 py-0.5 rounded text-xs font-medium text-black"
        style={{ backgroundColor: color }}
      >
        {name}
      </span>
    </div>
  );
}

function HoverVideo({
  poster,
  src,
  className = "",
  children,
}: {
  poster: string;
  src: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  return (
    <div
      className={`group relative overflow-hidden bg-black ${className}`}
      onMouseEnter={() => {
        const v = ref.current;
        if (v) {
          v.currentTime = 0;
          v.play().catch(() => {});
        }
      }}
      onMouseLeave={() => {
        const v = ref.current;
        if (v) {
          v.pause();
          v.currentTime = 0;
        }
      }}
    >
      <img
        src={poster}
        alt=""
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300 group-hover:opacity-0"
      />
      <video
        ref={ref}
        src={src}
        muted
        loop
        playsInline
        preload="none"
        className="absolute inset-0 h-full w-full object-cover opacity-0 group-hover:opacity-100 transition-opacity duration-300"
      />
      {children}
    </div>
  );
}

function ScenesGrid() {
  const [tab, setTab] = useState("Film");
  const tabs = ["Film", "Promo", "Performance Ad", "Product Ad", "Microdrama"];
  const scenes = [
    { img: scene1, vid: vid1.url },
    { img: scene2, vid: vid2.url },
    { img: scene3, vid: vid3.url },
    { img: scene4, vid: vid4.url },
    { img: scene5, vid: vid5.url },
    { img: scene6, vid: vid6.url },
  ];

  return (
    <section className="relative py-24 md:py-36 px-6">
      <div className="max-w-6xl mx-auto rounded-2xl border border-white/10 bg-[#0a0a0a] shadow-2xl overflow-hidden">
        <div className="flex items-center gap-1 border-b border-white/10 px-3 pt-3 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-xs md:text-sm rounded-t-md transition-colors whitespace-nowrap ${
                tab === t
                  ? "bg-[#141414] text-foreground border-t border-x border-white/10"
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
            <div className="h-7 w-7 rounded-full bg-white text-black text-[10px] font-bold flex items-center justify-center">
              A
            </div>
            <div className="h-7 w-7 rounded-full bg-neutral-400 text-black text-[10px] font-bold flex items-center justify-center">
              Y
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[320px_1fr]">
          <aside className="border-r border-white/10 p-5 min-h-[560px] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-full bg-white flex items-center justify-center">
                  <MakersMark className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium">Makers</span>
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
                  <Check className="h-3.5 w-3.5 text-white" />
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

          <div className="p-4">
            <div className="flex items-center gap-4 text-xs text-foreground/60 mb-4 px-2">
              <span className="hover:text-foreground cursor-pointer">◲ Context</span>
              <span className="text-foreground border-b border-foreground pb-1">📁 Scenes</span>
              <span className="hover:text-foreground cursor-pointer">🎞 Final</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {scenes.map((s, i) => (
                <HoverVideo
                  key={i}
                  poster={s.img}
                  src={s.vid}
                  className="aspect-video rounded-lg"
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all">
                    <span className="text-xs font-medium text-white/90">
                      Scene · Regenerate
                    </span>
                    <button className="h-8 w-8 rounded-full bg-white/90 text-black flex items-center justify-center">
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </HoverVideo>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

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

        <div className="relative rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
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
            <div className="h-6 w-6 rounded bg-white flex items-center justify-center">
              <MakersMark className="h-4 w-4" />
            </div>
            <span className="text-sm font-medium">makers</span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-white/10 text-foreground/70">
              Makers
            </span>
          </div>
          <p className="text-sm mb-4 flex items-center gap-1 text-foreground/90">
            Context Locked <Check className="h-3.5 w-3.5 text-white" />
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

function NotebookSection() {
  const [active, setActive] = useState("Location");
  return (
    <section className="px-6 py-24 md:py-36">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
        <div className="relative rounded-2xl border border-white/10 bg-[#0a0a0a] p-5">
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
              <Check className="h-3 w-3 text-white" /> Done · 3 steps
            </span>
            <span className="text-foreground/50 uppercase text-[10px]">Makers ⌃</span>
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

function IntroducingMakers() {
  return (
    <section className="px-6 py-24 md:py-32">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-[380px_1fr] gap-10 items-center rounded-2xl border border-white/10 bg-[#0a0a0a] overflow-hidden p-8 md:p-12">
        <div>
          <MakersMark className="h-10 w-10 mb-6" />
          <h2 className="font-serif-display text-4xl md:text-5xl leading-[1.05]">
            Introducing
            <br />
            Makers
          </h2>
          <p className="mt-4 text-sm text-foreground/60 max-w-sm">
            Go back and forth with an agent to create your dream short drama.
          </p>
          <Link
            to="/auth"
            search={{ mode: "signup" }}
            className="mt-8 inline-flex items-center gap-3 pl-5 pr-2 py-1.5 rounded-full bg-white text-black text-sm font-medium hover:bg-white/90 transition-all"
          >
            Try Makers
            <span className="h-7 w-7 rounded-full bg-black text-white flex items-center justify-center">
              <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        </div>
        <HoverVideo
          poster={slide3}
          src={vid2.url}
          className="aspect-video rounded-xl border border-white/10"
        >
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="h-20 w-20 rounded-full bg-white flex items-center justify-center opacity-90 group-hover:opacity-0 transition">
              <MakersMark className="h-10 w-10" />
            </div>
          </div>
        </HoverVideo>
      </div>
    </section>
  );
}

function MadeWithMakers() {
  const tiles = [
    { vid: mwm2.url, title: "Nightline", caption: "Cyberpunk short" },
    { vid: mwm3.url, title: "Ronin", caption: "Period piece" },
    { vid: mwm4.url, title: "Horizon", caption: "Aerial vignette" },
  ];
  const categories = [
    "MAKERS ORIGINALS",
    "FILM & DRAMA",
    "BRAND & COMMERCE",
    "MUSIC VIDEOS",
  ];
  return (
    <section className="relative py-16 md:py-24 px-6">
      <div className="max-w-6xl mx-auto">
        {/* Hero autoplay video */}
        <div className="relative aspect-[16/9] w-full rounded-2xl overflow-hidden bg-black">
          <video
            src={mwm1.url}
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

          {/* Bottom-left title + CTA */}
          <div className="absolute bottom-8 left-8 md:bottom-12 md:left-12 right-8 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div>
              <h2 className="font-serif-display text-4xl md:text-6xl text-white leading-[1.05]">
                Made with Makers
                <br />
                <span className="text-white/80">Building the next wave of drama</span>
              </h2>
              <Link
                to="/auth"
                search={{ mode: "signup" }}
                className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-black text-sm font-medium hover:bg-white/90 transition"
              >
                Get Started <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <ul className="text-white text-sm md:text-base space-y-2 md:text-right">
              {categories.map((c) => (
                <li key={c} className="tracking-wide font-medium">
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Row of autoplay tiles */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-5">
          {tiles.map((t) => (
            <div
              key={t.title}
              className="relative aspect-video rounded-xl overflow-hidden bg-black border border-white/10"
            >
              <video
                src={t.vid}
                autoPlay
                muted
                loop
                playsInline
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
              <div className="absolute bottom-4 left-4 right-4">
                <p className="text-[10px] uppercase tracking-[0.3em] text-white/70 mb-1">
                  {t.caption}
                </p>
                <h3 className="font-serif-display text-2xl text-white">{t.title}</h3>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/10 px-6 py-16">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
        <div>
          <div className="flex items-center gap-2">
            <MakersMark />
            <span className="text-lg font-semibold">makers</span>
          </div>
          <p className="mt-3 text-sm text-foreground/50 max-w-sm">
            The platform for creative short drama. Powered by Qwen Cloud.
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