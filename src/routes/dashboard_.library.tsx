import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Film, Trash2, Play, Download, Scissors, Volume2, VolumeX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sidebar, TopBar, MakersMark } from "./dashboard";

export const Route = createFileRoute("/dashboard_/library")({
  ssr: false,
  component: LibraryPage,
});

type Scene = {
  title: string;
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
};
type FilmDoc = {
  id: string;
  title: string;
  tone?: string;
  logline?: string;
  createdAt: number;
  scenes: Scene[];
};

function LibraryPage() {
  const navigate = useNavigate();
  const [films, setFilms] = useState<FilmDoc[]>([]);
  const [playing, setPlaying] = useState<{ film: FilmDoc; idx: number } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) navigate({ to: "/auth", search: { mode: "login" } });
    });
    try {
      setFilms(JSON.parse(localStorage.getItem("makers:library") || "[]"));
    } catch { setFilms([]); }
  }, [navigate]);

  function remove(id: string) {
    const next = films.filter((f) => f.id !== id);
    setFilms(next);
    localStorage.setItem("makers:library", JSON.stringify(next));
  }

  function exportFilm(film: FilmDoc) {
    downloadText(`${slugify(film.title)}-project.json`, JSON.stringify(film, null, 2), "application/json");
  }

  function exportTimeline(film: FilmDoc) {
    const timeline = film.scenes.map((scene, index) => {
      const start = film.scenes.slice(0, index).reduce((sum, s) => sum + (s.durationSeconds || 7), 0);
      const end = start + (scene.durationSeconds || 7);
      return [
        `SCENE ${index + 1}: ${scene.title.replace(/^#\d+\s*/, "")}`,
        `TIME: ${formatTime(start)} - ${formatTime(end)}`,
        `SHOT: ${scene.shotType || "cinematic"}`,
        `DIALOGUE: ${scene.character ? `${scene.character}: ` : ""}${scene.spokenLine}`,
        `VOICE: ${scene.language || "English"}, ${scene.voiceTone || "natural"}, ${scene.pitch || "medium"} pitch`,
        `BGM: ${scene.bgm || "cinematic score"}`,
        `SFX: ${scene.sfx || "clean room tone and Foley"}`,
        `GRADE: ${scene.colorGrade || "cinematic film grade"}`,
        `EDIT: ${scene.editingNotes || "straight cut with smooth continuity"}`,
        `VIDEO: ${scene.videoUrl || "not rendered"}`,
      ].join("\n");
    }).join("\n\n---\n\n");
    downloadText(`${slugify(film.title)}-timeline.txt`, `${film.title}\n${film.logline || ""}\n\n${timeline}`, "text/plain");
  }

  return (
    <div className="min-h-screen flex bg-black text-foreground">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <TopBar />
        <div className="flex-1 overflow-y-auto px-8 py-8">
          <h1 className="text-2xl font-semibold mb-6 flex items-center gap-2">
            <Film className="h-5 w-5" /> Library
          </h1>
          {films.length === 0 ? (
            <div className="text-white/50 text-sm border border-white/10 rounded-xl p-10 text-center">
              No films yet. <Link to="/dashboard" className="text-blue-400 hover:underline">Create one →</Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {films.map((f) => {
                const cover = f.scenes.find((s) => s.videoUrl)?.videoUrl;
                return (
                  <div key={f.id} className="group rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
                    <button
                      onClick={() => setPlaying({ film: f, idx: 0 })}
                      className="relative aspect-video w-full bg-black block"
                    >
                      {cover ? (
                        <video src={cover} muted playsInline preload="none" className="absolute inset-0 h-full w-full object-cover" />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-white/30"><Film className="h-8 w-8" /></div>
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <Play className="h-10 w-10 text-white" />
                      </div>
                    </button>
                    <div className="p-3">
                      <div className="text-sm font-medium truncate">{f.title}</div>
                      <div className="text-[11px] text-white/50 flex items-center justify-between mt-1">
                        <span>{new Date(f.createdAt).toLocaleDateString()}</span>
                        <span className="flex items-center gap-2">
                          <button onClick={() => exportTimeline(f)} className="hover:text-white" title="Export timeline"><Scissors className="h-3.5 w-3.5" /></button>
                          <button onClick={() => exportFilm(f)} className="hover:text-white" title="Export project"><Download className="h-3.5 w-3.5" /></button>
                          <button onClick={() => remove(f.id)} className="hover:text-red-400" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {playing && (
        <LibraryFilmPlayer
          film={playing.film}
          index={playing.idx}
          onNext={() => {
            if (playing.idx + 1 < playing.film.scenes.length)
              setPlaying({ film: playing.film, idx: playing.idx + 1 });
            else setPlaying(null);
          }}
          onClose={() => setPlaying(null)}
        />
      )}
    </div>
  );
}

function LibraryFilmPlayer({
  film, index, onNext, onClose,
}: { film: FilmDoc; index: number; onNext: () => void; onClose: () => void }) {
  const scene = film.scenes[index];
  const [muted, setMuted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fallbackRef = useRef<number | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video && scene?.videoUrl) {
      video.src = scene.videoUrl;
      video.currentTime = 0;
      video.load();
      video.play().catch(() => {});
    }
    if (fallbackRef.current) window.clearTimeout(fallbackRef.current);
    fallbackRef.current = window.setTimeout(onNext, Math.max(5, scene?.durationSeconds || 7) * 1000 + 1200);
    return () => {
      if (fallbackRef.current) window.clearTimeout(fallbackRef.current);
    };
  }, [scene?.videoUrl, scene?.durationSeconds, onNext]);

  if (!scene) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black">
      <button onClick={onClose} className="absolute top-4 right-4 text-white/60 hover:text-white text-sm z-10">Close ✕</button>
      <button onClick={() => setMuted((m) => !m)} className="absolute top-4 right-24 text-white/70 hover:text-white z-10">
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
      <div className="relative h-screen w-screen overflow-hidden bg-black">
        <video ref={videoRef} autoPlay playsInline muted preload="metadata" onEnded={onNext} onError={onNext} className="absolute inset-0 h-full w-full object-cover" />
        {scene.audioUrl && <audio key={scene.audioUrl} src={scene.audioUrl} autoPlay muted={muted} />}
        <div className="absolute inset-x-0 top-0 h-[5%] bg-black pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-[5%] bg-black pointer-events-none" />
        <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: "inset 0 0 200px rgba(0,0,0,0.75)" }} />
        <div className="absolute bottom-[20%] inset-x-0 text-center px-6">
          <div className="inline-block bg-black/70 text-white text-lg px-5 py-2 rounded-lg backdrop-blur max-w-[80%]">
            {scene.character && <b className="mr-2">{scene.character}:</b>}
            {scene.spokenLine}
          </div>
        </div>
        <div className="absolute top-4 left-4 text-white/70 text-xs">
          {film.title} · Scene {index + 1}/{film.scenes.length}
        </div>
        <div className="absolute top-10 left-4 max-w-[70vw] text-white text-sm md:text-lg font-medium drop-shadow">
          {scene.title.replace(/^#\d+\s*/, "")}
        </div>
        <div className="absolute bottom-2 inset-x-4">
          <LibraryTimeline scenes={film.scenes} activeIndex={index} />
        </div>
      </div>
    </div>
  );
}

function LibraryTimeline({ scenes, activeIndex }: { scenes: Scene[]; activeIndex: number }) {
  const total = scenes.reduce((sum, scene) => sum + (scene.durationSeconds || 7), 0) || scenes.length * 7 || 1;
  let cursor = 0;
  return (
    <div className="rounded-xl border border-white/10 bg-black/60 p-3 backdrop-blur">
      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-white/40">
        <span>Video timeline</span>
        <span>{formatTime(total)} · {scenes.length} scenes</span>
      </div>
      <div className="flex h-12 overflow-hidden rounded-md border border-white/10 bg-black">
        {scenes.map((scene, index) => {
          const start = cursor;
          const duration = scene.durationSeconds || 7;
          cursor += duration;
          return (
            <div
              key={index}
              className={`relative border-r border-black/70 ${index === activeIndex ? "bg-white/25" : scene.videoUrl ? "bg-white/12" : "bg-white/5"}`}
              style={{ width: `${Math.max(8, (duration / total) * 100)}%` }}
              title={`${scene.title} · ${formatTime(start)}-${formatTime(start + duration)}`}
            >
              <div className={`absolute inset-x-1 top-1 h-2 rounded-sm ${scene.videoUrl ? "bg-emerald-400" : "bg-white/20"}`} />
              <div className="absolute bottom-1 left-1 right-1 truncate text-[10px] text-white/70">#{index + 1} {scene.shotType || "shot"}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
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
