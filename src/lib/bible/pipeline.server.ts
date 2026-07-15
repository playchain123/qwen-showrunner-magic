// Story Bible pipeline: all agent business logic.
// Called from bible.functions.ts server functions.
// Uses only Wan + HappyHorse for motion; Qwen-Image for stills.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type SB = SupabaseClient<Database>;

const DASHSCOPE_BASE = "https://dashscope-intl.aliyuncs.com";
const CHAT_URL = `${DASHSCOPE_BASE}/compatible-mode/v1/chat/completions`;
const IMAGE_URL = `${DASHSCOPE_BASE}/api/v1/services/aigc/multimodal-generation/generation`;
const VIDEO_SUBMIT_URL = `${DASHSCOPE_BASE}/api/v1/services/aigc/video-generation/video-synthesis`;
const TASK_URL = (id: string) => `${DASHSCOPE_BASE}/api/v1/tasks/${id}`;
const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev";

const QWEN_VOICES = ["Cherry", "Ethan", "Serena", "Chelsie", "Dylan", "Jada", "Sunny"];
const VIDEO_POLL_TIMEOUT_MS = 360_000;

function dashKey() {
  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) throw new Error("DASHSCOPE_API_KEY not configured");
  return key;
}

function lovKey() {
  return process.env.LOVABLE_API_KEY || "";
}

async function llmJson<T>(system: string, user: string, maxTokens = 3000): Promise<T> {
  // Try Qwen first, fall back to Lovable AI gateway (Gemini) for JSON planning.
  const key = process.env.DASHSCOPE_API_KEY;
  if (key) {
    try {
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.QWEN_SCRIPT_MODEL || "qwen-plus",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
          temperature: 0.75,
          max_tokens: maxTokens,
        }),
      });
      if (res.ok) {
        const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = j.choices?.[0]?.message?.content;
        if (content) return JSON.parse(content) as T;
      }
    } catch (err) {
      console.warn("[bible] qwen llm failed, trying gateway", err);
    }
  }
  const lk = lovKey();
  if (!lk) throw new Error("No LLM available (DASHSCOPE_API_KEY and LOVABLE_API_KEY both missing)");
  const res = await fetch(`${LOVABLE_GATEWAY}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${lk}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`LLM gateway failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = j.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned no content");
  return JSON.parse(content) as T;
}

function randomSeed() {
  return Math.floor(Math.random() * 2_000_000_000);
}

async function loadBible(sb: SB, bibleId: string) {
  const { data, error } = await sb.from("story_bibles").select("*").eq("id", bibleId).single();
  if (error || !data) throw new Error(`Bible not found: ${error?.message ?? "no rows"}`);
  return data;
}

async function setStage(sb: SB, bibleId: string, stage: string, status = "in_progress") {
  await sb.from("story_bibles").update({ stage, status, updated_at: new Date().toISOString() }).eq("id", bibleId);
}

// ─────────────────────────────────────────────────────────────
// DIRECTOR — brief → plan + style bible + characters + locations
// ─────────────────────────────────────────────────────────────

type DirectorOutput = {
  logline: string;
  tone: string;
  characters: Array<{ token: string; name: string; description: string }>;
  locations: Array<{ token: string; name: string; description: string; palette: string[]; lighting: string }>;
  style_bible: {
    palette: string[];
    lighting: string;
    film_stock: string;
    camera: string;
    negative_prompt: string;
    style_suffix: string;
  };
};

export async function runDirector(sb: SB, userId: string, bibleId: string) {
  const bible = await loadBible(sb, bibleId);
  await setStage(sb, bibleId, "director");

  const system = [
    "You are the Director agent of a short-drama pipeline that uses ONLY Wan and HappyHorse video models.",
    "Given a brief, produce a compact story plan and visual style bible.",
    "Every character MUST have a short lowercase token (e.g. 'maya','deven'). Every location MUST have a lowercase token (e.g. 'rooftop','clinic_hall').",
    "Use 2-3 characters and 2-3 locations. Keep descriptions concrete and visual — face, hair, wardrobe, age, ethnicity for characters; interior/exterior, materials, era, mood for locations.",
    "style_bible.style_suffix is a short trailing prompt fragment (~30 words) appended to every image/video prompt to lock the look.",
    "Return STRICT JSON: {logline,tone,characters:[{token,name,description}],locations:[{token,name,description,palette:[hex...],lighting}],style_bible:{palette:[hex...],lighting,film_stock,camera,negative_prompt,style_suffix}}",
  ].join("\n");

  const out = await llmJson<DirectorOutput>(system, `BRIEF:\n${bible.brief}`, 2400);

  const globalSeed = randomSeed();
  await sb.from("story_bibles").update({
    plan: { logline: out.logline, tone: out.tone },
    style_bible: out.style_bible,
    global_seed: globalSeed,
    stage: "director_done",
    status: "ready",
    updated_at: new Date().toISOString(),
  }).eq("id", bibleId);

  // Clear old character/location rows for this bible before re-materializing.
  await sb.from("bible_characters").delete().eq("bible_id", bibleId);
  await sb.from("bible_locations").delete().eq("bible_id", bibleId);

  for (const c of out.characters.slice(0, 4)) {
    await sb.from("bible_characters").insert({
      bible_id: bibleId,
      user_id: userId,
      token: c.token.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40),
      name: c.name,
      description: c.description,
      visual_seed: randomSeed(),
    });
  }
  for (const l of out.locations.slice(0, 4)) {
    await sb.from("bible_locations").insert({
      bible_id: bibleId,
      user_id: userId,
      token: l.token.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40),
      name: l.name,
      description: l.description,
      palette: l.palette,
      lighting: l.lighting,
    });
  }
  return { ok: true, characters: out.characters.length, locations: out.locations.length };
}

// ─────────────────────────────────────────────────────────────
// SCREENWRITER — plan → scenes with dialogue (locked once written)
// ─────────────────────────────────────────────────────────────

type SwOutput = {
  scenes: Array<{
    scene_index: number;
    location_token: string;
    character_tokens: string[];
    beat: string;
    dialogue: Array<{ character_token: string; line: string; duration_estimate: number }>;
  }>;
};

export async function runScreenwriter(sb: SB, userId: string, bibleId: string) {
  const bible = await loadBible(sb, bibleId);
  const { data: chars } = await sb.from("bible_characters").select("token,name,description").eq("bible_id", bibleId);
  const { data: locs } = await sb.from("bible_locations").select("token,name,description").eq("bible_id", bibleId);
  if (!chars?.length || !locs?.length) throw new Error("Director stage incomplete: no characters or locations");
  await setStage(sb, bibleId, "screenwriter");

  const system = [
    "You are the Screenwriter agent. Produce a scene list for a ~15 second short drama.",
    "Constraints: 3-5 scenes total; each scene 3-5 seconds; every scene references EXISTING character tokens and location tokens (do NOT invent new ones).",
    "Each scene has at most one dialogue line, 4-12 words, spoken by a real on-screen character (never a narrator).",
    "Return STRICT JSON: {scenes:[{scene_index,location_token,character_tokens:[...],beat,dialogue:[{character_token,line,duration_estimate}]}]}",
  ].join("\n");

  const user = [
    `LOGLINE: ${(bible.plan as { logline?: string } | null)?.logline ?? ""}`,
    `TONE: ${(bible.plan as { tone?: string } | null)?.tone ?? ""}`,
    `CHARACTERS: ${chars.map((c) => `${c.token}=${c.name} (${c.description})`).join(" | ")}`,
    `LOCATIONS: ${locs.map((l) => `${l.token}=${l.name} (${l.description})`).join(" | ")}`,
  ].join("\n");

  const out = await llmJson<SwOutput>(system, user, 2200);
  const validCharTokens = new Set(chars.map((c) => c.token));
  const validLocTokens = new Set(locs.map((l) => l.token));

  // Wipe old scenes/shots to keep pipeline deterministic on re-runs.
  await sb.from("bible_shots").delete().eq("bible_id", bibleId);
  await sb.from("bible_scenes").delete().eq("bible_id", bibleId);

  const locMap = new Map(locs.map((l) => [l.token, l]));
  const { data: allLocRows } = await sb.from("bible_locations").select("id,token").eq("bible_id", bibleId);
  const { data: allCharRows } = await sb.from("bible_characters").select("id,token").eq("bible_id", bibleId);
  const locIdByToken = new Map((allLocRows ?? []).map((r) => [r.token, r.id]));
  const charIdByToken = new Map((allCharRows ?? []).map((r) => [r.token, r.id]));

  const cleanScenes = out.scenes
    .filter((s) => validLocTokens.has(s.location_token) && s.character_tokens.every((t) => validCharTokens.has(t)))
    .slice(0, 5);

  for (const s of cleanScenes) {
    const locId = locIdByToken.get(s.location_token) ?? null;
    const charIds = s.character_tokens.map((t) => charIdByToken.get(t)).filter(Boolean) as string[];
    const totalDur = s.dialogue.reduce((a, d) => a + Math.max(1, Math.min(6, d.duration_estimate || 3)), 0) || 4;
    await sb.from("bible_scenes").insert({
      bible_id: bibleId,
      user_id: userId,
      scene_index: s.scene_index,
      location_id: locId,
      character_ids: charIds,
      beat: s.beat,
      dialogue: s.dialogue,
      duration_estimate: totalDur,
      locked: true,
    });
  }
  await setStage(sb, bibleId, "screenwriter_done", "ready");
  return { ok: true, scenes: cleanScenes.length, ignored: out.scenes.length - cleanScenes.length };
}

// ─────────────────────────────────────────────────────────────
// ART DIRECTOR — generate reference stills for characters/locations
// via qwen-image (LLM-side image gen used only for identity anchors)
// ─────────────────────────────────────────────────────────────

async function generateStill(prompt: string, negativePrompt: string): Promise<string> {
  const res = await fetch(IMAGE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${dashKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.QWEN_IMAGE_MODEL || "qwen-image-2.0",
      input: { messages: [{ role: "user", content: [{ text: prompt }] }] },
      parameters: {
        negative_prompt: negativePrompt,
        prompt_extend: true,
        watermark: false,
        size: "1280*720",
        n: 1,
      },
    }),
  });
  if (!res.ok) throw new Error(`qwen-image failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as {
    output?: { choices?: Array<{ message?: { content?: Array<{ image?: string }> } }> };
  };
  const url = j.output?.choices?.[0]?.message?.content?.find((x) => x.image)?.image;
  if (!url) throw new Error("qwen-image returned no image");
  return url;
}

export async function runArtDirector(sb: SB, _userId: string, bibleId: string) {
  const bible = await loadBible(sb, bibleId);
  const style = (bible.style_bible ?? {}) as {
    style_suffix?: string;
    negative_prompt?: string;
    film_stock?: string;
    camera?: string;
    lighting?: string;
  };
  const suffix = style.style_suffix || "cinematic film still, 35mm, natural lighting, high detail";
  const neg = style.negative_prompt || "cartoon, illustration, watermark, text overlay, blurry, deformed hands";
  await setStage(sb, bibleId, "art_director");

  const { data: chars } = await sb.from("bible_characters").select("*").eq("bible_id", bibleId);
  for (const c of chars ?? []) {
    if (c.ref_image_url) continue;
    try {
      const prompt = `Character reference sheet for ${c.name}. ${c.description}. Front view, neutral expression, plain neutral background, full body visible. ${suffix}`;
      const url = await generateStill(prompt, neg);
      await sb.from("bible_characters").update({ ref_image_url: url, updated_at: new Date().toISOString() }).eq("id", c.id);
    } catch (err) {
      console.warn(`[bible] character ref failed for ${c.token}`, err);
    }
  }

  const { data: locs } = await sb.from("bible_locations").select("*").eq("bible_id", bibleId);
  for (const l of locs ?? []) {
    if (l.ref_image_url) continue;
    try {
      const prompt = `Establishing plate of ${l.name}: ${l.description}. Empty environment, no people. Lighting: ${l.lighting || style.lighting || "natural"}. ${suffix}`;
      const url = await generateStill(prompt, neg);
      await sb.from("bible_locations").update({ ref_image_url: url, updated_at: new Date().toISOString() }).eq("id", l.id);
    } catch (err) {
      console.warn(`[bible] location ref failed for ${l.token}`, err);
    }
  }
  await setStage(sb, bibleId, "art_director_done", "ready");
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// VOICE CASTER — assign one Qwen voice per character (deterministic)
// ─────────────────────────────────────────────────────────────

export async function runVoiceCaster(sb: SB, _userId: string, bibleId: string) {
  await setStage(sb, bibleId, "voice_caster");
  const { data: chars } = await sb.from("bible_characters").select("id,token,voice_id").eq("bible_id", bibleId);
  const taken = new Set<string>();
  for (const c of chars ?? []) if (c.voice_id) taken.add(c.voice_id);
  for (const c of chars ?? []) {
    if (c.voice_id) continue;
    let hash = 0;
    for (let i = 0; i < c.token.length; i++) hash = (hash * 31 + c.token.charCodeAt(i)) >>> 0;
    let pick = QWEN_VOICES[hash % QWEN_VOICES.length];
    let attempt = 0;
    while (taken.has(pick) && attempt < QWEN_VOICES.length) {
      pick = QWEN_VOICES[(hash + attempt + 1) % QWEN_VOICES.length];
      attempt += 1;
    }
    taken.add(pick);
    await sb.from("bible_characters").update({ voice_id: pick, updated_at: new Date().toISOString() }).eq("id", c.id);
  }
  await setStage(sb, bibleId, "voice_caster_done", "ready");
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// SHOT PLANNER — scenes → shots (inherit refs, seeds, dialogue slice)
// ─────────────────────────────────────────────────────────────

export async function runShotPlanner(sb: SB, userId: string, bibleId: string) {
  await setStage(sb, bibleId, "shot_planner");
  const { data: scenes } = await sb.from("bible_scenes").select("*").eq("bible_id", bibleId).order("scene_index");
  const { data: chars } = await sb.from("bible_characters").select("id,token,visual_seed").eq("bible_id", bibleId);
  const charById = new Map((chars ?? []).map((c) => [c.id, c]));

  await sb.from("bible_shots").delete().eq("bible_id", bibleId);

  for (const scene of scenes ?? []) {
    const primaryCharId = scene.character_ids[0];
    const primaryChar = primaryCharId ? charById.get(primaryCharId) : null;
    const seed = primaryChar?.visual_seed ?? randomSeed();
    const dialogue = (scene.dialogue as Array<{ character_token: string; line: string }>) ?? [];
    const primaryLine = dialogue[0]?.line ?? "";
    const camera = dialogue.length ? "medium close-up, subtle push-in" : "wide establishing, slow dolly";
    const visual = `${scene.beat}. ${primaryLine ? `Speaking: "${primaryLine}".` : ""} Camera: ${camera}. Locked characters and location per reference.`;
    await sb.from("bible_shots").insert({
      bible_id: bibleId,
      user_id: userId,
      scene_id: scene.id,
      shot_index: 0,
      character_ids: scene.character_ids,
      location_id: scene.location_id,
      dialogue_slice: dialogue,
      visual_prompt: visual,
      camera,
      seed,
      duration_seconds: scene.duration_estimate,
      status: "planned",
      attempt_count: 0,
    });
  }
  await setStage(sb, bibleId, "shot_planner_done", "ready");
  return { ok: true, shots: scenes?.length ?? 0 };
}

// ─────────────────────────────────────────────────────────────
// SHOT RENDERER — HappyHorse i2v from character keyframe (per shot)
// If character ref exists → i2v; else falls back to Wan t2v.
// ─────────────────────────────────────────────────────────────

async function submitVideoTask(model: string, prompt: string, imageUrl?: string) {
  const isModernWan = /^wan2\.[567]-/.test(model);
  const isI2v = model.includes("-i2v");
  const res = await fetch(VIDEO_SUBMIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${dashKey()}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify({
      model,
      input: imageUrl ? { prompt, img_url: imageUrl } : { prompt },
      parameters: isModernWan
        ? {
            resolution: "720P",
            duration: 5,
            prompt_extend: true,
            watermark: false,
            audio: false,
            ...(model.startsWith("wan2.6-") ? { shot_type: "multi" } : {}),
          }
        : { size: "1280*720" },
    }),
  });
  if (!res.ok) throw new Error(`video submit ${model} failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { output?: { task_id?: string } };
  const taskId = j.output?.task_id;
  if (!taskId) throw new Error(`${model} returned no task_id`);
  return taskId;
}

async function pollVideoTask(taskId: string, timeoutMs = 240_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 6000));
    const res = await fetch(TASK_URL(taskId), { headers: { Authorization: `Bearer ${dashKey()}` } });
    if (!res.ok) continue;
    const j = (await res.json()) as {
      output?: { task_status?: string; video_url?: string; message?: string };
    };
    const status = j.output?.task_status;
    if (status === "SUCCEEDED" && j.output?.video_url) return j.output.video_url;
    if (status === "FAILED") throw new Error(`Video task failed: ${j.output?.message ?? "unknown"}`);
  }
  throw new Error("Video task timed out");
}

export async function renderOneShot(sb: SB, _userId: string, bibleId: string, shotId: string) {
  const bible = await loadBible(sb, bibleId);
  const style = (bible.style_bible ?? {}) as { style_suffix?: string };
  const suffix = style.style_suffix || "cinematic 35mm, natural lighting, high detail";

  const { data: shot, error } = await sb.from("bible_shots").select("*").eq("id", shotId).single();
  if (error || !shot) throw new Error(`Shot not found: ${error?.message}`);

  const primaryCharId = shot.character_ids[0];
  let refImg: string | null = null;
  if (primaryCharId) {
    const { data: c } = await sb.from("bible_characters").select("ref_image_url,name").eq("id", primaryCharId).maybeSingle();
    refImg = c?.ref_image_url ?? null;
  }
  if (!refImg && shot.location_id) {
    const { data: l } = await sb.from("bible_locations").select("ref_image_url").eq("id", shot.location_id).maybeSingle();
    refImg = l?.ref_image_url ?? null;
  }

  await sb.from("bible_shots").update({ status: "rendering", attempt_count: shot.attempt_count + 1, updated_at: new Date().toISOString() }).eq("id", shotId);

  const motionPrompt = `${shot.visual_prompt} ${suffix}. Single continuous ${Math.round(Number(shot.duration_seconds))}-second cinematic shot.`;
  const models = refImg
    ? ["wan2.6-i2v-flash", "wan2.6-i2v", "wan2.7-i2v", "wan2.2-i2v-plus", "happyhorse-1.1-i2v"]
    : ["wan2.2-t2v-plus", "happyhorse-1.1-t2v"];

  let clipUrl = "";
  const failures: string[] = [];
  for (const model of models) {
    try {
      if (model === "happyhorse-1.1-i2v" && refImg) {
        const { happyhorseVideo } = await import("@/lib/agent/happyhorse.server");
        const direct = await happyhorseVideo(refImg, motionPrompt, 5);
        if (!direct.ok) throw new Error(direct.error);
        clipUrl = direct.url;
      } else {
        const taskId = await submitVideoTask(model, motionPrompt, refImg ?? undefined);
        clipUrl = await pollVideoTask(taskId, VIDEO_POLL_TIMEOUT_MS);
      }
      break;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`${model}: ${message}`);
      console.warn(`[bible] ${model} failed`, message);
    }
  }
  if (!clipUrl) {
    throw new Error(`All video engines failed: ${failures.join(" | ")}`.slice(0, 900));
  }

  await sb.from("bible_shots").update({
    clip_url: clipUrl,
    status: "rendered",
    updated_at: new Date().toISOString(),
  }).eq("id", shotId);
  return { ok: true, clip_url: clipUrl };
}

export async function runShotRenderer(sb: SB, userId: string, bibleId: string) {
  await setStage(sb, bibleId, "shot_renderer");
  const { data: shots } = await sb.from("bible_shots").select("id,status").eq("bible_id", bibleId).order("shot_index");
  const pending = (shots ?? []).filter((s) => s.status === "planned" || s.status === "failed");
  let done = 0;
  for (const s of pending) {
    try {
      await renderOneShot(sb, userId, bibleId, s.id);
      done += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[bible] shot ${s.id} failed`, message);
      await sb.from("bible_shots").update({
        status: "failed",
        qc_notes: message.slice(0, 400),
        updated_at: new Date().toISOString(),
      }).eq("id", s.id);
    }
  }
  await setStage(sb, bibleId, "shot_renderer_done", "ready");
  return { ok: true, rendered: done, total: pending.length };
}

// ─────────────────────────────────────────────────────────────
// ORCHESTRATOR — run every stage in order
// ─────────────────────────────────────────────────────────────

export async function runFullPipeline(sb: SB, userId: string, bibleId: string) {
  await runDirector(sb, userId, bibleId);
  await runScreenwriter(sb, userId, bibleId);
  await runArtDirector(sb, userId, bibleId);
  await runVoiceCaster(sb, userId, bibleId);
  await runShotPlanner(sb, userId, bibleId);
  await runShotRenderer(sb, userId, bibleId);
  await setStage(sb, bibleId, "complete", "ready");
  return { ok: true };
}