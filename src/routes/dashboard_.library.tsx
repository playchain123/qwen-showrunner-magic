import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Film, RefreshCw, Trash2, Play, Download, Scissors, Volume2, VolumeX, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sidebar, TopBar } from "./dashboard";
import { WebsiteBeatPreview } from "@/components/website-beat-preview";
import { readLibraryProjects, writeSceneReview, type LibraryProject, type LibraryProjectType, type LibraryScene } from "@/lib/library";
import type { CompiledMotionSpec } from "@/lib/website-render-pipeline";
import { concatClips } from "@/lib/ffmpeg-post";
import { buildScoreBrief, pickBgm } from "@/lib/free-sounds";

export const Route = createFileRoute("/dashboard_/library")({
  ssr: false,
  component: LibraryPage,
});

type LibraryFilter = "all" | LibraryProjectType;

function LibraryPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<LibraryProject[]>([]);
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [playing, setPlaying] = useState<{ project: LibraryProject; idx: number } | null>(null);
  const [downloadingProjectId, setDownloadingProjectId] = useState<string | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      all: projects.length,
      short_film: projects.filter((project) => project.type === "short_film").length,
      ad_video: projects.filter((project) => project.type === "ad_video").length,
      website_video: projects.filter((project) => project.type === "website_video").length,
    }),
    [projects],
  );
  const filteredProjects = useMemo(
    () => projects.filter((project) => filter === "all" || project.type === filter),
    [projects, filter],
  );

  useEffect(() => {
    if (!supabase) {
      navigate({ to: "/auth", search: { mode: "login" } });
    } else {
      supabase.auth.getUser().then(({ data }) => {
        if (!data.user) navigate({ to: "/auth", search: { mode: "login" } });
      });
    }
    try {
      setProjects(readLibraryProjects());
    } catch {
      setProjects([]);
    }
  }, [navigate]);

  function remove(id: string) {
    const next = projects.filter((project) => project.id !== id);
    setProjects(next);
    localStorage.setItem("makers:library", JSON.stringify(next));
  }

  function exportProject(project: LibraryProject) {
    downloadText(`${slugify(project.title)}-project.json`, JSON.stringify(project, null, 2), "application/json");
  }

  function exportTimeline(project: LibraryProject) {
    const scenes = getProjectScenes(project);
    const timeline = scenes.map((scene, index) => {
      const start = scenes.slice(0, index).reduce((sum, s) => sum + (s.durationSeconds || 7), 0);
      const end = start + (scene.durationSeconds || 7);
      return [
        `SCENE ${index + 1}: ${scene.title.replace(/^#\d+\s*/, "")}`,
        `TIME: ${formatTime(start)} - ${formatTime(end)}`,
        `TYPE: ${project.type === "ad_video" ? "Cinematic Ad" : project.type === "website_video" ? "Website Video" : "AI Short Film"}`,
        `SHOT: ${scene.shotType || "cinematic"}`,
        `DIALOGUE: ${scene.character ? `${scene.character}: ` : ""}${scene.spokenLine || scene.caption || ""}`,
        `VOICE: ${scene.language || "English"}, ${scene.voiceTone || "natural"}, ${scene.pitch || "medium"} pitch`,
        `BGM: ${scene.bgm || "cinematic score"}`,
        `SFX: ${scene.sfx || "clean room tone and Foley"}`,
        `GRADE: ${scene.colorGrade || "cinematic film grade"}`,
        `EDIT: ${scene.editingNotes || "straight cut with smooth continuity"}`,
        `VIDEO: ${scene.videoUrl || "not rendered"}`,
      ].join("\n");
    }).join("\n\n---\n\n");
    downloadText(
      `${slugify(project.title)}-timeline.txt`,
      `${project.title}\n${project.logline || project.productPitch || ""}\n\n${timeline}`,
      "text/plain",
    );
  }

  async function downloadProjectVideo(project: LibraryProject) {
    setDownloadingProjectId(project.id);
    setDownloadNotice(null);
    try {
      if (project.finalVideoUrl) {
        downloadUrl(project.finalVideoUrl, `${slugify(project.title)}.mp4`);
        setDownloadNotice(`Downloading ${project.title} master MP4.`);
        return;
      }
      const scenes = getProjectScenes(project);
      const clipUrls = (project.sceneVideos?.length ? project.sceneVideos : scenes.map((scene) => scene.videoUrl || scene.clipUrl))
        .filter((url): url is string => Boolean(url));
      if (clipUrls.length === 0) {
        setDownloadNotice("No rendered MP4 clips are available for this project yet.");
        return;
      }
      if (clipUrls.length === 1) {
        downloadUrl(clipUrls[0], `${slugify(project.title)}.mp4`);
        setDownloadNotice(`Downloading ${project.title} source MP4.`);
        return;
      }
      setDownloadNotice(`Building ${project.title} MP4 from ${clipUrls.length} clips. This can take a minute.`);
      const stitchedUrl = await concatClips(clipUrls);
      downloadUrl(stitchedUrl, `${slugify(project.title)}.mp4`);
      window.setTimeout(() => URL.revokeObjectURL(stitchedUrl), 10_000);
      setDownloadNotice(`Downloading ${project.title} stitched MP4.`);
    } catch (err) {
      setDownloadNotice(err instanceof Error ? err.message : "Could not export MP4 for this project.");
    } finally {
      setDownloadingProjectId(null);
    }
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

          <div className="mb-6 flex flex-wrap items-center gap-2">
            {[
              { id: "all" as const, label: "All", count: counts.all },
              { id: "short_film" as const, label: "Short Films", count: counts.short_film },
              { id: "ad_video" as const, label: "Ads", count: counts.ad_video },
              { id: "website_video" as const, label: "Website", count: counts.website_video },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setFilter(item.id)}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${
                  filter === item.id
                    ? "border-white bg-white text-black"
                    : "border-white/10 bg-white/[0.03] text-white/65 hover:bg-white/10 hover:text-white"
                }`}
              >
                {item.label} <span className={filter === item.id ? "text-black/60" : "text-white/40"}>{item.count}</span>
              </button>
            ))}
          </div>
          {downloadNotice && (
            <div className="mb-5 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs text-white/65">
              {downloadNotice}
            </div>
          )}

          {projects.length === 0 ? (
            <div className="text-white/50 text-sm border border-white/10 rounded-xl p-10 text-center">
              No projects yet. <Link to="/dashboard" className="text-blue-400 hover:underline">Create one</Link>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="text-white/50 text-sm border border-white/10 rounded-xl p-10 text-center">
              No {filter === "ad_video" ? "ads" : filter === "website_video" ? "website videos" : "short films"} saved yet.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredProjects.map((project) => {
                const scenes = getProjectScenes(project);
                const coverVideo = project.finalVideoUrl || scenes.find((scene) => scene.videoUrl)?.videoUrl;
                const coverPoster = project.posterUrl || scenes.find((scene) => scene.posterUrl)?.posterUrl;
                const duration = project.durationSeconds || scenes.reduce((sum, scene) => sum + (scene.durationSeconds || 7), 0);
                const meta = project.type === "ad_video"
                  ? project.brandName || project.adTone || "Cinematic Ad"
                  : project.type === "website_video"
                  ? project.websiteUrl || project.videoType || "Website Video"
                  : project.tone || project.genre || "AI Short Film";

                return (
                  <div key={`${project.type}-${project.id}`} className="group rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
                    <button
                      onClick={() => scenes.length ? setPlaying({ project, idx: 0 }) : undefined}
                      className="relative aspect-video w-full bg-black block"
                    >
                      {coverPoster ? (
                        <img src={coverPoster} alt="" className="absolute inset-0 h-full w-full object-cover" />
                      ) : coverVideo ? (
                        <video src={coverVideo} muted playsInline preload="none" className="absolute inset-0 h-full w-full object-cover" />
                      ) : project.type === "website_video" && scenes[0]?.motionSpec ? (
                        <WebsiteBeatPreview {...buildWebsiteScenePreviewProps(project, scenes[0], 0, 0.2)} />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-white/30">
                          <Film className="h-8 w-8" />
                        </div>
                      )}
                      <span className={`absolute left-2 top-2 rounded-full px-2 py-1 text-[10px] font-medium ${
                        project.type === "ad_video" ? "bg-red-500/80 text-white" : project.type === "website_video" ? "bg-emerald-500/80 text-white" : "bg-blue-500/80 text-white"
                      }`}>
                        {project.type === "ad_video" ? "Ad" : project.type === "website_video" ? "Website" : "Short Film"}
                      </span>
                      {project.type === "website_video" && scenes[0]?.assetSource === "fallback" && (
                        <span className="absolute right-2 top-2 rounded-full bg-amber-400/90 px-2 py-1 text-[10px] font-medium text-black">
                          Fallback
                        </span>
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <Play className="h-10 w-10 text-white" />
                      </div>
                    </button>
                    <div className="p-3">
                      <div className="text-sm font-medium truncate">{project.title}</div>
                      <div className="mt-1 truncate text-[11px] text-white/45">{meta}</div>
                      <div className="text-[11px] text-white/50 flex items-center justify-between mt-1">
                        <span>{new Date(project.createdAt).toLocaleDateString()} - {formatTime(duration)}</span>
                        <span className="flex items-center gap-2">
                          <button onClick={() => exportTimeline(project)} className="hover:text-white" title="Export timeline">
                            <Scissors className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => void downloadProjectVideo(project)}
                            disabled={downloadingProjectId === project.id}
                            className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-[10px] hover:border-white/30 hover:text-white disabled:opacity-50"
                            title={downloadingProjectId === project.id ? "Preparing MP4" : "Download MP4 video"}
                          >
                            <Download className="h-3 w-3" /> {downloadingProjectId === project.id ? "Prep" : "MP4"}
                          </button>
                          <button onClick={() => exportProject(project)} className="hover:text-white" title="Export project">
                            <span className="text-[11px] leading-none">JSON</span>
                          </button>
                          <button onClick={() => remove(project.id)} className="hover:text-red-400" title="Delete">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
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
        <LibraryProjectPlayer
          project={playing.project}
          index={playing.idx}
          onNext={() => {
            const scenes = getProjectScenes(playing.project);
            if (playing.idx + 1 < scenes.length) {
              setPlaying({ project: playing.project, idx: playing.idx + 1 });
            } else {
              setPlaying(null);
            }
          }}
          onClose={() => setPlaying(null)}
        />
      )}
    </div>
  );
}

function LibraryProjectPlayer({
  project,
  index,
  onNext,
  onClose,
}: {
  project: LibraryProject;
  index: number;
  onNext: () => void;
  onClose: () => void;
}) {
  const scenes = getProjectScenes(project);
  const scene = scenes[index];
  const [muted, setMuted] = useState(false);
  const [reviewed, setReviewed] = useState<string>("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const bgmRef = useRef<HTMLAudioElement>(null);
  const fallbackRef = useRef<number | null>(null);
  const isWebsiteScene = project.type === "website_video";
  const bgmUrl = project.scoreMusicUrl || scene?.bgmUrl || pickBgm(buildScoreBrief([
    project.title,
    project.tone,
    project.adTone,
    project.productPitch,
    scene?.bgm,
    scene?.visual,
  ]));

  useEffect(() => {
    const clip = scene?.videoUrl || scene?.clipUrl;
    const video = videoRef.current;
    const audio = audioRef.current;

    if (video && clip && !isWebsiteScene) {
      video.src = clip;
      video.currentTime = 0;
      video.muted = muted;
      video.load();
      void video.play().catch(() => undefined);
    }

    if (audio && scene?.audioUrl) {
      audio.src = scene.audioUrl;
      audio.currentTime = 0;
      audio.muted = muted;
      void audio.play().catch(() => undefined);
    }

    if (bgmRef.current && bgmUrl) {
      bgmRef.current.src = bgmUrl;
      bgmRef.current.currentTime = 0;
      bgmRef.current.volume = 0.22;
      bgmRef.current.muted = muted;
      void bgmRef.current.play().catch(() => undefined);
    }

    if (fallbackRef.current) window.clearTimeout(fallbackRef.current);
    fallbackRef.current = window.setTimeout(onNext, Math.max(5, scene?.durationSeconds || 7) * 1000 + 1200);
    return () => {
      if (fallbackRef.current) window.clearTimeout(fallbackRef.current);
    };
  }, [scene?.videoUrl, scene?.clipUrl, scene?.audioUrl, scene?.durationSeconds, bgmUrl, onNext, muted, isWebsiteScene]);

  if (!scene) return null;

  function review(action: "accepted" | "regenerated" | "manually_edited" | "rejected") {
    writeSceneReview({
      projectId: project.id,
      sceneTitle: scene.title,
      action,
      edits: action === "manually_edited" ? { note: "User requested edited regeneration from library review." } : undefined,
    });
    setReviewed(action);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <button onClick={onClose} className="absolute top-4 right-4 text-white/60 hover:text-white text-sm z-10">Close</button>
      <button onClick={() => setMuted((m) => !m)} className="absolute top-4 right-24 text-white/70 hover:text-white z-10">
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
        <button onClick={() => review("accepted")} className="flex items-center gap-1 rounded-full bg-emerald-500/90 px-3 py-1 text-[11px] text-white hover:bg-emerald-500">
          <Check className="h-3 w-3" /> Accept
        </button>
        <button onClick={() => review("manually_edited")} className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-[11px] text-white/80 hover:bg-white/20">
          <RefreshCw className="h-3 w-3" /> Edit signal
        </button>
        <button onClick={() => review("rejected")} className="flex items-center gap-1 rounded-full bg-red-500/80 px-3 py-1 text-[11px] text-white hover:bg-red-500">
          <X className="h-3 w-3" /> Reject
        </button>
        {reviewed && <span className="rounded-full bg-black/60 px-2 py-1 text-[10px] text-white/60">Logged {reviewed}</span>}
      </div>
      <div className="relative h-screen w-screen overflow-hidden bg-black">
        {isWebsiteScene ? (
          <WebsiteBeatPreview
            {...buildWebsiteScenePreviewProps(project, scene, index, 0.35)}
            audioUrl={scene.audioUrl}
            assetSource={scene.assetSource}
            autoPlayVideo
            muted={muted}
            onEnded={onNext}
          />
        ) : (
          <>
            {scene.posterUrl && <img src={scene.posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" />}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted={muted}
              preload="metadata"
              poster={scene.posterUrl}
              onEnded={onNext}
              onError={onNext}
              className="absolute inset-0 h-full w-full object-cover"
            />
          </>
        )}
        {!isWebsiteScene && scene.audioUrl && <audio ref={audioRef} src={scene.audioUrl} preload="auto" muted={muted} />}
        {bgmUrl && <audio ref={bgmRef} src={bgmUrl} preload="auto" loop muted={muted} />}
        {project.type === "website_video" && scene.assetSource === "fallback" && (
          <div className="absolute top-32 left-4 z-10 rounded-full border border-amber-300/30 bg-amber-400/15 px-3 py-1 text-[11px] font-medium text-amber-200">
            Using fallback visual
          </div>
        )}
        <div className="absolute inset-x-0 top-0 h-[5%] bg-black pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-[5%] bg-black pointer-events-none" />
        <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: "inset 0 0 200px rgba(0,0,0,0.75)" }} />
        {(scene.spokenLine || scene.caption) && (
          <div className="absolute bottom-[20%] inset-x-0 text-center px-6">
            <div className="inline-block bg-black/70 text-white text-lg px-5 py-2 rounded-lg backdrop-blur max-w-[80%]">
              {scene.character && <b className="mr-2">{scene.character}:</b>}
              {scene.spokenLine || scene.caption}
            </div>
          </div>
        )}
        <div className="absolute top-14 left-4 text-white/70 text-xs">
          {project.type === "ad_video" ? "Ad" : project.type === "website_video" ? "Website" : "Short Film"} - Scene {index + 1}/{scenes.length}
        </div>
        <div className="absolute top-20 left-4 max-w-[70vw] text-white text-sm md:text-lg font-medium drop-shadow">
          {project.title}
        </div>
        <div className="absolute bottom-2 inset-x-4">
          <LibraryTimeline scenes={scenes} activeIndex={index} />
        </div>
      </div>
    </div>
  );
}

function LibraryTimeline({ scenes, activeIndex }: { scenes: LibraryScene[]; activeIndex: number }) {
  const total = scenes.reduce((sum, scene) => sum + (scene.durationSeconds || 7), 0) || scenes.length * 7 || 1;
  let cursor = 0;
  return (
    <div className="rounded-xl border border-white/10 bg-black/60 p-3 backdrop-blur">
      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-white/40">
        <span>Video timeline</span>
        <span>{formatTime(total)} - {scenes.length} scenes</span>
      </div>
      <div className="flex h-12 overflow-hidden rounded-md border border-white/10 bg-black">
        {scenes.map((scene, index) => {
          const start = cursor;
          const duration = scene.durationSeconds || 7;
          const hasVisual = Boolean(scene.videoUrl || scene.clipUrl || scene.motionSpec);
          cursor += duration;
          return (
            <div
              key={index}
              className={`relative border-r border-black/70 ${index === activeIndex ? "bg-white/25" : hasVisual ? "bg-white/12" : "bg-white/5"}`}
              style={{ width: `${Math.max(8, (duration / total) * 100)}%` }}
              title={`${scene.title} - ${formatTime(start)}-${formatTime(start + duration)}`}
            >
              <div className={`absolute inset-x-1 top-1 h-2 rounded-sm ${hasVisual ? "bg-emerald-400" : "bg-white/20"}`} />
              <div className="absolute bottom-1 left-1 right-1 truncate text-[10px] text-white/70">#{index + 1} {scene.shotType || "shot"}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function buildWebsiteScenePreviewProps(project: LibraryProject, scene: LibraryScene, index: number, progress: number) {
  const metadata = project.metadata || {};
  const brandKit = metadata.brandKit as
    | {
        brand?: {
          name?: string;
          primary_color_hex?: string;
          secondary_color_hex?: string;
          accent_color_hex?: string;
          neutral_color_hex?: string;
        };
        product?: { one_line_description?: string };
      }
    | undefined;
  const brandName = brandKit?.brand?.name || project.title.replace(/\s+-\s+.*$/, "") || "Website";
  return {
    brandName,
    title: project.title,
    description: brandKit?.product?.one_line_description || project.productPitch || project.websiteUrl,
    productionMethod: scene.shotType || "motion_graphic",
    beatPurpose: scene.title,
    voLine: scene.spokenLine || scene.caption,
    startSeconds: 0,
    durationSeconds: scene.durationSeconds || 7,
    progress,
    colors: {
      primary: brandKit?.brand?.primary_color_hex,
      secondary: brandKit?.brand?.secondary_color_hex,
      accent: brandKit?.brand?.accent_color_hex,
      neutral: brandKit?.brand?.neutral_color_hex,
    },
    assetStatus: scene.assetStatus || (scene.clipUrl || scene.videoUrl || scene.motionSpec ? "ready" as const : "pending" as const),
    assetSource: scene.assetSource,
    clipUrl: scene.clipUrl || scene.videoUrl,
    motionSpec: scene.motionSpec as CompiledMotionSpec | undefined,
    audioUrl: scene.audioUrl,
  };
}

function getProjectScenes(project: LibraryProject): LibraryScene[] {
  return project.scenes?.length ? project.scenes : project.timeline || [];
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

function downloadUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "makers-project";
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
