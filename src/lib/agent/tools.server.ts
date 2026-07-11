// Tool catalog for the Showrunner agent.
// Every stage uses ONLY Wan + Happyhorse + CosyVoice + Voice-Enrollment.
// Consistency invariants (locked character sheet, prior-frame chaining) are
// enforced inside these tool bodies — the model cannot skip them.

import { tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  wanImage,
  happyhorseI2V,
  happyhorseR2V,
  wanI2V,
  wanR2V,
  cosyvoiceTTS,
  voiceEnroll,
} from "./dashscope.server";

type SB = SupabaseClient<Database>;

type ShotPlan = {
  idx: number;
  prompt: string;
  speaker: string;
  dialogue: string;
};

const NEG =
  "low quality, blurry, watermark, text overlay, deformed hands, mutated fingers, extra limbs, changing outfit, inconsistent face";

async function loadProject(sb: SB, projectId: string) {
  const { data, error } = await sb.from("agent_projects").select("*").eq("id", projectId).single();
  if (error || !data) throw new Error(`Project not found: ${error?.message ?? "no rows"}`);
  return data;
}

export function buildShowrunnerTools(sb: SB, userId: string, projectId: string) {
  return {
    plan_story: tool({
      description:
        "Plan the film: derive logline, 1–3 characters, and a 10-shot storyboard from the user's premise. Run this once at the start.",
      inputSchema: z.object({
        premise: z.string(),
        tone: z.string().nullable(),
      }),
      execute: async ({ premise, tone }) => {
        try {
          // Ask Qwen (via dashscope chat) for a structured plan.
          const res = await fetch(
            "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: process.env.QWEN_SCRIPT_MODEL || "qwen3.7-max",
                messages: [
                  {
                    role: "system",
                    content:
                      "You plan short 10-shot cinematic films. Return STRICT JSON: {logline,tone,characters:[{name,description,wardrobe}],shots:[{idx:1..10,prompt,speaker,dialogue}]}. Every shot MUST reuse the same character names and wardrobe from the characters list — do not invent new people or change outfits. Each dialogue line is 4–14 words.",
                  },
                  {
                    role: "user",
                    content: `PREMISE: ${premise}\nTONE: ${tone ?? "cinematic"}`,
                  },
                ],
                response_format: { type: "json_object" },
                temperature: 0.7,
              }),
            },
          );
          if (!res.ok) throw new Error(`plan_story LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
          const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
          const raw = j.choices?.[0]?.message?.content ?? "{}";
          const plan = JSON.parse(raw) as {
            logline: string;
            characters: Array<{ name: string; description: string; wardrobe: string }>;
            shots: ShotPlan[];
          };
          const shots = (plan.shots || []).slice(0, 10);

          await sb
            .from("agent_projects")
            .update({
              logline: plan.logline,
              characters: plan.characters,
              shots_plan: shots,
              status: "planned",
            })
            .eq("id", projectId);

          // Seed shot rows.
          await sb.from("agent_shots").delete().eq("project_id", projectId);
          for (const s of shots) {
            await sb.from("agent_shots").insert({
              project_id: projectId,
              user_id: userId,
              idx: s.idx,
              prompt: s.prompt,
              dialogue: s.dialogue,
              speaker: s.speaker,
              status: "planned",
            });
          }
          return { ok: true, logline: plan.logline, characters: plan.characters.length, shots: shots.length };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    build_character_sheets: tool({
      description:
        "Generate the locked identity portrait for every character via wan2.7-image-pro. MUST run before any shot renders. Enforces face + wardrobe consistency across every shot.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const proj = await loadProject(sb, projectId);
          const chars = (proj.characters as Array<{ name: string; description: string; wardrobe: string }>) ?? [];
          const out: Array<{ name: string; sheet_url: string }> = [];
          for (const c of chars) {
            const prompt = `Full-body character reference sheet, front view, plain neutral studio backdrop, 35mm film still. Character: ${c.name}. ${c.description}. Wardrobe: ${c.wardrobe}. Same face, wardrobe and lighting to be reused across every shot.`;
            const url = await wanImage(prompt, { negativePrompt: NEG, size: "1280*720" });
            await sb.from("agent_voices").upsert(
              { project_id: projectId, user_id: userId, character_name: c.name, voice_id: "pending", sheet_url: url },
              { onConflict: "project_id,character_name" },
            );
            out.push({ name: c.name, sheet_url: url });
          }
          return { ok: true, sheets: out };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    enroll_voices: tool({
      description:
        "Enroll a cloned voice per character via voice-enrollment. Seed clip is synthesised with CosyVoice defaults if the user did not provide one. Run once after build_character_sheets.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const { data: voices } = await sb.from("agent_voices").select("*").eq("project_id", projectId);
          const results: Array<{ name: string; voice_id: string }> = [];
          for (const v of voices ?? []) {
            if (v.voice_id && v.voice_id !== "pending") {
              results.push({ name: v.character_name, voice_id: v.voice_id });
              continue;
            }
            // Synthesise a short seed line with default cosyvoice voice, then clone.
            const seedAudio = await cosyvoiceTTS(
              `Hello, I am ${v.character_name}. This is my voice reference.`,
              "longwan",
            );
            const voiceId = await voiceEnroll(seedAudio, `${projectId}-${v.character_name}`.slice(0, 40));
            await sb.from("agent_voices").update({ voice_id: voiceId }).eq("id", v.id);
            results.push({ name: v.character_name, voice_id: voiceId });
          }
          return { ok: true, voices: results };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    generate_storyboard_frames: tool({
      description:
        "Render one keyframe per shot via wan2.7-image-pro, seeded from the speaker's character sheet so identity is preserved.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const { data: shots } = await sb
            .from("agent_shots")
            .select("*")
            .eq("project_id", projectId)
            .order("idx");
          const { data: voices } = await sb.from("agent_voices").select("*").eq("project_id", projectId);
          const sheetByName = new Map((voices ?? []).map((v) => [v.character_name, v.sheet_url]));
          const done: number[] = [];
          for (const s of shots ?? []) {
            if (s.frame_url) {
              done.push(s.idx);
              continue;
            }
            const ref = s.speaker ? sheetByName.get(s.speaker) : undefined;
            const url = await wanImage(s.prompt, {
              referenceImageUrl: ref ?? undefined,
              negativePrompt: NEG,
              size: "1280*720",
            });
            await sb.from("agent_shots").update({ frame_url: url, status: "framed" }).eq("id", s.id);
            done.push(s.idx);
          }
          return { ok: true, framed: done };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    render_shot: tool({
      description:
        "Render one shot to video. Shot 1 uses happyhorse-1.1-i2v from the keyframe. Shots 2..10 use happyhorse-1.1-r2v seeded from the character sheet AND the prior shot's keyframe for continuity. Wan i2v/r2v is used as fallback.",
      inputSchema: z.object({ idx: z.number().int().min(1).max(10) }),
      execute: async ({ idx }) => {
        try {
          const { data: shot } = await sb
            .from("agent_shots")
            .select("*")
            .eq("project_id", projectId)
            .eq("idx", idx)
            .single();
          if (!shot) return { ok: false, error: `shot ${idx} not planned` };
          if (!shot.frame_url) return { ok: false, error: `shot ${idx} has no frame — run generate_storyboard_frames first` };

          const { data: voices } = await sb.from("agent_voices").select("*").eq("project_id", projectId);
          const sheet = voices?.find((v) => v.character_name === shot.speaker)?.sheet_url;

          let priorFrame: string | null = null;
          if (idx > 1) {
            const { data: prev } = await sb
              .from("agent_shots")
              .select("frame_url")
              .eq("project_id", projectId)
              .eq("idx", idx - 1)
              .maybeSingle();
            priorFrame = prev?.frame_url ?? null;
          }

          await sb.from("agent_shots").update({ status: "rendering" }).eq("id", shot.id);
          let videoUrl: string;
          try {
            if (idx === 1) {
              videoUrl = await happyhorseI2V(shot.frame_url, `${shot.prompt}. ${NEG ? "" : ""}`);
            } else {
              const refs = [sheet, priorFrame, shot.frame_url].filter(Boolean) as string[];
              videoUrl = await happyhorseR2V(refs, shot.prompt);
            }
          } catch (primaryErr) {
            console.warn("[showrunner] happyhorse failed, wan fallback", primaryErr);
            if (idx === 1) {
              videoUrl = await wanI2V(shot.frame_url, shot.prompt);
            } else {
              const refs = [sheet, priorFrame, shot.frame_url].filter(Boolean) as string[];
              videoUrl = await wanR2V(refs, shot.prompt);
            }
          }

          await sb.from("agent_shots").update({ video_url: videoUrl, status: "rendered" }).eq("id", shot.id);
          return { ok: true, idx, video_url: videoUrl };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    synth_dialogue: tool({
      description: "Synthesize dialogue for one shot via CosyVoice using the speaker's cloned voice_id.",
      inputSchema: z.object({ idx: z.number().int().min(1).max(10) }),
      execute: async ({ idx }) => {
        try {
          const { data: shot } = await sb
            .from("agent_shots")
            .select("*")
            .eq("project_id", projectId)
            .eq("idx", idx)
            .single();
          if (!shot) return { ok: false, error: `shot ${idx} not planned` };
          if (!shot.dialogue) return { ok: true, idx, skipped: true };
          const { data: voice } = await sb
            .from("agent_voices")
            .select("voice_id")
            .eq("project_id", projectId)
            .eq("character_name", shot.speaker || "")
            .maybeSingle();
          if (!voice?.voice_id || voice.voice_id === "pending") {
            return { ok: false, error: `no cloned voice for ${shot.speaker} — run enroll_voices first` };
          }
          const audioUrl = await cosyvoiceTTS(shot.dialogue, voice.voice_id);
          await sb.from("agent_shots").update({ audio_url: audioUrl }).eq("id", shot.id);
          return { ok: true, idx, audio_url: audioUrl };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    finalize_film: tool({
      description:
        "Mark the project as complete. Client stitches the ordered shot video+audio pairs for playback (no server-side ffmpeg in the edge runtime).",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const { data: shots } = await sb
            .from("agent_shots")
            .select("idx,video_url,audio_url,status")
            .eq("project_id", projectId)
            .order("idx");
          const rendered = (shots ?? []).filter((s) => s.video_url).length;
          await sb
            .from("agent_projects")
            .update({ status: rendered === 10 ? "complete" : "partial" })
            .eq("id", projectId);
          return { ok: true, rendered, total: shots?.length ?? 0 };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    ask_user: tool({
      description: "Ask the human a clarifying question when the premise is genuinely ambiguous. Do NOT use for confirmations.",
      inputSchema: z.object({
        question: z.string(),
        choices: z.array(z.string()).nullable(),
      }),
      execute: async ({ question, choices }) => ({ ok: true, question, choices: choices ?? [] }),
    }),
  } as const;
}

export const SHOWRUNNER_SYSTEM_PROMPT = `You are the Makers Showrunner agent.

You produce 10-shot cinematic films end-to-end using ONLY these Qwen Cloud models:
- wan2.7-image-pro for every still image (character sheets + storyboard keyframes)
- happyhorse-1.1-i2v for shot 1 video, happyhorse-1.1-r2v for shots 2–10 (continuity)
- wan2.7-i2v / wan2.7-r2v-2026-06-12 as automatic fallbacks (tool handles this)
- voice-enrollment to clone a voice per character, cosyvoice-v3-plus for dialogue TTS
No other providers exist.

CANONICAL FLOW (run once, in order):
1. plan_story({ premise, tone })
2. build_character_sheets()
3. enroll_voices()
4. generate_storyboard_frames()
5. render_shot({ idx: 1 }) → render_shot({ idx: 2 }) → … → render_shot({ idx: 10 })
6. synth_dialogue({ idx: 1..10 }) for every shot that has dialogue
7. finalize_film()

HOUSE RULES:
- Character consistency is non-negotiable: the tools already inject the locked character sheet + prior keyframe as references — do not try to route around them.
- If a tool returns { ok: false }, retry that same tool once with the same args before giving up. Do not switch models manually; fallbacks are automatic inside render_shot.
- Keep chat replies to ≤ 2 sentences. The user watches shot cards update live.
- Use ask_user only when the premise is genuinely ambiguous (missing subject, unclear language).`;