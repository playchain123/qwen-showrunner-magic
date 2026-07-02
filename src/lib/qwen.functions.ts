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