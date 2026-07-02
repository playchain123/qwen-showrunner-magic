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
    z.object({ prompt: z.string().min(1), sceneCount: z.number().int().min(1).max(6).default(3) }).parse(input),
  )
  .handler(async ({ data }): Promise<Storyboard> => {
    const key = process.env.DASHSCOPE_API_KEY;
    if (!key) throw new Error("DASHSCOPE_API_KEY not configured");

    const system = `You are Makers, an AI showrunner. Given a logline, produce a cinematic short-drama storyboard totaling ~50 seconds across ${data.sceneCount} scenes. Each scene must include at least one line of spoken character dialogue.
Return ONLY strict JSON matching this TypeScript type — no markdown, no commentary:
{
  "title": string,
  "logline": string,
  "tone": string,
  "scenes": Array<{
    "title": string,           // short scene name
    "visual": string,          // 1-2 sentence visual description
    "dialogue": string,        // one spoken line "Character: line"
    "character": string,       // character name only
    "spoken_line": string,     // the exact spoken words WITHOUT the "Character:" prefix — this is what TTS will read
    "caption": string,         // <= 60 chars, screen caption shown during the scene
    "video_prompt": string     // detailed cinematic prompt for text-to-video (camera, lighting, subject, mood, ~40 words)
  }>
}`;

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
 * Tries CosyVoice-v2 on DashScope first; falls back to Lovable AI Gateway TTS
 * so the pipeline never blocks. Returns a base64 mp3 data URL playable in <audio>. */
export const generateVoice = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        text: z.string().min(1).max(1000),
        voice: z.string().default("longxiaochun"), // CosyVoice voice id
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ audio_url: string; provider: string }> => {
    // 1) Try CosyVoice-v2 on DashScope (async task pattern)
    const dashKey = process.env.DASHSCOPE_API_KEY;
    if (dashKey) {
      try {
        const submit = await fetch(
          `${DASHSCOPE_BASE}/api/v1/services/audio/tts`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${dashKey}`,
              "Content-Type": "application/json",
              "X-DashScope-Async": "enable",
            },
            body: JSON.stringify({
              model: "cosyvoice-v2",
              input: { text: data.text, voice: data.voice },
              parameters: { format: "mp3", sample_rate: 22050 },
            }),
          },
        );
        if (submit.ok) {
          const j = (await submit.json()) as { output?: { task_id?: string; audio?: { url?: string } } };
          const url = j.output?.audio?.url;
          if (url) return { audio_url: url, provider: "cosyvoice-v2" };
          const taskId = j.output?.task_id;
          if (taskId) {
            for (let i = 0; i < 30; i++) {
              await new Promise((r) => setTimeout(r, 2000));
              const p = await fetch(TASK_URL(taskId), {
                headers: { Authorization: `Bearer ${dashKey}` },
              });
              const pj = (await p.json()) as {
                output?: { task_status?: string; audio?: { url?: string }; results?: Array<{ url?: string }> };
              };
              if (pj.output?.task_status === "SUCCEEDED") {
                const u = pj.output.audio?.url || pj.output.results?.[0]?.url;
                if (u) return { audio_url: u, provider: "cosyvoice-v2" };
                break;
              }
              if (pj.output?.task_status === "FAILED") break;
            }
          }
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