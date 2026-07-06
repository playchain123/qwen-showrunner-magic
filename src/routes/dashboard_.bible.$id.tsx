import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Sidebar, TopBar } from "./dashboard";
import {
  getBible,
  stageDirector,
  stageScreenwriter,
  stageArtDirector,
  stageVoiceCaster,
  stageShotPlanner,
  stageShotRenderer,
  renderShot,
  runPipeline,
} from "@/lib/bible/bible.functions";

export const Route = createFileRoute("/dashboard_/bible/$id")({
  ssr: false,
  component: BiblePage,
});

type StageKey = "director" | "screenwriter" | "art" | "voice" | "plan" | "render" | "all";

function BiblePage() {
  const { id } = Route.useParams();
  const get = useServerFn(getBible);
  const q = useQuery({
    queryKey: ["bible", id],
    queryFn: () => get({ data: { bibleId: id } }),
    refetchInterval: 5000,
  });

  const [busy, setBusy] = useState<StageKey | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const director = useServerFn(stageDirector);
  const screenwriter = useServerFn(stageScreenwriter);
  const artDirector = useServerFn(stageArtDirector);
  const voice = useServerFn(stageVoiceCaster);
  const planner = useServerFn(stageShotPlanner);
  const renderer = useServerFn(stageShotRenderer);
  const oneShot = useServerFn(renderShot);
  const pipeline = useServerFn(runPipeline);

  async function run(key: StageKey, fn: () => Promise<unknown>) {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      await q.refetch();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const bible = q.data?.bible;
  const characters = q.data?.characters ?? [];
  const locations = q.data?.locations ?? [];
  const scenes = q.data?.scenes ?? [];
  const shots = q.data?.shots ?? [];

  return (
    <div className="min-h-screen flex bg-black text-white">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <TopBar />
        <div className="max-w-5xl mx-auto w-full px-6 py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-serif-display">Story Bible</h1>
              <p className="text-xs text-white/50 mt-1">
                stage: <span className="text-white/80">{bible?.stage ?? "…"}</span> · status:{" "}
                <span className="text-white/80">{bible?.status ?? "…"}</span>
              </p>
            </div>
            <button
              onClick={() => run("all", () => pipeline({ data: { bibleId: id } }))}
              disabled={busy !== null}
              className="px-4 py-2 rounded-full bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium disabled:opacity-40"
            >
              {busy === "all" ? "Running full pipeline…" : "Run full pipeline"}
            </button>
          </div>
          {bible?.brief && <p className="text-sm text-white/70 mt-3 italic">"{bible.brief}"</p>}
          {err && <p className="text-xs text-red-400 mt-3">{err}</p>}

          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-6">
            <StageButton label="1. Director" busy={busy === "director"} onClick={() => run("director", () => director({ data: { bibleId: id } }))} />
            <StageButton label="2. Screenwriter" busy={busy === "screenwriter"} onClick={() => run("screenwriter", () => screenwriter({ data: { bibleId: id } }))} />
            <StageButton label="3. Art Director" busy={busy === "art"} onClick={() => run("art", () => artDirector({ data: { bibleId: id } }))} />
            <StageButton label="4. Voice Caster" busy={busy === "voice"} onClick={() => run("voice", () => voice({ data: { bibleId: id } }))} />
            <StageButton label="5. Shot Planner" busy={busy === "plan"} onClick={() => run("plan", () => planner({ data: { bibleId: id } }))} />
            <StageButton label="6. Shot Renderer" busy={busy === "render"} onClick={() => run("render", () => renderer({ data: { bibleId: id } }))} />
          </div>

          {/* Plan */}
          {bible?.plan && Object.keys(bible.plan as object).length > 0 && (
            <Panel title="Plan">
              <pre className="text-xs whitespace-pre-wrap text-white/70">{JSON.stringify(bible.plan, null, 2)}</pre>
            </Panel>
          )}

          {characters.length > 0 && (
            <Panel title={`Characters (${characters.length})`}>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {characters.map((c) => (
                  <div key={c.id} className="border border-white/10 rounded-lg p-3 bg-white/[0.03]">
                    {c.ref_image_url ? (
                      <img src={c.ref_image_url} alt={c.name} className="w-full aspect-video object-cover rounded mb-2" />
                    ) : (
                      <div className="w-full aspect-video bg-white/5 rounded mb-2 flex items-center justify-center text-[10px] text-white/40">no ref</div>
                    )}
                    <div className="text-xs font-medium">{c.name}</div>
                    <div className="text-[10px] text-white/50">token: {c.token} · voice: {c.voice_id ?? "—"}</div>
                    <div className="text-[10px] text-white/40 line-clamp-2 mt-1">{c.description}</div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {locations.length > 0 && (
            <Panel title={`Locations (${locations.length})`}>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {locations.map((l) => (
                  <div key={l.id} className="border border-white/10 rounded-lg p-3 bg-white/[0.03]">
                    {l.ref_image_url ? (
                      <img src={l.ref_image_url} alt={l.name} className="w-full aspect-video object-cover rounded mb-2" />
                    ) : (
                      <div className="w-full aspect-video bg-white/5 rounded mb-2 flex items-center justify-center text-[10px] text-white/40">no ref</div>
                    )}
                    <div className="text-xs font-medium">{l.name}</div>
                    <div className="text-[10px] text-white/50">token: {l.token}</div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {scenes.length > 0 && (
            <Panel title={`Scenes (${scenes.length})`}>
              <div className="space-y-2">
                {scenes.map((s) => (
                  <div key={s.id} className="border border-white/10 rounded-lg p-3 bg-white/[0.03]">
                    <div className="text-[10px] text-white/50">scene {s.scene_index} · ~{Number(s.duration_estimate)}s</div>
                    <div className="text-sm mt-1">{s.beat}</div>
                    {Array.isArray(s.dialogue) && s.dialogue.length > 0 && (
                      <div className="mt-2 space-y-0.5">
                        {(s.dialogue as Array<{ character_token: string; line: string }>).map((d, i) => (
                          <div key={i} className="text-xs text-white/70">
                            <span className="text-white/50">{d.character_token}:</span> "{d.line}"
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {shots.length > 0 && (
            <Panel title={`Shots (${shots.length})`}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {shots.map((s) => (
                  <div key={s.id} className="border border-white/10 rounded-lg p-3 bg-white/[0.03]">
                    <div className="text-[10px] text-white/50 flex justify-between">
                      <span>shot {s.shot_index} · seed {String(s.seed).slice(0, 8)} · {Number(s.duration_seconds)}s</span>
                      <span className={`px-1.5 rounded ${s.status === "rendered" ? "bg-green-500/20 text-green-300" : s.status === "rendering" ? "bg-yellow-500/20 text-yellow-300" : s.status === "failed" ? "bg-red-500/20 text-red-300" : "bg-white/10 text-white/60"}`}>
                        {s.status}
                      </span>
                    </div>
                    <div className="text-xs mt-1 text-white/70 line-clamp-3">{s.visual_prompt}</div>
                    {s.clip_url ? (
                      <video src={s.clip_url} controls playsInline className="w-full aspect-video mt-2 rounded bg-black" />
                    ) : (
                      <button
                        onClick={() => run("render", () => oneShot({ data: { bibleId: id, shotId: s.id } }))}
                        disabled={busy !== null}
                        className="text-[11px] mt-2 px-3 py-1 rounded border border-white/15 hover:bg-white/10 disabled:opacity-40"
                      >
                        Render this shot
                      </button>
                    )}
                    {s.qc_notes && <div className="text-[10px] text-red-300/70 mt-2">{s.qc_notes}</div>}
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function StageButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="text-left px-3 py-2 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-xs disabled:opacity-40"
    >
      {busy ? "Running…" : label}
    </button>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xs uppercase tracking-widest text-white/40 mb-3">{title}</h2>
      {children}
    </section>
  );
}