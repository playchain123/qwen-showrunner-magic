import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getBibleSnapshot } from "@/lib/bible/loader.functions";
import { runDirector } from "@/lib/bible/director.functions";
import { runScreenwriter } from "@/lib/bible/screenwriter.functions";
import type { BibleSnapshot, BibleStage } from "@/lib/bible/types";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, BookOpen, Users, MapPin, ScrollText } from "lucide-react";

export const Route = createFileRoute("/dashboard_/bible/$id")({
  ssr: false,
  component: BibleWorkspace,
});

const STAGE_ORDER: BibleStage[] = [
  "director",
  "screenwriter",
  "art_director",
  "voice_caster",
  "shot_planner",
  "shot_renderer",
  "voice_renderer",
  "continuity_qc",
  "assembler",
  "done",
];

function stageIndex(s: BibleStage) {
  return STAGE_ORDER.indexOf(s);
}

function BibleWorkspace() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const load = useServerFn(getBibleSnapshot);
  const director = useServerFn(runDirector);
  const screenwriter = useServerFn(runScreenwriter);

  const [snap, setSnap] = useState<BibleSnapshot | null>(null);
  const [busy, setBusy] = useState<BibleStage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await load({ data: { bibleId: id } });
      setSnap(s);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(stage: BibleStage, fn: () => Promise<unknown>) {
    setBusy(stage);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!snap) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center">
        {error ? <div className="text-red-400 text-sm">{error}</div> : <Loader2 className="animate-spin" />}
      </div>
    );
  }

  const { bible, characters, locations, scenes } = snap;
  const currentIdx = stageIndex(bible.stage);

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.28em] text-white/45">Story Bible</div>
            <h1 className="text-2xl font-semibold mt-1">{bible.project_id}</h1>
            <p className="mt-2 text-sm text-white/70 max-w-2xl">{bible.brief}</p>
          </div>
          <div className="text-xs text-white/50">
            stage <span className="text-white/90">{bible.stage}</span> · status{" "}
            <span className="text-white/90">{bible.status}</span>
          </div>
        </header>

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <StageProgress current={currentIdx} />

        <StageCard
          icon={<BookOpen size={16} />}
          title="1. Director — plan & style bible"
          done={currentIdx > stageIndex("director")}
          busy={busy === "director"}
          onRun={() => run("director", () => director({ data: { bibleId: id } }))}
          runLabel={currentIdx > stageIndex("director") ? "Regenerate plan" : "Run Director"}
        >
          {"logline" in (bible.plan || {}) ? (
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-white/50 text-xs uppercase tracking-wider mb-1">Logline</div>
                <div>{(bible.plan as { logline?: string }).logline}</div>
              </div>
              <div>
                <div className="text-white/50 text-xs uppercase tracking-wider mb-1">Style</div>
                <div className="flex gap-1.5 flex-wrap">
                  {(bible.style_bible as { palette?: string[] }).palette?.map((c) => (
                    <span key={c} className="h-6 w-6 rounded border border-white/10" style={{ background: c }} />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-white/50">Not run yet.</div>
          )}
        </StageCard>

        <div className="grid md:grid-cols-2 gap-4">
          <MiniList icon={<Users size={14} />} title="Characters" empty="No characters yet — run Director.">
            {characters.map((c) => (
              <li key={c.id} className="py-2 border-b border-white/5 last:border-0">
                <div className="text-sm font-medium">{c.name} <span className="text-white/40 text-xs">@{c.token}</span></div>
                <div className="text-xs text-white/60 mt-0.5 line-clamp-2">{c.description}</div>
                <div className="text-[10px] mt-1 flex gap-2">
                  <Tag on={!!c.ref_image_url}>ref image</Tag>
                  <Tag on={!!c.voice_id}>voice</Tag>
                </div>
              </li>
            ))}
          </MiniList>
          <MiniList icon={<MapPin size={14} />} title="Locations" empty="No locations yet — run Director.">
            {locations.map((l) => (
              <li key={l.id} className="py-2 border-b border-white/5 last:border-0">
                <div className="text-sm font-medium">{l.name} <span className="text-white/40 text-xs">@{l.token}</span></div>
                <div className="text-xs text-white/60 mt-0.5 line-clamp-2">{l.description}</div>
                <Tag on={!!l.ref_image_url}>ref image</Tag>
              </li>
            ))}
          </MiniList>
        </div>

        <StageCard
          icon={<ScrollText size={16} />}
          title="2. Screenwriter — scenes & locked dialogue"
          done={currentIdx > stageIndex("screenwriter")}
          busy={busy === "screenwriter"}
          disabled={characters.length === 0}
          onRun={() => run("screenwriter", () => screenwriter({ data: { bibleId: id } }))}
          runLabel={scenes.length ? "Rewrite scenes" : "Run Screenwriter"}
        >
          {scenes.length === 0 ? (
            <div className="text-sm text-white/50">Not run yet.</div>
          ) : (
            <ol className="space-y-3">
              {scenes.map((s) => (
                <li key={s.id} className="rounded-md border border-white/10 bg-white/[0.02] p-3">
                  <div className="text-xs text-white/40 mb-1">Scene {s.scene_index} · ~{Math.round(s.duration_estimate)}s</div>
                  <div className="text-sm">{s.beat}</div>
                  {s.dialogue.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {s.dialogue.map((d, i) => (
                        <div key={i} className="text-xs">
                          <span className="text-white/50">{d.speaker_token}:</span>{" "}
                          <span className="text-white/90">"{d.text}"</span>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </StageCard>

        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-xs text-white/50">
          Stages 3-9 (Art Director, Voice Caster, Shot Planner, Shot Renderer, Voice Renderer, Continuity QC,
          Assembler) are next in the rollout. Once you're happy with the plan and scenes above, we'll wire
          those in — each will read from this bible and never re-invent characters, locations, dialogue, or voices.
        </div>

        <div className="pt-2">
          <Button variant="ghost" onClick={() => navigate({ to: "/dashboard" })}>← Back to dashboard</Button>
        </div>
      </div>
    </div>
  );
}

function StageProgress({ current }: { current: number }) {
  return (
    <div className="flex gap-1">
      {STAGE_ORDER.slice(0, 9).map((s, i) => (
        <div
          key={s}
          title={s}
          className={`h-1.5 flex-1 rounded ${i < current ? "bg-emerald-400" : i === current ? "bg-white/60" : "bg-white/10"}`}
        />
      ))}
    </div>
  );
}

function StageCard({
  icon,
  title,
  done,
  busy,
  disabled,
  onRun,
  runLabel,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  done: boolean;
  busy: boolean;
  disabled?: boolean;
  onRun: () => void;
  runLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="text-white/60">{icon}</span>
          {title}
          {done && <span className="text-[10px] text-emerald-400 uppercase tracking-wider">locked</span>}
        </div>
        <Button size="sm" variant={done ? "outline" : "default"} disabled={busy || disabled} onClick={onRun}>
          {busy ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
          <span className="ml-1.5">{runLabel}</span>
        </Button>
      </div>
      {children}
    </section>
  );
}

function MiniList({
  icon,
  title,
  empty,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-white/60 mb-2">
        {icon}
        {title}
      </div>
      {hasChildren ? <ul>{children}</ul> : <div className="text-sm text-white/40">{empty}</div>}
    </div>
  );
}

function Tag({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 ${on ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-white/40"}`}
    >
      {children}
    </span>
  );
}