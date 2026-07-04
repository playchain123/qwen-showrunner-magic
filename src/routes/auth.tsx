import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useEffect, type FormEvent } from "react";
import { z } from "zod";
import { Eye, EyeOff, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

function Mark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-label="Makers" role="img" fill="none">
      <rect x="1" y="1" width="30" height="30" rx="7" fill="#ffffff" />
      <path d="M8 23 V9 L16 19 L24 9 V23" stroke="#000000" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

const searchSchema = z.object({
  mode: z.enum(["login", "signup"]).catch("signup"),
});

export const Route = createFileRoute("/auth")({
  validateSearch: (s) => searchSchema.parse(s),
  component: AuthPage,
  head: () => ({
    meta: [
      { title: "Sign in — Makers" },
      { name: "description", content: "Sign in or create a Makers account." },
    ],
  }),
});

const reels = [
  { url: "/videos/vid-1.mp4", title: "Who am I?", tag: "Cinematic short" },
  { url: "/videos/vid-2.mp4", title: "The Interview", tag: "Portrait drama" },
  { url: "/videos/vid-3.mp4", title: "Nightwalker", tag: "Cyberpunk teaser" },
  { url: "/videos/vid-4.mp4", title: "Skyline", tag: "Epic wide shot" },
];

function AuthPage() {
  const { mode } = Route.useSearch();
  const isSignup = mode === "signup";
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [clipIdx, setClipIdx] = useState(0);
  const vidRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const t = setInterval(() => setClipIdx((i) => (i + 1) % reels.length), 6000);
    return () => clearInterval(t);
  }, []);

  const schema = isSignup
    ? z.object({
        name: z.string().trim().min(1, "Name is required").max(80),
        email: z.string().trim().email("Invalid email").max(255),
        password: z.string().min(6, "Password must be at least 6 characters").max(72),
      })
    : z.object({
        email: z.string().trim().email("Invalid email"),
        password: z.string().min(1, "Password required"),
      });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    const parsed = schema.safeParse({ name, email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setLoading(true);
    try {
      if (isSignup) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { full_name: name },
          },
        });
        if (error) throw error;
        setMsg("Account created. Redirecting…");
        setTimeout(() => navigate({ to: "/dashboard" }), 800);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/dashboard" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen w-full grid grid-cols-1 md:grid-cols-2 bg-black text-foreground">
      {/* LEFT — form */}
      <div className="flex flex-col justify-center px-8 md:px-16 py-12 relative">
        <Link to="/" className="absolute top-6 left-6 md:left-10 flex items-center gap-2 text-sm text-foreground/70 hover:text-foreground">
          <Mark className="h-6 w-6" />
          <span className="font-medium">makers</span>
        </Link>
        <div className="max-w-sm mx-auto w-full">
          <div className="flex justify-center mb-4">
            <Mark className="h-10 w-10" />
          </div>
          <h1 className="text-center text-2xl font-semibold mb-8">
            {isSignup ? "Create your Makers account" : "Welcome back to Makers"}
          </h1>

          <form onSubmit={onSubmit} className="space-y-3">
            {isSignup && (
              <input
                type="text"
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-full px-5 py-3 text-sm outline-none focus:border-white/40"
                autoComplete="name"
                maxLength={80}
              />
            )}
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-full px-5 py-3 text-sm outline-none focus:border-white/40"
              autoComplete="email"
              maxLength={255}
            />
            <div className="relative">
              <input
                type={show ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-full px-5 pr-12 py-3 text-sm outline-none focus:border-white/40"
                autoComplete={isSignup ? "new-password" : "current-password"}
                maxLength={72}
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/60 hover:text-foreground p-1"
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {error && <p className="text-xs text-red-400 text-center">{error}</p>}
            {msg && <p className="text-xs text-emerald-400 text-center">{msg}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-white text-black text-sm font-medium py-3 hover:bg-white/90 transition disabled:opacity-60"
            >
              {loading ? "Please wait…" : isSignup ? "Create account" : "Continue"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <p className="text-center text-sm text-foreground/60 mt-6">
            {isSignup ? (
              <>Already have an account?{" "}
                <Link to="/auth" search={{ mode: "login" }} className="text-white font-medium hover:underline">Log in</Link>
              </>
            ) : (
              <>Don't have an account?{" "}
                <Link to="/auth" search={{ mode: "signup" }} className="text-white font-medium hover:underline">Sign up</Link>
              </>
            )}
          </p>

          <p className="text-center text-[11px] text-foreground/40 mt-10">
            <a href="#" className="underline hover:text-foreground/70">Terms of Use</a>
            <span className="mx-2">·</span>
            <a href="#" className="underline hover:text-foreground/70">Privacy Policy</a>
          </p>
        </div>
      </div>

      {/* RIGHT — cinematic showcase */}
      <div className="hidden md:flex flex-col items-center justify-center bg-[#0a0a0a] border-l border-white/10 p-10 relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-40 pointer-events-none" />
        <div className="relative z-10 w-full max-w-xl">
          <h2 className="font-serif-display text-4xl md:text-5xl text-center mb-2">
            {reels[clipIdx].title}
          </h2>
          <p className="text-center text-sm text-foreground/60 mb-8">
            A new way to make cinematic video with Makers.
          </p>

          {/* Featured video */}
          <div className="relative aspect-video rounded-xl overflow-hidden border border-white/10 bg-black shadow-2xl">
            <video
              ref={vidRef}
              key={clipIdx}
              src={reels[clipIdx].url}
              autoPlay
              muted
              loop
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/50 backdrop-blur px-2.5 py-1">
              <Mark className="h-4 w-4" />
              <span className="text-[10px] uppercase tracking-widest text-white/80">Made with Makers</span>
            </div>
            <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-white/60">{reels[clipIdx].tag}</p>
                <p className="text-lg font-medium text-white">{reels[clipIdx].title}</p>
              </div>
            </div>
          </div>

          {/* Thumbnail strip */}
          <div className="mt-4 grid grid-cols-4 gap-2">
            {reels.map((r, i) => (
              <button
                key={r.url}
                onClick={() => setClipIdx(i)}
                className={`relative aspect-video rounded-md overflow-hidden border transition ${
                  i === clipIdx ? "border-white" : "border-white/10 opacity-60 hover:opacity-100"
                }`}
              >
                <video src={r.url} muted playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" />
                <span className="absolute bottom-1 left-1 right-1 truncate text-[9px] text-white/90 text-left">
                  {r.title}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
