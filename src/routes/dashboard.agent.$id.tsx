import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Plus, Play, ChevronDown, Sparkles, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sidebar, TopBar, MakersMark } from "./dashboard";
import { generateStoryboard, submitVideo, pollVideo } from "@/lib/qwen.functions";

export const Route = createFileRoute("/dashboard/agent/$id")({
  ssr: false,
  component: AgentWorkspace,
});

type ChatMsg = { role: "user" | "agent"; text: string; skills?: string[]; task?: string };
type StoryCard = { title: string; progress: number; done: boolean; videoUrl?: string; caption: string };

function AgentWorkspace() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [cards, setCards] = useState<StoryCard[]>([]);
  const [tasks, setTasks] = useState<{ text: string; done: boolean }[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  // auth + seed
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) navigate({ to: "/auth", search: { mode: "login" } });
    });
    const raw = sessionStorage.getItem(`makers:agent:${id}`);
    if (raw && !startedRef.current) {
      startedRef.current = true;
      const { prompt } = JSON.parse(raw);
      setMessages([{ role: "user", text: prompt }]);
      void runPipeline(prompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  async function runPipeline(prompt: string) {
    setThinking(true);
    try {
      // 1. Storyboard via Qwen
      const story = await generateStoryboard({ data: { prompt, sceneCount: 3 } });
      setThinking(false);
      setMessages((m) => [
        ...m,
        {
          role: "agent",
          text: `Locked. Storyboard "${story.title}" — ${story.tone}. Dispatching ${story.scenes.length} scenes to HappyHorse T2V on Qwen Cloud.`,
          skills: ["Script Agent", "Storyboard Agent", "HappyHorse T2V"],
          task: `Render ${story.scenes.length} cinematic scenes`,
        },
      ]);
      setTasks([{ text: `Render ${story.scenes.length} cinematic scenes`, done: false }]);

      // 2. Add cards + submit videos in parallel
      const scenes = story.scenes;
      setCards(
        scenes.map((s, i) => ({
          title: `#${i + 1} ${s.title}`,
          caption: `${s.dialogue} — ${s.visual}`,
          progress: 5,
          done: false,
        })),
      );

      await Promise.all(
        scenes.map(async (s, idx) => {
          try {
            const { task_id } = await submitVideo({ data: { prompt: s.video_prompt } });
            // poll
            let attempts = 0;
            while (attempts < 90) {
              await new Promise((r) => setTimeout(r, 5000));
              attempts++;
              const p = Math.min(10 + attempts * 2, 90);
              setCards((c) => c.map((card, i) => (i === idx ? { ...card, progress: p } : card)));
              const status = await pollVideo({ data: { task_id } });
              if (status.status === "SUCCEEDED" && status.video_url) {
                setCards((c) =>
                  c.map((card, i) => (i === idx ? { ...card, progress: 100, done: true, videoUrl: status.video_url } : card)),
                );
                return;
              }
              if (status.status === "FAILED") throw new Error(status.error || "Task failed");
            }
            throw new Error("Timed out waiting for video");
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setCards((c) => c.map((card, i) => (i === idx ? { ...card, caption: `${card.caption}\n⚠ ${msg}` } : card)));
          }
        }),
      );

      setTasks((t) => t.map((task) => ({ ...task, done: true })));
      setMessages((m) => [
        ...m,
        { role: "agent", text: `All ${scenes.length} scenes rendered. Master cut ready to assemble.` },
      ]);
    } catch (err: unknown) {
      setThinking(false);
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((m) => [...m, { role: "agent", text: `Pipeline error: ${msg}` }]);
    }
  }

  function send() {
    if (!input.trim()) return;
    const text = input.trim();
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    void runPipeline(text);
  }

  return (
    <div className="min-h-screen flex bg-black text-foreground">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <TopBar />
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_1fr] min-h-0">
          {/* LEFT — chat */}
          <div className="flex flex-col border-r border-white/10 min-h-0">
            <div className="flex items-center gap-2 px-6 py-3 border-b border-white/10">
              <MakersMark className="h-5 w-5" />
              <span className="text-sm font-medium">Makers</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 ml-1">Agent</span>
              <div className="ml-auto flex items-center gap-2 text-xs text-white/50">
                <Play className="h-3 w-3" /> Replay
              </div>
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
              {messages.map((m, i) => (
                <MessageBubble key={i} msg={m} />
              ))}
              {thinking && (
                <div className="flex items-center gap-2 text-sm text-white/60">
                  <MakersMark className="h-4 w-4" />
                  <span className="animate-pulse">Makers is thinking…</span>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-white/10">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  placeholder="Send a message to Makers"
                  className="w-full bg-transparent outline-none text-sm placeholder:text-white/40"
                />
                <div className="flex items-center justify-between mt-2">
                  <button className="h-7 w-7 rounded-full border border-white/10 hover:bg-white/10 flex items-center justify-center">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-white/50">Makers lite ▾</span>
                    <button onClick={send} className="h-7 w-7 rounded-full bg-white text-black flex items-center justify-center">
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT — canvas */}
          <div className="flex flex-col min-h-0">
            <div className="flex items-center gap-3 px-6 py-3 border-b border-white/10 text-xs">
              <span className="font-medium text-white">workspace</span>
              <span className="text-white/40">·</span>
              <button className="text-white/60 hover:text-white">Context</button>
              <button className="text-white bg-white/10 rounded px-2 py-0.5">Page 1</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
              {cards.length === 0 ? (
                <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-center text-white/40">
                  <Sparkles className="h-10 w-10 mb-3 opacity-40" />
                  <p className="text-sm">No items to display</p>
                </div>
              ) : (
                cards.map((c, i) => <StoryboardCard key={i} card={c} />)
              )}
            </div>
            {tasks.length > 0 && (
              <div className="border-t border-white/10 px-6 py-4">
                <div className="flex items-center justify-between text-xs text-white/60 mb-3">
                  <span>Tasks</span>
                  <span>{tasks.filter((t) => t.done).length} / {tasks.length}</span>
                </div>
                <div className="space-y-2">
                  {tasks.map((t, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className={`h-4 w-4 rounded-full border ${t.done ? "bg-emerald-500 border-emerald-500" : "border-white/30"} flex items-center justify-center`}>
                        {t.done && <Check className="h-3 w-3 text-black" />}
                      </span>
                      <span className={t.done ? "text-white/50 line-through" : "text-white/90"}>{t.text}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-white/60">
                  <MakersMark className="h-4 w-4" /> Pre-production
                  <ChevronDown className="h-3 w-3 ml-auto" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMsg }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-white/10 px-4 py-2 text-sm">{msg.text}</div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-white/60">
        <MakersMark className="h-4 w-4" />
        <span className="font-medium text-white">Makers</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">Agent</span>
      </div>
      {msg.skills && (
        <div className="text-sm text-white/80 space-y-1">
          <div>Reading {msg.skills.length} skills <Check className="inline h-3 w-3 text-emerald-400" /></div>
          {msg.skills.map((s) => (
            <div key={s} className="text-white/70">Dispatching {s} <Check className="inline h-3 w-3 text-emerald-400" /></div>
          ))}
        </div>
      )}
      <p className="text-sm text-white/90 leading-relaxed">{msg.text}</p>
    </div>
  );
}

function StoryboardCard({ card }: { card: StoryCard }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 text-sm border-b border-white/10">
        <MakersMark className="h-4 w-4" />
        <span className="font-medium">{card.title}</span>
      </div>
      <div className="relative aspect-video bg-black">
        {card.videoUrl && card.done ? (
          <video src={card.videoUrl} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="relative h-16 w-16">
              <svg viewBox="0 0 36 36" className="h-16 w-16 -rotate-90">
                <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
                <circle
                  cx="18" cy="18" r="16" fill="none" stroke="#fff" strokeWidth="2"
                  strokeDasharray={`${(card.progress / 100) * 100} 100`}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xs">{card.progress}</span>
            </div>
            <span className="text-xs text-white/60 mt-2">Generating with Nano Banana 2</span>
          </div>
        )}
      </div>
      <div className="px-4 py-3 text-xs text-white/70 flex items-center gap-2">
        <span className="truncate flex-1">{card.caption}</span>
        <span className="px-2 py-0.5 rounded bg-white/5 text-[10px]">No edits</span>
        <span className="px-2 py-0.5 rounded bg-white/5 text-[10px]">Nano Banana 2</span>
      </div>
    </div>
  );
}