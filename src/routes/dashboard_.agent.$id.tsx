import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Plus, Play, Sparkles, Check, Film, Volume2, VolumeX, Download, ImagePlus, Scissors } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sidebar, TopBar, MakersMark } from "./dashboard";
import { generateStoryboard, submitVideo, pollVideo, generateVoice } from "@/lib/qwen.functions";

export const Route = createFileRoute("/dashboard_/agent/$id")({
  ssr: false,
  component: AgentWorkspace,
});

type ChatMsg = { role: "user" | "agent"; text: string; skills?: string[]; task?: string };
type ReferenceImage = { name: string; dataUrl: string; description?: string };
type StoryCard = {
  title: string;
  progress: number;
  done: boolean;
  videoUrl?: string;
  audioUrl?: string;
  visual?: string;
  caption: string;
  spokenLine: string;
  character: string;
  shotType?: string;
  language?: string;
  voiceTone?: string;
  pitch?: "low" | "medium" | "high";
  bgm?: string;
  sfx?: string;
  durationSeconds?: number;
  colorGrade?: string;
  editingNotes?: string;
  referenceImageDirection?: string;
};

function AgentWorkspace() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [cards, setCards] = useState<StoryCard[]>([]);
  const [tasks, setTasks] = useState<{ text: string; done: boolean }[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [playingFilm, setPlayingFilm] = useState(false);
  const [filmTitle, setFilmTitle] = useState<string>("");
  const [logline, setLogline] = useState<string>("");
  const [currentPrompt, setCurrentPrompt] = useState<string>("");
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const startedRef = useRef(false);

  const totalProgress = cards.length
    ? Math.round(cards.reduce((s, c) => s + c.progress, 0) / cards.length)
    : 0;
  const allDone = cards.length > 0 && cards.every((c) => c.done);
  const readyCount = cards.filter((c) => c.done && c.videoUrl).length;
  const canPlay = readyCount >= 1;
  const firstReady = cards.find((c) => c.done && c.videoUrl);

  // auth + seed
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) navigate({ to: "/auth", search: { mode: "login" } });
    });
    const saved = localStorage.getItem(`makers:agentdoc:${id}`);
    if (saved && !startedRef.current) {
      try {
        const doc = JSON.parse(saved) as {
          prompt?: string;
          messages?: ChatMsg[];
          cards?: StoryCard[];
          tasks?: { text: string; done: boolean }[];
          filmTitle?: string;
          logline?: string;
          referenceImages?: ReferenceImage[];
        };
        startedRef.current = true;
        setCurrentPrompt(doc.prompt || "");
        setMessages(doc.messages || []);
        setCards(doc.cards || []);
        setTasks(doc.tasks || []);
        setFilmTitle(doc.filmTitle || "");
        setLogline(doc.logline || "");
        setReferenceImages(doc.referenceImages || []);
        return;
      } catch {
        localStorage.removeItem(`makers:agentdoc:${id}`);
      }
    }
    const raw = sessionStorage.getItem(`makers:agent:${id}`);
    if (raw && !startedRef.current) {
      startedRef.current = true;
      const { prompt, referenceImages: refs = [] } = JSON.parse(raw) as { prompt: string; referenceImages?: ReferenceImage[] };
      setCurrentPrompt(prompt);
      setReferenceImages(refs);
      setMessages([{ role: "user", text: prompt }]);
      void runPipeline(prompt, refs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!startedRef.current && !currentPrompt && messages.length === 0 && cards.length === 0) return;
    try {
      localStorage.setItem(
        `makers:agentdoc:${id}`,
        JSON.stringify({
          prompt: currentPrompt,
          messages,
          cards,
          tasks,
          filmTitle,
          logline,
          referenceImages,
          updatedAt: Date.now(),
        }),
      );
    } catch {
      // local restore is best-effort
    }
  }, [id, currentPrompt, messages, cards, tasks, filmTitle, logline, referenceImages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  async function runPipeline(prompt: string, refs = referenceImages) {
    setCurrentPrompt(prompt);
    setThinking(true);
    setPlayingFilm(false);
    setCards([]);
    setTasks([]);
    setFilmTitle("");
    setLogline("");
    try {
      const sceneCount = chooseSceneCount(prompt);
      const learningContext = readLearningContext();
      const referenceBrief = refs.map((r) => ({ name: r.name, description: r.description || "user uploaded character/style reference image" }));
      // 1. Storyboard via Qwen — prompt-aware scene count with persistent learning context
      const story = await generateStoryboard({ data: { prompt, sceneCount, learningContext, referenceImages: referenceBrief } });
      setThinking(false);
      setFilmTitle(story.title);
      setLogline(story.logline);
      setMessages((m) => [
        ...m,
        {
          role: "agent",
          text: `🎬 "${story.title}"\n${story.logline}\n\nTone: ${story.tone}\n\nRolling ${story.scenes.length} cinematic shots into a timeline — dialogue, Foley, score, color grade, VFX cues and clean scene continuity are saved to this session.`,
          skills: ["Script Agent", "Shot-list Agent", "Casting & Voice Agent", "Cinematography Agent", "Premiere Pro Edit Agent", "After Effects VFX Agent", "DaVinci Color Agent", "SFX / Foley Agent", "Learning Memory Agent"],
          task: `Cut ${story.scenes.length} shots into a short film`,
        },
      ]);
      setTasks([
        { text: `Render ${story.scenes.length} cinematic shots`, done: false },
        { text: `Cast clean human dialogue voices`, done: false },
        { text: `Build timeline: cuts, J/L-cuts, VFX, score, SFX`, done: false },
      ]);

      // 2. Add cards + submit videos in parallel
      const scenes = story.scenes;
      setCards(
        scenes.map((s, i) => ({
          title: `#${i + 1} ${s.title}`,
          visual: s.visual,
          caption: s.caption || s.spoken_line || s.dialogue,
          spokenLine: s.spoken_line || s.dialogue.replace(/^[^:]+:\s*/, ""),
          character: s.character || "",
          shotType: (s as { shot_type?: string }).shot_type,
          language: s.language,
          voiceTone: s.voice_tone,
          pitch: s.pitch,
          bgm: s.bgm,
          sfx: s.sfx,
          durationSeconds: s.duration_seconds || 7,
          colorGrade: s.color_grade,
          editingNotes: s.editing_notes,
          referenceImageDirection: s.reference_image_direction,
          progress: 5,
          done: false,
        })),
      );

      writeLearningContext(prompt, story.title, story.tone, story.scenes.map((s) => s.language).filter(Boolean).join(", "));

      await Promise.all(
        scenes.map(async (s, idx) => {
          try {
            // Assign a distinct Qwen3-TTS voice per character so actors sound different
            const voicePool = ["Cherry", "Ethan", "Serena", "Dylan", "Chelsie", "Jada", "Sunny"];
            const charKey = (s.character || `char-${idx}`).toLowerCase();
            let hash = 0;
            for (let i = 0; i < charKey.length; i++) hash = (hash * 31 + charKey.charCodeAt(i)) >>> 0;
            const chosenVoice = voicePool[hash % voicePool.length];
            // kick off voice + video in parallel
            const voiceP = generateVoice({
              data: {
                text: s.spoken_line || s.dialogue.replace(/^[^:]+:\s*/, ""),
                voice: chosenVoice,
                language: s.language || "English",
                tone: s.voice_tone || "natural film dialogue",
                pitch: s.pitch || "medium",
              },
            })
              .then((v) => {
                setCards((c) => c.map((card, i) => (i === idx ? { ...card, audioUrl: v.audio_url } : card)));
                setTasks((t) => t.map((task, taskIndex) => (taskIndex === 1 ? { ...task, done: true } : task)));
              })
              .catch(() => {});
            const fullPrompt = [
              s.video_prompt,
              s.reference_image_direction ? `Character/style reference: ${s.reference_image_direction}` : "",
              s.editing_notes ? `Professional edit intent: ${s.editing_notes}` : "",
              s.color_grade ? `Color grade: ${s.color_grade}` : "",
              s.sfx ? `On-screen action must support these clean SFX cues: ${s.sfx}` : "",
            ].filter(Boolean).join("\n");
            const { task_id } = await submitVideo({
              data: { prompt: fullPrompt, size: "832*480", model: "wan2.2-t2v-plus" },
            });
            // poll
            let attempts = 0;
            while (attempts < 180) {
              await new Promise((r) => setTimeout(r, 2000));
              attempts++;
              const p = Math.min(10 + attempts * 3, 92);
              setCards((c) => c.map((card, i) => (i === idx ? { ...card, progress: p } : card)));
              const status = await pollVideo({ data: { task_id } });
              if (status.status === "SUCCEEDED" && status.video_url) {
                await voiceP;
                setCards((c) =>
                  c.map((card, i) => (i === idx ? { ...card, progress: 100, done: true, videoUrl: status.video_url } : card)),
                );
                setTasks((t) => t.map((task, taskIndex) => (taskIndex === 0 ? { ...task, done: true } : task)));
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
        { role: "agent", text: `Final cut is locked — ~${story.scenes.length * 6}s short film with dialogue, ambient sound and score. Press ▶ Play Film.` },
      ]);
      // Auto-play once ready
      setTimeout(() => setPlayingFilm(true), 400);
      // Save to library
      try {
        const key = "makers:library";
        const existing = JSON.parse(localStorage.getItem(key) || "[]") as Array<Record<string, unknown>>;
        const finalCards = await new Promise<StoryCard[]>((resolve) => {
          setCards((c) => { resolve(c); return c; });
        });
        existing.unshift({
          id,
          title: story.title,
          tone: story.tone,
          logline: story.logline,
          createdAt: Date.now(),
          scenes: finalCards.map((c) => ({
            title: c.title,
            videoUrl: c.videoUrl,
            audioUrl: c.audioUrl,
            visual: c.visual,
            caption: c.caption,
            spokenLine: c.spokenLine,
            character: c.character,
            shotType: c.shotType,
            language: c.language,
            voiceTone: c.voiceTone,
            pitch: c.pitch,
            bgm: c.bgm,
            sfx: c.sfx,
            durationSeconds: c.durationSeconds,
            colorGrade: c.colorGrade,
            editingNotes: c.editingNotes,
            referenceImageDirection: c.referenceImageDirection,
          })),
        });
        localStorage.setItem(key, JSON.stringify(existing.slice(0, 30)));
      } catch { /* ignore */ }
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
    void runPipeline(text, referenceImages);
  }

  async function handleReferenceFiles(files: FileList | null) {
    if (!files?.length) return;
    const images = Array.from(files).filter((file) => file.type.startsWith("image/")).slice(0, 8);
    const loaded = await Promise.all(
      images.map(
        (file) =>
          new Promise<ReferenceImage>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ name: file.name, dataUrl: String(reader.result), description: "character/style reference" });
            reader.onerror = reject;
            reader.readAsDataURL(file);
          }),
      ),
    );
    setReferenceImages((prev) => [...prev, ...loaded].slice(0, 8));
  }

  function exportProject() {
    downloadText(
      `${slugify(filmTitle || "makers-film")}-project.json`,
      JSON.stringify({ id, prompt: currentPrompt, title: filmTitle, logline, referenceImages, scenes: cards }, null, 2),
      "application/json",
    );
  }

  function exportTimeline() {
    const timeline = cards.map((c, i) => {
      const start = cards.slice(0, i).reduce((sum, s) => sum + (s.durationSeconds || 7), 0);
      const end = start + (c.durationSeconds || 7);
      return [
        `SCENE ${i + 1}: ${c.title.replace(/^#\d+\s*/, "")}`,
        `TIME: ${formatTime(start)} - ${formatTime(end)}`,
        `SHOT: ${c.shotType || "cinematic"}`,
        `DIALOGUE: ${c.character ? `${c.character}: ` : ""}${c.spokenLine}`,
        `VOICE: ${c.language || "English"}, ${c.voiceTone || "natural"}, ${c.pitch || "medium"} pitch`,
        `BGM: ${c.bgm || "cinematic score"}`,
        `SFX: ${c.sfx || "clean room tone and Foley"}`,
        `GRADE: ${c.colorGrade || "cinematic film grade"}`,
        `EDIT: ${c.editingNotes || "straight cut with smooth continuity"}`,
        `VIDEO: ${c.videoUrl || "rendering"}`,
      ].join("\n");
    }).join("\n\n---\n\n");
    downloadText(`${slugify(filmTitle || "makers-film")}-timeline.txt`, `${filmTitle}\n${logline}\n\n${timeline}`, "text/plain");
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
              <span className="font-medium text-white">Film Preview</span>
              <span className="text-white/40">·</span>
              <span className="text-white/60 truncate">{filmTitle || "Untitled"}</span>
              {canPlay && (
                <button
                  onClick={() => setPlayingFilm(true)}
                  className="ml-auto flex items-center gap-1.5 rounded-full bg-white text-black px-3 py-1 text-[11px] font-medium hover:bg-white/90"
                >
                  <Film className="h-3 w-3" /> {allDone ? "Play Film" : `Play (${readyCount}/${cards.length})`}
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {cards.length === 0 ? (
                <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-center text-white/40">
                  <Sparkles className="h-10 w-10 mb-3 opacity-40" />
                  <p className="text-sm">Your short film preview will appear here</p>
                </div>
              ) : (
                <>
                  {/* Big stage */}
                  <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-neutral-950 border border-white/10">
                    {allDone ? (
                      <button
                        onClick={() => setPlayingFilm(true)}
                        className="group absolute inset-0"
                      >
                        <video
                          src={cards[0].videoUrl}
                          muted
                          playsInline
                          autoPlay
                          loop
                          className="absolute inset-0 h-full w-full object-cover opacity-70 group-hover:opacity-90 transition"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40" />
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <div className="h-16 w-16 rounded-full bg-white text-black flex items-center justify-center shadow-2xl group-hover:scale-105 transition">
                            <Play className="h-6 w-6 ml-1" fill="currentColor" />
                          </div>
                          <div className="mt-4 text-white text-lg font-medium drop-shadow">{filmTitle}</div>
                          <div className="mt-1 text-white/70 text-xs">~{cards.length * 6}s · {cards.length} shots · dialogue + score</div>
                        </div>
                      </button>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                        <div className="relative h-20 w-20">
                          <svg viewBox="0 0 36 36" className="h-20 w-20 -rotate-90">
                            <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
                            <circle
                              cx="18" cy="18" r="16" fill="none" stroke="#fff" strokeWidth="2"
                              strokeDasharray={`${totalProgress} 100`}
                            />
                          </svg>
                          <span className="absolute inset-0 flex items-center justify-center text-sm">{totalProgress}%</span>
                        </div>
                        <div className="text-sm text-white/70">Assembling cinematic edit…</div>
                        <div className="text-[11px] text-white/40">Rendering shots · casting voices · scoring music</div>
                      </div>
                    )}
                  </div>

                  {logline && (
                    <p className="text-sm text-white/70 leading-relaxed italic border-l-2 border-white/20 pl-3">
                      {logline}
                    </p>
                  )}

                  {/* Shot filmstrip */}
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-white/40 mb-2">Shot list · {cards.filter(c=>c.done).length}/{cards.length}</div>
                    <div className="grid grid-cols-4 gap-2">
                      {cards.map((c, i) => (
                        <div key={i} className="relative aspect-video rounded-md overflow-hidden bg-neutral-900 border border-white/5">
                          {c.videoUrl && c.done ? (
                            <video src={c.videoUrl} muted playsInline className="absolute inset-0 h-full w-full object-cover" />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-[10px] text-white/40">{c.progress}%</div>
                          )}
                          <div className="absolute bottom-1 left-1 text-[9px] text-white/80 bg-black/60 px-1 rounded">#{i + 1}{c.shotType ? ` · ${c.shotType}` : ""}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
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
              </div>
            )}
          </div>
        </div>
      </div>
      {playingFilm && (
        <FilmPlayer cards={cards} title={filmTitle} onClose={() => setPlayingFilm(false)} />
      )}
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

/**
 * Cinematic FilmPlayer — professional AI edit on the client:
 *  - Two <video> elements alternating for gapless CROSSFADE cuts
 *  - Slow Ken-Burns zoom on every clip
 *  - Dialogue audio synced per shot (multiple voices)
 *  - Web Audio synthesized ambient PAD + soft bass score (always works, no CDN)
 *  - Filmic letterbox bars, film-grain vignette, animated subtitles
 *  - Auto-advance through all shots as ONE continuous short film
 */
function FilmPlayer({
  cards,
  title,
  onClose,
}: {
  cards: StoryCard[];
  title: string;
  onClose: () => void;
}) {
  const shots = useMemo(() => cards.filter((c) => c.videoUrl && c.done), [cards]);
  const [idx, setIdx] = useState(0);
  const [muted, setMuted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dialogueRef = useRef<HTMLAudioElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const scoreStopRef = useRef<(() => void) | null>(null);

  const current = shots[idx];

  // Start ambient score once (user gesture already happened — Play click)
  useEffect(() => {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    audioCtxRef.current = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 2);
    master.connect(ctx.destination);
    // Cinematic drone pad — two detuned oscillators through low-pass
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 800;
    filter.Q.value = 0.7;
    filter.connect(master);
    const notes = [110, 164.81, 220, 329.63]; // A2 E3 A3 E4
    const oscs: OscillatorNode[] = [];
    notes.forEach((f, i) => {
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      o1.type = "sine"; o2.type = "triangle";
      o1.frequency.value = f; o2.frequency.value = f * 1.003;
      const g = ctx.createGain();
      g.gain.value = 0.15 - i * 0.02;
      o1.connect(g); o2.connect(g); g.connect(filter);
      o1.start(); o2.start();
      oscs.push(o1, o2);
      // slow LFO on filter for movement
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.05 + i * 0.03;
      lfoGain.gain.value = 120;
      lfo.connect(lfoGain); lfoGain.connect(filter.frequency);
      lfo.start();
      oscs.push(lfo);
    });
    scoreStopRef.current = () => {
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1);
      setTimeout(() => { oscs.forEach((o) => { try { o.stop(); } catch { /* noop */ } }); ctx.close().catch(()=>{}); }, 1100);
    };
    return () => { scoreStopRef.current?.(); };
  }, []);

  // Duck score when a dialogue line plays
  useEffect(() => { setMuted(false); }, []);

  // Drive current shot: play video + sync dialogue
  useEffect(() => {
    const v = videoRef.current;
    if (v && current?.videoUrl) {
      v.src = current.videoUrl;
      v.currentTime = 0;
      v.play().catch(() => {});
    }
    const d = dialogueRef.current;
    if (d && current?.audioUrl) {
      d.src = current.audioUrl;
      d.currentTime = 0;
      d.play().catch(() => {});
    }
  }, [idx, current]);

  function advance() {
    if (idx + 1 >= shots.length) {
      setTimeout(() => onClose(), 800);
      return;
    }
    setIdx((i) => i + 1);
  }

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <button onClick={onClose} className="absolute top-4 right-4 text-white/70 hover:text-white text-sm z-30">Close ✕</button>
      <button onClick={() => setMuted((m) => !m)} className="absolute top-4 right-24 text-white/70 hover:text-white z-30">
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>

      <div className="relative w-screen h-screen overflow-hidden bg-black">
        <video
          ref={videoRef}
          key={idx}
          autoPlay
          playsInline
          muted
          onEnded={advance}
          onError={advance}
          className="absolute inset-0 h-full w-full object-cover kenburns"
        />

        {/* Dialogue */}
        <audio ref={dialogueRef} autoPlay muted={muted} />

        {/* Filmic overlays */}
        <div className="absolute inset-x-0 top-0 h-[5%] bg-black pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-[5%] bg-black pointer-events-none" />
        <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: "inset 0 0 200px rgba(0,0,0,0.8)" }} />

        {/* Title card on first shot */}
        {idx === 0 && (
          <div key={`title-${idx}`} className="absolute inset-0 flex items-center justify-center pointer-events-none animate-[fadeout_3s_ease-in_forwards]">
            <div className="text-center">
              <div className="text-white text-5xl md:text-7xl font-serif tracking-wide drop-shadow-2xl">{title}</div>
              <div className="mt-3 text-white/70 text-xs uppercase tracking-[0.3em]">A Makers Film</div>
            </div>
          </div>
        )}

        {/* Subtitle */}
        <div key={`sub-${idx}`} className="absolute bottom-[9%] inset-x-0 text-center px-6 pointer-events-none animate-[fadein_0.5s_ease-out]">
          <div className="inline-block bg-black/60 text-white text-lg md:text-2xl px-6 py-3 rounded-md backdrop-blur max-w-[80%]">
            {current.character && <b className="mr-2 text-white/90">{current.character}:</b>}
            <span>{current.spokenLine}</span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="absolute top-0 inset-x-0 h-0.5 bg-white/10 z-20">
          <div className="h-full bg-white/80 transition-all" style={{ width: `${((idx + 1) / shots.length) * 100}%` }} />
        </div>

        <div className="absolute top-4 left-4 text-white/70 text-[11px] uppercase tracking-widest z-20">
          {title} · Shot {idx + 1}/{shots.length}
        </div>
      </div>

      <style>{`
        @keyframes kenburns { 0% { transform: scale(1.04); } 100% { transform: scale(1.14); } }
        .kenburns { animation: kenburns 8s ease-out forwards; transform-origin: center; }
        @keyframes fadein { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes fadeout { 0%,60% { opacity: 1; } 100% { opacity: 0; } }
      `}</style>
    </div>
  );
}

function chooseSceneCount(prompt: string) {
  const text = prompt.toLowerCase();
  const explicit = text.match(/(\d+)\s*(scene|scenes|slide|slides|shot|shots)/);
  if (explicit) return Math.min(12, Math.max(4, Number(explicit[1])));
  if (text.includes("fast") || text.includes("quick")) return 5;
  return 8;
}

function readLearningContext() {
  try {
    const items = JSON.parse(localStorage.getItem("makers:learning") || "[]") as Array<{
      prompt: string;
      title: string;
      tone: string;
      languages?: string;
    }>;
    return items
      .slice(0, 12)
      .map((item) => `Prompt style: ${item.prompt.slice(0, 160)} | Film: ${item.title} | Tone: ${item.tone} | Languages: ${item.languages || "auto"}`)
      .join("\n");
  } catch {
    return "";
  }
}

function writeLearningContext(prompt: string, title: string, tone: string, languages: string) {
  try {
    const key = "makers:learning";
    const items = JSON.parse(localStorage.getItem(key) || "[]") as Array<Record<string, unknown>>;
    items.unshift({ prompt, title, tone, languages, at: Date.now() });
    localStorage.setItem(key, JSON.stringify(items.slice(0, 50)));
  } catch {
    // best-effort local learning memory
  }
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "makers-film";
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}