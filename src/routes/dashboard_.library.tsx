import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Film, Trash2, Play } from "lucide-react";
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
  caption: string;
  spokenLine: string;
  character: string;
};
type FilmDoc = {
  id: string;
  title: string;
  tone?: string;
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
                        <video src={cover} muted playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" />
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
                        <button onClick={() => remove(f.id)} className="hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
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
  if (!scene) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
      <button onClick={onClose} className="absolute top-4 right-4 text-white/60 hover:text-white text-sm z-10">Close ✕</button>
      <div className="relative w-full max-w-5xl aspect-video">
        <video key={scene.videoUrl} src={scene.videoUrl} autoPlay playsInline muted onEnded={onNext} className="absolute inset-0 h-full w-full object-contain bg-black" />
        {scene.audioUrl && <audio key={scene.audioUrl} src={scene.audioUrl} autoPlay />}
        <div className="absolute bottom-6 inset-x-0 text-center px-6">
          <div className="inline-block bg-black/70 text-white text-lg px-5 py-2 rounded-lg backdrop-blur max-w-[80%]">
            {scene.character && <b className="mr-2">{scene.character}:</b>}
            {scene.spokenLine}
          </div>
        </div>
        <div className="absolute top-4 left-4 text-white/70 text-xs">
          {film.title} · Scene {index + 1}/{film.scenes.length}
        </div>
      </div>
    </div>
  );
}