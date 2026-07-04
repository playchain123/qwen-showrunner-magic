import { createFileRoute, Link, useNavigate, Outlet } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Plus, Home, Library, Upload, Sparkles, Film, FileText, Video, Package, X, Heart, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import slide1 from "@/assets/slide-1.jpg";
import slide2 from "@/assets/slide-2.jpg";
import slide3 from "@/assets/slide-3.jpg";
import slide4 from "@/assets/slide-4.jpg";

const LOCAL_VIDEOS = [
  "/videos/vid-1.mp4",
  "/videos/vid-2.mp4",
  "/videos/vid-3.mp4",
  "/videos/vid-4.mp4",
] as const;
const LOCAL_BACKGROUND_VIDEO = LOCAL_VIDEOS[0];

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  component: DashboardHome,
});

export function MakersMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" role="img" aria-label="Makers">
      <rect x="1" y="1" width="30" height="30" rx="7" fill="#ffffff" />
      <path d="M8 23 V9 L16 19 L24 9 V23" stroke="#000" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Sidebar() {
  return (
    <aside className="w-16 shrink-0 border-r border-white/10 bg-black flex flex-col items-center py-4 gap-6">
      <Link to="/dashboard"><MakersMark className="h-7 w-7" /></Link>
      <nav className="flex flex-col gap-4 mt-4 text-[10px] text-white/60">
        <Link to="/dashboard" className="flex flex-col items-center gap-1 hover:text-white">
          <Home className="h-4 w-4" /><span>Home</span>
        </Link>
        <Link to="/dashboard/library" className="flex flex-col items-center gap-1 hover:text-white">
          <Library className="h-4 w-4" /><span>Library</span>
        </Link>
        <Link to="/dashboard/ads" className="flex flex-col items-center gap-1 hover:text-white">
          <Film className="h-4 w-4" /><span>Ads</span>
        </Link>
      </nav>
    </aside>
  );
}

export function TopBar() {
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);
  async function logout() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { mode: "login" } });
  }
  return (
    <div className="flex items-center justify-end gap-3 px-6 py-3 border-b border-white/5 relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-xs uppercase"
      >
        {email?.[0] ?? "M"}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-4 top-14 z-50 w-56 rounded-xl border border-white/10 bg-[#0d0d0d] shadow-xl overflow-hidden">
            {email && <div className="px-4 py-3 text-xs text-white/60 border-b border-white/10 truncate">{email}</div>}
            <button
              onClick={logout}
              className="w-full text-left px-4 py-3 text-sm text-white hover:bg-white/5 flex items-center gap-2"
            >
              <LogOut className="h-4 w-4" /> Log out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const FEATURED = [
  { id: "product-ads", label: "Product Ads", icon: Package, hero: LOCAL_VIDEOS[0], poster: slide1, title: "Short ad video", kind: "ad" },
  { id: "ai-shorts", label: "Create AI shorts", icon: Film, hero: LOCAL_VIDEOS[1], poster: slide2, title: "AI short film", kind: "short" },
  { id: "use-script", label: "Use my script", icon: FileText, hero: LOCAL_VIDEOS[2], poster: slide3, title: "Turn script into video", kind: "script" },
  { id: "explainer", label: "Make explainer video", icon: Video, hero: LOCAL_VIDEOS[3], poster: slide4, title: "Explainer video", kind: "explainer" },
] as const;

function DashboardHome() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [openFeature, setOpenFeature] = useState<null | (typeof FEATURED)[number]>(null);
  const [attach, setAttach] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) navigate({ to: "/auth", search: { mode: "login" } });
    });
  }, [navigate]);

  async function launch(seed: string) {
    const id = crypto.randomUUID().slice(0, 8);
    const referenceImages = attach && attach.type.startsWith("image/")
      ? [await fileToReferenceImage(attach)]
      : [];
    sessionStorage.setItem(`makers:agent:${id}`, JSON.stringify({ prompt: seed, referenceImages, createdAt: Date.now() }));
    navigate({ to: "/dashboard/agent/$id", params: { id } });
  }

  return (
    <div className="min-h-screen flex bg-black text-foreground">
      <Sidebar />
      <div className="flex-1 flex flex-col relative">
        <div className="absolute inset-0 grid-bg opacity-40 pointer-events-none" />
        <TopBar />
        <div className="relative z-10 flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto pt-10 pb-16 px-6">
            <h1 className="text-center font-serif-display text-4xl md:text-5xl mb-1 mt-6">
              Introducing Makers <sup className="text-[10px] tracking-widest text-white/50 align-middle bg-white/5 px-1.5 py-0.5 rounded ml-1">ALPHA</sup>
            </h1>

            {/* prompt box */}
            <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Plan a script, storyboard or video"
                rows={5}
                className="w-full bg-transparent outline-none resize-none text-sm text-white placeholder:text-white/40"
              />
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="h-8 w-8 rounded-full border border-white/10 hover:bg-white/10 flex items-center justify-center"
                    title="Attach"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  {attach && <span className="text-[11px] text-white/60 truncate max-w-[240px]">{attach.name}</span>}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*,video/*"
                    className="hidden"
                    onChange={(e) => setAttach(e.target.files?.[0] ?? null)}
                  />
                </div>
                <button
                  disabled={!prompt.trim()}
                  onClick={() => void launch(prompt.trim())}
                  className="h-9 w-9 rounded-full bg-white text-black flex items-center justify-center disabled:opacity-40"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* featured */}
            <div className="mt-6 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 flex items-center gap-2 flex-wrap justify-center">
              <span className="text-xs text-white/50 mr-2">Featured</span>
              {FEATURED.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setOpenFeature(f)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 text-[11px] text-white/80"
                >
                  <f.icon className="h-3.5 w-3.5" /> {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {openFeature && (
        <FeatureModal
          feature={openFeature}
          onClose={() => setOpenFeature(null)}
          onProceed={(seed) => { setOpenFeature(null); void launch(seed); }}
        />
      )}
    </div>
  );
}

function fileToReferenceImage(file: File) {
  return new Promise<{ name: string; dataUrl: string; description: string }>((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const max = 720;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Could not process image"));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({ name: file.name, dataUrl: canvas.toDataURL("image/jpeg", 0.72), description: "character/style reference" });
      };
      img.onerror = reject;
      img.src = String(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function FeatureModal({
  feature,
  onClose,
  onProceed,
}: {
  feature: (typeof FEATURED)[number];
  onClose: () => void;
  onProceed: (seed: string) => void;
}) {
  const [duration, setDuration] = useState("15 seconds");
  const [pace, setPace] = useState("fast paced");
  const [platform, setPlatform] = useState("YouTube");
  const [topic, setTopic] = useState("");
  const [activeHero, setActiveHero] = useState(feature.hero || LOCAL_BACKGROUND_VIDEO);
  const [heroReady, setHeroReady] = useState(false);

  function proceed() {
    const seed = `Create a ${duration} ${pace} ${feature.label.toLowerCase()} for ${platform} about ${topic || "my topic"}.`;
    onProceed(seed);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-[#0d0d0d] border border-white/10 rounded-2xl overflow-hidden relative">
        <button onClick={onClose} className="absolute top-4 right-4 z-10 h-8 w-8 rounded-full bg-black/60 hover:bg-black flex items-center justify-center">
          <X className="h-4 w-4" />
        </button>
        <div className="relative h-56 bg-black">
          <img
            src={feature.poster}
            alt=""
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${heroReady ? "opacity-0" : "opacity-100"}`}
          />
          <video
            src={activeHero}
            poster={feature.poster}
            autoPlay
            muted
            loop
            playsInline
            onCanPlay={() => setHeroReady(true)}
            onError={() => {
              setHeroReady(false);
              if (activeHero !== LOCAL_BACKGROUND_VIDEO) setActiveHero(LOCAL_BACKGROUND_VIDEO);
            }}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${heroReady ? "opacity-100" : "opacity-0"}`}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
          <div className="absolute bottom-4 left-6 flex items-center justify-between right-6">
            <h2 className="text-2xl font-semibold">{feature.title}</h2>
            <button className="h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center">
              <Heart className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="p-6">
          <div className="flex flex-wrap items-center gap-2 text-sm text-white/80">
                <span>Create a</span>
                <Select value={duration} onChange={setDuration} options={["10 seconds", "15 seconds", "30 seconds", "60 seconds"]} />
                <Select value={pace} onChange={setPace} options={["fast paced", "cinematic", "dramatic", "calm"]} />
                <span>{feature.kind === "ad" ? "ad for" : feature.kind === "explainer" ? "explainer for" : "video for"}</span>
                <Select value={platform} onChange={setPlatform} options={["YouTube", "TikTok", "Instagram", "X"]} />
                <span>about</span>
              </div>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Type your topic here"
                rows={3}
                className="mt-4 w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-white/30 resize-none"
              />
              <p className="text-xs text-white/50 mt-5 mb-2">Settings:</p>
              <div className="flex flex-wrap gap-2">
                {["Background music", "Language", "Subtitles", "Voice Actors", "Watermark Text", "Music Preference", "Stock / Generative"].map((s) => (
                  <button key={s} className="text-[11px] px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.03] hover:bg-white/10 text-white/70 inline-flex items-center gap-1">
                    {s} <Plus className="h-3 w-3" />
                  </button>
                ))}
              </div>
          <div className="flex items-center justify-end gap-2 mt-8">
            <button onClick={onClose} className="px-5 py-2 rounded-full border border-white/15 text-sm hover:bg-white/5">Back</button>
            <button
              onClick={proceed}
              disabled={!topic.trim()}
              className="px-5 py-2 rounded-full bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium disabled:opacity-40"
            >
              Proceed
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-transparent border-b border-white/30 pr-5 pl-1 py-0.5 text-sm text-white outline-none cursor-pointer"
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-[#0d0d0d]">{o}</option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-white/50 text-[10px]">▾</span>
    </div>
  );
}
