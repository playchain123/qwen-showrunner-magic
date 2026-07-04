import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, Brain, Clock, Film, RefreshCw } from "lucide-react";
import { Sidebar, TopBar } from "./dashboard";
import { buildStyleProfile, readGenerationLogs, type GenerationLogEntry, type StyleProfile } from "@/lib/library";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/dashboard_/profile")({
  ssr: false,
  component: StyleProfilePage,
});

function StyleProfilePage() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState<GenerationLogEntry[]>([]);
  const profile = useMemo<StyleProfile>(() => buildStyleProfile(logs), [logs]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) navigate({ to: "/auth", search: { mode: "login" } });
    });
    setLogs(readGenerationLogs());
  }, [navigate]);

  function refresh() {
    setLogs(readGenerationLogs());
  }

  return (
    <div className="min-h-screen flex bg-black text-white">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <TopBar />
        <div className="flex-1 overflow-y-auto px-8 py-8">
          <div className="mb-7 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold flex items-center gap-2">
                <Brain className="h-5 w-5" /> Style Profile
              </h1>
              <p className="mt-2 text-sm text-white/50 max-w-2xl">
                Local learning signal from accepted projects, critique results, and website-video motion choices.
              </p>
            </div>
            <button onClick={refresh} className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Stat label="Samples" value={String(profile.sampleCount)} />
            <Stat label="Pacing" value={profile.preferredPacing} />
            <Stat label="Motion" value={profile.preferredMotionEnergy} />
            <Stat label="Capture Ratio" value={`${Math.round(profile.preferredCaptureRatio * 100)}%`} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
              <h2 className="text-sm font-medium flex items-center gap-2">
                <BarChart3 className="h-4 w-4" /> Preferred Shot Bias
              </h2>
              <div className="mt-4 space-y-3">
                {Object.keys(profile.preferredShotBias).length === 0 ? (
                  <EmptyLine text="No accepted shots yet." />
                ) : (
                  Object.entries(profile.preferredShotBias).map(([shot, value]) => (
                    <div key={shot}>
                      <div className="mb-1 flex justify-between text-xs text-white/60">
                        <span>{shot}</span>
                        <span>{Math.round(value * 100)}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full bg-white/80" style={{ width: `${Math.max(4, value * 100)}%` }} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
              <h2 className="text-sm font-medium flex items-center gap-2">
                <Film className="h-4 w-4" /> Planner Defaults
              </h2>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <Info label="Color Grade" value={profile.preferredColorGrade || "Not enough signal"} />
                <Info label="Lighting Mood" value={profile.preferredLightingMood || "Not enough signal"} />
                <Info label="Easing" value={profile.preferredEasingFamily || "ease-out-expo"} />
                <Info label="Transition" value={profile.preferredTransitionStyle || "match/cross-dissolve"} />
              </div>
            </section>

            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
              <h2 className="text-sm font-medium">Rejection / Refinement Patterns</h2>
              <div className="mt-4 space-y-2">
                {Object.keys(profile.rejectionPatterns).length === 0 ? (
                  <EmptyLine text="No recurring quality issues logged." />
                ) : (
                  Object.entries(profile.rejectionPatterns)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 8)
                    .map(([flag, count]) => (
                      <div key={flag} className="flex justify-between rounded-md border border-white/10 px-3 py-2 text-xs text-white/65">
                        <span>{flag}</span>
                        <span>{count}</span>
                      </div>
                    ))
                )}
              </div>
            </section>

            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
              <h2 className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4" /> Recent Generation Log
              </h2>
              <div className="mt-4 space-y-2 max-h-[360px] overflow-y-auto pr-1">
                {logs.length === 0 ? (
                  <EmptyLine text="Generate or save a project to create learning signal." />
                ) : (
                  logs.slice(-10).reverse().map((entry) => (
                    <div key={entry.id} className="rounded-md border border-white/10 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="truncate text-sm">{entry.sceneTitle}</div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
                          entry.critiqueResult.verdict === "accept" ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"
                        }`}>
                          {entry.critiqueResult.verdict}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-white/45 truncate">{entry.projectTitle} - {entry.projectType}</div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-white/55">
                        <span>F {Math.round(entry.critiqueResult.prompt_fidelity_score * 100)}</span>
                        <span>C {Math.round(entry.critiqueResult.continuity_score * 100)}</span>
                        <span>R {Math.round(entry.critiqueResult.realism_score * 100)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-[10px] uppercase tracking-widest text-white/40">{label}</div>
      <div className="mt-2 text-xl font-semibold capitalize">{value}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 p-3">
      <div className="text-[10px] uppercase tracking-widest text-white/40">{label}</div>
      <div className="mt-1 text-white/80">{value}</div>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <div className="rounded-md border border-dashed border-white/10 p-4 text-center text-xs text-white/40">{text}</div>;
}
