import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { clampSceneCount, normalizeSceneDuration } from "./makers-runtime";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SceneSpecSchema, type SceneSpec } from "./scene-spec";
import type { QualityResult } from "./quality-gate";
import {
  buildLocalizationPrompt,
  chooseSarvamSpeaker,
  critiqueRegionalScript,
  inferRegister,
  resolveTTSProvider,
  type LocalizationResult,
} from "./tts-routing";

const DASHSCOPE_BASE = "https://dashscope-intl.aliyuncs.com";
const CHAT_URL = `${DASHSCOPE_BASE}/compatible-mode/v1/chat/completions`;
const VIDEO_SUBMIT_URL = `${DASHSCOPE_BASE}/api/v1/services/aigc/video-generation/video-synthesis`;
const TASK_URL = (id: string) => `${DASHSCOPE_BASE}/api/v1/tasks/${id}`;
const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev";

// Allow only trusted external hosts for URLs we forward to third-party AI
// providers. Prevents SSRF-by-proxy against cloud-internal endpoints.
const ALLOWED_MEDIA_HOSTS = new Set([
  "dashscope-intl.aliyuncs.com",
  "dashscope.aliyuncs.com",
  "oss-cn-beijing.aliyuncs.com",
  "oss-accelerate.aliyuncs.com",
  "dashscope-result.oss-cn-beijing.aliyuncs.com",
  "dashscope-result-sh.oss-cn-shanghai.aliyuncs.com",
  "dashscope-result-wlcb.oss-cn-wulanchabu.aliyuncs.com",
  "acecxckmvlaxygbvubub.supabase.co",
]);

function isSafeExternalUrl(value: string): boolean {
  if (value.startsWith("data:image/") || value.startsWith("data:audio/")) return true;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:") return false;
    return ALLOWED_MEDIA_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

const safeMediaUrl = z
  .string()
  .url()
  .max(2048)
  .refine(isSafeExternalUrl, {
    message: "URL host is not on the allowlist for external media forwarding",
  });

const TASK_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

function allowNonQwenFallbacks() {
  return process.env.ALLOW_NON_QWEN_FALLBACKS === "true";
}

function qwenModel(name: string, fallback: string) {
  return process.env[name] || fallback;
}

function qwenMaasGenerationUrl() {
  const workspaceId = process.env.QWEN_WORKSPACE_ID;
  const region = process.env.QWEN_REGION || "ap-southeast-1";
  if (!workspaceId) return `${DASHSCOPE_BASE}/api/v1/services/aigc/multimodal-generation/generation`;
  return `https://${workspaceId}.${region}.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    console.info(`[qwen] ${label} ${res.status} ${Date.now() - started}ms`);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[qwen] ${label} failed after ${Date.now() - started}ms: ${message}`);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function compileLocalizedScriptForVoice({
  beatId,
  sourceLine,
  targetLanguage,
  brandVoiceTone,
  clientStyleProfile,
  revisionNote,
}: {
  beatId: string;
  sourceLine: string;
  targetLanguage: string;
  brandVoiceTone: string;
  clientStyleProfile: string;
  revisionNote?: string;
}): Promise<LocalizationResult> {
  const fallback: LocalizationResult = {
    beat_id: beatId,
    target_language: targetLanguage,
    localized_script: sourceLine,
    script_notes: "Localization compiler unavailable; source script preserved. Verify phrasing before final export.",
    register: inferRegister(brandVoiceTone),
  };
  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) return fallback;
  try {
    const res = await fetchWithTimeout(CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: qwenModel("QWEN_FAST_MODEL", "qwen-plus"),
        messages: [
          {
            role: "system",
            content: buildLocalizationPrompt({
              beatId,
              sourceLine,
              targetLanguage,
              brandVoiceTone,
              clientStyleProfile,
            }),
          },
          { role: "user", content: revisionNote ? `${sourceLine}\n\nRevision required: ${revisionNote}` : sourceLine },
        ],
        response_format: { type: "json_object" },
        temperature: 0.55,
        max_tokens: 800,
      }),
    }, 45_000, `localize ${targetLanguage}`);
    if (!res.ok) return fallback;
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(content) as Partial<LocalizationResult>;
    if (!parsed.localized_script || !parsed.target_language) return fallback;
    return {
      beat_id: parsed.beat_id || beatId,
      target_language: parsed.target_language || targetLanguage,
      localized_script: parsed.localized_script,
      script_notes: parsed.script_notes || "Localized for natural spoken delivery.",
      register: parsed.register === "formal" || parsed.register === "casual_slang" ? parsed.register : "conversational",
    };
  } catch {
    return fallback;
  }
}

async function resolveLocalizedScriptForVoice({
  beatId,
  sourceLine,
  targetLanguage,
  brandVoiceTone,
  clientStyleProfile,
}: {
  beatId: string;
  sourceLine: string;
  targetLanguage: string;
  brandVoiceTone: string;
  clientStyleProfile: string;
}) {
  let localized = await compileLocalizedScriptForVoice({
    beatId,
    sourceLine,
    targetLanguage,
    brandVoiceTone,
    clientStyleProfile,
  });
  let critique = critiqueRegionalScript({
    localizedScript: localized.localized_script,
    targetLanguage: localized.target_language,
    register: localized.register,
    sourceLine,
  });
  for (let attempt = 0; attempt < 2 && critique.verdict === "revise"; attempt += 1) {
    localized = await compileLocalizedScriptForVoice({
      beatId,
      sourceLine,
      targetLanguage,
      brandVoiceTone,
      clientStyleProfile,
      revisionNote: critique.revision_note || critique.issues.join("; "),
    });
    critique = critiqueRegionalScript({
      localizedScript: localized.localized_script,
      targetLanguage: localized.target_language,
      register: localized.register,
      sourceLine,
    });
  }
  return { localized, critique };
}

type Scene = {
  title: string;
  visual: string;
  dialogue: string;
  video_prompt: string;
  location?: string;
  character?: string;
  spoken_line?: string;
  caption?: string;
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
type Storyboard = {
  title: string;
  logline: string;
  tone: string;
  scenes: Scene[];
};

/** Generate a full short-drama storyboard from a logline using Qwen3.7-Max. */
export const generateStoryboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        prompt: z.string().min(1).max(4000),
        sceneCount: z.number().int().min(1).max(3).default(3),
        learningContext: z.string().max(2000).optional().default(""),
        referenceImages: z
          .array(
            z.object({
              name: z.string().max(200),
              description: z.string().max(500).optional().default(""),
            }),
          )
          .max(8)
          .optional()
          .default([]),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<Storyboard> => {
    const key = process.env.DASHSCOPE_API_KEY;
    if (!key) throw new Error("DASHSCOPE_API_KEY not configured");

    const sceneCount = clampSceneCount(data.sceneCount);
    const sceneSeconds = normalizeSceneDuration(undefined);
    const system = [
      `You are Makers, an AI showrunner + screenwriter + professional film editor trained in Adobe Premiere Pro, After Effects, DaVinci Resolve, cinematic camera blocking, color grading, VFX, SFX, Foley, trailer pacing, and short-drama continuity. Given a logline, produce a concise cinematic short film script and shot-list of EXACTLY ${sceneCount} scenes. Each scene is designed as a ${sceneSeconds}-second dramatic shot and the full hackathon demo must stay under 15 seconds.`,
      `HARD RULES:`,
      `- Real short FILM, not narrated slideshow. NEVER use a narrator or voice-over. Every spoken line is an in-world character speaking on screen (no "Narrator:" ever).`,
      `- Reuse the same 2-3 named characters across scenes so the audience follows them.`,
      `- Every scene must include a specific location and maintain geographic/story continuity from the previous scene.`,
      `- Vary shot types: wide establishing, medium, close-up, insert, action, reaction. No two consecutive scenes use the same shot_type.`,
      `- If the prompt asks for Tamil, Malayalam, Hindi, Telugu, Kannada, Bengali, Marathi, Punjabi, Urdu, or any Indian language, write clean native colloquial dialogue in that language's script with human slang and natural phrasing. Do not produce broken mixed-language output unless the user asks for Hinglish/Tanglish/etc.`,
      `- If the prompt asks for Tanglish, Hinglish, Manglish, Benglish, or other code-switched Indian speech, keep brand/product names, technical terms, UI terms, and numbers in English, but use the regional language for verbs, connectors, emotion, and everyday phrasing. This must sound like real local speech, not literal translation.`,
      `- Assign each scene a language, voice_tone, and pitch (low/medium/high) suitable for the character and emotion.`,
      `- Add clean bgm and sfx cues for each scene: realistic ambience, Foley, impacts, transitions, room tone, emotional score.`,
      `- Add professional editing_notes and color_grade for every scene: match cut, J-cut/L-cut, whip pan, speed ramp, rack focus, chromatic VFX, teal-orange grade, bleach bypass, warm film print, etc.`,
      `- video_prompt is a cinematic ${sceneSeconds}-second shot description (~55 words): camera movement (dolly in / tracking / handheld / crane / static close-up), lens & lighting, exact location, subject action, character continuity, mood, environment ambience, VFX/SFX context, color grade. End every video_prompt with: "single continuous four-second cinematic shot, film grain, shallow depth of field, 35mm, dramatic lighting, high detail, natural motion, real character performance".`,
      `- spoken_line: 4-12 words, natural dramatic dialogue that fits a ${sceneSeconds}-second scene.`,
      `- Long rich logline (3-4 sentences) and detailed tone.`,
      data.referenceImages.length
        ? `REFERENCE IMAGES PROVIDED: The user uploaded ${data.referenceImages.length} character/style reference image(s): ${data.referenceImages.map((r, i) => `#${i + 1} ${r.name}${r.description ? ` (${r.description})` : ""}`).join("; ")}. Keep characters, wardrobe, setting, and visual identity consistent with these references. Put the relevant reference guidance in reference_image_direction.`
        : `If no reference images are provided, create consistent original characters and repeat their visual identity in every scene.`,
      data.learningContext
        ? `PROJECT LEARNING MEMORY: Apply these learned user preferences and prior prompt patterns without repeating mistakes: ${data.learningContext}`
        : ``,
      ``,
      `Return ONLY strict JSON — no markdown:`,
      `{"title":string,"logline":string,"tone":string,"scenes":Array<{"title":string,"visual":string,"dialogue":string,"location":string,"character":string,"spoken_line":string,"caption":string,"image_prompt":string,"video_prompt":string,"negative_prompt":string,"shot_type":string,"language":string,"voice_tone":string,"pitch":"low"|"medium"|"high","bgm":string,"sfx":string,"duration_seconds":number,"color_grade":string,"editing_notes":string,"reference_image_direction":string}>}`,
    ].join("\n");

    const messages = [
      { role: "system", content: system },
      { role: "user", content: data.prompt },
    ];

    // Retry across Qwen model tiers. Non-Qwen fallback is opt-in so the
    // hackathon path remains clearly Qwen-first.
    const attempts: Array<{ model: string; max_tokens: number }> = [
      { model: qwenModel("QWEN_SCRIPT_MODEL", "qwen3.7-max"), max_tokens: 3200 },
      { model: qwenModel("QWEN_FAST_MODEL", "qwen-plus"), max_tokens: 2600 },
      { model: qwenModel("QWEN_FAST_MODEL", "qwen-plus"), max_tokens: 2200 },
    ];
    let content = "";
    let lastErr = "";
    for (let i = 0; i < attempts.length; i++) {
      const { model, max_tokens } = attempts[i];
      try {
        console.info(`[qwen] storyboard attempt ${i + 1}/${attempts.length} model=${model} max_tokens=${max_tokens}`);
        const res = await fetchWithTimeout(CHAT_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            response_format: { type: "json_object" },
            temperature: 0.8,
            max_tokens,
          }),
        }, 120_000, `storyboard ${model}`);
        if (res.ok) {
          const j = (await res.json()) as { choices: Array<{ message: { content: string } }> };
          content = j.choices?.[0]?.message?.content ?? "";
          if (content) break;
        } else {
          const body = await res.text().catch(() => "");
          lastErr = `Qwen ${model} (${res.status}): ${body.slice(0, 200)}`;
          console.warn(`[qwen] storyboard ${model} error: ${lastErr}`);
          if (res.status < 500 && res.status !== 429) break; // don't retry client errors
        }
      } catch (e) {
        const err = e as Error;
        const causeMsg = err.cause instanceof Error ? ` cause=${err.cause.message}` : "";
        lastErr = `Qwen ${model} ${err.message}${causeMsg}`;
        console.warn(`[qwen] storyboard ${model} fetch exception: ${lastErr}`);
      }
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }

    if (!content && allowNonQwenFallbacks()) {
      const lovKey = process.env.LOVABLE_API_KEY;
      if (!lovKey) throw new Error(`Storyboard failed: ${lastErr || "Qwen unreachable"}`);
      const res = await fetch(`${LOVABLE_GATEWAY}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${lovKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages,
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Storyboard fallback failed (${res.status}): ${t.slice(0, 240)}`);
      }
      const j = (await res.json()) as { choices: Array<{ message: { content: string } }> };
      content = j.choices?.[0]?.message?.content ?? "{}";
    }
    if (!content) throw new Error(`Storyboard failed: ${lastErr || "Qwen returned no content"}`);

    const parsed = JSON.parse(content || "{}") as Storyboard;
    if (!parsed.scenes || !Array.isArray(parsed.scenes)) {
      throw new Error("Storyboard missing scenes");
    }
    parsed.scenes = parsed.scenes.slice(0, sceneCount).map((scene) => ({
      ...scene,
      duration_seconds: normalizeSceneDuration(scene.duration_seconds),
    }));
    return parsed;
  });

/** Submit a text-to-video or image-to-video task to Qwen Cloud (async). Returns task_id. */
export const submitVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        prompt: z.string().min(3).max(4000),
        size: z.string().default("1280*720"),
        model: z
          .enum(["happyhorse-1.1-t2v", "wan2.2-t2v-plus", "happyhorse-1.1-i2v", "wan2.2-i2v-plus"])
          .default("happyhorse-1.1-t2v"),
        imageUrl: safeMediaUrl.optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ task_id: string }> => {
    const key = process.env.DASHSCOPE_API_KEY;
    if (!key) throw new Error("DASHSCOPE_API_KEY not configured");
    const isImageToVideo = data.model.includes("-i2v");
    if (isImageToVideo && !data.imageUrl) {
      throw new Error(`${data.model} requires a storyboard still image`);
    }

    const res = await fetchWithTimeout(VIDEO_SUBMIT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model: data.model,
        input: isImageToVideo
          ? { prompt: data.prompt, img_url: data.imageUrl }
          : { prompt: data.prompt },
        parameters: { size: data.size },
      }),
    }, 60_000, `video submit ${data.model}`);
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Video submit failed (${res.status}): ${t.slice(0, 300)}`);
    }
    const json = (await res.json()) as { output?: { task_id?: string }; request_id?: string };
    const task_id = json.output?.task_id;
    if (!task_id) throw new Error("No task_id returned");
    return { task_id };
  });

/** Poll a video-gen task. Returns status + video url when SUCCEEDED. */
export const pollVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        task_id: z
          .string()
          .regex(TASK_ID_PATTERN, "Invalid task_id format"),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ status: string; video_url?: string; error?: string }> => {
    const key = process.env.DASHSCOPE_API_KEY;
    if (!key) throw new Error("DASHSCOPE_API_KEY not configured");
    const res = await fetchWithTimeout(TASK_URL(data.task_id), {
      headers: { Authorization: `Bearer ${key}` },
    }, 20_000, "video poll");
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Poll failed (${res.status}): ${t.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      output?: { task_status?: string; video_url?: string; message?: string };
    };
    const status = json.output?.task_status ?? "UNKNOWN";
    return { status, video_url: json.output?.video_url, error: json.output?.message };
  });

/** Generate character voiceover for a dialogue line.
 * Uses Qwen3-TTS-Flash with a per-character voice so each actor sounds
 * distinct. Non-Qwen fallback is opt-in through ALLOW_NON_QWEN_FALLBACKS.
 * Returns a data URL (or hosted URL) playable in <audio>. */
export const generateVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        text: z.string().min(1).max(1000),
        voice: z.string().default("Cherry"), // Qwen3-TTS voice id (Cherry, Ethan, Serena, Chelsie, Dylan, Jada, Sunny…)
        language: z.string().default("English"),
        tone: z.string().optional().default("natural cinematic dialogue"),
        pitch: z.enum(["low", "medium", "high"]).optional().default("medium"),
        beatId: z.string().optional().default("voice-line"),
        clientStyleProfile: z.string().optional().default(""),
        preferredSpeaker: z.string().optional().default(""),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ audio_url: string; provider: string; localized_script?: string; target_language?: string; tts_speaker?: string; critique?: unknown }> => {
    const toDataUrl = (buffer: ArrayBuffer, mime = "audio/mpeg") => {
      const bytes = new Uint8Array(buffer);
      let bin = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      return `data:${mime};base64,${btoa(bin)}`;
    };

    const mapGatewayVoice = (voice: string) => {
      const female = ["nova", "shimmer", "sage"];
      const male = ["onyx", "echo", "ash"];
      const neutral = ["alloy", "fable"];
      const tone = `${data.tone} ${voice}`.toLowerCase();
      const pool = /female|woman|girl|mother|sister|queen|witch/.test(tone)
        ? female
        : /male|man|boy|father|brother|king|villain|hero|warrior/.test(tone)
        ? male
        : /child|kid|young/.test(tone)
        ? female
        : neutral;
      let hash = 0;
      for (let i = 0; i < voice.length; i++) hash = (hash * 31 + voice.charCodeAt(i)) >>> 0;
      return pool[hash % pool.length];
    };

    const detectEmotion = (t: string) => {
      const lower = t.toLowerCase();
      if (/cry|sob|tear|grief|mourn/.test(lower)) return "sad, tearful, breath catching";
      if (/whisper|hush|secret/.test(lower)) return "whispered, intimate, breathy";
      if (/shout|scream|yell|rage/.test(lower)) return "shouting, forceful, urgent";
      if (/laugh|joyful|excite|thrill/.test(lower)) return "joyful, animated, light";
      if (/angry|furious|threat/.test(lower)) return "angry, tight, controlled fury";
      if (/fear|scare|terrified/.test(lower)) return "fearful, trembling, quick breaths";
      if (/love|tender|gentle/.test(lower)) return "tender, warm, soft";
      if (/hope|inspire|motivat/.test(lower)) return "hopeful, uplifted, steady";
      return "grounded, natural, in-the-moment acting";
    };
    const emotion = detectEmotion(`${data.text} ${data.tone}`);
    const pitchWord = data.pitch === "low" ? "low chest resonance" : data.pitch === "high" ? "bright forward placement" : "balanced";
    const route = resolveTTSProvider(data.language);
    const localizedBundle = route.provider === "sarvam-bulbul-v3"
      ? await resolveLocalizedScriptForVoice({
          beatId: data.beatId,
          sourceLine: data.text,
          targetLanguage: route.normalizedLanguage,
          brandVoiceTone: data.tone,
          clientStyleProfile: data.clientStyleProfile,
        })
      : {
          localized: {
            beat_id: data.beatId,
            target_language: route.normalizedLanguage,
            localized_script: data.text,
            script_notes: "Qwen-supported language; source script used directly.",
            register: inferRegister(data.tone),
          },
          critique: null,
        };
    const localized = localizedBundle.localized;
    const critique = localizedBundle.critique;
    const richInstructions = [
      `You are a professional on-screen film actor delivering an in-world line — never a narrator, never an announcer.`,
      `Language: ${localized.target_language}. Speak with clean native pronunciation, natural colloquial rhythm and human phrasing. No robotic cadence.`,
      `Emotion: ${emotion}. Vocal placement: ${pitchWord}.`,
      `Directorial note: ${data.tone}.`,
      `Deliver with real breaths, micro-pauses, and dynamic pitch that matches the emotion.`,
    ].join(" ");

    if (route.provider === "sarvam-bulbul-v3") {
      const sarvamKey = process.env.SARVAM_API_KEY || process.env.SARVAM_AI_API_KEY;
      if (!sarvamKey) {
        throw new Error(`SARVAM_API_KEY not configured for ${route.normalizedLanguage}. This language must not be routed to Qwen3-TTS-Flash.`);
      }
      const speaker = data.preferredSpeaker || process.env.SARVAM_TTS_SPEAKER || chooseSarvamSpeaker(route.normalizedLanguage, data.tone, data.pitch);
      const endpoint = process.env.SARVAM_TTS_URL || "https://api.sarvam.ai/text-to-speech";
      const res = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: {
          "api-subscription-key": sarvamKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: localized.localized_script,
          target_language_code: route.languageCode,
          model: process.env.SARVAM_TTS_MODEL || "bulbul:v3",
          speaker,
          pace: 1,
          enable_preprocessing: true,
        }),
      }, 60_000, `sarvam tts ${route.normalizedLanguage}`);
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Sarvam TTS failed (${res.status}): ${t.slice(0, 240)}`);
      }
      const contentType = res.headers.get("content-type") || "";
      if (/application\/json/i.test(contentType)) {
        const json = await res.json() as { audio?: string; audios?: string[]; audio_url?: string };
        const b64 = json.audio || json.audios?.[0];
        if (json.audio_url) {
          return { audio_url: json.audio_url, provider: "sarvam-bulbul-v3", localized_script: localized.localized_script, target_language: localized.target_language, tts_speaker: speaker, critique };
        }
        if (b64) {
          return { audio_url: `data:audio/wav;base64,${b64}`, provider: "sarvam-bulbul-v3", localized_script: localized.localized_script, target_language: localized.target_language, tts_speaker: speaker, critique };
        }
        throw new Error("Sarvam TTS response did not include audio");
      }
      return {
        audio_url: toDataUrl(await res.arrayBuffer(), contentType.includes("wav") ? "audio/wav" : "audio/mpeg"),
        provider: "sarvam-bulbul-v3",
        localized_script: localized.localized_script,
        target_language: localized.target_language,
        tts_speaker: speaker,
        critique,
      };
    }

    const dashKey = process.env.DASHSCOPE_API_KEY;
    if (dashKey) {
      try {
        const res = await fetchWithTimeout(qwenMaasGenerationUrl(), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${dashKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: qwenModel("QWEN_TTS_MODEL", "qwen3-tts-flash"),
            input: {
              text: localized.localized_script,
              voice: data.voice,
              language_type: data.language,
            },
            parameters: { stream: false },
          }),
        }, 60_000, "qwen tts");
        if (res.ok) {
          const j = (await res.json()) as {
            output?: { audio?: { url?: string; data?: string } };
          };
          const url = j.output?.audio?.url;
          if (url) return { audio_url: url, provider: "qwen3-tts-flash", localized_script: localized.localized_script, target_language: localized.target_language };
          const b64 = j.output?.audio?.data;
          if (b64) return { audio_url: `data:audio/mpeg;base64,${b64}`, provider: "qwen3-tts-flash", localized_script: localized.localized_script, target_language: localized.target_language };
        }
      } catch {
        // fall through to optional fallback
      }
    }

    if (allowNonQwenFallbacks()) {
      const lovKey = process.env.LOVABLE_API_KEY;
      if (lovKey) {
        try {
          const res = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/audio/speech", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${lovKey}`,
              "Lovable-API-Key": lovKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "openai/gpt-4o-mini-tts",
              input: localized.localized_script,
              voice: mapGatewayVoice(data.voice),
              response_format: "mp3",
              instructions: richInstructions,
            }),
          }, 60_000, "gateway tts fallback");
          if (res.ok) {
            return { audio_url: toDataUrl(await res.arrayBuffer()), provider: "gateway-tts", localized_script: localized.localized_script, target_language: localized.target_language };
          }
        } catch {
          // provider error handled below
        }
      }
    }

    throw new Error(`${route.provider} provider unavailable`);
  });

/** Generate a cinematic scene poster image via Qwen-Image. */
export const generateSceneImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        prompt: z.string().min(3).max(4000),
        referenceImages: z.array(safeMediaUrl).max(4).optional().default([]),
        referenceWeight: z.number().min(0).max(1).optional().default(0.75),
        negativePrompt: z.string().optional().default(""),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ image_url: string }> => {
    const key = process.env.DASHSCOPE_API_KEY;
    if (!key) throw new Error("DASHSCOPE_API_KEY not configured");
    const weightPct = Math.round(data.referenceWeight * 100);
    const guidance = data.referenceImages.length
      ? `Reference guidance (${weightPct}%): keep the same character face, hairstyle, wardrobe, ethnicity, body type, environmental continuity and color palette from the uploaded references.`
      : ``;
    const prompt = [
      "Cinematic film still, 35mm anamorphic look, professional lighting, shallow depth of field, natural human subject, real photography look.",
      guidance,
      `SCENE: ${data.prompt}`,
      "No text, no watermark, no subtitles, no logos unless explicitly requested.",
    ].filter(Boolean).join("\n");

    const unusedLegacyContent: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: [
          `Cinematic film still, 35mm anamorphic look, professional lighting, shallow depth of field, natural human subject, real photography look — NOT stylized illustration unless the prompt says animation.`,
          guidance,
          `SCENE: ${data.prompt}`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ];
    for (const ref of data.referenceImages.slice(0, 4)) {
      unusedLegacyContent.push({ type: "image_url", image_url: { url: ref } });
    }

    const res = await fetchWithTimeout(qwenMaasGenerationUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: qwenModel("QWEN_IMAGE_MODEL", "qwen-image-2.0"),
        input: {
          messages: [
            {
              role: "user",
              content: [{ text: prompt }],
            },
          ],
        },
        parameters: {
          negative_prompt:
            data.negativePrompt ||
            "Low resolution, low quality, distorted limbs, malformed fingers, blurry faces, waxy skin, watermark, subtitles, text overlay.",
          prompt_extend: true,
          watermark: false,
          size: process.env.QWEN_IMAGE_SIZE || "1664*928",
          n: 1,
        },
      }),
    }, 90_000, "qwen image");
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Qwen image failed (${res.status}): ${t.slice(0, 240)}`);
    }
    const j = (await res.json()) as {
      output?: { choices?: Array<{ message?: { content?: Array<{ image?: string }> } }> };
    };
    const url = j.output?.choices?.[0]?.message?.content?.find((item) => item.image)?.image;
    if (!url) throw new Error("No image returned from Qwen-Image");
    return { image_url: url };
  });

/** Transcribe an audio URL with Paraformer-v2 to get word-level timing for subtitle sync. */
export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ audio_url: safeMediaUrl }).parse(input))
  .handler(async ({ data }): Promise<{ words: Array<{ text: string; begin: number; end: number }> }> => {
    const key = process.env.DASHSCOPE_API_KEY;
    if (!key) return { words: [] };
    try {
      const submit = await fetch(
        `${DASHSCOPE_BASE}/api/v1/services/audio/asr/transcription`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
          },
          body: JSON.stringify({
            model: "paraformer-v2",
            input: { file_urls: [data.audio_url] },
          }),
        },
      );
      if (!submit.ok) return { words: [] };
      const sj = (await submit.json()) as { output?: { task_id?: string } };
      const taskId = sj.output?.task_id;
      if (!taskId) return { words: [] };
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const p = await fetch(TASK_URL(taskId), { headers: { Authorization: `Bearer ${key}` } });
        const pj = (await p.json()) as {
          output?: {
            task_status?: string;
            results?: Array<{ transcripts?: Array<{ sentences?: Array<{ words?: Array<{ text: string; begin_time: number; end_time: number }> }> }> }>;
          };
        };
        if (pj.output?.task_status === "SUCCEEDED") {
          const words = pj.output.results?.[0]?.transcripts?.[0]?.sentences?.flatMap((s) => s.words ?? []) ?? [];
          return { words: words.map((w) => ({ text: w.text, begin: w.begin_time / 1000, end: w.end_time / 1000 })) };
        }
        if (pj.output?.task_status === "FAILED") break;
      }
    } catch {
      // ignore — captions are optional enrichment
    }
    return { words: [] };
  });

// ---------------------------------------------------------------------------
// §1.1 Cinematographer Agent v2 — compile a Director scene into a strict
// SceneSpec JSON that downstream nodes consume without loose parsing.
// ---------------------------------------------------------------------------
export const compileSceneSpec = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        scene_id: z.string().min(1),
        director_beat: z.string().min(1).max(4000),
        prior_scene_ref: z.string().nullable().optional().default(null),
        prior_scene_visual: z.string().max(2000).optional().default(""),
        character_token: z.string().min(1),
        wardrobe_token: z.string().max(500).optional().default(""),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<SceneSpec> => {
    const key = process.env.DASHSCOPE_API_KEY;
    if (!key) throw new Error("DASHSCOPE_API_KEY not configured");

    const system = `You are the Cinematographer Agent in an autonomous film pipeline. You receive a scene beat from the Director Agent and must output a single JSON object — nothing else, no preamble, no markdown fences.

Before writing the final prompt fields, reason internally (do not output this reasoning) through:
1. The ONE image that best captures this beat's emotional turn.
2. The lens/framing a human DP would pick to serve that emotion — not the default.
3. The motivated light source in this environment and where it falls on the subject.
4. What in the frame visually connects to the previous scene (wardrobe, prop, color).
5. What would break realism if unspecified — enumerate as negatives.

STRICT SCHEMA (return exactly these fields, no extras):
{
  "scene_id": string,
  "subject": string,
  "action": string,
  "camera": { "shot_type": string, "angle": string, "lens_mm": number, "movement": string },
  "lighting": { "key_source": string, "quality": "hard"|"soft"|"mixed", "color_temp_k": number, "mood": string },
  "color_grade": { "reference_stock_or_look": string, "contrast": "low"|"medium"|"high" },
  "environment": { "location": string, "atmosphere": string },
  "continuity_anchor": { "character_token": string, "wardrobe_token": string, "prior_scene_ref": string|null },
  "positive_prompt": string,
  "negative_prompt": string,
  "reference_image_weight": number
}

Rules:
- Never use vague adjectives without a concrete visual referent.
- Every light source must be motivated by something in "environment".
- If prior_scene_ref is not null, reference_image_weight MUST be >= 0.8.
- positive_prompt must be a single dense paragraph a cinematographer could act on, not a list of tags.`;

    const user = JSON.stringify({
      scene_id: data.scene_id,
      director_beat: data.director_beat,
      prior_scene_ref: data.prior_scene_ref,
      prior_scene_visual: data.prior_scene_visual,
      character_token: data.character_token,
      wardrobe_token: data.wardrobe_token,
    });

    const res = await fetchWithTimeout(CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: qwenModel("QWEN_SCRIPT_MODEL", "qwen3.7-max"),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.6,
        max_tokens: 1200,
      }),
    }, 60_000, "cinematographer v2");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Cinematographer failed (${res.status}): ${body.slice(0, 240)}`);
    }
    const j = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    const raw = j.choices?.[0]?.message?.content ?? "{}";
    const parsed = SceneSpecSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(`Cinematographer returned invalid SceneSpec: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`);
    }
    // Enforce the "prior scene → weight >= 0.8" rule server-side.
    const spec = parsed.data;
    if (spec.continuity_anchor.prior_scene_ref && spec.reference_image_weight < 0.8) {
      spec.reference_image_weight = 0.8;
    }
    return spec;
  });

// ---------------------------------------------------------------------------
// §1.2 Quality-Critique Agent — vision-model grades a generated still against
// the SceneSpec that requested it. Uses Lovable AI Gateway (Gemini flash) so
// this call never touches DashScope quota.
// ---------------------------------------------------------------------------
export const critiqueScene = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        spec: SceneSpecSchema,
        image_url: safeMediaUrl,
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<QualityResult> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY not configured");

    const system = `You are the Quality-Critique Agent. Score the shown still against the SceneSpec that requested it. Return strict JSON with these exact fields, no extras:
{
  "prompt_fidelity_score": number 0-1,
  "continuity_score": number 0-1,
  "realism_score": number 0-1,
  "artifact_flags": string[],
  "verdict": "accept"|"refine"|"reject",
  "refine_instructions": string|null
}
Rules:
- "accept" only if all three scores >= 0.8 AND artifact_flags is empty.
- Prefer "refine" over "reject" — refine_instructions must be one actionable sentence a prompt compiler can apply.
- Never write "make it better". Cite the specific field to change.`;

    const res = await fetch(`${LOVABLE_GATEWAY}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              { type: "text", text: `SceneSpec:\n${JSON.stringify(data.spec, null, 2)}` },
              { type: "image_url", image_url: { url: data.image_url } },
            ],
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Critique failed (${res.status}): ${body.slice(0, 240)}`);
    }
    const j = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    const raw = j.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as QualityResult;
    // Defensive: clamp scores + coerce verdict.
    const clamp = (n: unknown) => Math.max(0, Math.min(1, Number(n) || 0));
    return {
      prompt_fidelity_score: clamp(parsed.prompt_fidelity_score),
      continuity_score: clamp(parsed.continuity_score),
      realism_score: clamp(parsed.realism_score),
      artifact_flags: Array.isArray(parsed.artifact_flags) ? parsed.artifact_flags.filter((s) => typeof s === "string") : [],
      verdict: parsed.verdict === "accept" || parsed.verdict === "refine" || parsed.verdict === "reject" ? parsed.verdict : "refine",
      refine_instructions: typeof parsed.refine_instructions === "string" ? parsed.refine_instructions : null,
    };
  });

// ---------------------------------------------------------------------------
// §2.2 Continuity embeddings — embed a hero-frame description via Lovable AI
// (OpenAI text-embedding-3-small, 1536 dims to match pgvector column), then
// upsert/query in Supabase under RLS as the signed-in user.
// ---------------------------------------------------------------------------
async function embedText(text: string): Promise<number[]> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY not configured");
  const res = await fetch(`${LOVABLE_GATEWAY}/v1/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text.slice(0, 8000),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Embedding failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const j = (await res.json()) as { data: Array<{ embedding: number[] }> };
  const vec = j.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length !== 1536) {
    throw new Error(`Embedding returned wrong shape (len=${vec?.length})`);
  }
  return vec;
}

/** Embed a scene description and upsert it as the canonical character reference. */
export const upsertCharacterEmbedding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        project_id: z.string().min(1),
        character_token: z.string().min(1),
        description: z.string().min(3),
        metadata: z.record(z.string(), z.unknown()).optional().default({}),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const embedding = await embedText(data.description);
    const { error } = await context.supabase
      .from("character_embeddings")
      .upsert(
        {
          user_id: context.userId,
          project_id: data.project_id,
          character_token: data.character_token,
          embedding: embedding as unknown as string, // pgvector accepts array literals
          metadata: data.metadata as Record<string, unknown> as never,
        },
        { onConflict: "user_id,project_id,character_token" },
      );
    if (error) throw new Error(`upsert character embedding: ${error.message}`);
    return { embedding_dims: embedding.length };
  });

/** Embed a per-scene hero-frame description, store it, and return similarity vs. the character reference. */
export const scoreSceneAgainstCharacter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        project_id: z.string().min(1),
        scene_id: z.string().min(1),
        character_token: z.string().min(1),
        description: z.string().min(3),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ similarity: number | null; stored: boolean }> => {
    const embedding = await embedText(data.description);

    await context.supabase.from("scene_embeddings").insert({
      user_id: context.userId,
      project_id: data.project_id,
      scene_id: data.scene_id,
      character_token: data.character_token,
      embedding: embedding as unknown as string,
    });

    const { data: match, error } = await context.supabase.rpc("match_character_embedding", {
      p_project_id: data.project_id,
      p_character_token: data.character_token,
      p_query_embedding: embedding as unknown as string,
    });
    if (error) throw new Error(`match_character_embedding: ${error.message}`);
    const first = Array.isArray(match) ? match[0] : null;
    return { similarity: first?.similarity ?? null, stored: true };
  });
