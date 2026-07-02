import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DASHSCOPE_BASE = "https://dashscope-intl.aliyuncs.com";
const CHAT_URL = `${DASHSCOPE_BASE}/compatible-mode/v1/chat/completions`;
const VIDEO_SUBMIT_URL = `${DASHSCOPE_BASE}/api/v1/services/aigc/video-generation/video-synthesis`;
const TASK_URL = (id: string) => `${DASHSCOPE_BASE}/api/v1/tasks/${id}`;

type Scene = {
  title: string;
  visual: string;
  dialogue: string;
  video_prompt: string;
  character?: string;
  spoken_line?: string;
  caption?: string;
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
    z.object({ prompt: z.string().min(1), sceneCount: z.number().int().min(1).max(12).default(8) }).parse(input),
  )
  .handler(async ({ data }): Promise<Storyboard> => {
    const key = process.env.DASHSCOPE_API_KEY;
    if (!key) throw new Error("DASHSCOPE_API_KEY not configured");

    const system = [
      `You are Makers, an AI showrunner + screenwriter. Given a logline, produce a FULL cinematic short film script and shot-list of EXACTLY ${data.sceneCount} scenes (~5-7 seconds each) totaling ~60 seconds.`,
      `HARD RULES:`,
      `- Real short FILM, not narrated slideshow. NEVER use a narrator or voice-over. Every spoken line is an in-world character speaking on screen (no "Narrator:" ever).`,
      `- Reuse the same 2-3 named characters across scenes so the audience follows them.`,
      `- Vary shot types: wide establishing, medium, close-up, insert, action, reaction. No two consecutive scenes use the same shot_type.`,
      `- video_prompt is a cinematic shot description (~50 words): camera movement (dolly in / tracking / handheld / crane / static close-up), lens & lighting, subject action, mood, environment ambience (wind, birds, rain, crowd, footsteps, distant thunder). End every video_prompt with: "cinematic, film grain, shallow depth of field, 35mm, dramatic lighting, high detail".`,
      `- spoken_line: 5-15 words, natural dialogue that fits ~6 seconds.`,
      `- Long rich logline (3-4 sentences) and detailed tone.`,
      ``,
      `Return ONLY strict JSON — no markdown:`,
      `{"title":string,"logline":string,"tone":string,"scenes":Array<{"title":string,"visual":string,"dialogue":string,"character":string,"spoken_line":string,"caption":string,"video_prompt":string,"shot_type":string}>}`,
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

/** Submit a video-gen task to HappyHorse T2V (async). Returns task_id. */
export const submitVideo = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        prompt: z.string().min(3),
        size: z.string().default("1280*720"),
        model: z.enum(["happyhorse-1.1-t2v", "wan2.2-t2v-plus"]).default("happyhorse-1.1-t2v"),
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
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ audio_url: string; provider: string }> => {
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

    // 2) Fallback — Lovable AI Gateway (OpenAI TTS) returns raw mp3 bytes
    const lovKey = process.env.LOVABLE_API_KEY;
    if (!lovKey) throw new Error("No TTS provider available");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
      method: "POST",
      headers: {
        "Lovable-API-Key": lovKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini-tts",
        input: data.text,
        voice: "alloy",
        response_format: "mp3",
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`TTS failed (${res.status}): ${t.slice(0, 200)}`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const b64 = btoa(bin);
    return { audio_url: `data:audio/mpeg;base64,${b64}`, provider: "gateway-tts" };
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