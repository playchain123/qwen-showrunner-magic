import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { ArrowUp, Upload, Film, Play, Download, Copy, Pencil } from "lucide-react";
import { Sidebar, TopBar, MakersMark } from "./dashboard";
import { supabase } from "@/integrations/supabase/client";
import { generateStoryboard, submitVideo, pollVideo, generateVoice, generateSceneImage } from "@/lib/qwen.functions";
import { buildScoreBrief, pickBgm, pickScoreProfile } from "@/lib/free-sounds";
import { saveLibraryProject } from "@/lib/library";
import { MODEL_STRATEGY, buildHackathonAgentTrace, HACKATHON_ARCHITECTURE_SUMMARY } from "@/lib/model-strategy";
import {
  buildAdVisualBible,
  buildOptimizedScenePrompt,
  compileBrandAssetReferences,
  formatOptimizedScenePrompt,
  formatProductContinuity,
  formatReferenceRouting,
  formatVisualBible,
  validateAndRepairScenes,
} from "@/lib/continuity";
import {
  MAKERS_DEMO_LIMITS,
  getVideoPollDelayMs,
  normalizeSceneDuration,
  runWithConcurrency,
} from "@/lib/makers-runtime";

export const Route = createFileRoute("/dashboard_/ads")({
  ssr: false,
  component: CinematicAds,
});

type BrandAsset = { kind: "product" | "logo" | "model"; name: string; dataUrl: string };
type AdShot = {
  title: string;
  visual: string;
  spokenLine: string;
  progress: number;
  done: boolean;
  videoUrl?: string;
  audioUrl?: string;
  localizedScript?: string;
  targetLanguage?: string;
  ttsProvider?: string;
  ttsSpeaker?: string;
  regionalCritique?: unknown;
  posterUrl?: string;
  durationSeconds: number;
  colorGrade?: string;
  bgm?: string;
  bgmUrl?: string;
};
type VideoModel = "happyhorse-1.1-t2v" | "wan2.2-t2v-plus" | "happyhorse-1.1-i2v" | "wan2.2-i2v-plus";
type VideoAttempt = { model: VideoModel; imageUrl?: string };

const TONES = [
  { id: "luxury", label: "Luxury", desc: "Slow, refined, muted palette, gold accents" },
  { id: "energetic", label: "Energetic", desc: "Fast cuts, bold colors, punchy score" },
  { id: "emotional", label: "Emotional", desc: "Warm, cinematic, tender character focus" },
  { id: "dramatic", label: "Dramatic", desc: "High contrast, teal-orange, cinematic hook" },
];

function CinematicAds() {
  const navigate = useNavigate();
  const [brand, setBrand] = useState("");
  const [pitch, setPitch] = useState("");
  const [tone, setTone] = useState<string>("dramatic");
  const [cta, setCta] = useState("Discover more");
  const [assets, setAssets] = useState<BrandAsset[]>([]);
  const [shots, setShots] = useState<AdShot[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [playing, setPlaying] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const pitchRef = useRef<HTMLTextAreaElement>(null);

  const allDone = shots.length > 0 && shots.every((s) => s.done);

  async function handleUpload(files: FileList | null, kind: BrandAsset["kind"]) {
    if (!files?.length) return;
    const loaded = await Promise.all(
      Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, 4).map((file) =>
        new Promise<BrandAsset>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ kind, name: file.name, dataUrl: String(reader.result) });
          reader.readAsDataURL(file);
        })
      )
    );
    setAssets((prev) => [...prev, ...loaded].slice(0, 6));
  }

  async function generate() {
    if (!brand.trim() || !pitch.trim()) {
      alert("Add a brand name and pitch first.");
      return;
    }
    if (!supabase) {
      navigate({ to: "/auth", search: { mode: "login" } });
      return;
    }
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      navigate({ to: "/auth", search: { mode: "login" } });
      return;
    }
    setRunning(true);
    setShots([]);
    setStatus("Writing ad storyboard…");
    try {
      const toneObj = TONES.find((t) => t.id === tone) || TONES[0];
      const brief = `A ${toneObj.label.toLowerCase()} 15-30 second cinematic ad for ${brand}. Pitch: ${pitch}. Structure: 1) hook shot, 2) product/context, 3) emotional beat with talent, 4) CTA reveal ("${cta}"). Style: ${toneObj.desc}. No narrator voice-over — in-world dialogue only. Every shot MUST feature the brand's uploaded ${assets.some((a) => a.kind === "product") ? "product prominently" : "identity"}. Keep talent and product consistent across every shot.`;
      const referenceBrief = assets.map((a) => ({ name: a.name, description: a.kind === "product" ? "Hero product — must appear in every shot" : a.kind === "logo" ? "Brand logo — subtle placement + endcard" : "Brand talent — same face across all shots" }));
      const compiledReferences = compileBrandAssetReferences(assets.map((asset) => ({ kind: asset.kind, name: asset.name })));
      const referenceRouting = formatReferenceRouting(compiledReferences);
      const story = await generateStoryboard({
        data: {
          prompt: brief,
          sceneCount: MAKERS_DEMO_LIMITS.maxScenes,
          learningContext: referenceRouting ? `Reference routing map: ${referenceRouting}` : "",
          referenceImages: referenceBrief,
        },
      });
      const initialBible = buildAdVisualBible({
        brand,
        pitch,
        toneLabel: toneObj.label,
        toneDescription: toneObj.desc,
        assets: assets.map((asset) => ({ kind: asset.kind, name: asset.name })),
        scenes: story.scenes,
      });
      const repairedScenes = validateAndRepairScenes(story.scenes, initialBible, normalizeSceneDuration(undefined));
      story.scenes = repairedScenes;
      const visualBible = buildAdVisualBible({
        brand,
        pitch,
        toneLabel: toneObj.label,
        toneDescription: toneObj.desc,
        assets: assets.map((asset) => ({ kind: asset.kind, name: asset.name })),
        scenes: repairedScenes,
      });
      const productContinuity = formatProductContinuity(visualBible);
      const scoreProfile = pickScoreProfile(buildScoreBrief([
        brand,
        pitch,
        cta,
        toneObj.label,
        toneObj.desc,
        story.scenes.map((scene) => `${scene.bgm || ""} ${scene.visual || ""}`).join(" "),
      ]));
      const initShots: AdShot[] = story.scenes.map((s, i) => ({
        title: `#${i + 1} ${s.title}`,
        visual: s.visual,
        spokenLine: s.spoken_line || s.dialogue?.replace(/^[^:]+:\s*/, "") || "",
        progress: 5,
        done: false,
        durationSeconds: normalizeSceneDuration(s.duration_seconds),
        colorGrade: s.color_grade,
        bgm: `${scoreProfile.label}${s.bgm ? ` - ${s.bgm}` : ""}`,
        bgmUrl: scoreProfile.url,
      }));
      setShots(initShots);
      setStatus(`Rendering ${initShots.length} ad shots — product locked as reference…`);

      await runWithConcurrency(
        story.scenes,
        MAKERS_DEMO_LIMITS.maxParallelVideoJobs,
        async (s, idx) => {
          try {
            const previousScene = story.scenes[idx - 1];
            const nextScene = story.scenes[idx + 1];
            const optimizedPrompt = buildOptimizedScenePrompt({
              scene: s,
              bible: visualBible,
              sceneIndex: idx,
              sceneCount: story.scenes.length,
              previousVisual: previousScene?.visual || previousScene?.video_prompt,
              nextVisual: nextScene?.visual || nextScene?.video_prompt,
              referenceWeight: assets.length ? 0.9 : 0.7,
              references: compiledReferences,
              userStyleProfile: `${toneObj.label}: ${toneObj.desc}`,
            });
            const imgPrompt = [
              formatOptimizedScenePrompt(optimizedPrompt, "image"),
              productContinuity,
              referenceRouting ? `Reference compiler routing: ${referenceRouting}` : "",
              s.visual || s.video_prompt,
              s.color_grade ? `Color grade: ${s.color_grade}` : "",
              `Brand: ${brand}. Hero product/logo/talent must remain identical to references.`,
              `Negative prompt: ${optimizedPrompt.negative_prompt}`,
            ].filter(Boolean).join("\n");
            let storyboardStillUrl: string | undefined;
            try {
              const img = await generateSceneImage({
                data: {
                  prompt: imgPrompt,
                  referenceImages: assets.map((a) => a.dataUrl),
                  referenceWeight: optimizedPrompt.continuity.reference_image_weight,
                  negativePrompt: optimizedPrompt.negative_prompt,
                },
              });
              storyboardStillUrl = img.image_url;
              setShots((c) => c.map((sh, i) => (i === idx ? { ...sh, posterUrl: img.image_url } : sh)));
            } catch {
              // T2V fallback below still carries the product bible.
            }
            const voiceP = s.spoken_line
              ? generateVoice({ data: { text: s.spoken_line, voice: "Cherry", language: s.language || "English", tone: `premium YouTube ad voice-over, cinematic, emotional, natural, ${toneObj.label.toLowerCase()}`, pitch: s.pitch || "medium", beatId: `ad-${idx + 1}` } })
                  .then((v) => setShots((c) => c.map((sh, i) => (i === idx ? { ...sh, audioUrl: v.audio_url, localizedScript: v.localized_script, targetLanguage: v.target_language, ttsProvider: v.provider, ttsSpeaker: v.tts_speaker, regionalCritique: v.critique } : sh))))
                  .catch(() => {})
              : Promise.resolve();
            const fullPrompt = [
              formatOptimizedScenePrompt(optimizedPrompt, "video"),
              productContinuity,
              referenceRouting ? `Reference compiler routing: ${referenceRouting}` : "",
              `Project visual bible summary: ${formatVisualBible(visualBible)}`,
              s.video_prompt,
              previousScene ? `Previous ad shot visual: ${previousScene.visual || previousScene.video_prompt}` : "",
              nextScene ? `Next ad shot setup: ${nextScene.visual || nextScene.video_prompt}` : "",
              `Brand: ${brand}. Product/logo/talent from reference must appear and remain identical.`,
              s.color_grade ? `Color grade: ${s.color_grade}` : "",
              `No product geometry changes, no logo drift, no package swap, no random colorway, no disconnected location style.`,
              `Negative prompt: ${optimizedPrompt.negative_prompt}`,
            ].filter(Boolean).join("\n");
            const videoUrl = await submitAndPollAdVideo(fullPrompt, buildAdVideoAttempts(storyboardStillUrl), (p) => {
              setShots((c) => c.map((sh, i) => (i === idx ? { ...sh, progress: p } : sh)));
            });
            await voiceP;
            setShots((c) => c.map((sh, i) => (i === idx ? { ...sh, progress: 100, done: true, videoUrl } : sh)));
          } catch (err) {
            setShots((c) => c.map((sh, i) => (i === idx ? { ...sh, visual: `${sh.visual}\n⚠ ${err instanceof Error ? err.message : String(err)}` } : sh)));
          }
        },
      );
      const finalShots = await new Promise<AdShot[]>((resolve) => {
        setShots((current) => {
          resolve(current);
          return current;
        });
      });
      const readyShots = finalShots.filter((shot) => shot.done && shot.videoUrl);
      if (readyShots.length > 0) {
        const now = new Date().toISOString();
        saveLibraryProject({
          id: `ad-${Date.now()}`,
          type: "ad_video",
          title: `${brand.trim()} - Cinematic Ad`,
          createdAt: now,
          updatedAt: now,
          posterUrl: finalShots.find((shot) => shot.posterUrl)?.posterUrl,
          finalVideoUrl: readyShots[0].videoUrl,
          sceneVideos: readyShots.map((shot) => shot.videoUrl).filter((url): url is string => Boolean(url)),
          durationSeconds: finalShots.reduce((sum, shot) => sum + (shot.durationSeconds || 0), 0),
          scoreMusicUrl: scoreProfile.url,
          scoreMusicMood: scoreProfile.mood,
          scoreMusicLabel: scoreProfile.label,
          brandName: brand.trim(),
          productPitch: pitch.trim(),
          cta: cta.trim(),
          adTone: toneObj.label,
          scenes: finalShots.map((shot) => ({
            title: shot.title,
            videoUrl: shot.videoUrl,
            audioUrl: shot.audioUrl,
            localizedScript: shot.localizedScript,
            targetLanguage: shot.targetLanguage,
            ttsProvider: shot.ttsProvider,
            ttsSpeaker: shot.ttsSpeaker,
            regionalCritique: typeof shot.regionalCritique === "object" && shot.regionalCritique ? shot.regionalCritique as Record<string, unknown> : undefined,
            posterUrl: shot.posterUrl,
            visual: shot.visual,
            caption: shot.spokenLine,
            spokenLine: shot.spokenLine,
            character: brand.trim(),
            shotType: "cinematic ad shot",
            bgm: shot.bgm,
            bgmUrl: shot.bgmUrl,
            durationSeconds: shot.durationSeconds,
            colorGrade: shot.colorGrade,
            agentTrace: buildHackathonAgentTrace({
              "Video Producer": shot.videoUrl ? MODEL_STRATEGY.videoPrimary : MODEL_STRATEGY.videoT2v,
              "Voice Agent": shot.ttsProvider || MODEL_STRATEGY.tts,
            }),
          })),
          timeline: finalShots.map((shot, index) => ({
            title: `Ad shot ${index + 1}`,
            videoUrl: shot.videoUrl,
            audioUrl: shot.audioUrl,
            localizedScript: shot.localizedScript,
            targetLanguage: shot.targetLanguage,
            ttsProvider: shot.ttsProvider,
            ttsSpeaker: shot.ttsSpeaker,
            regionalCritique: typeof shot.regionalCritique === "object" && shot.regionalCritique ? shot.regionalCritique as Record<string, unknown> : undefined,
            posterUrl: shot.posterUrl,
            visual: shot.visual,
            spokenLine: shot.spokenLine,
            durationSeconds: shot.durationSeconds,
            bgm: shot.bgm,
            bgmUrl: shot.bgmUrl,
            colorGrade: shot.colorGrade,
          })),
          metadata: {
            source: "ads",
            architecture: HACKATHON_ARCHITECTURE_SUMMARY,
            modelStrategy: MODEL_STRATEGY,
            agentTrace: buildHackathonAgentTrace({
              "Script Writer Agent": MODEL_STRATEGY.planner,
              "Video Producer": MODEL_STRATEGY.videoPrimary,
            }),
            tone,
            toneDescription: toneObj.desc,
            scoreMusicUrl: scoreProfile.url,
            scoreMusicMood: scoreProfile.mood,
            scoreMusicLabel: scoreProfile.label,
            visualBible,
            compiledReferences,
            assets: assets.map((asset) => ({ kind: asset.kind, name: asset.name })),
          },
        });
      }
      setStatus("Ad ready — press play to preview.");
      setPlaying(true);
    } catch (err) {
      setStatus("Failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-black text-white">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <TopBar />
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[420px_1fr] min-h-0">
          {/* LEFT — brand brief */}
          <div className="border-r border-white/10 p-6 space-y-5 overflow-y-auto">
            <div className="flex items-center gap-2">
              <MakersMark className="h-5 w-5" />
              <span className="text-sm font-medium">Cinematic Ads</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300">Brand</span>
            </div>
            <p className="text-xs text-white/60 leading-relaxed">Upload your product / logo / brand talent. We generate a 5-shot dramatic ad with your assets locked as references in every shot.</p>

            <div>
              <div className="text-[11px] uppercase tracking-widest text-white/40 mb-1">Brand</div>
              <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Nova Athletics" className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm outline-none focus:border-white/30" />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-widest text-white/40">Pitch / product</div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => pitchRef.current?.focus()}
                    className="h-7 w-7 rounded-md border border-white/10 text-white/60 hover:bg-white/10 hover:text-white flex items-center justify-center"
                    title="Edit prompt"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={!pitch.trim()}
                    onClick={() => void navigator.clipboard?.writeText(pitch)}
                    className="h-7 w-7 rounded-md border border-white/10 text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-40 flex items-center justify-center"
                    title="Copy prompt"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <textarea ref={pitchRef} value={pitch} onChange={(e) => setPitch(e.target.value)} rows={3} placeholder="e.g. A carbon-plated running shoe for marathon athletes." className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm outline-none focus:border-white/30" />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-widest text-white/40 mb-1">Tone</div>
              <div className="grid grid-cols-2 gap-2">
                {TONES.map((t) => (
                  <button key={t.id} onClick={() => setTone(t.id)} className={`rounded-md border p-2 text-left text-xs ${tone === t.id ? "border-white bg-white/10" : "border-white/10 hover:border-white/30"}`}>
                    <div className="font-medium">{t.label}</div>
                    <div className="text-white/50 text-[10px] mt-0.5">{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-widest text-white/40 mb-1">Call to action</div>
              <input value={cta} onChange={(e) => setCta(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm outline-none focus:border-white/30" />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] uppercase tracking-widest text-white/40">Brand assets</div>
                <div className="flex gap-1 text-[10px]">
                  {(["product", "logo", "model"] as const).map((k) => (
                    <button key={k} onClick={() => { if (uploadRef.current) { uploadRef.current.dataset.kind = k; uploadRef.current.click(); } }} className="flex items-center gap-1 rounded border border-white/10 px-2 py-1 hover:bg-white/10">
                      <Upload className="h-3 w-3" /> {k}
                    </button>
                  ))}
                </div>
              </div>
              <input ref={uploadRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const kind = (e.currentTarget.dataset.kind as BrandAsset["kind"]) || "product"; void handleUpload(e.target.files, kind); e.currentTarget.value = ""; }} />
              <div className="grid grid-cols-3 gap-2">
                {assets.map((a, i) => (
                  <div key={i} className="relative aspect-square rounded-md overflow-hidden border border-white/10 bg-neutral-900">
                    <img src={a.dataUrl} alt={a.name} className="h-full w-full object-cover" />
                    <div className="absolute bottom-0 inset-x-0 bg-black/70 text-[9px] text-white/80 px-1 py-0.5 uppercase">{a.kind}</div>
                  </div>
                ))}
                {assets.length === 0 && <div className="col-span-3 text-[11px] text-white/40 border border-dashed border-white/10 rounded-md p-4 text-center">Upload product photo, logo, and/or brand model.</div>}
              </div>
            </div>

            <button disabled={running} onClick={generate} className="w-full h-11 rounded-md bg-white text-black text-sm font-medium disabled:opacity-60 flex items-center justify-center gap-2">
              <ArrowUp className="h-4 w-4" /> {running ? "Rendering ad…" : "Generate cinematic ad"}
            </button>
            {status && <div className="text-[11px] text-white/60">{status}</div>}
          </div>

          {/* RIGHT — ad preview */}
          <div className="flex flex-col min-h-0 overflow-y-auto p-6 space-y-4">
            <div className="flex items-center gap-3 text-xs">
              <span className="font-medium">Ad Preview</span>
              <span className="text-white/40">·</span>
              <span className="text-white/60">{brand || "Untitled brand"}</span>
              {shots.length > 0 && shots.some((s) => s.done) && (
                <button onClick={() => setPlaying(true)} className="ml-auto flex items-center gap-1.5 rounded-full bg-white text-black px-3 py-1 text-[11px] font-medium">
                  <Film className="h-3 w-3" /> {allDone ? "Play Ad" : `Play (${shots.filter((s) => s.done).length}/${shots.length})`}
                </button>
              )}
            </div>
            {shots.length === 0 ? (
              <div className="flex-1 min-h-[300px] flex flex-col items-center justify-center text-center text-white/40 border border-white/10 rounded-xl">
                <Film className="h-10 w-10 mb-3 opacity-40" />
                <p className="text-sm">Your ad shots appear here as they render</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {shots.map((s, i) => (
                  <div key={i} className="relative aspect-video rounded-lg overflow-hidden border border-white/10 bg-neutral-950">
                    {s.videoUrl && s.done ? (
                      <video src={s.videoUrl} muted loop autoPlay playsInline className="absolute inset-0 h-full w-full object-cover" />
                    ) : s.posterUrl ? (
                      <img src={s.posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-[10px] text-white/40">{s.progress}%</div>
                    )}
                    {!s.done && <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10"><div className="h-full bg-emerald-400" style={{ width: `${s.progress}%` }} /></div>}
                    <div className="absolute top-1 left-1 text-[10px] text-white bg-black/60 px-1 rounded">#{i + 1}</div>
                    {s.audioUrl && <audio src={s.audioUrl} className="hidden" />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {playing && <AdPlayer shots={shots} brand={brand} cta={cta} tone={tone} onClose={() => setPlaying(false)} />}
    </div>
  );
}

function buildAdVideoAttempts(storyboardStillUrl?: string): VideoAttempt[] {
  const attempts: VideoAttempt[] = [];
  if (storyboardStillUrl) {
    attempts.push(
      { model: MODEL_STRATEGY.videoPrimary as VideoModel, imageUrl: storyboardStillUrl },
      { model: MODEL_STRATEGY.videoI2vFallback as VideoModel, imageUrl: storyboardStillUrl },
    );
  }
  attempts.push({ model: MODEL_STRATEGY.videoT2v as VideoModel }, { model: MODEL_STRATEGY.videoFallback as VideoModel });
  return attempts;
}

async function submitAndPollAdVideo(
  prompt: string,
  attempts: VideoAttempt[],
  onProgress: (progress: number) => void,
) {
  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      const { task_id } = await submitVideo({
        data: {
          prompt,
          size: "832*480",
          model: attempt.model,
          imageUrl: attempt.imageUrl,
        },
      });
      for (let pollAttempt = 0; pollAttempt < MAKERS_DEMO_LIMITS.maxVideoPollAttempts; pollAttempt++) {
        await new Promise((r) => setTimeout(r, getVideoPollDelayMs(pollAttempt)));
        onProgress(Math.min(10 + pollAttempt * 3, 92));
        const status = await pollVideo({ data: { task_id } });
        if (status.status === "SUCCEEDED" && status.video_url) return status.video_url;
        if (status.status === "FAILED") throw new Error(status.error || "Task failed");
      }
      throw new Error("Timed out waiting for video");
    } catch (err) {
      failures.push(`${attempt.model}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`All ad video engines failed. ${failures.join(" | ")}`);
}

function AdPlayer({ shots, brand, cta, tone, onClose }: { shots: AdShot[]; brand: string; cta: string; tone: string; onClose: () => void }) {
  const ready = shots.filter((s) => s.done && s.videoUrl);
  const [idx, setIdx] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dialogueRef = useRef<HTMLAudioElement>(null);
  const bgmRef = useRef<HTMLAudioElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const bgmUrl = ready.find((shot) => shot.bgmUrl)?.bgmUrl || pickBgm(buildScoreBrief([brand, tone, ready[0]?.bgm, ready[0]?.visual]));
  const current = ready[idx];

  function advance() {
    if (idx + 1 >= ready.length) {
      if (recRef.current && recRef.current.state !== "inactive") { try { recRef.current.stop(); } catch { /* noop */ } }
      setTimeout(onClose, 1200);
      return;
    }
    setIdx((i) => i + 1);
  }

  async function download() {
    const urls = ready.map((shot) => shot.videoUrl).filter((url): url is string => Boolean(url));
    if (urls.length === 0) return;
    setDownloading(true);
    setNotice(null);
    try {
      urls.forEach((url, index) => {
        downloadUrl(url, `${slugify(brand || "makers-ad")}-shot-${index + 1}.mp4`);
      });
      setNotice(urls.length === 1 ? "Downloading source MP4." : `Downloading ${urls.length} rendered source MP4 clips.`);
    } catch {
      setNotice("Could not start MP4 download.");
    } finally {
      setDownloading(false);
    }
  }

  async function recordFallback() {
    const v = videoRef.current;
    if (!v) return;
    try {
      const stream = (v as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
      if (!stream) {
        setNotice("Real-time WebM recording is not supported for this video/browser. Use Download MP4.");
        return;
      }
      const rec = new MediaRecorder(stream, { mimeType: "video/webm" });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${slugify(brand || "makers-ad")}.webm`;
        a.click();
        setDownloading(false);
      };
      recRef.current = rec;
      rec.start(500);
      setDownloading(true);
      setIdx(0);
    } catch {
      setDownloading(false);
      setNotice("Could not start WebM recording. Browser/CORS blocked captureStream.");
    }
  }

  if (!current) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black">
      <button onClick={onClose} className="absolute top-4 right-4 z-30 text-white/70 hover:text-white text-sm">Close ✕</button>
      <div className="absolute left-4 right-24 top-12 z-30 flex flex-wrap items-center justify-end gap-2">
        {notice && <span className="mr-auto rounded-full border border-white/10 bg-black/70 px-3 py-1 text-[11px] text-white/70">{notice}</span>}
        <button onClick={() => setIdx(0)} className="rounded-full border border-white/10 bg-black/45 px-3 py-1 text-[11px] text-white/75 hover:bg-white/10">
          Replay
        </button>
        <button onClick={download} disabled={downloading} className="flex items-center gap-1 rounded-full bg-white px-3 py-1 text-[11px] font-medium text-black hover:bg-white/90 disabled:opacity-60">
          <Download className="h-3 w-3" /> {downloading ? "Preparing" : "Download MP4"}
        </button>
        <button onClick={recordFallback} disabled={downloading} className="rounded-full border border-red-300/30 bg-red-500/20 px-3 py-1 text-[11px] text-red-100 hover:bg-red-500/30 disabled:opacity-60">
          Record WebM
        </button>
      </div>
      <video ref={videoRef} key={idx} src={current.videoUrl} autoPlay playsInline muted onEnded={advance} className="absolute inset-0 h-full w-full object-cover" style={{ animation: `kbAd ${Math.max(4, current.durationSeconds)}s ease-out forwards` }} />
      <audio ref={dialogueRef} src={current.audioUrl} autoPlay />
      <audio ref={bgmRef} src={bgmUrl} autoPlay loop />
      <div className="absolute inset-x-0 top-0 h-[5%] bg-black" />
      <div className="absolute inset-x-0 bottom-0 h-[5%] bg-black" />
      {idx === ready.length - 1 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="text-white text-6xl font-serif tracking-wide">{brand}</div>
            <div className="mt-3 text-white/80 text-sm uppercase tracking-[0.4em]">{cta}</div>
          </div>
        </div>
      )}
      {current.spokenLine && (
        <div className="absolute bottom-[15%] inset-x-0 text-center px-6">
          <div className="inline-block bg-black/60 text-white text-xl px-6 py-3 rounded-md">{current.spokenLine}</div>
        </div>
      )}
      <div className="absolute top-0 inset-x-0 h-0.5 bg-white/10"><div className="h-full bg-white/80" style={{ width: `${((idx + 1) / ready.length) * 100}%` }} /></div>
      <div className="absolute top-4 left-4 text-white/70 text-[11px] uppercase tracking-widest z-20 flex items-center gap-2">
        <Play className="h-3 w-3" /> {brand} · Cinematic Ad · {idx + 1}/{ready.length}
      </div>
      <style>{`@keyframes kbAd { 0% { transform: scale(1.03); } 100% { transform: scale(1.12); } }`}</style>
    </div>
  );
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "makers-video";
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
