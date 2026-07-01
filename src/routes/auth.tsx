import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useRef, type FormEvent } from "react";
import { z } from "zod";
import { Eye, EyeOff, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/makers-logo.png";
import authReel from "@/assets/auth-reel.mp4.asset.json";

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

const clips = [authReel.url];

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
        setTimeout(() => navigate({ to: "/" }), 800);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/" });
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
          <img src={logo} alt="Makers" className="h-6 w-6" style={{ filter: "brightness(0) invert(1)" }} />
          <span className="font-medium">makers</span>
        </Link>
        <div className="max-w-sm mx-auto w-full">
          <div className="flex justify-center mb-4">
            <img src={logo} alt="Makers" className="h-10 w-10" style={{ filter: "brightness(0) invert(1)" }} />
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

      {/* RIGHT — cinematic video */}
      <div className="hidden md:flex flex-col items-center justify-center bg-[#0a0a0a] border-l border-white/10 p-10">
        <h2 className="font-serif-display text-4xl mb-2">Introducing Makers</h2>
        <p className="text-sm text-foreground/60 mb-8">Go back and forth with an agent to create your dream drama.</p>
        <div className="relative w-full max-w-xl aspect-video rounded-xl overflow-hidden border border-white/10 bg-black">
          <video
            ref={vidRef}
            key={clipIdx}
            src={clips[clipIdx]}
            autoPlay
            muted
            playsInline
            onEnded={() => setClipIdx((i) => (i + 1) % clips.length)}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          <div className="absolute bottom-4 left-4 flex items-center gap-2">
            <img src={logo} alt="" className="h-6 w-6" style={{ filter: "brightness(0) invert(1)" }} />
            <span className="text-xs uppercase tracking-widest text-white/80">Made with Makers</span>
          </div>
        </div>
      </div>
    </main>
  );
}