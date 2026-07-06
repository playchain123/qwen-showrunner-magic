import { z } from "zod";
import {
  CHAT_URL,
  TASK_URL,
  VIDEO_SUBMIT_URL,
  dashscopeFetch,
  qwenMaasGenerationUrl,
  qwenModel,
  requireDashscopeKey,
  traceAgent,
} from "./dashscope.js";

export type HandlerContext = {
  requestId: string;
  startedAt: number;
  userId: string | null;
};

type Handler = (request: Request, context: HandlerContext) => Promise<Response>;

const scriptSchema = z.object({
  prompt: z.string().min(1).max(4000),
  scene_count: z.number().int().min(1).max(6).optional().default(3),
});

const storyboardSchema = z.object({
  script: z.string().min(1).max(12000),
  scene_count: z.number().int().min(1).max(6).optional().default(3),
});

const imageSchema = z.object({
  prompt: z.string().min(3).max(4000),
  negative_prompt: z.string().max(2000).optional().default(""),
  size: z.string().optional().default("1664*928"),
});

const videoSubmitSchema = z.object({
  prompt: z.string().min(3).max(4000),
  model: z
    .enum(["happyhorse-1.1-t2v", "wan2.2-t2v-plus", "happyhorse-1.1-i2v", "wan2.2-i2v-plus"])
    .optional()
    .default("happyhorse-1.1-t2v"),
  size: z.string().optional().default("1280*720"),
  image_url: z.string().url().optional(),
});

const voiceSchema = z.object({
  text: z.string().min(1).max(1000),
  voice: z.string().optional().default("Cherry"),
  language: z.string().optional().default("English"),
});

const renderSchema = z.object({
  clips: z.array(z.object({ url: z.string().url(), duration_seconds: z.number().optional() })).min(1).max(12),
  audio_urls: z.array(z.string().url()).optional().default([]),
  title: z.string().optional().default("makers-export"),
});

function ok(context: HandlerContext, stage: string, provider: string, body: Record<string, unknown>) {
  return json(context, 200, {
    success: true,
    stage,
    provider,
    ...body,
    agent_trace: [traceAgent(stage, provider, context.startedAt, context.requestId, "ok")],
  });
}

function fail(context: HandlerContext, status: number, stage: string, provider: string, message: string, retryable = false) {
  return json(context, status, {
    success: false,
    stage,
    provider,
    message,
    retryable,
    agent_trace: [traceAgent(stage, provider, context.startedAt, context.requestId, "error")],
  });
}

function json(context: HandlerContext, status: number, body: Record<string, unknown>) {
  return new Response(
    JSON.stringify({
      ...body,
      request_id: context.requestId,
      latency_ms: Date.now() - context.startedAt,
    }),
    { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } },
  );
}

async function readJson<T>(request: Request, schema: z.ZodSchema<T>) {
  const raw = await request.json().catch(() => ({}));
  return schema.parse(raw);
}

function requireAuth(context: HandlerContext) {
  if (process.env.DEMO_MODE === "true") return;
  if (!context.userId) throw new Error("Authorization required");
}

export const handleScript: Handler = async (request, context) => {
  requireAuth(context);
  const data = await readJson(request, scriptSchema);
  const key = requireDashscopeKey();
  const sceneCount = data.scene_count;
  const res = await dashscopeFetch(
    CHAT_URL,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: qwenModel("QWEN_SCRIPT_MODEL", "qwen3.7-max"),
        messages: [
          {
            role: "system",
            content: `You are the Writer Agent. Return strict JSON screenplay with title, genre, tone, logline, characters[], world, and exactly ${sceneCount} scenes with scene_number, heading, duration_seconds, action, dialogue[], camera, image_prompt, video_prompt, negative_prompt.`,
          },
          { role: "user", content: data.prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.75,
        max_tokens: 3200,
      }),
    },
    120_000,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return fail(context, res.status, "script_generation", "qwen-text", text.slice(0, 300), res.status >= 500);
  }
  const payload = await res.json();
  const content = (payload as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content || "{}";
  return ok(context, "script_generation", "qwen-text", { screenplay: JSON.parse(content) });
};

export const handleStoryboard: Handler = async (request, context) => {
  requireAuth(context);
  const data = await readJson(request, storyboardSchema);
  const key = requireDashscopeKey();
  const res = await dashscopeFetch(
    CHAT_URL,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: qwenModel("QWEN_FAST_MODEL", "qwen-plus"),
        messages: [
          {
            role: "system",
            content: `You are the Director Agent. Convert the screenplay into ${data.scene_count} shot JSON scenes with title, visual, dialogue, spoken_line, caption, image_prompt, video_prompt, negative_prompt, shot_type, duration_seconds.`,
          },
          { role: "user", content: data.script },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: 2800,
      }),
    },
    120_000,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return fail(context, res.status, "storyboard_generation", "qwen-text", text.slice(0, 300), res.status >= 500);
  }
  const payload = await res.json();
  const content = (payload as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content || "{}";
  return ok(context, "storyboard_generation", "qwen-text", { storyboard: JSON.parse(content) });
};

export const handleImage: Handler = async (request, context) => {
  requireAuth(context);
  const data = await readJson(request, imageSchema);
  const key = requireDashscopeKey();
  const res = await dashscopeFetch(
    qwenMaasGenerationUrl(),
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: qwenModel("QWEN_IMAGE_MODEL", "qwen-image-2.0"),
        input: { messages: [{ role: "user", content: [{ text: data.prompt }] }] },
        parameters: {
          negative_prompt: data.negative_prompt || "blurry, watermark, low quality",
          prompt_extend: true,
          watermark: false,
          size: data.size,
          n: 1,
        },
      }),
    },
    90_000,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return fail(context, res.status, "image_generation", "qwen-image", text.slice(0, 300), res.status >= 500);
  }
  const json = (await res.json()) as {
    output?: { choices?: Array<{ message?: { content?: Array<{ image?: string }> } }> };
  };
  const image_url = json.output?.choices?.[0]?.message?.content?.find((item) => item.image)?.image;
  if (!image_url) return fail(context, 502, "image_generation", "qwen-image", "No image returned", true);
  return ok(context, "image_generation", "qwen-image", { image_url });
};

export const handleVideoSubmit: Handler = async (request, context) => {
  requireAuth(context);
  const data = await readJson(request, videoSubmitSchema);
  const key = requireDashscopeKey();
  const model = data.model ?? "happyhorse-1.1-t2v";
  const isI2v = model.includes("-i2v");
  if (isI2v && !data.image_url) {
    return fail(context, 400, "video_generation", "wan", `${model} requires image_url`, false);
  }
  const res = await dashscopeFetch(
    VIDEO_SUBMIT_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model,
        input: isI2v ? { prompt: data.prompt, img_url: data.image_url } : { prompt: data.prompt },
        parameters: { size: data.size },
      }),
    },
    60_000,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return fail(context, res.status, "video_generation", "wan", text.slice(0, 300), res.status >= 500);
  }
  const json = (await res.json()) as { output?: { task_id?: string } };
  const task_id = json.output?.task_id;
  if (!task_id) return fail(context, 502, "video_generation", "wan", "No task_id returned", true);
  return ok(context, "video_generation", "wan", { task_id, provider_job_id: task_id });
};

export const handleVideoStatus: Handler = async (request, context) => {
  requireAuth(context);
  const url = new URL(request.url);
  const taskId = url.searchParams.get("task_id") || url.searchParams.get("id");
  if (!taskId || !/^[a-zA-Z0-9_-]{1,128}$/.test(taskId)) {
    return fail(context, 400, "video_status", "dashscope", "task_id query parameter required", false);
  }
  const key = requireDashscopeKey();
  const res = await dashscopeFetch(TASK_URL(taskId), { headers: { Authorization: `Bearer ${key}` } }, 20_000);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return fail(context, res.status, "video_status", "dashscope", text.slice(0, 300), res.status >= 500);
  }
  const json = (await res.json()) as {
    output?: { task_status?: string; video_url?: string; message?: string };
  };
  return ok(context, "video_status", "dashscope", {
    status: json.output?.task_status ?? "UNKNOWN",
    video_url: json.output?.video_url,
    error: json.output?.message,
  });
};

export const handleVoice: Handler = async (request, context) => {
  requireAuth(context);
  const data = await readJson(request, voiceSchema);
  const sarvamKey = process.env.SARVAM_API_KEY || process.env.SARVAM_AI_API_KEY;
  const language = String(data.language || "English").toLowerCase();
  const sarvamLanguages: Record<string, string> = {
    tamil: "ta-IN",
    hindi: "hi-IN",
    malayalam: "ml-IN",
    telugu: "te-IN",
    tanglish: "ta-IN",
    hinglish: "hi-IN",
    manglish: "ml-IN",
  };
  const sarvamCode = sarvamLanguages[language];
  if (sarvamCode && sarvamKey) {
    const res = await dashscopeFetch(
      process.env.SARVAM_TTS_URL || "https://api.sarvam.ai/text-to-speech",
      {
        method: "POST",
        headers: { "api-subscription-key": sarvamKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: data.text,
          target_language_code: sarvamCode,
          model: process.env.SARVAM_TTS_MODEL || "bulbul:v3",
          speaker: process.env.SARVAM_TTS_SPEAKER || "meera",
          pace: 1,
          enable_preprocessing: true,
        }),
      },
      60_000,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return fail(context, res.status, "voice_generation", "sarvam-bulbul-v3", text.slice(0, 300), res.status >= 500);
    }
    const contentType = res.headers.get("content-type") || "";
    if (/application\/json/i.test(contentType)) {
      const json = (await res.json()) as { audio_url?: string; audio?: string };
      if (json.audio_url) return ok(context, "voice_generation", "sarvam-bulbul-v3", { audio_url: json.audio_url, provider: "sarvam-bulbul-v3" });
      if (json.audio) return ok(context, "voice_generation", "sarvam-bulbul-v3", { audio_url: `data:audio/wav;base64,${json.audio}`, provider: "sarvam-bulbul-v3" });
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const mime = contentType.includes("wav") ? "audio/wav" : "audio/mpeg";
    return ok(context, "voice_generation", "sarvam-bulbul-v3", {
      audio_url: `data:${mime};base64,${buffer.toString("base64")}`,
      provider: "sarvam-bulbul-v3",
    });
  }

  const key = requireDashscopeKey();
  const res = await dashscopeFetch(
    qwenMaasGenerationUrl(),
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: qwenModel("QWEN_TTS_MODEL", "qwen3-tts-flash"),
        input: { text: data.text, voice: data.voice, language_type: data.language },
        parameters: { stream: false },
      }),
    },
    60_000,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return fail(context, res.status, "voice_generation", "qwen-tts", text.slice(0, 300), res.status >= 500);
  }
  const json = (await res.json()) as { output?: { audio?: { url?: string; data?: string } } };
  const audio_url = json.output?.audio?.url || (json.output?.audio?.data ? `data:audio/mpeg;base64,${json.output.audio.data}` : undefined);
  if (!audio_url) return fail(context, 502, "voice_generation", "qwen-tts", "No audio returned", true);
  return ok(context, "voice_generation", "qwen-tts", { audio_url, provider: "qwen3-tts-flash" });
};

export const handleRender: Handler = async (request, context) => {
  requireAuth(context);
  const data = await readJson(request, renderSchema);
  // FC render worker returns a stitch manifest; final Remotion/ffmpeg encode runs off-FC.
  const audioUrls = data.audio_urls ?? [];
  return ok(context, "render", "ffmpeg", {
    status: "queued",
    title: data.title,
    clip_count: data.clips.length,
    audio_track_count: audioUrls.length,
    message: "Render manifest accepted. Use the Lovable app Remotion export for final MP4 assembly.",
    manifest: {
      clips: data.clips,
      audio_urls: audioUrls,
    },
  });
};
