import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUp, Check, Copy, Download, ExternalLink, Film, Globe, Pencil, Play, Volume2, X } from "lucide-react";
import { Sidebar, TopBar, MakersMark } from "./dashboard";
import { WebsiteBeatPreview } from "@/components/website-beat-preview";
import { generateVoice } from "@/lib/qwen.functions";
import { saveLibraryProject } from "@/lib/library";
import {
  buildWebsiteVideoPlan,
  extractWebsiteBrandKit,
  type WebsiteBrandKit,
  type WebsiteVideoBeat,
  type WebsiteVideoPlan,
  type WebsiteVideoType,
} from "@/lib/website-video";
import { repurposePlanForBlockedSite, repurposePlanForCaptureUnavailable } from "@/lib/website-site-resilience";
import { isCaptureApiConfigured } from "@/lib/website-browser-api";
import { slimWebsiteProjectForStorage } from "@/lib/library";
import {
  buildWebsiteRenderPipeline,
  estimateVoiceDurationSeconds,
  type WebsiteBeatRenderAsset,
  type WebsiteRenderPipeline,
} from "@/lib/website-render-pipeline";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import { generateWebsiteBeatClipServer } from "@/lib/website-video-clips.server";
import { buildExportBeats } from "@/lib/website-export-beats";
import { createWebsiteProjectJob, summarizeJobProgress, updateBeatJob } from "@/lib/website-jobs";
import { Player } from "@remotion/player";
import { WebsiteMainComposition, websiteCompositionDurationFrames } from "@/remotion/website-main-composition";
import { exportWebsiteVideoRemotion } from "@/lib/website-remotion-export";
import {
  buildWebsiteStyleProfile,
  readWebsiteSpeakerMemory,
  WEBSITE_VOICE_LANGUAGES,
  writeWebsiteSpeakerMemory,
  type WebsiteVoiceLanguage,
} from "@/lib/website-voice-languages";

export const Route = createFileRoute("/dashboard_/website")({
  ssr: false,
  component: WebsiteVideoPage,
});

type BeatPreview = WebsiteVideoBeat & {
  audioUrl?: string;
  localizedScript?: string;
  targetLanguage?: string;
  ttsProvider?: string;
  ttsSpeaker?: string;
  regionalCritique?: unknown;
  actualVoDurationSeconds?: number;
  plannedDurationSeconds?: number;
  renderAsset?: WebsiteBeatRenderAsset;
  assetStatus?: "pending" | "generating" | "ready" | "failed";
  assetSource?: WebsiteBeatRenderAsset["asset_source"];
  clipUrl?: string;
  motionSpec?: WebsiteBeatRenderAsset["motionGraphicSpec"];
  done?: boolean;
  progress?: number;
};

const VIDEO_TYPES: Array<{ id: WebsiteVideoType; label: string; desc: string; duration: number }> = [
  { id: "saas_launch", label: "SaaS Launch", desc: "Hook, problem, reveal, walkthrough, proof, CTA", duration: 200 },
  { id: "website_promo", label: "Website Promo", desc: "Brand hook, visual tour, value proposition, CTA", duration: 180 },
  { id: "user_demo", label: "User Demo", desc: "Problem, step-by-step walkthrough, result, CTA", duration: 195 },
  { id: "user_manual", label: "User Manual", desc: "Calm chaptered guide with screen capture steps", duration: 230 },
];

function WebsiteVideoPage() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [videoType, setVideoType] = useState<WebsiteVideoType>("website_promo");
  const [targetDuration, setTargetDuration] = useState(180);
  const [voiceLanguage, setVoiceLanguage] = useState<WebsiteVoiceLanguage>("english");
  const [brandKit, setBrandKit] = useState<WebsiteBrandKit | null>(null);
  const [plan, setPlan] = useState<WebsiteVideoPlan | null>(null);
  const [renderPipeline, setRenderPipeline] = useState<WebsiteRenderPipeline | null>(null);
  const [beats, setBeats] = useState<BeatPreview[]>([]);
  const [running, setRunning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [status, setStatus] = useState("");
  const [playing, setPlaying] = useState<BeatPreview | null>(null);
  const [showVideoPlayer, setShowVideoPlayer] = useState(false);
  const [editingBeat, setEditingBeat] = useState<{ beatId: string; text: string } | null>(null);
  const [regeneratingBeatId, setRegeneratingBeatId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  const selectedType = useMemo(() => VIDEO_TYPES.find((type) => type.id === videoType) || VIDEO_TYPES[1], [videoType]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      navigate({ to: "/auth", search: { mode: "login" } });
      return;
    }
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) navigate({ to: "/auth", search: { mode: "login" } });
    });
  }, [navigate]);

  async function generate() {
    if (!url.trim()) {
      alert("Add a website URL first.");
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      navigate({ to: "/auth", search: { mode: "login" } });
      return;
    }
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      navigate({ to: "/auth", search: { mode: "login" } });
      return;
    }
    setRunning(true);
    setBrandKit(null);
    setPlan(null);
    setRenderPipeline(null);
    setBeats([]);
    setStatus("Extracting brand kit from website...");
    try {
      const safeDuration = clampDuration(targetDuration);
      if (safeDuration !== targetDuration) {
        setTargetDuration(safeDuration);
        setStatus(`Target duration adjusted to ${safeDuration}s. Extracting brand kit from website...`);
      }
      const kit = await extractWebsiteBrandKit({ data: { url: normalizeUrlInput(url.trim()) } });
      setBrandKit(kit);
      setStatus(kit.confidence_flags.includes("fallback_brand_kit_used")
        ? "Website fetch was blocked/unavailable. Building a fallback plan from the domain..."
        : "Building website-to-video production plan...");
      const nextPlan = repurposePlanForCaptureUnavailable(
        repurposePlanForBlockedSite(
          kit,
          buildWebsiteVideoPlan({
            brandKit: kit,
            videoType,
            targetDurationSeconds: safeDuration,
            availableAiBroll: true,
            clientStyleProfile: buildWebsiteStyleProfile(kit.brand.name, voiceLanguage),
          }),
        ),
      );
      setPlan(nextPlan);
      setBeats(nextPlan.beats.map((beat) => ({ ...beat, progress: 5, done: false })));
      setStatus("Generating clear voice-over for each beat...");
      const nextProjectId = `website-${Date.now()}`;
      setProjectId(nextProjectId);

      const renderedBeats = await Promise.all(
        nextPlan.beats.map(async (beat, index) => {
          try {
            const voice = await generateVoice({
              data: {
                text: beat.vo_line,
                voice: index % 2 === 0 ? "Cherry" : "Ethan",
                language: voiceLanguage,
                tone: kit.brand.voice_tone,
                pitch: "medium",
                beatId: beat.beat_id,
                clientStyleProfile: buildWebsiteStyleProfile(kit.brand.name, voiceLanguage),
                preferredSpeaker: readWebsiteSpeakerMemory(kit.brand.name, voiceLanguage),
              },
            });
            if (voice.tts_speaker && voice.target_language) {
              writeWebsiteSpeakerMemory(kit.brand.name, voice.target_language, voice.tts_speaker);
            }
            const audioDuration = await resolveAudioDurationSeconds(voice.audio_url, beat.vo_line);
            return { ...beat, audioUrl: voice.audio_url, localizedScript: voice.localized_script, targetLanguage: voice.target_language, ttsProvider: voice.provider, ttsSpeaker: voice.tts_speaker, regionalCritique: voice.critique, actualVoDurationSeconds: audioDuration, done: true, progress: 50 };
          } catch {
            return { ...beat, actualVoDurationSeconds: estimateVoiceDurationSeconds(beat.vo_line), done: true, progress: 50 };
          }
        }),
      );

      const pipelineDraft = buildWebsiteRenderPipeline({ brandKit: kit, beats: renderedBeats });
      setBeats(mergePipelineBeats(pipelineDraft.beats).map((beat) => ({ ...beat, assetStatus: "generating" as const, progress: 55 })));
      setStatus(`Generating clips and screen captures for ${nextPlan.beats.length} beats (parallel x2)...`);

      const clipResults = new Map<string, Awaited<ReturnType<typeof generateWebsiteBeatClipServer>>>();
      let assetJob = createWebsiteProjectJob(nextProjectId, nextPlan.beats);
      const clipQueue = [...nextPlan.beats];
      const workers = Array.from({ length: 2 }, async () => {
        while (clipQueue.length > 0) {
          const beat = clipQueue.shift();
          if (!beat) break;
          const renderAsset = pipelineDraft.assets[beat.beat_id];
          if (!renderAsset) continue;
          setBeats((current) =>
            current.map((item) =>
              item.beat_id === beat.beat_id ? { ...item, assetStatus: "generating", progress: 58 } : item,
            ),
          );
          assetJob = updateBeatJob(assetJob, beat.beat_id, { asset_status: "generating", progress: 58 });
          const progress = summarizeJobProgress(assetJob);
          setStatus(`Generating clips and captures… ${progress.ready}/${progress.total} ready`);
          const result = await generateWebsiteBeatClipServer({
            data: {
              brandKit: kit,
              beat,
              renderAsset,
              projectId: nextProjectId,
            },
          });
          clipResults.set(beat.beat_id, result);
          assetJob = updateBeatJob(assetJob, beat.beat_id, {
            asset_status: result.asset_status === "ready" ? "ready" : "failed",
            asset_source: result.asset_source,
            clip_url: result.clip_url,
            progress: 100,
            error: result.asset_error,
          });
          setBeats((current) =>
            current.map((item) =>
              item.beat_id === beat.beat_id
                ? {
                    ...item,
                    clipUrl: result.clip_url,
                    motionSpec: result.motion_spec ?? item.motionSpec ?? renderAsset.motionGraphicSpec,
                    assetStatus: result.asset_status === "ready" ? "ready" : "failed",
                    assetSource: result.asset_source,
                    progress: 100,
                    renderAsset: {
                      ...item.renderAsset!,
                      clip_url: result.clip_url,
                      motionGraphicSpec: result.motion_spec ?? item.renderAsset?.motionGraphicSpec,
                      asset_status: result.asset_status,
                      asset_source: result.asset_source,
                      asset_error: result.asset_error,
                    },
                  }
                : item,
            ),
          );
        }
      });
      await Promise.all(workers);

      const pipeline = buildWebsiteRenderPipeline({
        brandKit: kit,
        beats: renderedBeats.map((beat) => {
          const clip = clipResults.get(beat.beat_id);
          return {
            ...beat,
            clipUrl: clip?.clip_url,
            motionSpec: clip?.motion_spec,
          };
        }),
      });
      const pipelineBeats = mergePipelineBeats(pipeline.beats).map((beat) => {
        const clip = clipResults.get(beat.beat_id);
        if (!clip) return beat;
        return {
          ...beat,
          clipUrl: clip.clip_url ?? beat.clipUrl,
          motionSpec: clip.motion_spec ?? beat.motionSpec,
          assetStatus: clip.asset_status,
          assetSource: clip.asset_source,
          renderAsset: beat.renderAsset
            ? {
                ...beat.renderAsset,
                clip_url: clip.clip_url,
                asset_status: clip.asset_status,
                asset_source: clip.asset_source,
                asset_error: clip.asset_error,
              }
            : beat.renderAsset,
        };
      });
      setBeats(pipelineBeats);
      setPlan({ ...nextPlan, beats: pipeline.beats });
      setRenderPipeline(pipeline);
      saveWebsiteProject(kit, { ...nextPlan, beats: pipeline.beats }, pipelineBeats, pipeline);
      writeWebsiteStyleMemory(kit.brand.name, nextPlan);
      setStatus(
        `Website video ready — ${[...clipResults.values()].filter((c) => c.clip_url || c.motion_spec).length}/${clipResults.size} beats with real visuals.`,
      );
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  }

  async function regenerateBeat(beatId: string, text: string) {
    const nextText = text.trim();
    if (!nextText) return;
    const beat = beats.find((item) => item.beat_id === beatId);
    if (!beat || !brandKit) return;
    setRegeneratingBeatId(beatId);
    setStatus("Regenerating this video beat...");
    try {
      let audioUrl = beat.audioUrl;
      let voiceMeta = {
        localizedScript: beat.localizedScript,
        targetLanguage: beat.targetLanguage,
        ttsProvider: beat.ttsProvider,
        ttsSpeaker: beat.ttsSpeaker,
        regionalCritique: beat.regionalCritique,
      };
      try {
        const voice = await generateVoice({
          data: {
            text: nextText,
            voice: beats.findIndex((item) => item.beat_id === beatId) % 2 === 0 ? "Cherry" : "Ethan",
            language: beat.targetLanguage || voiceLanguage,
            tone: brandKit.brand.voice_tone,
            pitch: "medium",
            beatId,
            clientStyleProfile: buildWebsiteStyleProfile(brandKit.brand.name, beat.targetLanguage || voiceLanguage),
            preferredSpeaker: readWebsiteSpeakerMemory(brandKit.brand.name, beat.targetLanguage || voiceLanguage),
          },
        });
        audioUrl = voice.audio_url;
        if (voice.tts_speaker && voice.target_language) {
          writeWebsiteSpeakerMemory(brandKit.brand.name, voice.target_language, voice.tts_speaker);
        }
        voiceMeta = {
          localizedScript: voice.localized_script,
          targetLanguage: voice.target_language,
          ttsProvider: voice.provider,
          ttsSpeaker: voice.tts_speaker,
          regionalCritique: voice.critique,
        };
      } catch {
        audioUrl = beat.audioUrl;
      }
      const actualVoDurationSeconds = audioUrl ? await resolveAudioDurationSeconds(audioUrl, nextText) : estimateVoiceDurationSeconds(nextText);
      let editedBeats = beats.map((item) =>
        item.beat_id === beatId ? { ...item, vo_line: nextText, audioUrl, ...voiceMeta, actualVoDurationSeconds, done: true, progress: 100 } : item,
      );
      const draftPipeline = buildWebsiteRenderPipeline({ brandKit, beats: editedBeats });
      const renderAsset = draftPipeline.assets[beatId];
      if (renderAsset) {
        setStatus("Regenerating clip for this beat...");
        const clip = await generateWebsiteBeatClipServer({
          data: {
            brandKit,
            beat: { ...beat, vo_line: nextText },
            renderAsset,
            projectId: projectId || `website-${Date.now()}`,
          },
        });
        editedBeats = editedBeats.map((item) =>
          item.beat_id === beatId
            ? { ...item, clipUrl: clip.clip_url, assetStatus: clip.asset_status, assetSource: clip.asset_source }
            : item,
        );
      }
      const pipeline = buildWebsiteRenderPipeline({ brandKit, beats: editedBeats });
      const nextBeats = mergePipelineBeats(pipeline.beats);
      setBeats(nextBeats);
      setPlan((current) =>
        current ? { ...current, beats: pipeline.beats } : current,
      );
      setRenderPipeline(pipeline);
      setEditingBeat(null);
      setStatus("Beat updated. Preview or download the regenerated website video.");
    } finally {
      setRegeneratingBeatId(null);
    }
  }

  async function downloadVideo() {
    if (!brandKit || beats.length === 0) return;
    setDownloading(true);
    setStatus("Rendering website video (Remotion MP4)...");
    try {
      await exportWebsiteVideoRemotion({
        brandName: brandKit.brand.name,
        colors: brandColors(brandKit),
        beats: buildExportBeats(beats),
        title: `${brandKit.brand.name} - ${selectedType.label}`,
        onProgress: (progress) => setStatus(`Rendering website video… ${progress}%`),
      });
      setStatus("MP4 download ready (Remotion WebCodecs).");
    } catch (remotionErr) {
      setStatus(`Remotion export unavailable (${remotionErr instanceof Error ? remotionErr.message : String(remotionErr)}). Falling back to canvas export…`);
      await renderWebsiteVideoDownload({
        brandKit,
        beats,
        title: `${brandKit.brand.name} - ${selectedType.label}`,
      });
      setStatus("WebM download ready (canvas fallback).");
    } finally {
      setDownloading(false);
    }
  }

  function saveWebsiteProject(kit: WebsiteBrandKit, nextPlan: WebsiteVideoPlan, renderedBeats: BeatPreview[], pipeline: WebsiteRenderPipeline | null) {
    const now = new Date().toISOString();
    const scene = (beat: BeatPreview) => ({
      title: beat.beat_purpose,
      assetStatus: beat.assetStatus || "ready",
      assetSource: beat.assetSource,
      clipUrl: beat.clipUrl?.startsWith("data:") ? undefined : beat.clipUrl,
      videoUrl: beat.clipUrl?.startsWith("data:") ? undefined : beat.clipUrl,
      visual: `${beat.production_method}: ${beat.screen_capture_spec?.interaction_sequence.join(", ") || beat.motion_graphic_spec?.layout || "AI B-roll context"}`,
      caption: beat.vo_line,
      spokenLine: beat.vo_line,
      audioUrl: beat.audioUrl?.startsWith("data:") ? undefined : beat.audioUrl,
      localizedScript: beat.localizedScript,
      targetLanguage: beat.targetLanguage,
      ttsProvider: beat.ttsProvider,
      ttsSpeaker: beat.ttsSpeaker,
      shotType: beat.production_method,
      durationSeconds: beat.duration_seconds,
      colorGrade: `${kit.brand.primary_color_hex}, ${kit.brand.secondary_color_hex}, ${kit.brand.accent_color_hex}`,
      editingNotes: beat.assetSource === "fallback" ? `Fallback: ${beat.renderAsset?.asset_error || "visual unavailable"}` : `Transition: ${beat.transition_out}`,
    });
    try {
      saveLibraryProject(
        slimWebsiteProjectForStorage({
          id: `website-${Date.now()}`,
          type: "website_video",
          title: `${kit.brand.name} - ${selectedType.label}`,
          createdAt: now,
          updatedAt: now,
          brandName: kit.brand.name,
          posterUrl: kit.brand.logo_asset_path?.startsWith("data:") ? undefined : kit.brand.logo_asset_path || undefined,
          durationSeconds: nextPlan.total_duration_seconds,
          websiteUrl: kit.source_url,
          videoType: selectedType.label,
          productPitch: kit.product.one_line_description,
          scenes: renderedBeats.map(scene),
          metadata: {
            source: "website",
            confidenceFlags: kit.confidence_flags,
            beatCount: renderedBeats.length,
          },
        }),
      );
    } catch (err) {
      console.warn("[website] library save failed:", err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="min-h-screen flex bg-black text-white">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <TopBar />
        <div className="flex-1 grid grid-cols-1 xl:grid-cols-[460px_1fr] min-h-0">
          <div className="border-r border-white/10 p-6 space-y-5 overflow-y-auto">
            <div className="flex items-center gap-2">
              <MakersMark className="h-5 w-5" />
              <span className="text-sm font-medium">Website to Video</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300">URL</span>
            </div>
            <p className="text-xs text-white/60 leading-relaxed">
              Turn one website URL into a launch, promo, demo, or manual video plan using the site's own brand, copy, pages, and motion rules.
            </p>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-widest text-white/40">Website URL</div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => urlRef.current?.focus()} className="h-7 w-7 rounded-md border border-white/10 text-white/60 hover:bg-white/10 hover:text-white flex items-center justify-center" title="Edit URL">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" disabled={!url.trim()} onClick={() => void navigator.clipboard?.writeText(url)} className="h-7 w-7 rounded-md border border-white/10 text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-40 flex items-center justify-center" title="Copy URL">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <input
                ref={urlRef}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm outline-none focus:border-white/30"
              />
            </div>

            {!isCaptureApiConfigured() && (
              <div className="rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">
                Screen capture worker not configured — set <code className="text-amber-100">VITE_API_BASE_URL</code> to your deployed FC worker URL for real site recordings.
              </div>
            )}

            <div>
              <div className="text-[11px] uppercase tracking-widest text-white/40 mb-2">Video Type</div>
              <div className="grid grid-cols-1 gap-2">
                {VIDEO_TYPES.map((type) => (
                  <button
                    key={type.id}
                    onClick={() => {
                      setVideoType(type.id);
                      setTargetDuration(type.duration);
                    }}
                    className={`rounded-md border p-3 text-left text-xs ${videoType === type.id ? "border-white bg-white/10" : "border-white/10 hover:border-white/30"}`}
                  >
                    <div className="font-medium">{type.label}</div>
                    <div className="text-white/50 text-[11px] mt-1">{type.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-widest text-white/40 mb-1">Target Duration</div>
              <input
                type="number"
                min={180}
                max={240}
                value={targetDuration}
                onChange={(e) => setTargetDuration(Number(e.target.value))}
                onBlur={() => setTargetDuration((value) => clampDuration(value))}
                className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm outline-none focus:border-white/30"
              />
              <div className="mt-1 text-[10px] text-white/35">Valid website videos are 180-240 seconds.</div>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-widest text-white/40 mb-1">Voice Language</div>
              <select
                value={voiceLanguage}
                onChange={(e) => setVoiceLanguage(e.target.value as WebsiteVoiceLanguage)}
                className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm outline-none focus:border-white/30"
              >
                {WEBSITE_VOICE_LANGUAGES.map((option) => (
                  <option key={option.value} value={option.value} className="bg-neutral-900">
                    {option.label}
                  </option>
                ))}
              </select>
              <div className="mt-1 text-[10px] text-white/35">
                Indian languages and code-switched modes route to Sarvam Bulbul V3 with localized scripts.
              </div>
            </div>

            <button disabled={running} onClick={generate} className="w-full h-11 rounded-md bg-white text-black text-sm font-medium disabled:opacity-60 flex items-center justify-center gap-2">
              <ArrowUp className="h-4 w-4" /> {running ? "Building plan..." : "Build website video"}
            </button>
            {status && <div className="text-[11px] text-white/60">{status}</div>}

            {brandKit && (
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-sm">{brandKit.brand.name}</div>
                  <a href={brandKit.source_url} target="_blank" rel="noreferrer" className="text-white/50 hover:text-white">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
                <div className="text-xs text-white/60">{brandKit.product.one_line_description}</div>
                <div className="flex gap-2">
                  {[brandKit.brand.primary_color_hex, brandKit.brand.secondary_color_hex, brandKit.brand.accent_color_hex, brandKit.brand.neutral_color_hex].map((color) => (
                    <span key={color} className="h-6 w-10 rounded border border-white/10" style={{ background: color }} title={color} />
                  ))}
                </div>
                <div className="text-[11px] text-white/40">
                  {brandKit.brand.heading_typeface} / {brandKit.brand.body_typeface}
                </div>
                {brandKit.confidence_flags.length > 0 && (
                  <div className="text-[11px] text-amber-300">Flags: {brandKit.confidence_flags.join(", ")}</div>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col min-h-0 overflow-y-auto p-6 space-y-4">
            <div className="flex items-center gap-3 text-xs">
              <span className="font-medium">Video Plan</span>
              <span className="text-white/40">-</span>
              <span className="text-white/60">{selectedType.label}</span>
              {plan && (
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => setShowVideoPlayer(true)}
                    className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-medium hover:bg-white/15"
                  >
                    <Play className="h-3 w-3" /> Play Video
                  </button>
                  <button
                    disabled={downloading}
                    onClick={() => void downloadVideo()}
                    className="flex items-center gap-1.5 rounded-full bg-white text-black px-3 py-1 text-[11px] font-medium disabled:opacity-60"
                  >
                    <Download className="h-3 w-3" /> {downloading ? "Rendering" : "Download Video"}
                  </button>
                  <button
                    onClick={() => downloadText(`${slugify(brandKit?.brand.name || "website")}-website-video-plan.json`, JSON.stringify({ brandKit, plan }, null, 2), "application/json")}
                    className="flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1 text-[11px] font-medium text-white/70 hover:text-white"
                  >
                    <Download className="h-3 w-3" /> Plan
                  </button>
                </div>
              )}
            </div>

            {!plan ? (
              <div className="flex-1 min-h-[360px] flex flex-col items-center justify-center text-center text-white/40 border border-white/10 rounded-xl">
                <Globe className="h-10 w-10 mb-3 opacity-40" />
                <p className="text-sm">Your website video beats appear here</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Stat label="Duration" value={`${Math.round(plan.total_duration_seconds / 60)} min`} />
                  <Stat label="Beats" value={String(plan.beats.length)} />
                  <Stat label="Lint Score" value={`${Math.round(plan.production_value_self_check.score * 100)}%`} />
                  <Stat label="Verdict" value={plan.production_value_self_check.verdict} />
                </div>
                {renderPipeline && (
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">Render Pipeline</div>
                        <div className="text-[11px] text-white/45">Plan compiled into executable beat assets and reconciled against voice timing.</div>
                      </div>
                      <span className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] uppercase tracking-widest text-white/50">{renderPipeline.target.replaceAll("_", " ")}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {renderPipeline.checklist.map((item) => (
                        <div key={item.id} className="flex items-start gap-2 rounded-md border border-white/10 bg-black/25 p-2 text-[11px] text-white/55">
                          <span className={`mt-0.5 h-2 w-2 rounded-full ${item.ok ? "bg-emerald-300" : "bg-amber-300"}`} />
                          <span>{item.note}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
                  <div className="aspect-video bg-neutral-950 relative">
                    {brandKit && beats[0] ? (
                      <WebsiteBeatPreview
                        brandName={brandKit.brand.name}
                        title={`${brandKit.brand.name} - ${selectedType.label}`}
                        description={brandKit.product.one_line_description}
                        productionMethod={beats[0].production_method}
                        beatPurpose={beats[0].beat_purpose}
                        voLine={beats[0].vo_line}
                        startSeconds={beats[0].start_seconds}
                        durationSeconds={beats[0].duration_seconds}
                        progress={0.25}
                        colors={brandColors(brandKit)}
            assetStatus={beats[0].assetStatus}
            assetSource={beats[0].assetSource}
            clipUrl={beats[0].clipUrl}
            motionSpec={beats[0].motionSpec}
            audioUrl={beats[0].audioUrl}
                        autoPlayVideo
                        muted
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-white/40">
                        <Film className="h-8 w-8" />
                      </div>
                    )}
                  </div>
                  <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{brandKit?.brand.name || "Website"} video preview</div>
                      <div className="text-[11px] text-white/45">Generated from the selected video type, brand kit, beat visuals, and voice-over.</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setShowVideoPlayer(true)} className="h-9 rounded-md bg-white text-black px-4 text-xs font-medium flex items-center gap-2">
                        <Play className="h-3.5 w-3.5" /> Play Video
                      </button>
                      <button disabled={downloading} onClick={() => void downloadVideo()} className="h-9 rounded-md border border-white/15 px-4 text-xs font-medium flex items-center gap-2 disabled:opacity-60">
                        <Download className="h-3.5 w-3.5" /> Download
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {beats.map((beat, index) => (
                    <div key={beat.beat_id} className="rounded-lg border border-white/10 bg-white/[0.03] overflow-hidden">
                      <div className="aspect-video bg-neutral-950 relative">
                        {brandKit && (
                          <WebsiteBeatPreview
                            brandName={brandKit.brand.name}
                            title={`${brandKit.brand.name} - ${selectedType.label}`}
                            description={brandKit.product.one_line_description}
                            productionMethod={beat.production_method}
                            beatPurpose={beat.beat_purpose}
                            voLine={beat.vo_line}
                            startSeconds={beat.start_seconds}
                            durationSeconds={beat.duration_seconds}
                            progress={0.2}
                            colors={brandColors(brandKit)}
                            assetStatus={beat.assetStatus}
                            assetSource={beat.assetSource}
                            clipUrl={beat.clipUrl}
                            motionSpec={beat.motionSpec}
                            audioUrl={beat.audioUrl}
                            autoPlayVideo={Boolean(beat.clipUrl)}
                            muted
                          />
                        )}
                      </div>
                      <div className="p-3 text-[11px] text-white/50 space-y-1">
                        <div className="font-medium text-white/80">{beat.beat_purpose}</div>
                        {editingBeat?.beatId === beat.beat_id ? (
                          <textarea
                            value={editingBeat.text}
                            onChange={(event) => setEditingBeat({ beatId: beat.beat_id, text: event.target.value })}
                            className="mt-1 h-20 w-full resize-none rounded-md border border-white/15 bg-black/40 p-3 text-xs leading-relaxed outline-none focus:border-white/35"
                          />
                        ) : (
                          <div className="text-xs text-white/55 leading-relaxed line-clamp-2">{beat.vo_line}</div>
                        )}
                        <div className="flex items-center justify-between pt-1">
                          <span>{formatTime(beat.start_seconds)} - {formatTime(beat.start_seconds + beat.duration_seconds)}</span>
                          <div className="flex items-center gap-2">
                            <button onClick={() => void navigator.clipboard?.writeText(beat.vo_line)} className="flex items-center gap-1 hover:text-white" title="Copy beat prompt">
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => setEditingBeat({ beatId: beat.beat_id, text: beat.vo_line })} className="flex items-center gap-1 hover:text-white" title="Edit this beat">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => setPlaying(beat)} className="flex items-center gap-1 hover:text-white">
                              {beat.audioUrl ? <Volume2 className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </div>
                        {beat.screen_capture_spec && <div>Capture: {beat.screen_capture_spec.source_page}</div>}
                        {beat.motion_graphic_spec && <div>Motion: {beat.motion_graphic_spec.layout}</div>}
                        {beat.clipUrl && <div className="text-emerald-300">Qwen video clip ready</div>}
                        {beat.assetSource === "fallback" && (
                          <div className="text-amber-300">
                            {formatBeatAssetError(beat.renderAsset?.asset_error)}
                          </div>
                        )}
                        {beat.renderAsset?.captureChoreography && <div>Choreography: {beat.renderAsset.captureChoreography.interaction_sequence.join(" -> ")}</div>}
                        {beat.renderAsset?.motionGraphicSpec && <div>Compiled layers: {beat.renderAsset.motionGraphicSpec.elements.length}</div>}
                        {beat.renderAsset?.brollPromptSpec && <div>B-roll prompt compiled</div>}
                        {beat.actualVoDurationSeconds && <div>Timing: VO {beat.actualVoDurationSeconds.toFixed(1)}s / resolved {beat.duration_seconds.toFixed(1)}s</div>}
                        {beat.done && <div className="flex items-center gap-1 text-emerald-300"><Check className="h-3 w-3" /> Voice ready</div>}
                        {editingBeat?.beatId === beat.beat_id && (
                          <div className="pt-2 flex justify-end gap-2">
                            <button onClick={() => setEditingBeat(null)} className="h-8 rounded-md border border-white/15 px-3 text-xs text-white/70 hover:text-white">
                              Cancel
                            </button>
                            <button
                              disabled={regeneratingBeatId === beat.beat_id}
                              onClick={() => void regenerateBeat(beat.beat_id, editingBeat.text)}
                              className="h-8 rounded-md bg-white px-3 text-xs font-medium text-black disabled:opacity-60"
                            >
                              {regeneratingBeatId === beat.beat_id ? "Regenerating" : "Regenerate Beat"}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {playing && brandKit && <BeatModal beat={playing} brandKit={brandKit} title={`${brandKit.brand.name} - ${selectedType.label}`} onClose={() => setPlaying(null)} />}
      {showVideoPlayer && brandKit && beats.length > 0 && (
        <WebsiteVideoPlayer
          brandKit={brandKit}
          beats={beats}
          title={`${brandKit.brand.name} - ${selectedType.label}`}
          onClose={() => setShowVideoPlayer(false)}
          onDownload={() => void downloadVideo()}
          downloading={downloading}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="text-[10px] uppercase tracking-widest text-white/40">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function BeatModal({ beat, brandKit, title, onClose }: { beat: BeatPreview; brandKit: WebsiteBrandKit; title: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl rounded-xl border border-white/10 bg-[#0b0b0b] p-5">
        <div className="flex items-center justify-between">
          <div className="font-medium">{beat.beat_purpose}</div>
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white">Close</button>
        </div>
        <div className="mt-4 aspect-video rounded-lg bg-white/[0.03] border border-white/10 overflow-hidden">
          <WebsiteBeatPreview
            brandName={brandKit.brand.name}
            title={title}
            description={brandKit.product.one_line_description}
            productionMethod={beat.production_method}
            beatPurpose={beat.beat_purpose}
            voLine={beat.vo_line}
            startSeconds={beat.start_seconds}
            durationSeconds={beat.duration_seconds}
            progress={0.35}
            colors={brandColors(brandKit)}
            assetStatus={beat.assetStatus}
            assetSource={beat.assetSource}
            clipUrl={beat.clipUrl}
            motionSpec={beat.motionSpec}
            audioUrl={beat.audioUrl}
            autoPlayVideo
            muted={false}
          />
        </div>
      </div>
    </div>
  );
}

function WebsiteVideoPlayer({
  brandKit,
  beats,
  title,
  onClose,
  onDownload,
  downloading,
}: {
  brandKit: WebsiteBrandKit;
  beats: BeatPreview[];
  title: string;
  onClose: () => void;
  onDownload: () => void;
  downloading: boolean;
}) {
  const remotionBeats = useMemo(() => {
    const exportBeats = buildExportBeats(beats);
    return exportBeats.map((beat) => ({
      beat_id: beat.beat_id,
      beat_purpose: beat.beat_purpose,
      vo_line: beat.vo_line,
      duration_seconds: beat.duration_seconds,
      transition_out: beat.transition_out,
      clip_url: beat.clipUrl,
      motion_spec: beat.motionSpec,
      vo_audio_url: beat.audioUrl,
      asset_source: beat.assetSource,
    }));
  }, [beats]);
  const inputProps = useMemo(
    () => ({
      beats: remotionBeats,
      brandName: brandKit.brand.name,
      colors: brandColors(brandKit),
    }),
    [remotionBeats, brandKit],
  );
  const durationInFrames = websiteCompositionDurationFrames(remotionBeats);

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      <div className="h-14 border-b border-white/10 flex items-center justify-between px-5">
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-[11px] text-white/40">Remotion timeline preview — matches export assembly</div>
        </div>
        <div className="flex items-center gap-2">
          <button disabled={downloading} onClick={onDownload} className="h-9 rounded-md bg-white px-4 text-xs font-medium text-black disabled:opacity-60 flex items-center gap-2">
            <Download className="h-3.5 w-3.5" /> {downloading ? "Rendering" : "Download MP4"}
          </button>
          <button onClick={onClose} className="h-9 w-9 rounded-md border border-white/15 flex items-center justify-center text-white/70 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 p-5 flex items-center justify-center">
        <div className="w-full max-w-6xl aspect-video rounded-xl overflow-hidden border border-white/10 shadow-2xl shadow-black bg-black">
          <Player
            component={WebsiteMainComposition}
            inputProps={inputProps}
            durationInFrames={durationInFrames}
            fps={30}
            compositionWidth={1280}
            compositionHeight={720}
            controls
            style={{ width: "100%", height: "100%" }}
          />
        </div>
      </div>
    </div>
  );
}

function formatBeatAssetError(error?: string) {
  if (!error) return "Using branded motion fallback";
  if (error === "ai_video_unavailable") return "AI video unavailable (billing or API) — using branded motion";
  if (error === "capture_api_unavailable") return "Screen capture worker not configured — using branded motion";
  if (error === "site_blocked") return "Site blocked live capture — using branded motion";
  if (error.length > 120) return `Clip unavailable — using branded motion`;
  return `Clip failed — ${error}`;
}

function normalizeUrlInput(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function clampDuration(value: number) {
  if (!Number.isFinite(value)) return 180;
  return Math.min(240, Math.max(180, Math.round(value)));
}

function readWebsiteStyleMemory(brand: string) {
  try {
    const items = JSON.parse(localStorage.getItem("makers:website-style") || "{}") as Record<string, string>;
    return items[brand] || "";
  } catch {
    return "";
  }
}

function writeWebsiteStyleMemory(brand: string, plan: WebsiteVideoPlan) {
  try {
    const key = "makers:website-style";
    const items = JSON.parse(localStorage.getItem(key) || "{}") as Record<string, string>;
    items[brand] = `preferred easing ${plan.beats.find((beat) => beat.motion_graphic_spec)?.motion_graphic_spec?.easing_family || "ease-out-expo"}; transitions ${Array.from(new Set(plan.beats.map((beat) => beat.transition_out))).join(", ")}; methods ${Array.from(new Set(plan.beats.map((beat) => beat.production_method))).join(", ")}`;
    localStorage.setItem(key, JSON.stringify(items));
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
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "website-video";
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function getPreviewDuration(beat: WebsiteVideoBeat) {
  return Math.min(8, Math.max(4, Math.round(beat.duration_seconds / 18)));
}

function validColor(value: string | null | undefined, fallback: string) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function mergePipelineBeats(beats: WebsiteRenderPipeline["beats"]): BeatPreview[] {
  return beats.map((beat) => ({
    ...beat,
    audioUrl: beat.vo_audio_url,
    localizedScript: "localizedScript" in beat ? String(beat.localizedScript || "") || undefined : undefined,
    targetLanguage: "targetLanguage" in beat ? String(beat.targetLanguage || "") || undefined : undefined,
    ttsProvider: "ttsProvider" in beat ? String(beat.ttsProvider || "") || undefined : undefined,
    ttsSpeaker: "ttsSpeaker" in beat ? String(beat.ttsSpeaker || "") || undefined : undefined,
    regionalCritique: "regionalCritique" in beat ? beat.regionalCritique : undefined,
    actualVoDurationSeconds: beat.actual_vo_duration_seconds,
    plannedDurationSeconds: beat.planned_duration_seconds,
    assetStatus: beat.asset_status,
    assetSource: beat.render_asset.asset_source,
    clipUrl: beat.clip_url,
    motionSpec: beat.motion_spec,
    renderAsset: beat.render_asset,
    done: true,
    progress: 100,
  }));
}

function brandColors(brandKit: WebsiteBrandKit) {
  return {
    primary: brandKit.brand.primary_color_hex,
    secondary: brandKit.brand.secondary_color_hex,
    accent: brandKit.brand.accent_color_hex,
    neutral: brandKit.brand.neutral_color_hex,
    headingFont: `${brandKit.brand.heading_typeface}, Georgia, serif`,
    bodyFont: `${brandKit.brand.body_typeface}, system-ui, sans-serif`,
    logoUrl: brandKit.brand.logo_asset_path,
    fontUrls: brandKit.font_urls,
  };
}

function resolveAudioDurationSeconds(audioUrl: string | undefined, fallbackText: string) {
  if (!audioUrl || typeof Audio === "undefined") return Promise.resolve(estimateVoiceDurationSeconds(fallbackText));
  return new Promise<number>((resolve) => {
    const audio = new Audio();
    const fallback = estimateVoiceDurationSeconds(fallbackText);
    let settled = false;
    const done = (value: number) => {
      if (settled) return;
      settled = true;
      audio.removeAttribute("src");
      audio.load();
      resolve(Number.isFinite(value) && value > 0 ? Number(value.toFixed(2)) : fallback);
    };
    const timeout = window.setTimeout(() => done(fallback), 2500);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      done(audio.duration);
    };
    audio.onerror = () => {
      window.clearTimeout(timeout);
      done(fallback);
    };
    audio.src = audioUrl;
  });
}

async function renderWebsiteVideoDownload({
  brandKit,
  beats,
  title,
}: {
  brandKit: WebsiteBrandKit;
  beats: BeatPreview[];
  title: string;
}) {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("This browser cannot record video. Try Chrome or Edge.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas renderer unavailable.");

  const stream = canvas.captureStream(30);
  const audioContext = createAudioContext();
  const audioDestination = audioContext?.createMediaStreamDestination();
  if (audioDestination) {
    for (const track of audioDestination.stream.getAudioTracks()) stream.addTrack(track);
  }
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start(250);
  for (const beat of beats) {
    const audio = await playBeatAudioThroughDestination(beat.audioUrl, audioContext, audioDestination);
    await drawBeatFrames(ctx, canvas, brandKit, beat, title, Math.max(2, beat.duration_seconds || getPreviewDuration(beat)));
    stopBeatAudio(audio);
  }
  recorder.stop();
  await stopped;
  await audioContext?.close().catch(() => undefined);

  const blob = new Blob(chunks, { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(title)}.webm`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function drawBeatFrames(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  brandKit: WebsiteBrandKit,
  beat: BeatPreview,
  title: string,
  durationSeconds: number,
) {
  if (beat.clipUrl) {
    await drawBeatVideoClip(ctx, canvas, beat, brandKit, title, durationSeconds);
    return;
  }
  const fps = 30;
  const totalFrames = Math.max(1, Math.round(durationSeconds * fps));
  for (let frame = 0; frame < totalFrames; frame += 1) {
    drawBeatFrame(ctx, canvas, brandKit, beat, title, frame / totalFrames);
    await sleep(1000 / fps);
  }
}

async function drawBeatVideoClip(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  beat: BeatPreview,
  brandKit: WebsiteBrandKit,
  title: string,
  durationSeconds: number,
) {
  const video = document.createElement("video");
  video.src = beat.clipUrl!;
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error("Failed to load beat clip"));
    video.load();
  });
  const fps = 30;
  const totalFrames = Math.max(1, Math.round(durationSeconds * fps));
  const frameDuration = Math.min(video.duration || durationSeconds, durationSeconds) / totalFrames;
  for (let frame = 0; frame < totalFrames; frame += 1) {
    video.currentTime = Math.min(video.duration || durationSeconds, frame * frameDuration);
    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked);
        resolve();
      };
      video.addEventListener("seeked", onSeeked);
      if (Math.abs(video.currentTime - frame * frameDuration) < 0.01) resolve();
    });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, canvas.height - 120, canvas.width, 120);
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 28px Arial";
    ctx.fillText(beat.beat_purpose, 48, canvas.height - 72);
    ctx.font = "400 18px Arial";
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    wrapCanvasText(ctx, beat.vo_line, 48, canvas.height - 40, canvas.width - 96, 22, 2);
    await sleep(1000 / fps);
  }
}

function drawBeatFrame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  brandKit: WebsiteBrandKit,
  beat: BeatPreview,
  title: string,
  progress: number,
) {
  const width = canvas.width;
  const height = canvas.height;
  const primary = validColor(brandKit.brand.primary_color_hex, "#111111");
  const secondary = validColor(brandKit.brand.secondary_color_hex, "#2a2a2a");
  const accent = validColor(brandKit.brand.accent_color_hex, "#ffffff");
  const neutral = validColor(brandKit.brand.neutral_color_hex, "#080808");
  const motionSpec = beat.motionSpec || beat.renderAsset?.motionGraphicSpec;
  const captureSpec = beat.renderAsset?.captureChoreography;
  const brollSpec = beat.renderAsset?.brollPromptSpec;
  const panelTitle = motionSpec?.layout?.replaceAll("_", " ") || captureSpec?.framing?.replaceAll("_", " ") || brollSpec?.positive_prompt.split(".")[0] || beat.production_method;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, beat.production_method === "screen_capture" ? neutral : primary);
  gradient.addColorStop(0.58, primary);
  gradient.addColorStop(1, secondary);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  for (let x = -60 + progress * 60; x < width; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = -60 + progress * 60; y < height; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  drawMotionPanel({
    ctx,
    x: beat.production_method === "screen_capture" ? 110 + progress * 50 : 690 - progress * 30,
    y: 110,
    width: beat.production_method === "screen_capture" ? 690 : 420,
    height: 330,
    accent,
    primary,
    brandName: brandKit.brand.name,
    headline: beat.beat_purpose,
    subhead: beat.vo_line,
    source: beat.assetSource || beat.renderAsset?.asset_source,
    progress,
  });

  const fade = ctx.createLinearGradient(0, height * 0.35, 0, height);
  fade.addColorStop(0, "rgba(0,0,0,0.05)");
  fade.addColorStop(1, "rgba(0,0,0,0.86)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "600 18px Arial";
  ctx.fillText(beat.production_method.replace("_", " ").toUpperCase(), 76, 470);
  ctx.fillText(`${formatTime(beat.start_seconds)} - ${formatTime(beat.start_seconds + beat.duration_seconds)}`, 76, 500);
  ctx.fillText(panelTitle.toUpperCase(), 76, 530);

  ctx.fillStyle = "#ffffff";
  ctx.font = "700 54px Georgia";
  ctx.fillText(brandKit.brand.name, 76, 585);
  ctx.font = "500 34px Arial";
  wrapCanvasText(ctx, beat.beat_purpose, 76, 632, 760, 40);
  ctx.font = "400 25px Arial";
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  wrapCanvasText(ctx, beat.vo_line, 76, 676, 820, 30, 2);

  ctx.font = "600 17px Arial";
  ctx.fillStyle = "rgba(255,255,255,0.58)";
  ctx.textAlign = "right";
  ctx.fillText(title, width - 76, 80);
  ctx.font = "400 18px Arial";
  wrapCanvasText(ctx, brandKit.product.one_line_description, width - 420, 112, 344, 24, 3, "right");
  ctx.textAlign = "left";
}

function drawMotionPanel({
  ctx,
  x,
  y,
  width,
  height,
  accent,
  primary,
  brandName,
  headline,
  subhead,
  source,
  progress,
}: {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  width: number;
  height: number;
  accent: string;
  primary: string;
  brandName: string;
  headline: string;
  subhead: string;
  source?: WebsiteBeatRenderAsset["asset_source"];
  progress: number;
}) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  roundRect(ctx, x, y, width, height, 28);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.66)";
  ctx.font = "700 18px Arial";
  ctx.fillText(brandName.toUpperCase(), x + 34, y + 42);
  ctx.fillStyle = source === "fallback" ? "rgba(251,191,36,0.9)" : "rgba(255,255,255,0.42)";
  ctx.font = "600 12px Arial";
  ctx.fillText(source === "fallback" ? "FALLBACK MOTION GRAPHIC" : "COMPILED MOTION GRAPHIC", x + 34, y + 66);
  const blockGradient = ctx.createLinearGradient(x + 34, y + 78, x + width - 34, y + 78);
  blockGradient.addColorStop(0, `${accent}99`);
  blockGradient.addColorStop(1, `${primary}99`);
  ctx.fillStyle = blockGradient;
  roundRect(ctx, x + 34, y + 78, width - 68, 94, 18);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 25px Arial";
  wrapCanvasText(ctx, headline, x + 58, y + 124, width - 116, 30, 2);
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  roundRect(ctx, x + 34 + progress * 20, y + 204, width - 68, 76, 16);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = "400 18px Arial";
  wrapCanvasText(ctx, subhead, x + 58 + progress * 20, y + 232, width - 116, 23, 2);
  ctx.restore();
}

function createAudioContext() {
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

async function playBeatAudioThroughDestination(
  audioUrl: string | undefined,
  audioContext: AudioContext | null,
  destination: MediaStreamAudioDestinationNode | undefined,
) {
  if (!audioUrl || !audioContext || !destination) return null;
  try {
    if (audioContext.state === "suspended") await audioContext.resume();
    const audio = new Audio(audioUrl);
    audio.crossOrigin = "anonymous";
    audio.preload = "auto";
    const source = audioContext.createMediaElementSource(audio);
    source.connect(destination);
    audio.currentTime = 0;
    await audio.play();
    return { audio, source };
  } catch {
    return null;
  }
}

function stopBeatAudio(active: { audio: HTMLAudioElement; source: MediaElementAudioSourceNode } | null) {
  if (!active) return;
  active.audio.pause();
  active.audio.removeAttribute("src");
  active.audio.load();
  active.source.disconnect();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 3,
  align: CanvasTextAlign = "left",
) {
  const originalAlign = ctx.textAlign;
  ctx.textAlign = align;
  const words = text.split(/\s+/).filter(Boolean);
  let line = "";
  let lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, align === "right" ? x + maxWidth : x, y + lines * lineHeight);
      line = word;
      lines += 1;
      if (lines >= maxLines) break;
    } else {
      line = test;
    }
  }
  if (line && lines < maxLines) ctx.fillText(line, align === "right" ? x + maxWidth : x, y + lines * lineHeight);
  ctx.textAlign = originalAlign;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
