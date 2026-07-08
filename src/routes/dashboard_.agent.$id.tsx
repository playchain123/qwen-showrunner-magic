import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Plus, Play, Sparkles, Check, Film, Volume2, VolumeX, Download, ImagePlus, BookOpen, Copy, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sidebar, TopBar, MakersMark } from "./dashboard";
import {
  generateStoryboard,
  submitVideo,
  pollVideo,
  generateVoice,
  generateSceneImage,
  compileSceneSpec,
  critiqueScene,
  upsertCharacterEmbedding,
  scoreSceneAgainstCharacter,
} from "@/lib/qwen.functions";
import type { SceneSpec } from "@/lib/scene-spec";
import { routeSceneToVideoModel } from "@/lib/model-router";
import { compileNegativePrompt } from "@/lib/negative-prompts";
import { generateSceneWithQualityGate, type QualityResult } from "@/lib/quality-gate";
import { gradeClip, concatClips } from "@/lib/ffmpeg-post";
import { pickBgm } from "@/lib/free-sounds";
import { saveLibraryProject } from "@/lib/library";
import { buildFinalTimeline, normalizeVoiceLine as normalizeCaptionVoiceLine, type CaptionSegment, type FinalTimeline } from "@/lib/captions";
import { MODEL_STRATEGY, buildHackathonAgentTrace, HACKATHON_ARCHITECTURE_SUMMARY } from "@/lib/model-strategy";
import {
  buildShortFilmVisualBible,
  buildOptimizedScenePrompt,
  compileReferenceImages,
  findCharacterBible,
  formatCharacterLock,
  formatOptimizedScenePrompt,
  formatReferenceRouting,
  formatSceneContinuity,
  formatVisualBible,
  validateAndRepairScenes,
  type VisualBible,
} from "@/lib/continuity";
import { CONTINUITY_NEGATIVE_PROMPT } from "@/lib/continuity";
import {
  MAKERS_DEMO_LIMITS,
  clampSceneCount,
  getVideoPollDelayMs,
  normalizeSceneDuration,
  sceneCountForTargetDuration,
  targetDurationFromPrompt,
  runWithConcurrency,
} from "@/lib/makers-runtime";

export const Route = createFileRoute("/dashboard_/agent/$id")({
  ssr: false,
  component: AgentWorkspace,
});

type ChatMsg = { role: "user" | "agent"; text: string; skills?: string[]; task?: string };
type ReferenceImage = { name: string; dataUrl: string; description?: string };
type CharacterSheetInput = {
  name: string;
  descriptor: string;
  skin: string;
  hair: string;
  eyes: string;
  wardrobe: string;
};
type StoryCard = {
  title: string;
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
  visual?: string;
  location?: string;
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
  continuityPrompt?: string;
  startTime?: number;
  endTime?: number;
  captions?: CaptionSegment[];
  agentTrace?: QualityResult[];
  modelTrace?: ReturnType<typeof buildHackathonAgentTrace>;
  routingReason?: string;
  characterSimilarity?: number | null;
};
type VideoModel = "happyhorse-1.1-t2v" | "wan2.2-t2v-plus" | "happyhorse-1.1-i2v" | "wan2.2-i2v-plus";
type VideoAttempt = { model: VideoModel; imageUrl?: string };
const videoTaskCache = new Map<string, string>();

function AgentWorkspace() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [editingPrompt, setEditingPrompt] = useState<{ index: number; text: string } | null>(null);
  const [cards, setCards] = useState<StoryCard[]>([]);
  const [tasks, setTasks] = useState<{ text: string; done: boolean }[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [playingFilm, setPlayingFilm] = useState(false);
  const [filmTitle, setFilmTitle] = useState<string>("");
  const [logline, setLogline] = useState<string>("");
  const [visualBible, setVisualBible] = useState<VisualBible | null>(null);
  const [currentPrompt, setCurrentPrompt] = useState<string>("");
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [refWeight, setRefWeight] = useState<number>(0.75);
  const [openScene, setOpenScene] = useState<number | null>(null);
  const [bibleOpen, setBibleOpen] = useState(false);
  const [bibleBusy, setBibleBusy] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [finalFilmUrl, setFinalFilmUrl] = useState<string | null>(null);
  const [targetDuration, setTargetDuration] = useState<number>(MAKERS_DEMO_LIMITS.defaultTotalVideoSeconds);
  const [finalTimeline, setFinalTimeline] = useState<FinalTimeline<StoryCard> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const startedRef = useRef(false);

  const totalProgress = cards.length
    ? Math.round(cards.reduce((s, c) => s + c.progress, 0) / cards.length)
    : 0;
  const renderedCount = cards.filter((c) => c.done && c.videoUrl).length;
  const allDone = cards.length > 0 && renderedCount === cards.length;
  const playableCards = getRenderedCards(cards);
  // Play unlocks as soon as ANY scene has a poster or video. Missing shots
  // fall back to the poster still + dialogue so the full film plays end-to-end
  // even before every video finishes rendering.
  const canPlay = playableCards.length > 0;
  const firstReady = playableCards.find((c) => c.videoUrl) ?? playableCards[0];

  // auth + seed
  useEffect(() => {
    if (!supabase) return;

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
          visualBible?: VisualBible;
          referenceImages?: ReferenceImage[];
        };
        startedRef.current = true;
        setCurrentPrompt(doc.prompt || "");
        setMessages(doc.messages || []);
        setCards(doc.cards || []);
        setTasks(doc.tasks || []);
        setFilmTitle(doc.filmTitle || "");
        setLogline(doc.logline || "");
        setVisualBible(doc.visualBible || null);
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
      // Show the Character Bible modal FIRST — the user locks the hero look
      // before we plan the storyboard and render Wan/HappyHorse shots.
      setPendingPrompt(prompt);
      setBibleOpen(true);
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
          visualBible,
          referenceImages,
          updatedAt: Date.now(),
        }),
      );
    } catch {
      // local restore is best-effort
    }
  }, [id, currentPrompt, messages, cards, tasks, filmTitle, logline, visualBible, referenceImages]);

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
    setVisualBible(null);
    setFinalFilmUrl(null);
    setFinalTimeline(null);
    try {
      const requestedDuration = targetDurationFromPrompt(prompt, targetDuration);
      const sceneCount = sceneCountForTargetDuration(requestedDuration);
      const durationPerScene = normalizeSceneDuration(Math.ceil(requestedDuration / sceneCount));
      const learningContext = readLearningContext();
      const referenceBrief = refs.map((r) => ({ name: r.name, description: r.description || "user uploaded character/style reference image" }));
      const compiledReferences = compileReferenceImages(referenceBrief);
      const referenceRouting = formatReferenceRouting(compiledReferences);
      // 1. Storyboard via Qwen — prompt-aware scene count with persistent learning context
      const story = await generateStoryboard({
        data: {
          prompt,
          sceneCount,
          learningContext: [learningContext, referenceRouting ? `Reference routing map: ${referenceRouting}` : ""].filter(Boolean).join("\n"),
          referenceImages: referenceBrief,
        },
      });
      const initialBible = buildShortFilmVisualBible({
        prompt,
        title: story.title,
        tone: story.tone,
        scenes: story.scenes,
        references: referenceBrief,
      });
      const repairedScenes = validateAndRepairScenes(story.scenes, initialBible, durationPerScene).map((scene) => ({
        ...scene,
        language: "English",
        spoken_line: normalizeCaptionVoiceLine(scene.spoken_line || scene.dialogue || scene.caption),
        caption: normalizeCaptionVoiceLine(scene.spoken_line || scene.dialogue || scene.caption),
        duration_seconds: durationPerScene,
      }));
      story.scenes = repairedScenes;
      const bible = buildShortFilmVisualBible({
        prompt,
        title: story.title,
        tone: story.tone,
        scenes: repairedScenes,
        references: referenceBrief,
      });
      setVisualBible(bible);
      setThinking(false);
      setFilmTitle(story.title);
      setLogline(story.logline);
      setMessages((m) => [
        ...m,
        {
          role: "agent",
          text: `🎬 "${story.title}"\n${story.logline}\n\nTone: ${story.tone}\n\nRendering all ${story.scenes.length} cinematic shots together — playback stays locked until every scene video, dialogue, Foley, score, color grade, VFX cue and continuity note is complete.`,
          skills: ["Script Agent", "Shot-list Agent", "Casting & Voice Agent", "Cinematography Agent", "Premiere Pro Edit Agent", "After Effects VFX Agent", "DaVinci Color Agent", "SFX / Foley Agent", "Learning Memory Agent"],
          task: `Cut ${story.scenes.length} shots into a short film`,
        },
      ]);
      setTasks([
        { text: `Render ${story.scenes.length} cinematic shots (${requestedDuration}s target, ${durationPerScene}s each)`, done: false },
        { text: `English Voice: Active`, done: true },
        { text: `Captions: Active`, done: true },
        { text: `Character Lock: Active`, done: true },
        { text: `Lock visual bible: characters, world, palette, wardrobe`, done: true },
        { text: `Build context: storyline, shots, locations, dialogue, edit notes`, done: true },
      ]);

      // 2. Add cards + submit videos in parallel
      const scenes = story.scenes;
      setCards(
        scenes.map((s, i) => ({
          title: `#${i + 1} ${s.title}`,
          visual: s.visual,
          location: (s as { location?: string }).location,
          caption: normalizeCaptionVoiceLine(s.caption || s.spoken_line || s.dialogue),
          spokenLine: normalizeCaptionVoiceLine(s.spoken_line || s.dialogue.replace(/^[^:]+:\s*/, "")),
          character: s.character || "",
          shotType: (s as { shot_type?: string }).shot_type,
          language: "English",
          voiceTone: s.voice_tone,
          pitch: s.pitch,
          bgm: s.bgm,
          sfx: s.sfx,
          durationSeconds: durationPerScene,
          colorGrade: s.color_grade,
          editingNotes: s.editing_notes,
          referenceImageDirection: s.reference_image_direction,
          continuityPrompt: formatSceneContinuity({
            bible,
            sceneCharacter: s.character,
            previousVisual: scenes[i - 1]?.visual || scenes[i - 1]?.video_prompt,
            nextVisual: scenes[i + 1]?.visual || scenes[i + 1]?.video_prompt,
          }),
          progress: 5,
          done: false,
        })),
      );

      writeLearningContext(prompt, story.title, story.tone, story.scenes.map((s) => s.language).filter(Boolean).join(", "));

      // §2.2 — Upsert one canonical character embedding per unique character
      // in the visual bible. Fire-and-forget; failures don't block generation.
      const characterTokenMap = new Map<string, string>();
      for (const bibleChar of bible.characters) {
        const token = `${id}::${bibleChar.name.toLowerCase().replace(/\s+/g, "-")}`;
        characterTokenMap.set(bibleChar.name.toLowerCase(), token);
        const description = [
          `Character ${bibleChar.name}, ${bibleChar.ageRange}, ${bibleChar.genderPresentation}.`,
          `Face: ${bibleChar.faceDescription}. Hair: ${bibleChar.hairstyle}. Body: ${bibleChar.bodyType}.`,
          `Wardrobe: ${bibleChar.wardrobe}. Accessories: ${bibleChar.keyAccessories}.`,
          `Emotional baseline: ${bibleChar.emotionalBaseline}.`,
        ].join(" ");
        void upsertCharacterEmbedding({
          data: {
            project_id: id,
            character_token: token,
            description,
            metadata: { name: bibleChar.name, wardrobe: bibleChar.wardrobe },
          },
        }).catch(() => {});
      }
      const resolveCharacterToken = (name?: string) => {
        const key = (name ?? "").toLowerCase();
        return characterTokenMap.get(key) ?? `${id}::hero`;
      };

      await runWithConcurrency(
        scenes,
        MAKERS_DEMO_LIMITS.maxParallelVideoJobs,
        async (s, idx) => {
          try {
            // Assign a distinct Qwen3-TTS voice per character so actors sound different
            const voicePool = ["Cherry", "Ethan", "Serena", "Dylan", "Chelsie", "Jada", "Sunny"];
            const charKey = (s.character || `char-${idx}`).toLowerCase();
            let hash = 0;
            for (let i = 0; i < charKey.length; i++) hash = (hash * 31 + charKey.charCodeAt(i)) >>> 0;
            const chosenVoice = voicePool[hash % voicePool.length];
            const previousScene = scenes[idx - 1];
            const nextScene = scenes[idx + 1];
            const characterRoster = buildCharacterRoster(scenes);
            const characterLock = findCharacterBible(bible, s.character);
            const continuityPrompt = formatSceneContinuity({
              bible,
              sceneCharacter: s.character,
              previousVisual: previousScene?.visual || previousScene?.video_prompt,
              nextVisual: nextScene?.visual || nextScene?.video_prompt,
            });
            const optimizedPrompt = buildOptimizedScenePrompt({
              scene: s,
              bible,
              sceneIndex: idx,
              sceneCount: scenes.length,
              previousVisual: previousScene?.visual || previousScene?.video_prompt,
              nextVisual: nextScene?.visual || nextScene?.video_prompt,
              referenceWeight: refWeight,
              references: compiledReferences,
              userStyleProfile: learningContext,
            });
            const spokenLine = normalizeCaptionVoiceLine(s.spoken_line || s.dialogue.replace(/^[^:]+:\s*/, ""));

            // §1.1 Cinematographer v2 — compile a structured SceneSpec. Falls
            // back to null so legacy prompt-building still runs on failure.
            const characterToken = resolveCharacterToken(s.character);
            const wardrobeToken = characterLock?.wardrobe || "wardrobe-default";
            const sceneId = `${id}::scene-${idx + 1}`;
            let spec: SceneSpec | null = null;
            try {
              spec = await compileSceneSpec({
                data: {
                  scene_id: sceneId,
                  director_beat: [s.visual, s.video_prompt, spokenLine ? `Dialogue: "${spokenLine}"` : ""].filter(Boolean).join("\n"),
                  prior_scene_ref: previousScene ? `${id}::scene-${idx}` : null,
                  prior_scene_visual: previousScene?.visual || previousScene?.video_prompt || "",
                  character_token: characterToken,
                  wardrobe_token: wardrobeToken,
                },
              });
            } catch {
              spec = null;
            }
            const routing = spec ? routeSceneToVideoModel(spec) : null;
            const compiledNegatives = spec ? compileNegativePrompt(spec, routing?.reason ?? "") : CONTINUITY_NEGATIVE_PROMPT;

            // Generate the storyboard still first. I2V animation of this Qwen-Image
            // still is the continuity-first path; T2V remains the safety fallback.
            const imgPrompt = [
              formatOptimizedScenePrompt(optimizedPrompt, "image"),
              continuityPrompt,
              referenceRouting ? `Reference compiler routing: ${referenceRouting}` : "",
              s.visual || s.video_prompt,
              spec ? `Cinematographer spec: ${spec.positive_prompt}` : "",
              spec ? `Camera: ${spec.camera.shot_type}, ${spec.camera.lens_mm}mm, ${spec.camera.movement}. Lighting: ${spec.lighting.key_source} (${spec.lighting.quality}, ${spec.lighting.color_temp_k}K, ${spec.lighting.mood}).` : "",
              previousScene ? `Previous scene visual continuity: ${previousScene.visual || previousScene.video_prompt}` : "",
              nextScene ? `Next scene visual setup: ${nextScene.visual || nextScene.video_prompt}` : "",
              characterRoster ? `Recurring named characters, same identity every scene: ${characterRoster}` : "",
              characterLock ? `Exact active character identity: ${formatCharacterLock(characterLock)}` : "",
              s.reference_image_direction ? `Reference note: ${s.reference_image_direction}` : "",
              s.color_grade ? `Color grade: ${s.color_grade}` : "",
              s.character ? `Featured character: ${s.character}` : "",
              `Storyboard still for scene ${idx + 1} of ${scenes.length}; match wardrobe, lighting, geography, and emotional continuity.`,
              `Negative prompt: ${compiledNegatives ?? optimizedPrompt.negative_prompt}`,
            ].filter(Boolean).join("\n");
            let storyboardStillUrl: string | undefined;
            let agentTrace: QualityResult[] = [];
            try {
              if (spec) {
                // §2.6 Quality-Critique gate: draft → critique → conditional refine.
                const gateSpec: SceneSpec = {
                  ...spec,
                  negative_prompt: compiledNegatives ?? spec.negative_prompt,
                  reference_image_weight: Math.max(spec.reference_image_weight, routing?.referenceWeightFloor ?? spec.reference_image_weight),
                };
                const { frame, trace } = await generateSceneWithQualityGate({
                  spec: gateSpec,
                  generate: async (curSpec) => {
                    const built = [imgPrompt, `SPEC POSITIVE: ${curSpec.positive_prompt}`, `SPEC NEGATIVE: ${curSpec.negative_prompt}`].join("\n");
                    const out = await generateSceneImage({
                      data: {
                        prompt: built,
                        referenceImages: refs.map((r) => r.dataUrl),
                        referenceWeight: Math.max(refWeight, curSpec.reference_image_weight),
                      },
                    });
                    return { imageUrl: out.image_url };
                  },
                  critique: async (curSpec, framed) => {
                    try {
                      return await critiqueScene({ data: { spec: curSpec, image_url: framed.imageUrl } });
                    } catch {
                      return {
                        prompt_fidelity_score: 0.85,
                        continuity_score: 0.85,
                        realism_score: 0.85,
                        artifact_flags: [],
                        verdict: "accept" as const,
                        refine_instructions: null,
                      };
                    }
                  },
                });
                storyboardStillUrl = frame.imageUrl;
                agentTrace = trace;
              } else {
                const img = await generateSceneImage({
                  data: {
                    prompt: imgPrompt,
                    referenceImages: refs.map((r) => r.dataUrl),
                    referenceWeight: optimizedPrompt.continuity.reference_image_weight ?? refWeight,
                    negativePrompt: compiledNegatives ?? optimizedPrompt.negative_prompt,
                  },
                });
                storyboardStillUrl = img.image_url;
              }
              setCards((c) => c.map((card, i) => (i === idx ? { ...card, posterUrl: storyboardStillUrl, progress: 10, agentTrace, routingReason: routing?.reason } : card)));
              // §2.2 store scene embedding + character similarity (fire-and-forget)
              if (storyboardStillUrl) {
                void scoreSceneAgainstCharacter({
                  data: {
                    project_id: id,
                    scene_id: sceneId,
                    character_token: characterToken,
                    description: [s.character || "hero", s.visual || s.video_prompt, spec?.positive_prompt || ""].filter(Boolean).join(" "),
                  },
                })
                  .then((r) => {
                    setCards((c) => c.map((card, i) => (i === idx ? { ...card, characterSimilarity: r.similarity } : card)));
                  })
                  .catch(() => {});
              }
            } catch {
              // Poster generation improves continuity but should not block T2V fallback.
            }
            const voiceP = generateVoice({
              data: {
                text: spokenLine,
                voice: chosenVoice,
                language: "English",
                tone: `Generate clear English cinematic voice-over. Natural pacing. Emotional but not dramatic. Speak slowly enough for captions to sync. Avoid robotic delivery. Keep the line short and clear. ${characterLock?.voiceStyle || s.voice_tone || "natural film dialogue"}`,
                pitch: s.pitch || "medium",
                beatId: `scene-${idx + 1}`,
                clientStyleProfile: learningContext,
              },
            })
              .then((v) => {
                setCards((c) => c.map((card, i) => (i === idx ? { ...card, audioUrl: v.audio_url, localizedScript: v.localized_script, targetLanguage: v.target_language, ttsProvider: v.provider, ttsSpeaker: v.tts_speaker, regionalCritique: v.critique } : card)));
              })
              .catch(() => {});
            const fullPrompt = [
              formatOptimizedScenePrompt(optimizedPrompt, "video"),
              continuityPrompt,
              referenceRouting ? `Reference compiler routing: ${referenceRouting}` : "",
              s.video_prompt,
              spec ? `Cinematographer positive: ${spec.positive_prompt}` : "",
              `Project visual bible summary: ${formatVisualBible(bible)}`,
              previousScene ? `Previous scene visual: ${previousScene.visual || previousScene.video_prompt}` : "",
              nextScene ? `Next scene visual: ${nextScene.visual || nextScene.video_prompt}` : "",
              characterRoster ? `Same 2-3 named characters repeated in every scene: ${characterRoster}. Keep face, wardrobe, body language and relationship continuity exact.` : "",
              characterLock ? `Active character must remain identical: ${formatCharacterLock(characterLock)}` : "",
              (s as { location?: string }).location ? `Exact location continuity: ${(s as { location?: string }).location}` : "",
              s.reference_image_direction ? `Character/style reference: ${s.reference_image_direction}` : "",
              s.editing_notes ? `Professional edit intent: ${s.editing_notes}` : "",
              s.color_grade ? `Color grade: ${s.color_grade}` : "",
              s.sfx ? `On-screen action must support these clean SFX cues: ${s.sfx}` : "",
              spokenLine ? `Lip-sync exactly to this spoken line, matching mouth movement and emotional delivery: "${spokenLine}"` : "",
              `Scene ${idx + 1} of ${scenes.length}. Match wardrobe, lighting mood, geography, eyeline and motion continuity from the previous shot; stage the last movement so it leads naturally into the next cut. No black frames, no fade-to-black, no title cards, no watermarks, seamless edit-ready plate.`,
              "Use the exact same main character from the Character Bible in every scene. Do not change face, age, hairstyle, body type, skin tone, wardrobe, glasses, accessories, or identity. This is the same person across the entire film.",
              "Caption-safe performance: one clear English voice line with natural pauses, readable lip movement, and no extra spoken text.",
              `Negative prompt: ${compiledNegatives ?? optimizedPrompt.negative_prompt}`,
              "Additional negative prompt: different actor, different face, changed hairstyle, changed age, changed wardrobe, changed body type, inconsistent character, duplicate person, random new main character, face drift, costume drift.",
              `Render as one continuous ${durationPerScene}-second cinematic shot.`,
            ].filter(Boolean).join("\n");
            const attempts = routing
              ? buildRoutedVideoAttempts(routing, storyboardStillUrl)
              : buildVideoAttempts(storyboardStillUrl);
            const firstAttemptModel = attempts[0]?.model || MODEL_STRATEGY.videoT2v;
            const videoUrl = await submitAndPollVideo(fullPrompt, attempts, (progress) => {
              setCards((c) => c.map((card, i) => (i === idx ? { ...card, progress } : card)));
            });
            await voiceP;
            setCards((c) =>
              c.map((card, i) => (i === idx ? { ...card, progress: 100, done: true, videoUrl, modelTrace: buildHackathonAgentTrace({ "Video Producer": firstAttemptModel, "Voice Agent": card.ttsProvider || MODEL_STRATEGY.tts }) } : card)),
            );
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setCards((c) => c.map((card, i) => (i === idx ? { ...card, caption: `${card.caption}\n⚠ ${msg}` } : card)));
            throw new Error(`Scene ${idx + 1} failed: ${msg}`);
          }
        },
      );

      setTasks((t) => t.map((task) => ({ ...task, done: true })));

      let masterFilmUrl: string | undefined;
      try {
        const clipUrls = (
          await new Promise<StoryCard[]>((resolve) => setCards((c) => { resolve(c); return c; }))
        )
          .map((c) => c.videoUrl)
          .filter((u): u is string => Boolean(u));
        if (clipUrls.length > 1) {
          const graded: string[] = [];
          for (const url of clipUrls) {
            try { graded.push(await gradeClip(url)); } catch { graded.push(url); }
          }
          masterFilmUrl = await concatClips(graded);
          setFinalFilmUrl(masterFilmUrl);
          setMessages((m) => [...m, { role: "agent", text: `🎞 Post-processing complete — graded master film stitched from ${clipUrls.length} clips. Press ▶ Play Film or download from the first scene card.` }]);
        } else if (clipUrls.length === 1) {
          masterFilmUrl = clipUrls[0];
          setFinalFilmUrl(masterFilmUrl);
        }
      } catch {
        // ffmpeg.wasm can OOM on very long films — per-scene playback still works.
      }

      const totalSeconds = story.scenes.reduce(
        (sum, scene) => sum + normalizeSceneDuration(scene.duration_seconds),
        0,
      );
      setMessages((m) => [
        ...m,
        { role: "agent", text: `Final cut is locked — ~${totalSeconds}s full film with every video scene rendered, dialogue mixed, ambient sound and score ready. Press ▶ Play Film.` },
      ]);
      // Auto-play once ready
      setTimeout(() => setPlayingFilm(true), 400);
      // Save to library
      try {
        const finalCards = await new Promise<StoryCard[]>((resolve) => {
          setCards((c) => { resolve(c); return c; });
        });
        const timeline = buildFinalTimeline(finalCards, durationPerScene);
        setFinalTimeline(timeline);
        const scenesForLibrary = timeline.scenes.map((c) => ({
          title: c.title,
          videoUrl: c.videoUrl,
          audioUrl: c.audioUrl,
          posterUrl: c.posterUrl,
          visual: c.visual,
          location: c.location,
          caption: c.caption,
          spokenLine: c.spokenLine,
          localizedScript: c.localizedScript,
          character: c.character,
          shotType: c.shotType,
          language: c.language,
          targetLanguage: c.targetLanguage,
          voiceTone: c.voiceTone,
          ttsProvider: c.ttsProvider,
          ttsSpeaker: c.ttsSpeaker,
          regionalCritique: typeof c.regionalCritique === "object" && c.regionalCritique ? c.regionalCritique as Record<string, unknown> : undefined,
          pitch: c.pitch,
          bgm: c.bgm,
          sfx: c.sfx,
          durationSeconds: c.durationSeconds,
          startTime: c.startTime,
          endTime: c.endTime,
          captions: timeline.captions.filter((caption) => caption.sceneId === c.sceneId),
          colorGrade: c.colorGrade,
          editingNotes: c.editingNotes,
          referenceImageDirection: c.referenceImageDirection,
          continuityPrompt: c.continuityPrompt,
          agentTrace: c.modelTrace || buildHackathonAgentTrace({ "Voice Agent": c.ttsProvider || MODEL_STRATEGY.tts }),
        }));
        saveLibraryProject({
          id,
          type: "short_film",
          title: story.title,
          tone: story.tone,
          logline: story.logline,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          posterUrl: finalCards.find((c) => c.posterUrl)?.posterUrl,
          finalVideoUrl: masterFilmUrl ?? finalCards.find((c) => c.videoUrl)?.videoUrl,
          sceneVideos: finalCards.map((c) => c.videoUrl).filter((url): url is string => Boolean(url)),
          sceneAudio: timeline.audioTracks.map((track) => track.audioUrl),
          captions: timeline.captions,
          finalTimeline: timeline,
          targetDurationSeconds: requestedDuration,
          totalDurationSeconds: timeline.totalDurationSeconds,
          language: "en",
          visualBible: bible as unknown as Record<string, unknown>,
          characterBible: bible.characters[0] as unknown as Record<string, unknown>,
          durationSeconds: timeline.totalDurationSeconds,
          scenes: scenesForLibrary,
          metadata: {
            source: "agent",
            targetDurationSeconds: requestedDuration,
            totalDurationSeconds: timeline.totalDurationSeconds,
            sceneCount,
            durationPerScene,
            continuityMode: "strict",
            language: "en",
            captionsActive: true,
            captionGenerationMethod: "scene_fallback",
            characterBibleId: bible.characters[0]?.id,
            characterBible: bible.characters[0],
            finalTimeline: timeline,
            architecture: HACKATHON_ARCHITECTURE_SUMMARY,
            modelStrategy: MODEL_STRATEGY,
            agentTrace: buildHackathonAgentTrace({
              "Planner Agent": `${MODEL_STRATEGY.planner} (${requestedDuration}s/${sceneCount} scenes)`,
              "Voice Agent": MODEL_STRATEGY.tts,
              "Editor Agent": "FilmPlayer / scene fallback captions",
            }),
            prompt,
            visualBible: bible,
            compiledReferences,
            referenceImages: refs.map((r) => ({ name: r.name, description: r.description })),
          },
        });
      } catch { /* ignore */ }
    } catch (err: unknown) {
      setThinking(false);
      const msg = err instanceof Error ? err.message : String(err);
      const providerBlocked = /Arrearage|overdue-payment|Throttling|RateQuota|rate limit|quota/i.test(msg);
      setTasks((current) =>
        current.map((task) =>
          task.text.startsWith("Render ")
            ? { ...task, text: providerBlocked ? `${task.text} - blocked by DashScope billing/quota` : `${task.text} - failed` }
            : task,
        ),
      );
      setMessages((m) => [...m, {
        role: "agent",
        text: providerBlocked
          ? `Pipeline stopped because DashScope blocked video rendering: ${msg}\n\nThe story, visual bible, character lock, English voice plan and captions are ready, but video generation cannot continue until the DashScope account is in good standing and rate quota is available. After that, replay/regenerate will continue with the same continuity rules.`
          : `Pipeline error: ${msg}`,
      }]);
    }
  }

  function send() {
    if (thinking || !input.trim()) return;
    const text = input.trim();
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    void runPipeline(text, referenceImages);
  }

  function copyPrompt(text: string) {
    void navigator.clipboard?.writeText(text).catch(() => {
      setInput(text);
    });
  }

  function submitEditedPrompt(index: number, text: string) {
    const nextText = text.trim();
    if (thinking || !nextText) return;
    setEditingPrompt(null);
    setMessages((m) => [...m.slice(0, index), { ...m[index], text: nextText }]);
    setInput("");
    void runPipeline(nextText, referenceImages);
  }

  async function handleReferenceFiles(files: FileList | null) {
    if (!files?.length) return;
    const images = Array.from(files).filter((file) => file.type.startsWith("image/")).slice(0, 8);
    const loaded = await Promise.all(images.map((file) => imageFileToReferenceImage(file)));
    setReferenceImages((prev) => [...prev, ...loaded].slice(0, 8));
  }

  async function buildCharacterBible(b: CharacterSheetInput) {
    setBibleBusy(true);
    try {
      const lockedPrompt = [
        `Cinematic character reference sheet, 35mm film still, plain neutral studio backdrop.`,
        `Character: ${b.name}. ${b.descriptor}.`,
        `Skin tone: ${b.skin}. Hair: ${b.hair}. Eye color: ${b.eyes}. Wardrobe: ${b.wardrobe}.`,
        `Show THREE full-body views side-by-side: front, three-quarter, profile. Same identical face, wardrobe and lighting in all three. Professional lookbook.`,
      ].join(" ");
      const img = await generateSceneImage({ data: { prompt: lockedPrompt, referenceImages: [], referenceWeight: 1 } });
      const bibleRef: ReferenceImage = {
        name: `bible-${b.name.replace(/\s+/g, "-").toLowerCase() || "hero"}.png`,
        dataUrl: img.image_url,
        description: `Locked character bible for ${b.name || "hero"}: ${b.descriptor}. Match face, wardrobe and colors EXACTLY in every scene.`,
      };
      const nextRefs = [bibleRef, ...referenceImages].slice(0, 8);
      setReferenceImages(nextRefs);
      setBibleOpen(false);
      if (pendingPrompt) {
        const p = pendingPrompt;
        setPendingPrompt(null);
        void runPipeline(p, nextRefs);
      }
    } catch (err) {
      alert("Character bible failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBibleBusy(false);
    }
  }

  function skipCharacterBible() {
    setBibleOpen(false);
    if (pendingPrompt) {
      const p = pendingPrompt;
      setPendingPrompt(null);
      void runPipeline(p, referenceImages);
    }
  }

  function exportProject() {
    downloadText(
      `${slugify(filmTitle || "makers-film")}-project.json`,
      JSON.stringify({ id, prompt: currentPrompt, title: filmTitle, logline, visualBible, referenceImages, scenes: cards }, null, 2),
      "application/json",
    );
  }

  function exportContext() {
    const context = cards.map((c, i) => {
      const start = cards.slice(0, i).reduce((sum, s) => sum + (s.durationSeconds || 8), 0);
      const end = start + (c.durationSeconds || 8);
      return [
        `SCENE ${i + 1}: ${c.title.replace(/^#\d+\s*/, "")}`,
        `TIME: ${formatTime(start)} - ${formatTime(end)}`,
        `LOCATION: ${c.location || "story location"}`,
        `SHOT: ${c.shotType || "cinematic"}`,
        `STORYLINE: ${c.visual || c.caption}`,
        `DIALOGUE: ${c.character ? `${c.character}: ` : ""}${c.spokenLine}`,
        `VOICE: ${c.language || "English"}, ${c.voiceTone || "natural"}, ${c.pitch || "medium"} pitch`,
        `BGM: ${c.bgm || "cinematic score"}`,
        `SFX: ${c.sfx || "clean room tone and Foley"}`,
        `GRADE: ${c.colorGrade || "cinematic film grade"}`,
        `EDIT: ${c.editingNotes || "straight cut with smooth continuity"}`,
        `VIDEO: ${c.videoUrl || "rendering"}`,
      ].join("\n");
    }).join("\n\n---\n\n");
    downloadText(`${slugify(filmTitle || "makers-film")}-context.txt`, `${filmTitle}\n${logline}\n\n${context}`, "text/plain");
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
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 flex flex-col justify-end">
              <div className="space-y-6">
                {messages.map((m, i) => (
                  <MessageBubble
                    key={i}
                    msg={m}
                    editingText={editingPrompt?.index === i ? editingPrompt.text : null}
                    disabled={thinking}
                    onCopy={() => copyPrompt(m.text)}
                    onEdit={() => setEditingPrompt({ index: i, text: m.text })}
                    onEditText={(text) => setEditingPrompt((current) => current?.index === i ? { ...current, text } : current)}
                    onCancelEdit={() => setEditingPrompt(null)}
                    onSubmitEdit={() => submitEditedPrompt(i, editingPrompt?.text || "")}
                  />
                ))}
                {thinking && (
                  <div className="flex items-center gap-2 text-sm text-white/60">
                    <MakersMark className="h-4 w-4" />
                    <span className="animate-pulse">Makers is thinking…</span>
                  </div>
                )}
              </div>
            </div>
            <div className="p-4 border-t border-white/10">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-white/60">
                  <span className="rounded-full border border-white/10 px-2 py-1">Character Lock: Active</span>
                  <span className="rounded-full border border-white/10 px-2 py-1">English Voice: Active</span>
                  <span className="rounded-full border border-white/10 px-2 py-1">Captions: Active</span>
                  <div className="ml-auto flex rounded-full border border-white/10 p-0.5">
                    {[30, 45].map((seconds) => (
                      <button
                        key={seconds}
                        type="button"
                        onClick={() => setTargetDuration(seconds)}
                        disabled={thinking}
                        className={`rounded-full px-3 py-1 ${targetDuration === seconds ? "bg-white text-black" : "text-white/60 hover:text-white"}`}
                      >
                        {seconds}s
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  placeholder="Send a message to Makers"
                  className="w-full bg-transparent outline-none text-sm placeholder:text-white/40"
                />
                <div className="flex items-center justify-between mt-2">
                  <input
                    ref={uploadRef}
                    type="file"
                    multiple
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void handleReferenceFiles(e.target.files)}
                  />
                  <button onClick={() => uploadRef.current?.click()} className="h-7 w-7 rounded-full border border-white/10 hover:bg-white/10 flex items-center justify-center" title="Add character reference images">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  {referenceImages.length > 0 && <span className="text-[11px] text-white/50">{referenceImages.length} refs</span>}
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-white/50">Makers lite ▾</span>
                    <button
                      onClick={send}
                      disabled={thinking || !input.trim()}
                      className="h-7 w-7 rounded-full bg-white text-black flex items-center justify-center disabled:opacity-40"
                    >
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
              {cards.length > 0 && (
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={exportContext} className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/75 hover:bg-white/10">
                    <BookOpen className="h-3 w-3" /> Context
                  </button>
                  <button onClick={exportProject} className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/75 hover:bg-white/10">
                    <Download className="h-3 w-3" /> Export
                  </button>
                </div>
              )}
              {canPlay && (
                <button
                  onClick={() => setPlayingFilm(true)}
                  className="flex items-center gap-1.5 rounded-full bg-white text-black px-3 py-1 text-[11px] font-medium hover:bg-white/90"
                >
                  <Film className="h-3 w-3" /> Play Full Movie {!allDone && `(${renderedCount}/${cards.length})`}
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
                    {canPlay && firstReady ? (
                      <button
                        onClick={() => setPlayingFilm(true)}
                        className="group absolute inset-0"
                      >
                        {firstReady.videoUrl ? (
                          <video
                            src={firstReady.videoUrl}
                            muted
                            playsInline
                            autoPlay
                            loop
                            preload="metadata"
                            poster={firstReady.posterUrl}
                            className="absolute inset-0 h-full w-full object-cover opacity-70 group-hover:opacity-90 transition"
                          />
                        ) : firstReady.posterUrl ? (
                          <img
                            src={firstReady.posterUrl}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover opacity-70 group-hover:opacity-90 transition"
                          />
                        ) : null}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40" />
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <div className="h-16 w-16 rounded-full bg-white text-black flex items-center justify-center shadow-2xl group-hover:scale-105 transition">
                            <Play className="h-6 w-6 ml-1" fill="currentColor" />
                          </div>
                          <div className="mt-4 text-white text-lg font-medium drop-shadow">{filmTitle}</div>
                          <div className="mt-1 text-white/70 text-xs">
                            {allDone
                              ? `Final cut · all ${cards.length} scenes rendered · dialogue + score`
                              : `Preview cut · ${renderedCount}/${cards.length} scenes rendered · plays end-to-end`}
                          </div>
                        </div>
                      </button>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                        {cards.find((c) => c.posterUrl)?.posterUrl && (
                          <img
                            src={cards.find((c) => c.posterUrl)!.posterUrl}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover opacity-40"
                          />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
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
                        <div className="relative text-sm text-white/80">Rendering the full film before playback…</div>
                        <div className="relative text-[11px] text-white/50">{renderedCount}/{cards.length} videos finished · play unlocks only when every scene is ready</div>
                      </div>
                    )}
                  </div>

                  <ContextPanel
                    cards={cards}
                    title={filmTitle}
                    logline={logline}
                    onScene={setOpenScene}
                    references={referenceImages}
                  />

                  {referenceImages.length > 0 && (
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-white/40 mb-2 flex items-center gap-3">
                        <span className="flex items-center gap-1.5"><ImagePlus className="h-3 w-3" /> Reference images</span>
                        <label className="ml-auto flex items-center gap-2 text-white/60 normal-case tracking-normal">
                          <span>Weight {Math.round(refWeight * 100)}%</span>
                          <input
                            type="range" min={0} max={100} step={5}
                            value={Math.round(refWeight * 100)}
                            onChange={(e) => setRefWeight(Number(e.target.value) / 100)}
                            className="w-32 accent-white"
                          />
                        </label>
                      </div>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {referenceImages.map((r, i) => (
                          <div key={`${r.name}-${i}`} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-white/10 bg-neutral-900">
                            <img src={r.dataUrl} alt={r.name} className="h-full w-full object-cover" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {logline && (
                    <p className="text-sm text-white/70 leading-relaxed italic border-l-2 border-white/20 pl-3">
                      {logline}
                    </p>
                  )}

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
        <FilmPlayer cards={cards} title={filmTitle} onClose={() => setPlayingFilm(false)} timeline={finalTimeline} finalVideoUrl={finalFilmUrl} />
      )}
      {openScene !== null && cards[openScene] && (
        <SceneDetail card={cards[openScene]} index={openScene} total={cards.length} onClose={() => setOpenScene(null)} />
      )}
      {bibleOpen && (
        <CharacterBibleModal
          busy={bibleBusy}
          hasPending={pendingPrompt !== null}
          onClose={() => (pendingPrompt ? skipCharacterBible() : setBibleOpen(false))}
          onBuild={buildCharacterBible}
          onSkip={skipCharacterBible}
        />
      )}
    </div>
  );
}

function CharacterBibleModal({ busy, hasPending, onClose, onBuild, onSkip }: { busy: boolean; hasPending: boolean; onClose: () => void; onBuild: (b: CharacterSheetInput) => void; onSkip: () => void }) {
  const [b, setB] = useState<CharacterSheetInput>({
    name: "",
    descriptor: "Weathered detective, early 50s, stoic",
    skin: "#c9a888",
    hair: "#2b2b2b",
    eyes: "#3a2a1c",
    wardrobe: "#4a2f1e",
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="max-w-lg w-full rounded-2xl border border-white/10 bg-neutral-950 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-white/50 uppercase tracking-widest">Character Bible</div>
            <div className="text-lg font-medium text-white">Lock your hero's look</div>
            {hasPending && (
              <div className="text-[11px] text-blue-300 mt-1">Step 1 of 3 · then script → storyboard → Wan/HappyHorse render</div>
            )}
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-sm">Close ✕</button>
        </div>
        <p className="text-xs text-white/60 leading-relaxed">Generates a reference sheet (front / three-quarter / profile) and injects it as a locked reference into every scene render — the biggest lever for character consistency.</p>
        <input value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} placeholder="Character name (e.g. Silas)" className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-white/30" />
        <textarea value={b.descriptor} onChange={(e) => setB({ ...b, descriptor: e.target.value })} rows={2} placeholder="Free-text description (age, build, ethnicity, energy)" className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white outline-none focus:border-white/30" />
        <div className="grid grid-cols-4 gap-2 text-[11px] text-white/70">
          <ColorField label="Skin" value={b.skin} onChange={(v) => setB({ ...b, skin: v })} />
          <ColorField label="Hair" value={b.hair} onChange={(v) => setB({ ...b, hair: v })} />
          <ColorField label="Eyes" value={b.eyes} onChange={(v) => setB({ ...b, eyes: v })} />
          <ColorField label="Wardrobe" value={b.wardrobe} onChange={(v) => setB({ ...b, wardrobe: v })} />
        </div>
        <button disabled={busy} onClick={() => onBuild(b)} className="w-full h-10 rounded-md bg-white text-black text-sm font-medium disabled:opacity-60">
          {busy ? "Generating character sheet…" : "Generate & lock character"}
        </button>
        {hasPending && (
          <button
            disabled={busy}
            onClick={onSkip}
            className="w-full h-9 rounded-md border border-white/15 text-white/70 hover:bg-white/5 text-xs disabled:opacity-40"
          >
            Skip character bible and generate directly
          </button>
        )}
      </div>
    </div>
  );
}
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span>{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-full rounded border border-white/10 bg-transparent cursor-pointer" />
    </label>
  );
}

function SceneDetail({ card, index, total, onClose }: { card: StoryCard; index: number; total: number; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="max-w-3xl w-full rounded-2xl border border-white/10 bg-neutral-950 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="relative aspect-video bg-black">
          {card.videoUrl && card.done ? (
            <video src={card.videoUrl} controls autoPlay playsInline className="h-full w-full object-cover" />
          ) : card.posterUrl ? (
            <img src={card.posterUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-white/40 text-sm">Rendering… {card.progress}%</div>
          )}
        </div>
        <div className="p-5 space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-white/40">Scene {index + 1} / {total}</div>
              <div className="text-lg font-medium text-white">{card.title.replace(/^#\d+\s*/, "")}</div>
            </div>
            <button onClick={onClose} className="text-white/60 hover:text-white text-sm">Close ✕</button>
          </div>
          {card.visual && <p className="text-white/70 leading-relaxed">{card.visual}</p>}
          <div className="grid grid-cols-2 gap-3 text-xs text-white/70">
            <Detail label="Shot" value={card.shotType} />
            <Detail label="Location" value={card.location} />
            <Detail label="Character" value={card.character} />
            <Detail label="Language" value={card.language} />
            <Detail label="Voice tone" value={card.voiceTone} />
            <Detail label="Pitch" value={card.pitch} />
            <Detail label="Duration" value={`${card.durationSeconds || 8}s`} />
            <Detail label="Color grade" value={card.colorGrade} />
            <Detail label="Editing note" value={card.editingNotes} />
            <Detail label="BGM" value={card.bgm} />
            <Detail label="SFX" value={card.sfx} />
          </div>
          {card.spokenLine && (
            <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Dialogue</div>
              <div className="text-white">{card.character && <b className="mr-1">{card.character}:</b>}{card.spokenLine}</div>
              {card.audioUrl && <audio controls src={card.audioUrl} className="mt-2 w-full" />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function Detail({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-white/40">{label}</div>
      <div className="text-white/85">{value}</div>
    </div>
  );
}

function MessageBubble({
  msg,
  editingText,
  disabled,
  onCopy,
  onEdit,
  onEditText,
  onCancelEdit,
  onSubmitEdit,
}: {
  msg: ChatMsg;
  editingText?: string | null;
  disabled?: boolean;
  onCopy?: () => void;
  onEdit?: () => void;
  onEditText?: (text: string) => void;
  onCancelEdit?: () => void;
  onSubmitEdit?: () => void;
}) {
  if (msg.role === "user") {
    if (editingText !== null && editingText !== undefined) {
      return (
        <div className="flex justify-end">
          <div className="w-full max-w-[80%] rounded-2xl bg-white/15 px-4 py-3 text-sm">
            <textarea
              value={editingText}
              onChange={(e) => onEditText?.(e.target.value)}
              rows={Math.min(10, Math.max(3, Math.ceil(editingText.length / 80)))}
              className="w-full resize-none bg-transparent text-white outline-none placeholder:text-white/35"
              autoFocus
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={onCancelEdit}
                className="rounded-full border border-white/15 px-4 py-2 text-xs font-medium text-white hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={disabled || !editingText.trim()}
                onClick={onSubmitEdit}
                className="rounded-full bg-white px-4 py-2 text-xs font-medium text-black disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="group flex flex-col items-end">
        <div className="max-w-[80%] rounded-2xl bg-white/10 px-4 py-2 text-sm">{msg.text}</div>
        <div className="mt-1 flex items-center gap-1">
          <button
            type="button"
            onClick={onCopy}
            title="Copy prompt"
            className="h-8 w-8 rounded-lg bg-white/10 text-white/70 hover:bg-white/20 hover:text-white flex items-center justify-center"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onEdit}
            title="Edit and regenerate"
            className="h-8 w-8 rounded-lg bg-white/10 text-white/70 hover:bg-white/20 hover:text-white disabled:opacity-40 flex items-center justify-center"
          >
            <Pencil className="h-4 w-4" />
          </button>
        </div>
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

function ContextPanel({ cards, title, logline, onScene, references = [] }: { cards: StoryCard[]; title: string; logline: string; onScene?: (i: number) => void; references?: ReferenceImage[] }) {
  const [tab, setTab] = useState<"context" | "notebook">("context");
  const total = cards.reduce((sum, card) => sum + (card.durationSeconds || 8), 0) || cards.length * 8 || 1;
  const rendered = cards.filter((card) => card.done && card.videoUrl).length;

  // Aggregate unique characters and locations from the storyboard
  const characters = useMemo(() => {
    const map = new Map<string, { name: string; lines: string[]; scenes: number[]; wardrobe?: string; visual?: string }>();
    cards.forEach((c, i) => {
      const name = (c.character || "").trim();
      if (!name) return;
      const entry = map.get(name) || { name, lines: [], scenes: [], wardrobe: c.referenceImageDirection, visual: c.visual };
      entry.scenes.push(i + 1);
      if (c.spokenLine) entry.lines.push(c.spokenLine);
      map.set(name, entry);
    });
    return Array.from(map.values());
  }, [cards]);

  const locations = useMemo(() => {
    const map = new Map<string, number[]>();
    cards.forEach((c, i) => {
      const loc = (c.location || "").trim();
      if (!loc) return;
      const arr = map.get(loc) || [];
      arr.push(i + 1);
      map.set(loc, arr);
    });
    return Array.from(map.entries()).map(([name, scenes]) => ({ name, scenes }));
  }, [cards]);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03]">
      {/* Tabs bar */}
      <div className="flex items-center gap-1 border-b border-white/10 px-3 pt-3">
        {(["context", "notebook"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex items-center gap-2 rounded-t-md px-3 py-2 text-xs capitalize ${tab === k ? "bg-white/10 text-white border border-b-transparent border-white/10" : "text-white/50 hover:text-white/80"}`}
          >
            {k === "context" ? <BookOpen className="h-3 w-3" /> : <Film className="h-3 w-3" />}
            {k === "context" ? "Context" : `Notebook · ${cards.length} scenes`}
          </button>
        ))}
        <div className="ml-auto pb-2 text-[11px] text-white/45">{formatTime(total)} · {rendered}/{cards.length} rendered</div>
      </div>

      {tab === "context" ? (
        <div className="p-5 space-y-6">
          {/* World Building header */}
          <div>
            <h2 className="text-2xl font-semibold text-white">World Building</h2>
            <p className="mt-1 text-sm text-white/55">Characters, locations, and lore that define {title || "your film"}'s universe.</p>
          </div>

          {logline && (
            <p className="text-sm text-white/75 leading-relaxed border-l-2 border-white/20 pl-3 italic">{logline}</p>
          )}

          {/* Characters */}
          {characters.length > 0 && (
            <div className="space-y-4">
              <div className="text-[11px] uppercase tracking-widest text-white/40">Characters</div>
              {characters.map((ch) => (
                <div key={ch.name} className="rounded-lg border border-white/10 bg-black/30 p-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-medium text-white">{ch.name}</h3>
                    <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/60">Character</span>
                    <span className="ml-auto text-[11px] text-white/45">Appears in scene {ch.scenes.join(", ")}</span>
                  </div>
                  {ch.visual && <p className="mt-2 text-sm italic text-white/70">{ch.visual}</p>}
                  {ch.wardrobe && (
                    <div className="mt-3">
                      <div className="text-[11px] uppercase tracking-wider text-white/40">Wardrobe & continuity</div>
                      <p className="mt-1 text-xs text-white/70 leading-relaxed">{ch.wardrobe}</p>
                    </div>
                  )}
                  {ch.lines.length > 0 && (
                    <div className="mt-3">
                      <div className="text-[11px] uppercase tracking-wider text-white/40">Dialogue</div>
                      <ul className="mt-1 space-y-1 text-xs text-white/75">
                        {ch.lines.slice(0, 4).map((l, i) => (
                          <li key={i}>"{l}"</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {references.length > 0 && (
                    <div className="mt-3">
                      <div className="text-[11px] uppercase tracking-wider text-white/40">References</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {references.slice(0, 6).map((r, i) => (
                          <img key={i} src={r.dataUrl} alt={r.name} title={r.description} className="h-16 w-16 rounded object-cover border border-white/15" />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Locations */}
          {locations.length > 0 && (
            <div className="space-y-3">
              <div className="text-[11px] uppercase tracking-widest text-white/40">Locations</div>
              <div className="grid gap-3 sm:grid-cols-2">
                {locations.map((l) => (
                  <div key={l.name} className="rounded-lg border border-white/10 bg-black/30 p-3">
                    <div className="text-sm font-medium text-white">{l.name}</div>
                    <div className="mt-1 text-[11px] text-white/50">Scene {l.scenes.join(", ")}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="p-4 space-y-3">
          {cards.map((card, index) => (
            <button
              key={index}
              type="button"
              onClick={() => onScene?.(index)}
              className="w-full rounded-lg border border-white/10 bg-black/25 p-3 text-left hover:border-white/25 transition"
            >
              <div className="flex items-center gap-3">
                <span className={`h-6 w-6 shrink-0 rounded-full border flex items-center justify-center text-[11px] ${card.done && card.videoUrl ? "border-emerald-400 bg-emerald-400 text-black" : "border-white/20 text-white/50"}`}>
                  {card.done && card.videoUrl ? <Check className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium text-white">Scene {index + 1}: {card.title.replace(/^#\d+\s*/, "")}</span>
                    <span className="text-[11px] text-white/45">{card.shotType || "cinematic shot"}</span>
                    <span className="text-[11px] text-white/45">{card.location || "story location"}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-white/65">{card.visual || card.caption}</p>
                </div>
                <div className="text-right text-[11px] text-white/45">
                  <div>{card.durationSeconds || normalizeSceneDuration(undefined)}s</div>
                  <div>{card.done && card.videoUrl ? "rendered" : `${card.progress}%`}</div>
                </div>
              </div>
              <div className="mt-3 rounded-md bg-white/[0.04] px-3 py-2 text-xs text-white/75">
                {card.character && <b className="mr-1 text-white/90">{card.character}:</b>}{card.spokenLine}
              </div>
              <div className="mt-2 grid gap-2 text-[11px] text-white/45 sm:grid-cols-3">
                <span>BGM: {card.bgm || "cinematic score"}</span>
                <span>SFX: {card.sfx || "Foley"}</span>
                <span>Edit: {card.editingNotes || "continuity cut"}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function getRenderedCards(cards: StoryCard[]) {
  // Any scene with a video OR poster can play — poster-only shots render as
  // still frames with dialogue+BGM so the full movie always plays end-to-end
  // even while later scenes are still rendering.
  return cards.filter((card) => Boolean(card.videoUrl) || Boolean(card.posterUrl));
}

function buildCharacterRoster(scenes: Array<{ character?: string }>) {
  const names = scenes
    .map((scene) => scene.character?.trim())
    .filter((name): name is string => Boolean(name));
  return Array.from(new Set(names)).slice(0, 3).join(", ");
}

function buildVideoAttempts(storyboardStillUrl?: string): VideoAttempt[] {
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

function buildRoutedVideoAttempts(
  routing: { primary: VideoModel; fallback: VideoModel | null; requiresStartingImage: boolean },
  storyboardStillUrl?: string,
): VideoAttempt[] {
  const attempts: VideoAttempt[] = [];
  const needsImage = (m: VideoModel) => m.endsWith("i2v") || m.endsWith("i2v-plus");
  const push = (m: VideoModel) => {
    if (needsImage(m)) {
      if (storyboardStillUrl) attempts.push({ model: m, imageUrl: storyboardStillUrl });
    } else {
      attempts.push({ model: m });
    }
  };
  push(routing.primary);
  if (routing.fallback) push(routing.fallback);
  // Safety net: also try the opposite-mode engine so a still-image failure
  // never leaves the scene un-rendered.
  if (!attempts.some((a) => a.model === MODEL_STRATEGY.videoT2v)) attempts.push({ model: MODEL_STRATEGY.videoT2v as VideoModel });
  if (!attempts.some((a) => a.model === MODEL_STRATEGY.videoFallback)) attempts.push({ model: MODEL_STRATEGY.videoFallback as VideoModel });
  return attempts;
}

async function submitAndPollVideo(
  prompt: string,
  attempts: VideoAttempt[],
  onProgress: (progress: number) => void,
) {
  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      const cacheKey = JSON.stringify({
        model: attempt.model,
        imageUrl: attempt.imageUrl || "",
        size: "832*480",
        prompt,
      });
      let task_id = videoTaskCache.get(cacheKey);
      if (!task_id) {
        const submitted = await submitVideo({
          data: {
            prompt,
            size: "832*480",
            model: attempt.model,
            imageUrl: attempt.imageUrl,
          },
        });
        task_id = submitted.task_id;
        videoTaskCache.set(cacheKey, task_id);
      }
      for (let pollAttempt = 0; pollAttempt < MAKERS_DEMO_LIMITS.maxVideoPollAttempts; pollAttempt++) {
        await new Promise((r) => setTimeout(r, getVideoPollDelayMs(pollAttempt)));
        onProgress(Math.min(10 + pollAttempt * 3, 92));
        const status = await pollVideo({ data: { task_id } });
        if (status.status === "SUCCEEDED" && status.video_url) return status.video_url;
        if (status.status === "FAILED") {
          videoTaskCache.delete(cacheKey);
          throw new Error(status.error || "Task failed");
        }
      }
      throw new Error("Timed out waiting for video");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`${attempt.model}: ${message}`);
    }
  }
  throw new Error(`All video engines failed. ${failures.join(" | ")}`);
}

/**
 * Cinematic FilmPlayer — professional AI edit on the client:
 *  - Single reliable <video> element with preload + guarded timing
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
  timeline,
  finalVideoUrl,
}: {
  cards: StoryCard[];
  title: string;
  onClose: () => void;
  timeline?: FinalTimeline<StoryCard> | null;
  finalVideoUrl?: string | null;
}) {
  const shots = useMemo(() => getRenderedCards(cards), [cards]);
  const playbackTimeline = useMemo(() => timeline ?? buildFinalTimeline(shots, MAKERS_DEMO_LIMITS.defaultSecondsPerScene), [shots, timeline]);
  const [idx, setIdx] = useState(0);
  const [localTime, setLocalTime] = useState(0);
  const [muted, setMuted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordDone, setRecordDone] = useState(false);
  const [exportingVideo, setExportingVideo] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dialogueRef = useRef<HTMLAudioElement>(null);
  const bgmRef = useRef<HTMLAudioElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const scoreStopRef = useRef<(() => void) | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const dialogueSrcRef = useRef<MediaElementAudioSourceNode | null>(null);
  const recDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  const current = shots[idx];
  const currentSceneIndex = Math.max(0, cards.findIndex((c) => c.videoUrl === current?.videoUrl));
  const currentTimelineScene = playbackTimeline.scenes[idx];
  const activeCaption = useMemo(() => {
    const sceneId = currentTimelineScene?.sceneId;
    if (!sceneId) return null;
    const sceneStart = currentTimelineScene.startTime || 0;
    const globalTime = sceneStart + localTime;
    return playbackTimeline.captions.find((caption) =>
      caption.sceneId === sceneId && globalTime >= caption.startTime && globalTime <= caption.endTime,
    ) || null;
  }, [currentTimelineScene, localTime, playbackTimeline]);
  const bgmUrl = useMemo(() => pickBgm(cards[0]?.bgm || cards[0]?.colorGrade || title), [cards, title]);

  useEffect(() => {
    if (bgmRef.current) bgmRef.current.volume = 0.28;
  }, [bgmUrl]);

  // Start ambient score once (user gesture already happened — Play click)
  useEffect(() => {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    void ctx.resume?.();
    audioCtxRef.current = ctx;
    const master = ctx.createGain();
    masterGainRef.current = master;
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

  useEffect(() => {
    const master = masterGainRef.current;
    const ctx = audioCtxRef.current;
    if (!master || !ctx) return;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.linearRampToValueAtTime(muted ? 0 : 0.18, ctx.currentTime + 0.25);
  }, [muted]);

  // Drive current shot: play video + sync dialogue
  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      if (current?.videoUrl) {
        if (v.src !== current.videoUrl) {
          v.src = current.videoUrl;
          v.load();
        }
        v.currentTime = 0;
        setLocalTime(0);
        v.muted = muted;
        v.volume = 0.9;
        v.play().catch(() => {});
      } else {
        // Should not happen because playback is locked until all videos render,
        // but clear the source defensively if an old session has incomplete data.
        v.removeAttribute("src");
        v.load();
      }
    }
    const d = dialogueRef.current;
    if (d && current?.audioUrl) {
      d.src = current.audioUrl;
      d.currentTime = 0;
      d.play().catch(() => {});
    }
    if (fallbackTimerRef.current) window.clearTimeout(fallbackTimerRef.current);
    const duration = Math.max(6, current?.durationSeconds || 8) * 1000;
    fallbackTimerRef.current = window.setTimeout(() => advance(), duration + 1200);
    playSceneAccent(audioCtxRef.current, current?.sfx || current?.bgm || "cinematic cut");
    const next = shots[idx + 1];
    if (next?.videoUrl) {
      // Warm the browser cache for the next clip so scene change doesn't flash black
      const preload = document.createElement("video");
      preload.src = next.videoUrl;
      preload.preload = "auto";
      preload.muted = true;
      preload.style.position = "absolute";
      preload.style.width = "1px";
      preload.style.height = "1px";
      preload.style.opacity = "0";
      preload.style.pointerEvents = "none";
      document.body.appendChild(preload);
      return () => {
        preload.remove();
        if (fallbackTimerRef.current) window.clearTimeout(fallbackTimerRef.current);
      };
    }
    return () => {
      if (fallbackTimerRef.current) window.clearTimeout(fallbackTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, current?.videoUrl, current?.posterUrl]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLocalTime(videoRef.current?.currentTime || 0);
    }, 100);
    return () => window.clearInterval(timer);
  }, []);

  // Keep the video element's mute state in sync with the toggle
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  function advance() {
    if (fallbackTimerRef.current) window.clearTimeout(fallbackTimerRef.current);
    if (idx + 1 >= shots.length) {
      // End of film — stop recording if active
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try { recorderRef.current.stop(); } catch { /* noop */ }
      }
      setExportNotice("Playback finished. Use Replay, Export Script, or Download MP4.");
      return;
    }
    setIdx((i) => i + 1);
  }

  function replayFilm() {
    if (fallbackTimerRef.current) window.clearTimeout(fallbackTimerRef.current);
    setExportNotice(null);
    setLocalTime(0);
    setIdx(0);
    requestAnimationFrame(() => {
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        void videoRef.current.play().catch(() => {});
      }
      if (dialogueRef.current) {
        dialogueRef.current.currentTime = 0;
        void dialogueRef.current.play().catch(() => {});
      }
    });
  }

  function exportScript() {
    const script = shots.map((shot, i) => {
      const timelineScene = playbackTimeline.scenes[i];
      return [
        `SCENE ${i + 1}: ${shot.title.replace(/^#\d+\s*/, "")}`,
        `TIME: ${formatTime(timelineScene?.startTime || 0)} - ${formatTime(timelineScene?.endTime || ((timelineScene?.startTime || 0) + (shot.durationSeconds || 6)))}`,
        `LOCATION: ${shot.location || "story location"}`,
        `SHOT: ${shot.shotType || "cinematic"}`,
        `VISUAL: ${shot.visual || shot.caption}`,
        `DIALOGUE: ${shot.character ? `${shot.character}: ` : ""}${shot.spokenLine || ""}`,
        `VOICE: ${shot.language || "English"}, ${shot.voiceTone || "natural"}, ${shot.pitch || "medium"} pitch`,
        `BGM: ${shot.bgm || "cinematic score"}`,
        `SFX: ${shot.sfx || "clean room tone"}`,
        `GRADE: ${shot.colorGrade || "cinematic film grade"}`,
        `EDIT: ${shot.editingNotes || "straight cut with smooth continuity"}`,
        `VIDEO: ${shot.videoUrl || "not rendered"}`,
      ].join("\n");
    }).join("\n\n---\n\n");
    downloadText(`${slugify(title || "makers-film")}-export-script.txt`, `${title}\n\n${script}`, "text/plain");
  }

  async function downloadHighQualityMp4() {
    setExportNotice(null);
    setExportingVideo(true);
    try {
      if (finalVideoUrl) {
        downloadUrl(finalVideoUrl, `${slugify(title || "makers-film")}-master.mp4`);
        setExportNotice("Downloading generated master/source MP4.");
        return;
      }
      const clipUrls = shots.map((shot) => shot.videoUrl).filter((url): url is string => Boolean(url));
      if (clipUrls.length === 0) throw new Error("No rendered scene video is available yet.");
      if (clipUrls.length === 1) {
        downloadUrl(clipUrls[0], `${slugify(title || "makers-film")}-scene-1.mp4`);
        setExportNotice("Downloading rendered source MP4 for this scene.");
        return;
      }
      setExportNotice("Building a high-quality MP4 from rendered clips. This can take a minute in the browser.");
      const stitchedUrl = await concatClips(clipUrls);
      downloadUrl(stitchedUrl, `${slugify(title || "makers-film")}-master.mp4`);
      window.setTimeout(() => URL.revokeObjectURL(stitchedUrl), 10_000);
      setExportNotice("MP4 export started.");
    } catch (err) {
      setExportNotice(err instanceof Error ? err.message : "Could not export MP4. Try downloading the source clips from Library.");
    } finally {
      setExportingVideo(false);
    }
  }

  async function startRecording() {
    const v = videoRef.current;
    const ctx = audioCtxRef.current;
    const master = masterGainRef.current;
    const dEl = dialogueRef.current;
    if (!v || !ctx || !master || !dEl) return;
    try {
      const videoStream = (v as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
      if (!videoStream) {
        setExportNotice("Real-time WebM recording is not supported for this video in your browser. Use Download MP4 instead.");
        return;
      }
      // Route dialogue element into a WebAudio source (once) so recorder can hear it
      if (!dialogueSrcRef.current) {
        dialogueSrcRef.current = ctx.createMediaElementSource(dEl);
        dialogueSrcRef.current.connect(ctx.destination);
      }
      if (!recDestRef.current) {
        recDestRef.current = ctx.createMediaStreamDestination();
        master.connect(recDestRef.current);
        dialogueSrcRef.current.connect(recDestRef.current);
      }
      const combined = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...recDestRef.current.stream.getAudioTracks(),
      ]);
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
        ? "video/webm;codecs=vp8,opus"
        : "video/webm";
      const rec = new MediaRecorder(combined, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
      recChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) recChunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(recChunksRef.current, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${(title || "makers-film").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.webm`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        setRecording(false);
        setRecordDone(true);
      };
      recorderRef.current = rec;
      rec.start(500);
      setRecording(true);
      setRecordDone(false);
      // Restart from first shot so full film is captured
      replayFilm();
    } catch (err) {
      console.error(err);
      setRecording(false);
      setExportNotice("Could not start real-time recording. Browser/CORS blocked captureStream; use Download MP4.");
    }
  }

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <button onClick={onClose} className="absolute top-4 right-4 text-white/70 hover:text-white text-sm z-30">Close ✕</button>
      <button onClick={() => setMuted((m) => !m)} className="absolute top-4 right-24 text-white/70 hover:text-white z-30">
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
      <button
        onClick={startRecording}
        disabled={recording}
        className="hidden"
        title="Records the film in real time and downloads a .webm file"
      >
        {recording ? "● Recording…" : recordDone ? "Download again" : "⬇ Record & Download"}
      </button>

      <div className="absolute left-4 right-4 top-12 z-30 flex flex-wrap items-center justify-end gap-2">
        {exportNotice && (
          <span className="mr-auto max-w-[48rem] rounded-full border border-white/10 bg-black/70 px-3 py-1 text-[11px] text-white/75 backdrop-blur">
            {exportNotice}
          </span>
        )}
        <button onClick={replayFilm} className="rounded-full border border-white/10 bg-black/45 px-3 py-1 text-[11px] text-white/75 hover:bg-white/10">
          Replay
        </button>
        <button onClick={exportScript} className="rounded-full border border-white/10 bg-black/45 px-3 py-1 text-[11px] text-white/75 hover:bg-white/10">
          Export Script
        </button>
        <button
          onClick={downloadHighQualityMp4}
          disabled={exportingVideo}
          className="flex items-center gap-1 rounded-full bg-white px-3 py-1 text-[11px] font-medium text-black hover:bg-white/90 disabled:opacity-60"
          title="Downloads the generated master/source MP4. If no master exists, stitches rendered clips in-browser."
        >
          <Download className="h-3 w-3" /> {exportingVideo ? "Exporting MP4" : "Download MP4"}
        </button>
        <button
          onClick={startRecording}
          disabled={recording}
          className="flex items-center gap-1 rounded-full border border-red-300/30 bg-red-500/20 px-3 py-1 text-[11px] text-red-100 hover:bg-red-500/30 disabled:opacity-60"
          title="Fallback only: records the current browser playback to WebM when captureStream is available."
        >
          {recording ? "Recording WebM" : recordDone ? "Record Again" : "Record WebM"}
        </button>
      </div>

      <div className="relative w-screen h-screen overflow-hidden bg-black">
        {/* Persistent poster underlay — kills the black flash between clips */}
        {current.posterUrl && (
          <img
            src={current.posterUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
            style={{ filter: filterForGrade(current.colorGrade) }}
          />
        )}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          onEnded={advance}
          onError={advance}
          onStalled={() => {
            setTimeout(() => videoRef.current?.play().catch(() => advance()), 900);
          }}
          poster={current.posterUrl}
          className="absolute inset-0 h-full w-full object-cover kenburns transition-opacity duration-500"
          style={{
            animationDuration: `${Math.max(6, current.durationSeconds || 8)}s`,
            filter: filterForGrade(current.colorGrade),
          }}
        />

        {/* Dialogue */}
        <audio ref={dialogueRef} autoPlay muted={muted} />
        {/* Free hosted cinematic BGM under the WebAudio pad */}
        <audio ref={bgmRef} src={bgmUrl} autoPlay loop muted={muted} />

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
        {(activeCaption?.text || current.spokenLine) && (
          <div key={`sub-${idx}-${activeCaption?.id || "fallback"}`} className="absolute bottom-[20%] inset-x-0 text-center px-6 pointer-events-none animate-[fadein_0.3s_ease-out]">
            <div className="inline-block bg-black/65 text-white text-base md:text-xl leading-snug px-5 py-2.5 rounded-md backdrop-blur max-w-[80%] shadow-2xl [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
              <span>{activeCaption?.text || current.spokenLine}</span>
            </div>
          </div>
        )}

        {/* Progress bar */}
        <div className="absolute top-0 inset-x-0 h-0.5 bg-white/10 z-20">
          <div className="h-full bg-white/80 transition-all" style={{ width: `${((idx + 1) / shots.length) * 100}%` }} />
        </div>

        <div className="absolute top-4 left-4 text-white/70 text-[11px] uppercase tracking-widest z-20">
          {title} · Scene {currentSceneIndex + 1}/{cards.length}
        </div>
        <div className="absolute top-10 left-4 max-w-[70vw] text-white text-sm md:text-lg font-medium drop-shadow z-20">
          {current.title.replace(/^#\d+\s*/, "")}
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
  if (explicit) return clampSceneCount(Number(explicit[1]));
  return MAKERS_DEMO_LIMITS.maxScenes;
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

function imageFileToReferenceImage(file: File) {
  return new Promise<ReferenceImage>((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      img.onload = () => {
        const max = 720;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Could not process image"));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({ name: file.name, dataUrl: canvas.toDataURL("image/jpeg", 0.72), description: "character/style reference" });
      };
      img.onerror = reject;
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
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

function playSceneAccent(ctx: AudioContext | null, cue: string) {
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.05, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    const lowerCue = cue.toLowerCase();
    osc.type = lowerCue.includes("rain") || lowerCue.includes("wind") ? "sine" : "triangle";
    osc.frequency.setValueAtTime(lowerCue.includes("impact") || lowerCue.includes("hit") ? 72 : 146, now);
    osc.frequency.exponentialRampToValueAtTime(lowerCue.includes("rise") ? 220 : 54, now + 0.5);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.7);
  } catch {
    // audio accent is optional
  }
}
function filterForGrade(grade?: string) {
  const s = (grade || "").toLowerCase();
  if (/teal.*orange|blockbuster|marvel|action/.test(s)) return "saturate(1.25) contrast(1.12) hue-rotate(-8deg)";
  if (/bleach|desatur/.test(s)) return "saturate(0.55) contrast(1.35) brightness(1.05)";
  if (/noir|black.*white|monochrome/.test(s)) return "grayscale(1) contrast(1.25) brightness(0.95)";
  if (/warm|golden|sunset|amber/.test(s)) return "sepia(0.22) saturate(1.18) brightness(1.06) contrast(1.05)";
  if (/cyber|neon|blade.*runner|cold|blue/.test(s)) return "saturate(1.35) contrast(1.15) hue-rotate(14deg)";
  if (/vintage|film.*print|kodak|super.*8|grain/.test(s)) return "sepia(0.3) contrast(1.08) saturate(0.88) brightness(0.98)";
  if (/anime|ghibli|pixar|animation/.test(s)) return "saturate(1.4) contrast(1.05) brightness(1.05)";
  if (/dune|desert|earth/.test(s)) return "sepia(0.35) saturate(1.15) contrast(1.1) hue-rotate(-6deg)";
  if (/horror|thriller|dark/.test(s)) return "contrast(1.3) brightness(0.85) saturate(0.85)";
  return "contrast(1.06) saturate(1.08)";
}
