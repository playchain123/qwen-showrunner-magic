import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { clampSceneCount, normalizeSceneDuration } from "./makers-runtime";

const DASHSCOPE_BASE = "https://dashscope-intl.aliyuncs.com";
const CHAT_URL = `${DASHSCOPE_BASE}/compatible-mode/v1/chat/completions`;
const VIDEO_SUBMIT_URL = `${DASHSCOPE_BASE}/api/v1/services/aigc/video-generation/video-synthesis`;
const TASK_URL = (id: string) => `${DASHSCOPE_BASE}/api/v1/tasks/${id}`;
const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev";

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
  .inputValidator((input: unknown) =>
    z
      .object({
        prompt: z.string().min(1),
        sceneCount: z.number().int().min(1).max(3).default(3),
        learningContext: z.string().optional().default(""),
        referenceImages: z
          .array(z.object({ name: z.string(), description: z.string().optional().default("") }))
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
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), 90_000);
        const res = await fetch(CHAT_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            response_format: { type: "json_object" },
            temperature: 0.8,
            max_tokens,
          }),
          signal: controller.signal,
        }).finally(() => clearTimeout(to));
        if (res.ok) {
          const j = (await res.json()) as { choices: Array<{ message: { content: string } }> };
          content = j.choices?.[0]?.message?.content ?? "";
          if (content) break;
        } else {
          lastErr = `Qwen ${model} (${res.status})`;
          if (res.status < 500 && res.status !== 429) break; // don't retry client errors
        }
      } catch (e) {
        lastErr = `Qwen ${model} ${(e as Error).message}`;
      }
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
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
  .inputValidator((input: unknown) =>
    z
      .object({
        prompt: z.string().min(3),
        size: z.string().default("1280*720"),
        model: z
          .enum(["happyhorse-1.1-t2v", "wan2.2-t2v-plus", "happyhorse-1.1-i2v", "wan2.2-i2v-plus"])
          .default("happyhorse-1.1-t2v"),
        imageUrl: z.string().url().optional(),
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

    const res = await fetch(VIDEO_SUBMIT_URL, {
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
    });
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
  .inputValidator((input: unknown) => z.object({ task_id: z.string().min(1) }).parse(input))
  .handler(async ({ data }): Promise<{ status: string; video_url?: string; error?: string }> => {
    const key = process.env.DASHSCOPE_API_KEY;
    if (!key) throw new Error("DASHSCOPE_API_KEY not configured");
    const res = await fetch(TASK_URL(data.task_id), {
      headers: { Authorization: `Bearer ${key}` },
    });
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
  .inputValidator((input: unknown) =>
    z
      .object({
        text: z.string().min(1).max(1000),
        voice: z.string().default("Cherry"), // Qwen3-TTS voice id (Cherry, Ethan, Serena, Chelsie, Dylan, Jada, Sunny…)
        language: z.string().default("English"),
        tone: z.string().optional().default("natural cinematic dialogue"),
        pitch: z.enum(["low", "medium", "high"]).optional().default("medium"),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ audio_url: string; provider: string }> => {
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
    const richInstructions = [
      `You are a professional on-screen film actor delivering an in-world line — never a narrator, never an announcer.`,
      `Language: ${data.language}. Speak with clean native pronunciation, natural colloquial rhythm and human phrasing. No robotic cadence.`,
      `Emotion: ${emotion}. Vocal placement: ${pitchWord}.`,
      `Directorial note: ${data.tone}.`,
      `Deliver with real breaths, micro-pauses, and dynamic pitch that matches the emotion.`,
    ].join(" ");

    const dashKey = process.env.DASHSCOPE_API_KEY;
    if (dashKey) {
      try {
        const res = await fetch(qwenMaasGenerationUrl(), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${dashKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: qwenModel("QWEN_TTS_MODEL", "qwen3-tts-flash"),
            input: {
              text: data.text,
              voice: data.voice,
              language_type: data.language,
            },
            parameters: { stream: false },
          }),
        });
        if (res.ok) {
          const j = (await res.json()) as {
            output?: { audio?: { url?: string; data?: string } };
          };
          const url = j.output?.audio?.url;
          if (url) return { audio_url: url, provider: "qwen3-tts-flash" };
          const b64 = j.output?.audio?.data;
          if (b64) return { audio_url: `data:audio/mpeg;base64,${b64}`, provider: "qwen3-tts-flash" };
        }
      } catch {
        // fall through to optional fallback
      }
    }

    if (allowNonQwenFallbacks()) {
      const lovKey = process.env.LOVABLE_API_KEY;
      if (lovKey) {
        try {
          const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${lovKey}`,
              "Lovable-API-Key": lovKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "openai/gpt-4o-mini-tts",
              input: data.text,
              voice: mapGatewayVoice(data.voice),
              response_format: "mp3",
              instructions: richInstructions,
            }),
          });
          if (res.ok) {
            return { audio_url: toDataUrl(await res.arrayBuffer()), provider: "gateway-tts" };
          }
        } catch {
          // provider error handled below
        }
      }
    }

    throw new Error("Qwen TTS provider unavailable");
  });

/** Generate a cinematic scene poster image via Qwen-Image. */
export const generateSceneImage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        prompt: z.string().min(3),
        referenceImages: z.array(z.string()).optional().default([]),
        referenceWeight: z.number().min(0).max(1).optional().default(0.75),
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

    const res = await fetch(qwenMaasGenerationUrl(), {
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
          negative_prompt: "Low resolution, low quality, distorted limbs, malformed fingers, blurry faces, waxy skin, watermark, subtitles, text overlay.",
          prompt_extend: true,
          watermark: false,
          size: process.env.QWEN_IMAGE_SIZE || "1664*928",
          n: 1,
        },
      }),
    });
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
  .inputValidator((input: unknown) => z.object({ audio_url: z.string().url() }).parse(input))
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
