import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DASHSCOPE_BASE = "https://dashscope-intl.aliyuncs.com";
const CHAT_URL = `${DASHSCOPE_BASE}/compatible-mode/v1/chat/completions`;
const VIDEO_SUBMIT_URL = `${DASHSCOPE_BASE}/api/v1/services/aigc/video-generation/video-synthesis`;
const TASK_URL = (id: string) => `${DASHSCOPE_BASE}/api/v1/tasks/${id}`;
const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev";

type Scene = {
  title: string;
  visual: string;
  dialogue: string;
  video_prompt: string;
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
        sceneCount: z.number().int().min(1).max(12).default(8),
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

    const system = [
      `You are Makers, an AI showrunner + screenwriter + professional film editor trained in Adobe Premiere Pro, After Effects, DaVinci Resolve, cinematic camera blocking, color grading, VFX, SFX, Foley, trailer pacing, and short-drama continuity. Given a logline, produce a FULL cinematic short film script and shot-list of EXACTLY ${data.sceneCount} scenes (~5-8 seconds each).`,
      `HARD RULES:`,
      `- Real short FILM, not narrated slideshow. NEVER use a narrator or voice-over. Every spoken line is an in-world character speaking on screen (no "Narrator:" ever).`,
      `- Reuse the same 2-3 named characters across scenes so the audience follows them.`,
      `- Vary shot types: wide establishing, medium, close-up, insert, action, reaction. No two consecutive scenes use the same shot_type.`,
      `- If the prompt asks for Tamil, Malayalam, Hindi, Telugu, Kannada, Bengali, Marathi, Punjabi, Urdu, or any Indian language, write clean native colloquial dialogue in that language's script with human slang and natural phrasing. Do not produce broken mixed-language output unless the user asks for Hinglish/Tanglish/etc.`,
      `- Assign each scene a language, voice_tone, and pitch (low/medium/high) suitable for the character and emotion.`,
      `- Add clean bgm and sfx cues for each scene: realistic ambience, Foley, impacts, transitions, room tone, emotional score.`,
      `- Add professional editing_notes and color_grade for every scene: match cut, J-cut/L-cut, whip pan, speed ramp, rack focus, chromatic VFX, teal-orange grade, bleach bypass, warm film print, etc.`,
      `- video_prompt is a cinematic shot description (~65 words): camera movement (dolly in / tracking / handheld / crane / static close-up), lens & lighting, subject action, character continuity, mood, environment ambience, VFX/SFX context, color grade. End every video_prompt with: "cinematic, film grain, shallow depth of field, 35mm, dramatic lighting, high detail, natural motion, real character performance".`,
      `- spoken_line: 5-15 words, natural dialogue that fits ~6 seconds.`,
      `- Long rich logline (3-4 sentences) and detailed tone.`,
      data.referenceImages.length
        ? `REFERENCE IMAGES PROVIDED: The user uploaded ${data.referenceImages.length} character/style reference image(s): ${data.referenceImages.map((r, i) => `#${i + 1} ${r.name}${r.description ? ` (${r.description})` : ""}`).join("; ")}. Keep characters, wardrobe, setting, and visual identity consistent with these references. Put the relevant reference guidance in reference_image_direction.`
        : `If no reference images are provided, create consistent original characters and repeat their visual identity in every scene.`,
      data.learningContext
        ? `PROJECT LEARNING MEMORY: Apply these learned user preferences and prior prompt patterns without repeating mistakes: ${data.learningContext}`
        : ``,
      ``,
      `Return ONLY strict JSON — no markdown:`,
      `{"title":string,"logline":string,"tone":string,"scenes":Array<{"title":string,"visual":string,"dialogue":string,"character":string,"spoken_line":string,"caption":string,"video_prompt":string,"shot_type":string,"language":string,"voice_tone":string,"pitch":"low"|"medium"|"high","bgm":string,"sfx":string,"duration_seconds":number,"color_grade":string,"editing_notes":string,"reference_image_direction":string}>}`,
    ].join("\n");

    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen3.7-max",
        messages: [
          { role: "system", content: system },
          { role: "user", content: data.prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.8,
        max_tokens: 6000,
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Qwen chat failed (${res.status}): ${t.slice(0, 300)}`);
    }
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as Storyboard;
    if (!parsed.scenes || !Array.isArray(parsed.scenes)) {
      throw new Error("Storyboard missing scenes");
    }
    return parsed;
  });

/** Submit a text-to-video task to Qwen Cloud (async). Returns task_id. */
export const submitVideo = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        prompt: z.string().min(3),
        size: z.string().default("1280*720"),
        model: z.enum(["happyhorse-1.1-t2v", "wan2.2-t2v-plus"]).default("wan2.2-t2v-plus"),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ task_id: string }> => {
    const key = process.env.DASHSCOPE_API_KEY;
    if (!key) throw new Error("DASHSCOPE_API_KEY not configured");

    const res = await fetch(VIDEO_SUBMIT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model: data.model,
        input: { prompt: data.prompt },
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
 * Uses Qwen3-TTS-Flash (per Qwen Cloud docs) with a per-character voice so
 * each actor sounds distinct. Falls back to Lovable AI Gateway TTS if the
 * DashScope call fails so the pipeline never blocks.
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

    // Prefer Lovable AI Gateway TTS for more natural multilingual delivery.
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
            instructions: `Act as an on-screen film actor. Language: ${data.language}. Delivery: ${data.tone}. Pitch: ${data.pitch}. Speak with clean native human phrasing, natural emotion, no announcer voice, no narration, no robotic cadence.`,
          }),
        });
        if (res.ok) {
          return { audio_url: toDataUrl(await res.arrayBuffer()), provider: "gateway-tts" };
        }
      } catch {
        // fall through to Qwen
      }
    }

    const dashKey = process.env.DASHSCOPE_API_KEY;
    if (dashKey) {
      try {
        // Qwen3-TTS-Flash via MultiModal Generation (synchronous)
        const res = await fetch(
          `${DASHSCOPE_BASE}/api/v1/services/aigc/multimodal-generation/generation`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${dashKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "qwen3-tts-flash",
              input: {
                text: data.text,
                voice: data.voice,
                language_type: data.language,
              },
              parameters: { stream: false },
            }),
          },
        );
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
        // fall through to gateway
      }
    }

    throw new Error("No TTS provider available");
  });

/** Generate a cinematic scene poster image via Lovable AI (Gemini image).
 * Accepts optional reference images (data URLs or https URLs) so characters,
 * wardrobe and setting stay consistent across the whole film. */
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
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY not configured");
    const weightPct = Math.round(data.referenceWeight * 100);
    const guidance = data.referenceImages.length
      ? `Match the provided reference image(s) at ~${weightPct}% strength: keep the SAME character face, hairstyle, wardrobe, ethnicity and body type. Preserve environmental continuity and color palette. Do not invent a new character.`
      : ``;
    const content: Array<Record<string, unknown>> = [
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
      content.push({ type: "image_url", image_url: { url: ref } });
    }

    const res = await fetch(`${LOVABLE_GATEWAY}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        messages: [{ role: "user", content }],
        modalities: ["image", "text"],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Scene image failed (${res.status}): ${t.slice(0, 240)}`);
    }
    const j = (await res.json()) as {
      choices?: Array<{
        message?: {
          images?: Array<{ image_url?: { url?: string } }>;
          content?: unknown;
        };
      }>;
    };
    const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!url) throw new Error("No image returned from gateway");
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