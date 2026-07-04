import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { ArrowUp, Check, Copy, Download, ExternalLink, Film, Globe, Pencil, Play, Volume2 } from "lucide-react";
import { Sidebar, TopBar, MakersMark } from "./dashboard";
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
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/dashboard_/website")({
  ssr: false,
  component: WebsiteVideoPage,
});

type BeatPreview = WebsiteVideoBeat & {
  audioUrl?: string;
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
  const [brandKit, setBrandKit] = useState<WebsiteBrandKit | null>(null);
  const [plan, setPlan] = useState<WebsiteVideoPlan | null>(null);
  const [beats, setBeats] = useState<BeatPreview[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [playing, setPlaying] = useState<BeatPreview | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  const selectedType = useMemo(() => VIDEO_TYPES.find((type) => type.id === videoType) || VIDEO_TYPES[1], [videoType]);

  async function generate() {
    if (!url.trim()) {
      alert("Add a website URL first.");
      return;
    }
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) navigate({ to: "/auth", search: { mode: "login" } });
    });
    setRunning(true);
    setBrandKit(null);
    setPlan(null);
    setBeats([]);
    setStatus("Extracting brand kit from website...");
    try {
      const kit = await extractWebsiteBrandKit({ data: { url: normalizeUrlInput(url.trim()) } });
      setBrandKit(kit);
      setStatus("Building website-to-video production plan...");
      const nextPlan = buildWebsiteVideoPlan({
        brandKit: kit,
        videoType,
        targetDurationSeconds: targetDuration,
        availableAiBroll: true,
        clientStyleProfile: readWebsiteStyleMemory(kit.brand.name),
      });
      setPlan(nextPlan);
      setBeats(nextPlan.beats.map((beat) => ({ ...beat, progress: 5, done: false })));
      setStatus("Generating clear voice-over for each beat...");

      const renderedBeats = await Promise.all(
        nextPlan.beats.map(async (beat, index) => {
          try {
            const voice = await generateVoice({
              data: {
                text: beat.vo_line,
                voice: index % 2 === 0 ? "Cherry" : "Ethan",
                language: "English",
                tone: kit.brand.voice_tone,
                pitch: "medium",
              },
            });
            return { ...beat, audioUrl: voice.audio_url, done: true, progress: 100 };
          } catch {
            return { ...beat, done: true, progress: 100 };
          }
        }),
      );
      setBeats(renderedBeats);
      saveWebsiteProject(kit, nextPlan, renderedBeats);
      writeWebsiteStyleMemory(kit.brand.name, nextPlan);
      setStatus("Website video plan ready - saved to Library.");
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  }

  function saveWebsiteProject(kit: WebsiteBrandKit, nextPlan: WebsiteVideoPlan, renderedBeats: BeatPreview[]) {
    const now = new Date().toISOString();
    saveLibraryProject({
      id: `website-${Date.now()}`,
      type: "website_video",
      title: `${kit.brand.name} - ${selectedType.label}`,
      createdAt: now,
      updatedAt: now,
      posterUrl: kit.brand.logo_asset_path || undefined,
      durationSeconds: nextPlan.total_duration_seconds,
      websiteUrl: kit.source_url,
      videoType: selectedType.label,
      productPitch: kit.product.one_line_description,
      scenes: renderedBeats.map((beat) => ({
        title: beat.beat_purpose,
        visual: `${beat.production_method}: ${beat.screen_capture_spec?.interaction_sequence.join(", ") || beat.motion_graphic_spec?.layout || "AI B-roll context"}`,
        caption: beat.vo_line,
        spokenLine: beat.vo_line,
        audioUrl: beat.audioUrl,
        shotType: beat.production_method,
        durationSeconds: beat.duration_seconds,
        colorGrade: `${kit.brand.primary_color_hex}, ${kit.brand.secondary_color_hex}, ${kit.brand.accent_color_hex}`,
        editingNotes: `Transition: ${beat.transition_out}. ${beat.screen_capture_spec ? `Capture ${beat.screen_capture_spec.source_page}` : "Motion graphics using brand kit"}`,
      })),
      timeline: renderedBeats.map((beat) => ({
        title: beat.beat_purpose,
        caption: beat.vo_line,
        spokenLine: beat.vo_line,
        audioUrl: beat.audioUrl,
        visual: beat.production_method,
        shotType: beat.production_method,
        durationSeconds: beat.duration_seconds,
        editingNotes: beat.transition_out,
      })),
      metadata: {
        source: "website",
        brandKit: kit,
        websiteVideoPlan: nextPlan,
      },
    });
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
                className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm outline-none focus:border-white/30"
              />
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
                <button
                  onClick={() => downloadText(`${slugify(brandKit?.brand.name || "website")}-website-video-plan.json`, JSON.stringify({ brandKit, plan }, null, 2), "application/json")}
                  className="ml-auto flex items-center gap-1.5 rounded-full bg-white text-black px-3 py-1 text-[11px] font-medium"
                >
                  <Download className="h-3 w-3" /> Export Plan
                </button>
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
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {beats.map((beat, index) => (
                    <div key={beat.beat_id} className="rounded-lg border border-white/10 bg-white/[0.03] overflow-hidden">
                      <div className="aspect-video bg-neutral-950 relative p-5 flex flex-col justify-between">
                        <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-white/45">
                          <span>{beat.production_method.replace("_", " ")}</span>
                          <span>{formatTime(beat.start_seconds)} - {formatTime(beat.start_seconds + beat.duration_seconds)}</span>
                        </div>
                        <div>
                          <div className="text-xl font-semibold">{beat.beat_purpose}</div>
                          <div className="mt-2 text-xs text-white/55 leading-relaxed line-clamp-3">{beat.vo_line}</div>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-white/45">
                          <span>{beat.transition_out}</span>
                          <button onClick={() => setPlaying(beat)} className="flex items-center gap-1 hover:text-white">
                            {beat.audioUrl ? <Volume2 className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} Preview
                          </button>
                        </div>
                      </div>
                      <div className="p-3 text-[11px] text-white/50 space-y-1">
                        {beat.screen_capture_spec && <div>Capture: {beat.screen_capture_spec.source_page}</div>}
                        {beat.motion_graphic_spec && <div>Motion: {beat.motion_graphic_spec.layout}</div>}
                        {beat.done && <div className="flex items-center gap-1 text-emerald-300"><Check className="h-3 w-3" /> Voice ready</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {playing && <BeatModal beat={playing} onClose={() => setPlaying(null)} />}
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

function BeatModal({ beat, onClose }: { beat: BeatPreview; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl rounded-xl border border-white/10 bg-[#0b0b0b] p-5">
        <div className="flex items-center justify-between">
          <div className="font-medium">{beat.beat_purpose}</div>
          <button onClick={onClose} className="text-sm text-white/50 hover:text-white">Close</button>
        </div>
        <div className="mt-4 rounded-lg bg-white/[0.03] border border-white/10 p-5">
          <div className="text-xs uppercase tracking-widest text-white/40">{beat.production_method.replace("_", " ")}</div>
          <div className="mt-3 text-xl font-semibold">{beat.vo_line}</div>
          {beat.audioUrl && <audio src={beat.audioUrl} controls autoPlay className="mt-5 w-full" />}
        </div>
      </div>
    </div>
  );
}

function normalizeUrlInput(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
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
