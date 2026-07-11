// DashScope REST wrappers for the Showrunner agent.
// Only Wan + Happyhorse + CosyVoice + Voice-Enrollment. Nothing else.
//
// All calls read DASHSCOPE_API_KEY from the environment at call time.

const BASE = "https://dashscope-intl.aliyuncs.com";
const IMAGE_URL = `${BASE}/api/v1/services/aigc/multimodal-generation/generation`;
const VIDEO_SUBMIT_URL = `${BASE}/api/v1/services/aigc/video-generation/video-synthesis`;
const TASK_URL = (id: string) => `${BASE}/api/v1/tasks/${id}`;
const TTS_URL = `${BASE}/api/v1/services/aigc/multimodal-generation/generation`;
const VOICE_ENROLL_URL = `${BASE}/api/v1/services/audio/tts/customization`;

function key() {
  const k = process.env.DASHSCOPE_API_KEY;
  if (!k) throw new Error("DASHSCOPE_API_KEY not configured");
  return k;
}

function auth() {
  return { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" } as Record<string, string>;
}

async function readSlice(res: Response) {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

/** Generate a still image via wan2.7-image-pro. Returns a public CDN URL. */
export async function wanImage(prompt: string, opts?: { referenceImageUrl?: string; negativePrompt?: string; size?: string }) {
  const content: Array<Record<string, string>> = [];
  if (opts?.referenceImageUrl) content.push({ image: opts.referenceImageUrl });
  content.push({ text: prompt });
  const res = await fetch(IMAGE_URL, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({
      model: process.env.QWEN_IMAGE_MODEL || "wan2.7-image-pro",
      input: { messages: [{ role: "user", content }] },
      parameters: {
        negative_prompt: opts?.negativePrompt || "low quality, watermark, text, deformed",
        size: opts?.size || "1280*720",
        prompt_extend: true,
        watermark: false,
        n: 1,
      },
    }),
  });
  if (!res.ok) throw new Error(`wan-image ${res.status}: ${await readSlice(res)}`);
  const j = (await res.json()) as {
    output?: { choices?: Array<{ message?: { content?: Array<{ image?: string }> } }> };
  };
  const url = j.output?.choices?.[0]?.message?.content?.find((x) => x.image)?.image;
  if (!url) throw new Error("wan-image returned no image url");
  return url;
}

/** Submit an async video-generation task; returns task_id. */
export async function submitVideo(model: string, body: Record<string, unknown>) {
  const res = await fetch(VIDEO_SUBMIT_URL, {
    method: "POST",
    headers: { ...auth(), "X-DashScope-Async": "enable" },
    body: JSON.stringify({ model, ...body }),
  });
  if (!res.ok) throw new Error(`video-submit ${model} ${res.status}: ${await readSlice(res)}`);
  const j = (await res.json()) as { output?: { task_id?: string } };
  const id = j.output?.task_id;
  if (!id) throw new Error(`${model} returned no task_id`);
  return id;
}

/** Poll a DashScope async task until SUCCEEDED. Returns the video_url. */
export async function pollVideo(taskId: string, timeoutMs = 240_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 6000));
    const res = await fetch(TASK_URL(taskId), { headers: { Authorization: `Bearer ${key()}` } });
    if (!res.ok) continue;
    const j = (await res.json()) as {
      output?: { task_status?: string; video_url?: string; message?: string };
    };
    const status = j.output?.task_status;
    if (status === "SUCCEEDED" && j.output?.video_url) return j.output.video_url;
    if (status === "FAILED") throw new Error(`Task failed: ${j.output?.message ?? "unknown"}`);
  }
  throw new Error("Video task timed out");
}

/** Happyhorse image-to-video (single reference image, shot 1). */
export async function happyhorseI2V(imageUrl: string, prompt: string) {
  const id = await submitVideo("happyhorse-1.1-i2v", {
    input: { prompt, img_url: imageUrl },
    parameters: { size: "1280*720" },
  });
  return pollVideo(id);
}

/** Happyhorse reference-to-video (character sheet + prior last frame, shots 2..N). */
export async function happyhorseR2V(referenceImages: string[], prompt: string) {
  const id = await submitVideo("happyhorse-1.1-r2v", {
    input: { prompt, ref_images: referenceImages },
    parameters: { size: "1280*720" },
  });
  return pollVideo(id);
}

/** Wan i2v fallback. */
export async function wanI2V(imageUrl: string, prompt: string) {
  const id = await submitVideo("wan2.7-i2v", {
    input: { prompt, img_url: imageUrl },
    parameters: { size: "1280*720" },
  });
  return pollVideo(id);
}

/** Wan r2v fallback. */
export async function wanR2V(referenceImages: string[], prompt: string) {
  const id = await submitVideo("wan2.7-r2v-2026-06-12", {
    input: { prompt, ref_images: referenceImages },
    parameters: { size: "1280*720" },
  });
  return pollVideo(id);
}

/** CosyVoice text-to-speech with an enrolled voice_id. Returns audio URL. */
export async function cosyvoiceTTS(text: string, voiceId: string) {
  const res = await fetch(TTS_URL, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({
      model: "cosyvoice-v3-plus",
      input: { text, voice: voiceId },
      parameters: { format: "mp3", sample_rate: 22050 },
    }),
  });
  if (!res.ok) throw new Error(`cosyvoice ${res.status}: ${await readSlice(res)}`);
  const j = (await res.json()) as { output?: { audio?: { url?: string }; url?: string } };
  const url = j.output?.audio?.url || j.output?.url;
  if (!url) throw new Error("cosyvoice returned no audio url");
  return url;
}

/** Enroll a cloned voice from a short reference audio clip. */
export async function voiceEnroll(referenceAudioUrl: string, label: string) {
  const res = await fetch(VOICE_ENROLL_URL, {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({
      model: "voice-enrollment",
      input: { audio_url: referenceAudioUrl, voice_name: label },
    }),
  });
  if (!res.ok) throw new Error(`voice-enrollment ${res.status}: ${await readSlice(res)}`);
  const j = (await res.json()) as { output?: { voice_id?: string } };
  const id = j.output?.voice_id;
  if (!id) throw new Error("voice-enrollment returned no voice_id");
  return id;
}