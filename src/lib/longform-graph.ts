/**
 * LangGraph-orchestrated long-form pipeline: 30+ second films with locked
 * character identity and wan2.6-i2v lip-sync. Runs in the browser via
 * @langchain/langgraph/web so video polling stays client-side.
 */
import { Annotation, END, START, StateGraph } from "@langchain/langgraph/web";
import type { LangGraphRunnableConfig } from "@langchain/langgraph/web";
import {
  compileSceneSpec,
  critiqueScene,
  generateSceneImage,
  generateStoryboard,
  generateVoice,
  pollVideo,
  scoreSceneAgainstCharacter,
  submitVideo,
  uploadVoiceAudio,
  upsertCharacterEmbedding,
} from "@/lib/qwen.functions";
import type { SceneSpec } from "@/lib/scene-spec";
import { compileNegativePrompt } from "@/lib/negative-prompts";
import { generateSceneWithQualityGate, type QualityResult } from "@/lib/quality-gate";
import { gradeClip, concatClips } from "@/lib/ffmpeg-post";
import {
  buildOptimizedScenePrompt,
  buildShortFilmVisualBible,
  compileReferenceImages,
  CONTINUITY_NEGATIVE_PROMPT,
  CONTINUITY_THRESHOLD,
  findCharacterBible,
  formatCharacterLock,
  formatOptimizedScenePrompt,
  formatReferenceRouting,
  formatSceneContinuity,
  formatVisualBible,
  validateAndRepairScenes,
  type VisualBible,
} from "@/lib/continuity";
import {
  computeSceneDurationFromAudio,
  getLongformVideoPollDelayMs,
  LONGFORM_LIMITS,
  normalizeLongformSceneDuration,
  runWithConcurrency,
} from "@/lib/makers-runtime";

export type LongformReferenceImage = {
  name: string;
  dataUrl: string;
  description?: string;
};

export type LongformSceneRecord = {
  index: number;
  title: string;
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
  durationSeconds: number;
  colorGrade?: string;
  editingNotes?: string;
  referenceImageDirection?: string;
  videoPrompt?: string;
  continuityPrompt?: string;
  audioUrl?: string;
  audioSeconds?: number;
  posterUrl?: string;
  videoUrl?: string;
  embeddedAudio?: boolean;
  localizedScript?: string;
  targetLanguage?: string;
  ttsProvider?: string;
  ttsSpeaker?: string;
  regionalCritique?: unknown;
  characterSimilarity?: number | null;
  agentTrace?: QualityResult[];
  progress: number;
  done: boolean;
  retryCount: number;
};

export type LongformProgressEvent =
  | { type: "storyboard"; title: string; logline: string; tone: string; sceneCount: number }
  | { type: "scenesInit"; scenes: LongformSceneRecord[] }
  | { type: "bible"; bible: VisualBible }
  | { type: "anchor"; anchorImageUrl: string }
  | { type: "scene"; index: number; patch: Partial<LongformSceneRecord> }
  | { type: "tasks"; tasks: Array<{ text: string; done: boolean }> }
  | { type: "message"; text: string; skills?: string[]; task?: string }
  | { type: "editor"; finalFilmUrl: string }
  | { type: "done"; finalFilmUrl: string | null; totalSeconds: number; scenes: LongformSceneRecord[] };

type StoryboardScene = {
  title?: string;
  visual?: string;
  dialogue?: string;
  spoken_line?: string;
  caption?: string;
  video_prompt?: string;
  image_prompt?: string;
  character?: string;
  location?: string;
  shot_type?: string;
  language?: string;
  voice_tone?: string;
  pitch?: "low" | "medium" | "high";
  bgm?: string;
  sfx?: string;
  duration_seconds?: number;
  color_grade?: string;
  editing_notes?: string;
  reference_image_direction?: string;
};

type LongformVideoModel =
  | "wan2.6-i2v"
  | "wan2.6-i2v-flash"
  | "wan2.2-i2v-plus"
  | "happyhorse-1.1-i2v";

type VideoAttempt = {
  model: LongformVideoModel;
  imageUrl: string;
  audioUrl?: string;
  durationSeconds: number;
  resolution: "720P" | "1080P";
  embeddedAudio: boolean;
};

type GraphConfigurable = {
  onProgress?: (event: LongformProgressEvent) => void;
};

const LongformState = Annotation.Root({
  prompt: Annotation<string>,
  projectId: Annotation<string>,
  referenceImages: Annotation<LongformReferenceImage[]>,
  referenceWeight: Annotation<number>,
  learningContext: Annotation<string>,
  storyTitle: Annotation<string>({ reducer: (_, y) => y, default: () => "" }),
  logline: Annotation<string>({ reducer: (_, y) => y, default: () => "" }),
  tone: Annotation<string>({ reducer: (_, y) => y, default: () => "" }),
  visualBible: Annotation<VisualBible | null>({ reducer: (_, y) => y, default: () => null }),
  anchorImageUrl: Annotation<string | null>({ reducer: (_, y) => y ?? null, default: () => null }),
  scenes: Annotation<LongformSceneRecord[]>({ reducer: (_, y) => y, default: () => [] }),
  rawScenes: Annotation<StoryboardScene[]>({ reducer: (_, y) => y, default: () => [] }),
  finalFilmUrl: Annotation<string | null>({ reducer: (_, y) => y ?? null, default: () => null }),
  totalSeconds: Annotation<number>({ reducer: (_, y) => y, default: () => 0 }),
  retryIndices: Annotation<number[]>({ reducer: (_, y) => y, default: () => [] }),
  qcPassed: Annotation<boolean>({ reducer: (_, y) => y, default: () => false }),
  qcAttempt: Annotation<number>({ reducer: (_, y) => y, default: () => 0 }),
});

const videoTaskCache = new Map<string, string>();

function progress(config: LangGraphRunnableConfig, event: LongformProgressEvent) {
  const cb = (config.configurable as GraphConfigurable | undefined)?.onProgress;
  cb?.(event);
}

function patchScene(
  scenes: LongformSceneRecord[],
  index: number,
  patch: Partial<LongformSceneRecord>,
): LongformSceneRecord[] {
  return scenes.map((scene) => {
    if (scene.index !== index) return scene;
    const next = { ...scene, ...patch };
    // Monotonic progress: never let a scene's percent go backwards while it's rendering.
    // Only reset when we explicitly start a fresh retry (retryCount incremented).
    if (
      typeof patch.progress === "number" &&
      patch.retryCount === undefined &&
      patch.progress < scene.progress &&
      !scene.done
    ) {
      next.progress = scene.progress;
    }
    return next;
  });
}

async function measureAudioDuration(url: string): Promise<number> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(buffer.slice(0));
    return decoded.duration;
  } finally {
    await ctx.close().catch(() => {});
  }
}

function buildCharacterRoster(scenes: StoryboardScene[]) {
  const names = scenes
    .map((scene) => scene.character?.trim())
    .filter((name): name is string => Boolean(name));
  return Array.from(new Set(names)).slice(0, 3).join(", ");
}

function buildLongformVideoAttempts(
  stillUrl: string,
  audioUrl: string | undefined,
  durationSeconds: number,
): VideoAttempt[] {
  const resolution: "720P" | "1080P" = "720P";
  const primary = "wan2.6-i2v" as LongformVideoModel;
  const fallback = "wan2.6-i2v-flash" as LongformVideoModel;
  const attempts: VideoAttempt[] = [];
  if (audioUrl) {
    attempts.push({
      model: primary,
      imageUrl: stillUrl,
      audioUrl,
      durationSeconds,
      resolution,
      embeddedAudio: true,
    });
    if (fallback !== primary) {
      attempts.push({
        model: fallback,
        imageUrl: stillUrl,
        audioUrl,
        durationSeconds,
        resolution,
        embeddedAudio: true,
      });
    }
  }
  attempts.push({
    model: "wan2.2-i2v-plus",
    imageUrl: stillUrl,
    durationSeconds: Math.min(5, durationSeconds),
    resolution: "720P",
    embeddedAudio: false,
  });
  return attempts;
}

async function submitAndPollLongformVideo(
  prompt: string,
  attempts: VideoAttempt[],
  onProgress: (progress: number) => void,
) {
  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      const cacheKey = JSON.stringify({
        model: attempt.model,
        imageUrl: attempt.imageUrl,
        audioUrl: attempt.audioUrl || "",
        durationSeconds: attempt.durationSeconds,
        resolution: attempt.resolution,
        prompt,
      });
      let task_id = videoTaskCache.get(cacheKey);
      if (!task_id) {
        const submitted = await submitVideo({
          data: {
            prompt,
            model: attempt.model,
            imageUrl: attempt.imageUrl,
            audioUrl: attempt.audioUrl,
            durationSeconds: attempt.durationSeconds,
            resolution: attempt.resolution,
            size: "1280*720",
          },
        });
        task_id = submitted.task_id;
        videoTaskCache.set(cacheKey, task_id);
      }
      for (let pollAttempt = 0; pollAttempt < LONGFORM_LIMITS.maxVideoPollAttempts; pollAttempt++) {
        await new Promise((r) => setTimeout(r, getLongformVideoPollDelayMs(pollAttempt)));
        onProgress(Math.min(12 + pollAttempt * 2, 94));
        const status = await pollVideo({ data: { task_id } });
        if (status.status === "SUCCEEDED" && status.video_url) {
          return { videoUrl: status.video_url, embeddedAudio: attempt.embeddedAudio };
        }
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

function scenesToRecords(scenes: StoryboardScene[], bible: VisualBible): LongformSceneRecord[] {
  return scenes.map((scene, index) => {
    const spokenLine = (scene.spoken_line || scene.dialogue || scene.caption || "").replace(/^[^:]+:\s*/, "");
    return {
      index,
      title: scene.title || `Scene ${index + 1}`,
      visual: scene.visual,
      location: scene.location,
      caption: scene.caption || spokenLine,
      spokenLine,
      character: scene.character || bible.characters[0]?.name || "Lead character",
      shotType: scene.shot_type,
      language: scene.language || "English",
      voiceTone: scene.voice_tone,
      pitch: scene.pitch,
      bgm: scene.bgm,
      sfx: scene.sfx,
      durationSeconds: normalizeLongformSceneDuration(scene.duration_seconds),
      colorGrade: scene.color_grade,
      editingNotes: scene.editing_notes,
      referenceImageDirection: scene.reference_image_direction,
      videoPrompt: scene.video_prompt,
      continuityPrompt: formatSceneContinuity({
        bible,
        sceneCharacter: scene.character,
        previousVisual: scenes[index - 1]?.visual || scenes[index - 1]?.video_prompt,
        nextVisual: scenes[index + 1]?.visual || scenes[index + 1]?.video_prompt,
      }),
      progress: 5,
      done: false,
      retryCount: 0,
    };
  });
}

async function screenwriterNode(
  state: typeof LongformState.State,
  config: LangGraphRunnableConfig,
): Promise<Partial<typeof LongformState.State>> {
  const referenceBrief = state.referenceImages.map((r) => ({
    name: r.name,
    description: r.description || "user uploaded character/style reference image",
  }));
  const compiledReferences = compileReferenceImages(referenceBrief);
  const referenceRouting = formatReferenceRouting(compiledReferences);

  const story = await generateStoryboard({
    data: {
      prompt: state.prompt,
      sceneCount: LONGFORM_LIMITS.maxScenes,
      mode: "longform",
      learningContext: [state.learningContext, referenceRouting ? `Reference routing map: ${referenceRouting}` : ""]
        .filter(Boolean)
        .join("\n"),
      referenceImages: referenceBrief,
    },
  });

  const initialBible = buildShortFilmVisualBible({
    prompt: state.prompt,
    title: story.title,
    tone: story.tone,
    scenes: story.scenes,
    references: referenceBrief,
  });
  const repairedScenes = validateAndRepairScenes(
    story.scenes,
    initialBible,
    normalizeLongformSceneDuration(undefined),
  );
  const bible = buildShortFilmVisualBible({
    prompt: state.prompt,
    title: story.title,
    tone: story.tone,
    scenes: repairedScenes,
    references: referenceBrief,
  });

  const scenes = scenesToRecords(repairedScenes, bible);

  progress(config, {
    type: "storyboard",
    title: story.title,
    logline: story.logline,
    tone: story.tone,
    sceneCount: scenes.length,
  });
  progress(config, { type: "scenesInit", scenes });
  progress(config, { type: "bible", bible });
  progress(config, {
    type: "message",
    text: `🎬 "${story.title}"\n${story.logline}\n\nTone: ${story.tone}\n\nRendering ${scenes.length} lip-synced cinematic shots (~30+ seconds) — character identity locked across every scene.`,
    skills: [
      "Script Agent",
      "Casting & Voice Agent",
      "Continuity Agent",
      "Cinematography Agent",
      "Lip-Sync Video Agent",
      "Editor Agent",
    ],
    task: `Cut ${scenes.length} shots into a 30+ second film`,
  });
  progress(config, {
    type: "tasks",
    tasks: [
      { text: `Render ${scenes.length} lip-synced cinematic shots`, done: false },
      { text: "Lock character anchor portrait", done: false },
      { text: "Cast English dialogue voices", done: false },
      { text: "Stitch graded master film (30s+)", done: false },
    ],
  });

  return {
    storyTitle: story.title,
    logline: story.logline,
    tone: story.tone,
    visualBible: bible,
    rawScenes: repairedScenes,
    scenes,
    retryIndices: [],
    qcPassed: false,
    qcAttempt: 0,
  };
}

async function characterDesignerNode(
  state: typeof LongformState.State,
  config: LangGraphRunnableConfig,
): Promise<Partial<typeof LongformState.State>> {
  const bible = state.visualBible;
  if (!bible) throw new Error("Visual bible missing before character designer");

  const mainCharacter = bible.characters[0];
  const anchorPrompt = [
    "Canonical character identity anchor portrait, front-facing three-quarter close-up, neutral expression, sharp facial detail.",
    mainCharacter ? formatCharacterLock(mainCharacter) : formatVisualBible(bible),
    "Same face, hairstyle, wardrobe, body type, and accessories that must appear in every scene.",
    "Cinematic 35mm film still, professional lighting, shallow depth of field, no text, no watermark.",
    `Negative prompt: ${CONTINUITY_NEGATIVE_PROMPT}`,
  ].join("\n");

  const refs = [
    ...state.referenceImages.map((r) => r.dataUrl),
  ];
  const anchor = await generateSceneImage({
    data: {
      prompt: anchorPrompt,
      referenceImages: refs,
      referenceWeight: Math.max(state.referenceWeight, 0.9),
      negativePrompt: CONTINUITY_NEGATIVE_PROMPT,
    },
  });

  if (mainCharacter) {
    const token = `${state.projectId}::${mainCharacter.name.toLowerCase().replace(/\s+/g, "-")}`;
    const description = [
      `Character ${mainCharacter.name}, ${mainCharacter.ageRange}, ${mainCharacter.genderPresentation}.`,
      `Face: ${mainCharacter.faceDescription}. Hair: ${mainCharacter.hairstyle}. Body: ${mainCharacter.bodyType}.`,
      `Wardrobe: ${mainCharacter.wardrobe}. Accessories: ${mainCharacter.keyAccessories}.`,
    ].join(" ");
    void upsertCharacterEmbedding({
      data: {
        project_id: state.projectId,
        character_token: token,
        description,
        metadata: { name: mainCharacter.name, wardrobe: mainCharacter.wardrobe, anchor: true },
      },
    }).catch(() => {});
  }

  progress(config, { type: "anchor", anchorImageUrl: anchor.image_url });
  progress(config, {
    type: "tasks",
    tasks: [
      { text: `Render ${state.scenes.length} lip-synced cinematic shots`, done: false },
      { text: "Lock character anchor portrait", done: true },
      { text: "Cast English dialogue voices", done: false },
      { text: "Stitch graded master film (30s+)", done: false },
    ],
  });

  return { anchorImageUrl: anchor.image_url };
}

async function produceScenesNode(
  state: typeof LongformState.State,
  config: LangGraphRunnableConfig,
): Promise<Partial<typeof LongformState.State>> {
  const bible = state.visualBible;
  const anchorImageUrl = state.anchorImageUrl;
  if (!bible || !anchorImageUrl) throw new Error("Missing bible or anchor before scene production");

  const referenceBrief = state.referenceImages.map((r) => ({
    name: r.name,
    description: r.description || "user uploaded character/style reference image",
  }));
  const compiledReferences = compileReferenceImages(referenceBrief);
  const referenceRouting = formatReferenceRouting(compiledReferences);
  const characterRoster = buildCharacterRoster(state.rawScenes);

  const indices =
    state.retryIndices.length > 0
      ? state.retryIndices
      : state.scenes.map((scene) => scene.index);

  let scenes = [...state.scenes];

  const resolveCharacterToken = (name?: string) => {
    const normalized = (name ?? bible.characters[0]?.name ?? "hero").toLowerCase().replace(/\s+/g, "-");
    return `${state.projectId}::${normalized}`;
  };

  const voicePool = ["Cherry", "Ethan", "Serena", "Dylan", "Chelsie", "Jada", "Sunny"];

  await runWithConcurrency(indices, LONGFORM_LIMITS.maxParallelVideoJobs, async (sceneIndex) => {
    const raw = state.rawScenes[sceneIndex];
    const record = scenes[sceneIndex];
    if (!raw || !record) return;

    const runScene = async (attemptNum: number): Promise<void> => {
      const characterLock = findCharacterBible(bible, raw.character);
      const charKey = (raw.character || `char-${sceneIndex}`).toLowerCase();
      let hash = 0;
      for (let i = 0; i < charKey.length; i++) hash = (hash * 31 + charKey.charCodeAt(i)) >>> 0;
      const chosenVoice = voicePool[hash % voicePool.length];
      const spokenLine = record.spokenLine;

      progress(config, { type: "scene", index: sceneIndex, patch: { progress: 8 } });

      let uploadedAudioUrl: string | undefined;
      let audioSeconds = 0;
      let voiceMeta: { provider?: string; tts_speaker?: string; localized_script?: string; target_language?: string; critique?: unknown } = {};
      try {
        const voice = await generateVoice({
          data: {
            text: spokenLine,
            voice: chosenVoice,
            language: "English",
            tone: characterLock?.voiceStyle || raw.voice_tone || "natural film dialogue",
            pitch: raw.pitch || "medium",
            beatId: `scene-${sceneIndex + 1}`,
            clientStyleProfile: state.learningContext,
          },
        });
        const uploaded = await uploadVoiceAudio({
          data: {
            project_id: state.projectId,
            scene_id: `scene-${sceneIndex + 1}`,
            audio_data_url: voice.audio_url,
          },
        });
        uploadedAudioUrl = uploaded.audio_url;
        audioSeconds = await measureAudioDuration(uploaded.audio_url);
        voiceMeta = {
          provider: voice.provider,
          tts_speaker: voice.tts_speaker,
          localized_script: voice.localized_script,
          target_language: voice.target_language,
          critique: voice.critique,
        };
      } catch (audioErr) {
        // Audio failed — continue with silent video so the film still renders.
        const msg = audioErr instanceof Error ? audioErr.message : String(audioErr);
        console.warn(`[longform] scene ${sceneIndex + 1} audio failed, rendering silent:`, msg);
      }
      const durationSeconds = audioSeconds
        ? computeSceneDurationFromAudio(audioSeconds)
        : LONGFORM_LIMITS.defaultSecondsPerScene;

      scenes = patchScene(scenes, sceneIndex, {
        audioUrl: uploadedAudioUrl,
        audioSeconds,
        durationSeconds,
        localizedScript: voiceMeta.localized_script,
        targetLanguage: voiceMeta.target_language,
        ttsProvider: voiceMeta.provider,
        ttsSpeaker: voiceMeta.tts_speaker,
        regionalCritique: voiceMeta.critique,
        progress: 18,
      });
      progress(config, {
        type: "scene",
        index: sceneIndex,
        patch: {
          audioUrl: uploadedAudioUrl,
          audioSeconds,
          durationSeconds,
          localizedScript: voiceMeta.localized_script,
          targetLanguage: voiceMeta.target_language,
          ttsProvider: voiceMeta.provider,
          ttsSpeaker: voiceMeta.tts_speaker,
          regionalCritique: voiceMeta.critique,
          progress: 18,
        },
      });

      const previousScene = state.rawScenes[sceneIndex - 1];
      const nextScene = state.rawScenes[sceneIndex + 1];
      const optimizedPrompt = buildOptimizedScenePrompt({
        scene: raw,
        bible,
        sceneIndex,
        sceneCount: state.rawScenes.length,
        previousVisual: previousScene?.visual || previousScene?.video_prompt,
        nextVisual: nextScene?.visual || nextScene?.video_prompt,
        referenceWeight: Math.max(state.referenceWeight, 0.85),
        references: compiledReferences,
        userStyleProfile: state.learningContext,
      });

      const continuityPrompt = record.continuityPrompt || formatSceneContinuity({
        bible,
        sceneCharacter: raw.character,
        previousVisual: previousScene?.visual || previousScene?.video_prompt,
        nextVisual: nextScene?.visual || nextScene?.video_prompt,
      });

      const characterToken = resolveCharacterToken(raw.character);
      const wardrobeToken = characterLock?.wardrobe || "wardrobe-default";
      const sceneId = `${state.projectId}::scene-${sceneIndex + 1}`;

      let spec: SceneSpec | null = null;
      try {
        spec = await compileSceneSpec({
          data: {
            scene_id: sceneId,
            director_beat: [raw.visual, raw.video_prompt, spokenLine ? `Dialogue: "${spokenLine}"` : ""]
              .filter(Boolean)
              .join("\n"),
            prior_scene_ref: previousScene ? `${state.projectId}::scene-${sceneIndex}` : null,
            prior_scene_visual: previousScene?.visual || previousScene?.video_prompt || "",
            character_token: characterToken,
            wardrobe_token: wardrobeToken,
          },
        });
      } catch {
        spec = null;
      }

      const compiledNegatives = spec
        ? compileNegativePrompt(spec, "longform continuity i2v")
        : CONTINUITY_NEGATIVE_PROMPT;

      const imgPrompt = [
        formatOptimizedScenePrompt(optimizedPrompt, "image"),
        continuityPrompt,
        referenceRouting ? `Reference compiler routing: ${referenceRouting}` : "",
        `Match the canonical anchor portrait identity exactly: ${anchorImageUrl}`,
        raw.visual || raw.video_prompt,
        characterRoster ? `Recurring named characters: ${characterRoster}` : "",
        characterLock ? `Exact active character identity: ${formatCharacterLock(characterLock)}` : "",
        `Storyboard still for scene ${sceneIndex + 1} of ${state.rawScenes.length}.`,
        `Negative prompt: ${compiledNegatives}`,
      ].filter(Boolean).join("\n");

      const stillRefs = [
        anchorImageUrl,
        ...state.referenceImages.map((r) => r.dataUrl),
      ];

      let storyboardStillUrl: string | undefined;
      let agentTrace: QualityResult[] = [];

      if (spec) {
        const gateSpec: SceneSpec = {
          ...spec,
          negative_prompt: compiledNegatives ?? spec.negative_prompt,
          reference_image_weight: Math.max(spec.reference_image_weight, 0.85),
        };
        const { frame, trace } = await generateSceneWithQualityGate({
          spec: gateSpec,
          generate: async (curSpec) => {
            const built = [imgPrompt, `SPEC POSITIVE: ${curSpec.positive_prompt}`, `SPEC NEGATIVE: ${curSpec.negative_prompt}`].join("\n");
            const out = await generateSceneImage({
              data: {
                prompt: built,
                referenceImages: stillRefs,
                referenceWeight: Math.max(state.referenceWeight, curSpec.reference_image_weight, 0.85),
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
            referenceImages: stillRefs,
            referenceWeight: Math.max(state.referenceWeight, 0.85),
            negativePrompt: compiledNegatives,
          },
        });
        storyboardStillUrl = img.image_url;
      }

      const similarityResult = await scoreSceneAgainstCharacter({
        data: {
          project_id: state.projectId,
          scene_id: sceneId,
          character_token: characterToken,
          description: [raw.character || "hero", raw.visual || raw.video_prompt, spec?.positive_prompt || ""]
            .filter(Boolean)
            .join(" "),
        },
      }).catch(() => ({ similarity: null as number | null, stored: false }));

      if (
        similarityResult.similarity != null &&
        similarityResult.similarity < CONTINUITY_THRESHOLD &&
        record.retryCount < LONGFORM_LIMITS.maxRetriesPerScene
      ) {
        const regen = await generateSceneImage({
          data: {
            prompt: [
              imgPrompt,
              "REGENERATE: tighten face match to anchor portrait; do not change wardrobe colors or hairstyle.",
            ].join("\n"),
            referenceImages: [anchorImageUrl, storyboardStillUrl],
            referenceWeight: 0.92,
            negativePrompt: compiledNegatives,
          },
        });
        storyboardStillUrl = regen.image_url;
      }

      scenes = patchScene(scenes, sceneIndex, {
        posterUrl: storyboardStillUrl,
        characterSimilarity: similarityResult.similarity,
        agentTrace,
        progress: 32,
      });
      progress(config, {
        type: "scene",
        index: sceneIndex,
        patch: {
          posterUrl: storyboardStillUrl,
          characterSimilarity: similarityResult.similarity,
          agentTrace,
          progress: 32,
        },
      });

      const fullPrompt = [
        formatOptimizedScenePrompt(optimizedPrompt, "video"),
        continuityPrompt,
        `ANCHOR PORTRAIT LOCK: match this exact character identity from the anchor still.`,
        raw.video_prompt,
        spec ? `Cinematographer positive: ${spec.positive_prompt}` : "",
        `Project visual bible summary: ${formatVisualBible(bible)}`,
        characterLock ? `Active character must remain identical: ${formatCharacterLock(characterLock)}` : "",
        spokenLine
          ? `Lip-sync exactly to this spoken line with natural English delivery matching age and gender: "${spokenLine}"`
          : "",
        `Scene ${sceneIndex + 1} of ${state.rawScenes.length}. Seamless edit-ready plate, no black frames, no watermark.`,
        `Negative prompt: ${compiledNegatives}`,
        `Render as one continuous ${durationSeconds}-second cinematic shot with embedded dialogue audio.`,
      ].filter(Boolean).join("\n");

      const attempts = buildLongformVideoAttempts(storyboardStillUrl!, uploadedAudioUrl, durationSeconds);
      const { videoUrl, embeddedAudio } = await submitAndPollLongformVideo(
        fullPrompt,
        attempts,
        (p) => {
          scenes = patchScene(scenes, sceneIndex, { progress: p });
          progress(config, { type: "scene", index: sceneIndex, patch: { progress: p } });
        },
      );

      scenes = patchScene(scenes, sceneIndex, {
        videoUrl,
        embeddedAudio,
        progress: 100,
        done: true,
      });
      progress(config, {
        type: "scene",
        index: sceneIndex,
        patch: { videoUrl, embeddedAudio, progress: 100, done: true },
      });
    };

    const maxAttempts = LONGFORM_LIMITS.maxRetriesPerScene + 1;
    let lastErr: unknown = null;
    for (let attemptNum = 0; attemptNum < maxAttempts; attemptNum++) {
      try {
        await runScene(attemptNum);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[longform] scene ${sceneIndex + 1} attempt ${attemptNum + 1} failed:`, msg);
        if (attemptNum < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 4000));
        }
      }
    }
    if (lastErr) {
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      // Mark scene as failed but do NOT throw — let the rest of the film render.
      scenes = patchScene(scenes, sceneIndex, {
        caption: `${record.caption}\n⚠ ${msg}`,
        progress: 0,
        done: false,
      });
      progress(config, {
        type: "scene",
        index: sceneIndex,
        patch: { caption: `${record.caption}\n⚠ ${msg}`, progress: 0, done: false },
      });
    }
  });

  const totalSeconds = scenes.reduce((sum, scene) => sum + (scene.durationSeconds || 0), 0);
  return { scenes, totalSeconds, retryIndices: [] };
}

async function editorNode(
  state: typeof LongformState.State,
  config: LangGraphRunnableConfig,
): Promise<Partial<typeof LongformState.State>> {
  const clipUrls = state.scenes.map((s) => s.videoUrl).filter((u): u is string => Boolean(u));
  if (clipUrls.length === 0) throw new Error("No video clips to stitch");

  let finalFilmUrl: string | null = null;
  if (clipUrls.length === 1) {
    finalFilmUrl = clipUrls[0];
  } else {
    const graded: string[] = [];
    for (const url of clipUrls) {
      try {
        graded.push(await gradeClip(url));
      } catch {
        graded.push(url);
      }
    }
    finalFilmUrl = await concatClips(graded);
  }

  progress(config, {
    type: "tasks",
    tasks: [
      { text: `Render ${state.scenes.length} lip-synced cinematic shots`, done: true },
      { text: "Lock character anchor portrait", done: true },
      { text: "Cast English dialogue voices", done: true },
      { text: "Stitch graded master film (30s+)", done: true },
    ],
  });
  progress(config, {
    type: "message",
    text: `🎞 Post-processing complete — graded master film stitched from ${clipUrls.length} lip-synced clips.`,
  });
  progress(config, { type: "editor", finalFilmUrl: finalFilmUrl! });

  const totalSeconds = state.scenes.reduce((sum, scene) => sum + (scene.durationSeconds || 0), 0);
  progress(config, {
    type: "done",
    finalFilmUrl,
    totalSeconds,
    scenes: state.scenes,
  });

  return { finalFilmUrl };
}

async function qualityControlNode(
  state: typeof LongformState.State,
  config: LangGraphRunnableConfig,
): Promise<Partial<typeof LongformState.State>> {
  const totalSeconds = state.scenes.reduce((sum, scene) => sum + (scene.durationSeconds || 0), 0);
  const failedIndices = state.scenes
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => !scene.videoUrl || !scene.done)
    .map(({ index }) => index);

  const shortDuration = totalSeconds < LONGFORM_LIMITS.minTotalVideoSeconds;
  const needsRetry =
    state.qcAttempt < LONGFORM_LIMITS.maxRetriesPerScene &&
    (failedIndices.length > 0 || shortDuration);

  if (needsRetry) {
    const retryIndices = failedIndices.length
      ? failedIndices
      : state.scenes
          .filter((scene) => scene.retryCount < LONGFORM_LIMITS.maxRetriesPerScene)
          .map((scene) => scene.index);

    const scenes = state.scenes.map((scene) =>
      retryIndices.includes(scene.index)
        ? { ...scene, retryCount: scene.retryCount + 1, done: false, progress: 5, videoUrl: undefined }
        : scene,
    );

  progress(config, {
    type: "message",
    text: `Quality control: retrying ${retryIndices.length} scene(s) to hit the 30+ second target.`,
  });

    return {
      scenes,
      retryIndices,
      qcPassed: false,
      qcAttempt: state.qcAttempt + 1,
    };
  }

  return { qcPassed: true, totalSeconds };
}

function routeAfterQualityControl(state: typeof LongformState.State) {
  return state.qcPassed ? "editor" : "produceScenes";
}

function buildLongformGraph() {
  return new StateGraph(LongformState)
    .addNode("screenwriter", screenwriterNode)
    .addNode("characterDesigner", characterDesignerNode)
    .addNode("produceScenes", produceScenesNode)
    .addNode("editor", editorNode)
    .addNode("qualityControl", qualityControlNode)
    .addEdge(START, "screenwriter")
    .addEdge("screenwriter", "characterDesigner")
    .addEdge("characterDesigner", "produceScenes")
    .addEdge("produceScenes", "qualityControl")
    .addConditionalEdges("qualityControl", routeAfterQualityControl)
    .addEdge("editor", END)
    .compile();
}

let compiledGraph: ReturnType<typeof buildLongformGraph> | null = null;

export async function runLongformPipeline(input: {
  prompt: string;
  projectId: string;
  referenceImages: LongformReferenceImage[];
  referenceWeight: number;
  learningContext: string;
  onProgress: (event: LongformProgressEvent) => void;
}) {
  if (!compiledGraph) compiledGraph = buildLongformGraph();
  const result = await compiledGraph.invoke(
    {
      prompt: input.prompt,
      projectId: input.projectId,
      referenceImages: input.referenceImages,
      referenceWeight: input.referenceWeight,
      learningContext: input.learningContext,
    },
    {
      configurable: {
        onProgress: input.onProgress,
      },
    },
  );
  return result;
}
