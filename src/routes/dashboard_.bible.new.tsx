import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Sidebar, TopBar } from "./dashboard";
import { createBible, listBibles } from "@/lib/bible/bible.functions";
import { useQuery } from "@tanstack/react-query";

export const Route = createFileRoute("/dashboard_/bible/new")({
  ssr: false,
  component: NewBiblePage,
});

function NewBiblePage() {
  const navigate = useNavigate();
  const create = useServerFn(createBible);
  const list = useServerFn(listBibles);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ["bibles"], queryFn: () => list() });

  async function submit() {
    if (busy || brief.trim().length < 10) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await create({ data: { brief: brief.trim() } });
      navigate({ to: "/dashboard_/bible/$id", params: { id: res.id } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-black text-white">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <TopBar />
        <div className="max-w-3xl mx-auto w-full px-6 py-10">
          <h1 className="text-3xl font-serif-display mb-2">New Story Bible</h1>
          <p className="text-sm text-white/60 mb-6">
            The agent will run: Director → Screenwriter → Art Director (HappyHorse refs) → Voice Caster → Shot Planner →
            Shot Renderer (HappyHorse + Wan). Only Wan and HappyHorse are used for motion.
          </p>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={6}
            placeholder="A 15-second short drama about a rooftop reunion between two estranged sisters at dawn in Tokyo."
            className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-sm outline-none focus:border-white/30 resize-none"
          />
          {err && <p className="text-xs text-red-400 mt-2">{err}</p>}
          <div className="mt-4 flex justify-end">
            <button
              disabled={busy || brief.trim().length < 10}
              onClick={() => void submit()}
              className="px-5 py-2 rounded-full bg-white text-black font-medium disabled:opacity-40"
            >
              {busy ? "Creating…" : "Create bible"}
            </button>
          </div>

          <h2 className="text-sm uppercase tracking-widest text-white/40 mt-12 mb-3">Recent bibles</h2>
          <div className="space-y-2">
            {(data?.bibles ?? []).map((b) => (
              <button
                key={b.id}
                onClick={() => navigate({ to: "/dashboard_/bible/$id", params: { id: b.id } })}
                className="w-full text-left rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] px-4 py-3"
              >
                <div className="text-xs text-white/50">
                  {b.stage} · {b.status}
                </div>
                <div className="text-sm truncate">{b.brief}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}