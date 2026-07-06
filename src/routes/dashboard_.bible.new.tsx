import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { createStoryBible } from "@/lib/bible/director.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/dashboard_/bible/new")({
  ssr: false,
  component: NewBible,
});

function NewBible() {
  const create = useServerFn(createStoryBible);
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { id } = await create({ data: { projectId: projectId || `bible-${Date.now()}`, brief } });
      navigate({ to: "/dashboard_/bible/$id", params: { id } });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <div>
          <div className="text-xs uppercase tracking-[0.28em] text-white/45">New Story Bible</div>
          <h1 className="text-2xl font-semibold mt-1">Start a consistent video project</h1>
          <p className="mt-2 text-sm text-white/60">
            The bible locks characters, voices, dialogue, and style once. Every downstream stage reads from
            it — so scenes stay consistent instead of drifting.
          </p>
        </div>
        <label className="block text-sm">
          <span className="text-white/70">Project name</span>
          <Input value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="my-first-film" />
        </label>
        <label className="block text-sm">
          <span className="text-white/70">Brief</span>
          <Textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="A rain-soaked chase through a Tokyo alley, two characters, one betrayal."
            rows={6}
          />
        </label>
        {error && <div className="text-sm text-red-400">{error}</div>}
        <div className="flex justify-end">
          <Button disabled={busy || brief.length < 10} onClick={submit}>
            {busy ? <Loader2 className="animate-spin" size={14} /> : null}
            <span className="ml-1.5">Create bible</span>
          </Button>
        </div>
      </div>
    </div>
  );
}