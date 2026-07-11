import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ensureAgentProject, listAgentShots } from "@/lib/agent/projects.functions";
import { Sidebar, TopBar } from "./dashboard";

export const Route = createFileRoute("/dashboard_/showrunner/$id")({
  ssr: false,
  component: ShowrunnerPage,
});

type ShotRow = {
  idx: number;
  prompt: string;
  speaker: string | null;
  dialogue: string | null;
  frame_url: string | null;
  video_url: string | null;
  audio_url: string | null;
  status: string;
};

function ShowrunnerPage() {
  const { id } = Route.useParams();
  const [ready, setReady] = useState(false);
  const [shots, setShots] = useState<ShotRow[]>([]);
  const [premise, setPremise] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/agent",
        body: { projectId: id },
      }),
    [id],
  );

  const initial: UIMessage[] = useMemo(() => [], []);
  const { messages, sendMessage, status } = useChat({
    id,
    messages: initial,
    transport,
    onError: (err) => setError(err.message),
  });
  const busy = status === "submitted" || status === "streaming";

  // Ensure project row exists (draft premise until user sends first message).
  useEffect(() => {
    let alive = true;
    void ensureAgentProject({ data: { id, premise: "Untitled showrunner project" } })
      .then((p) => {
        if (!alive) return;
        setPremise(p.premise || "");
        setReady(true);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [id]);

  // Poll shots (simple; refresh every 3s while busy, every 8s while idle).
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      try {
        const rows = await listAgentShots({ data: { projectId: id } });
        if (alive) setShots(rows as ShotRow[]);
      } catch {
        // best-effort
      }
      if (alive) timer = setTimeout(tick, busy ? 3000 : 8000);
    }
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [id, busy]);

  // Keep composer focused per chat-agent contract.
  useEffect(() => {
    inputRef.current?.focus();
  }, [ready, status]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const el = inputRef.current;
    if (!el || !el.value.trim() || busy) return;
    const text = el.value.trim();
    el.value = "";
    // Guard: make sure user is signed in.
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) {
      setError("Please sign in first.");
      return;
    }
    await sendMessage({ text });
  }

  return (
    <div className="min-h-screen flex bg-black text-white">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <TopBar />
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] min-h-0">
          {/* Chat */}
          <div className="flex flex-col border-r border-white/10 min-h-0">
            <div className="px-6 py-3 border-b border-white/10 flex items-center gap-2">
              <span className="text-sm font-medium">Showrunner</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-fuchsia-500/20 text-fuchsia-200">
                Wan · Happyhorse · CosyVoice
              </span>
              <span className="ml-auto text-xs text-white/40 truncate max-w-[240px]">{premise}</span>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {messages.length === 0 && (
                <div className="text-sm text-white/50 leading-relaxed">
                  Describe your 10-shot film. Example: <em>"A rooftop reunion between two estranged siblings at
                  golden hour in Mumbai, warm cinematic tone."</em> The agent will plan the story, lock character
                  identity via wan2.7-image-pro, clone each voice with CosyVoice + voice-enrollment, then render all
                  10 shots with Happyhorse (Wan fallback).
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className="text-sm">
                  <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">
                    {m.role === "user" ? "You" : "Showrunner"}
                  </div>
                  <div className="space-y-2">
                    {m.parts.map((p, i) => {
                      if (p.type === "text") {
                        return (
                          <div key={i} className="whitespace-pre-wrap text-white/90">
                            {p.text}
                          </div>
                        );
                      }
                      if (p.type.startsWith("tool-")) {
                        const toolName = p.type.replace(/^tool-/, "");
                        // AI SDK v5 tool part shape (best-effort render).
                        const state = (p as { state?: string }).state;
                        return (
                          <div
                            key={i}
                            className="text-[11px] px-2 py-1 inline-flex items-center gap-2 rounded bg-white/5 text-white/70 border border-white/10"
                          >
                            <span className="font-mono">{toolName}</span>
                            <span className="text-white/40">{state ?? "…"}</span>
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                </div>
              ))}
              {busy && <div className="text-xs text-white/40 animate-pulse">Showrunner is working…</div>}
              {error && <div className="text-xs text-red-400">{error}</div>}
            </div>
            <form onSubmit={submit} className="p-4 border-t border-white/10 flex gap-2">
              <textarea
                ref={inputRef}
                rows={2}
                placeholder="Describe the film…"
                className="flex-1 resize-none bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-white/30"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submit(e as unknown as React.FormEvent);
                  }
                }}
                disabled={busy || !ready}
              />
              <button
                type="submit"
                disabled={busy || !ready}
                className="px-4 py-2 rounded-lg bg-white text-black text-sm font-medium disabled:opacity-40"
              >
                {busy ? "…" : "Send"}
              </button>
            </form>
          </div>

          {/* Shot grid */}
          <div className="min-h-0 overflow-y-auto p-6">
            <div className="text-xs uppercase tracking-wider text-white/40 mb-3">10-shot storyboard</div>
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((idx) => {
                const s = shots.find((x) => x.idx === idx);
                return (
                  <div key={idx} className="rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden">
                    <div className="aspect-video bg-black/60 flex items-center justify-center relative">
                      {s?.video_url ? (
                        <video src={s.video_url} controls className="w-full h-full object-cover" />
                      ) : s?.frame_url ? (
                        <img src={s.frame_url} alt="" className="w-full h-full object-cover opacity-80" />
                      ) : (
                        <span className="text-[10px] text-white/30">Shot {idx}</span>
                      )}
                      <span className="absolute top-1 left-1 text-[10px] bg-black/60 rounded px-1.5 py-0.5">
                        #{idx} · {s?.status ?? "—"}
                      </span>
                    </div>
                    <div className="p-2 text-[11px] text-white/60 line-clamp-2 min-h-[38px]">
                      {s?.prompt || <span className="text-white/30">not planned yet</span>}
                    </div>
                    {s?.dialogue && (
                      <div className="px-2 pb-2 text-[10px] text-white/40 truncate">
                        {s.speaker}: “{s.dialogue}”
                        {s.audio_url && <span className="ml-1 text-emerald-400">♪</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}