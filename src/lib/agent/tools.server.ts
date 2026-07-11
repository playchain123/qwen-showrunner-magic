// Tool catalog for the Makers agent orchestrator.
// Every tool returns a compact JSON result so the model can plan on it.
// Large media (images, videos) are represented as URLs, never inlined.
//
// Only Qwen (via existing bible pipeline stages) and Happyhorse are called.

import { tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  runDirector,
  runScreenwriter,
  runArtDirector,
  runVoiceCaster,
  runShotPlanner,
  runShotRenderer,
} from "@/lib/bible/pipeline.server";
import { happyhorseImage, happyhorseVideo } from "./happyhorse.server";

type SB = SupabaseClient<Database>;

export function buildMakersTools(sb: SB, userId: string, bibleId: string) {
  return {
    build_bible: tool({
      description:
        "Establish the film's premise, tone, and main characters. Run this first if the bible has no logline yet.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const bible = await runDirector(sb, userId, bibleId);
          return { ok: true, logline: bible?.logline || "", tone: bible?.tone || "" };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    write_script: tool({
      description: "Write the beat-by-beat screenplay based on the bible. Requires build_bible first.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const script = await runScreenwriter(sb, userId, bibleId);
          return { ok: true, beat_count: Array.isArray(script?.beats) ? script.beats.length : 0 };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    art_direction: tool({
      description: "Lock the visual palette, camera language, and character continuity anchors.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const art = await runArtDirector(sb, userId, bibleId);
          return { ok: true, palette: art?.palette || null };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    cast_voices: tool({
      description: "Assign Qwen TTS voices to characters.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const voices = await runVoiceCaster(sb, userId, bibleId);
          return { ok: true, casted: voices?.length ?? 0 };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    plan_storyboard: tool({
      description: "Break the script into shot-by-shot storyboard with camera and composition notes.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const shots = await runShotPlanner(sb, userId, bibleId);
          return { ok: true, shot_count: Array.isArray(shots) ? shots.length : 0 };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    render_shots: tool({
      description:
        "Render all planned shots into video clips (Wan i2v primary, Happyhorse fallback for scenes that fail).",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const rendered = await runShotRenderer(sb, userId, bibleId);
          return { ok: true, rendered_count: Array.isArray(rendered) ? rendered.length : 0 };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    happyhorse_image: tool({
      description: "Emergency image fallback via Happyhorse. Use only when a Qwen image call fails twice.",
      inputSchema: z.object({ prompt: z.string() }),
      execute: async ({ prompt }) => happyhorseImage(prompt),
    }),

    happyhorse_video: tool({
      description: "Emergency i2v fallback via Happyhorse. Use only when a Wan call fails twice.",
      inputSchema: z.object({
        image_url: z.string(),
        prompt: z.string(),
        duration_seconds: z.number(),
      }),
      execute: async ({ image_url, prompt, duration_seconds }) =>
        happyhorseVideo(image_url, prompt, duration_seconds),
    }),

    ask_user: tool({
      description:
        "Ask the human a clarifying question mid-flow. The stream pauses; the next user message is their answer.",
      inputSchema: z.object({
        question: z.string(),
        choices: z.array(z.string()).optional(),
      }),
      execute: async ({ question, choices }) => ({ ok: true, question, choices: choices ?? [] }),
    }),
  } as const;
}

export const MAKERS_SYSTEM_PROMPT = `You are the Makers showrunner agent.

You produce short dramas end-to-end using only Qwen (script, image, video, TTS) and Happyhorse (image/video fallback). No other providers exist.

House rules:
- Maximum 3 scenes and 15 seconds of total video per project (demo limits).
- Always run in this order the first time: build_bible -> write_script -> art_direction -> cast_voices -> plan_storyboard -> render_shots.
- If a tool returns { ok: false }, decide: retry once, fall back to happyhorse_image / happyhorse_video, or ask_user for guidance.
- After render_shots succeeds, stop and tell the user the film is ready.
- Keep chat replies short (<= 2 sentences). The user watches tool activity in the UI.
- Use ask_user only for genuine ambiguity (missing character name, unclear tone), not for confirmations.`;