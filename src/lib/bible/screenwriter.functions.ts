import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { DirectorPlan, ScenePlan, StoryBibleRow } from "./types";

const Input = z.object({ bibleId: z.string().uuid() });

const SYSTEM = `You are the Screenwriter agent. You expand a Director's plan into an ordered scene list.
You MUST only reference characters and locations by the tokens supplied. Do NOT invent new ones.
Dialogue you write here is LOCKED — later stages will use the exact string, so make it final and speakable.
Keep total duration close to plan.target_seconds. Use 2-6 scenes for short videos.

Return STRICT JSON (no prose, no code fences):
{
  "scenes": [{
    "scene_index": number,          // 1-based, contiguous
    "location_token": string,       // must be from allowed_locations
    "character_tokens": [string],   // must be subset of allowed_characters
    "beat": string,                 // 1-2 sentence description of what happens
    "dialogue": [{                  // may be empty
      "speaker_token": string,      // must be in character_tokens
      "text": string,               // final speakable line
      "duration_est": number        // seconds
    }],
    "duration_estimate": number     // seconds, including silence
  }]
}`;

export const runScreenwriter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<{ sceneCount: number }> => {
    const { data: bible, error } = await context.supabase
      .from("story_bibles")
      .select("*")
      .eq("id", data.bibleId)
      .eq("user_id", context.userId)
      .single();
    if (error || !bible) throw new Error(error?.message || "Bible not found");
    const plan = bible.plan as unknown as DirectorPlan;
    if (!plan?.characters?.length) throw new Error("Director stage has not produced a plan yet.");

    const allowedChars = plan.characters.map((c) => c.token);
    const allowedLocs = plan.locations.map((l) => l.token);

    const { callGatewayJson } = await import("./gateway.server");
    const result = await callGatewayJson<{ scenes: ScenePlan[] }>({
      system: SYSTEM,
      user: JSON.stringify({
        logline: plan.logline,
        synopsis: plan.synopsis,
        target_seconds: plan.target_seconds,
        acts: plan.acts,
        allowed_characters: allowedChars,
        allowed_locations: allowedLocs,
      }),
      temperature: 0.6,
    });

    // Validate every referenced token exists — reject the whole batch on drift.
    for (const s of result.scenes) {
      if (!allowedLocs.includes(s.location_token)) {
        throw new Error(`Screenwriter used unknown location token "${s.location_token}"`);
      }
      for (const t of s.character_tokens) {
        if (!allowedChars.includes(t)) {
          throw new Error(`Screenwriter used unknown character token "${t}"`);
        }
      }
      for (const d of s.dialogue || []) {
        if (!s.character_tokens.includes(d.speaker_token)) {
          throw new Error(`Dialogue speaker "${d.speaker_token}" not in scene ${s.scene_index}`);
        }
      }
    }

    // Resolve tokens to bible-row ids and persist.
    const { data: chars } = await context.supabase
      .from("bible_characters")
      .select("id, token")
      .eq("bible_id", bible.id);
    const { data: locs } = await context.supabase
      .from("bible_locations")
      .select("id, token")
      .eq("bible_id", bible.id);
    const charByToken = new Map((chars || []).map((c) => [c.token, c.id]));
    const locByToken = new Map((locs || []).map((l) => [l.token, l.id]));

    await context.supabase.from("bible_scenes").delete().eq("bible_id", bible.id);

    const rows = result.scenes.map((s) => ({
      bible_id: bible.id,
      user_id: context.userId,
      scene_index: s.scene_index,
      location_id: locByToken.get(s.location_token) || null,
      character_ids: s.character_tokens
        .map((t) => charByToken.get(t))
        .filter((v): v is string => Boolean(v)),
      beat: s.beat,
      dialogue: s.dialogue as unknown as never,
      duration_estimate: s.duration_estimate,
      locked: true,
    }));
    if (rows.length) {
      const { error: insErr } = await context.supabase.from("bible_scenes").insert(rows);
      if (insErr) throw new Error(`Insert scenes failed: ${insErr.message}`);
    }

    await context.supabase
      .from("story_bibles")
      .update({ stage: "art_director" })
      .eq("id", bible.id)
      .eq("user_id", context.userId);

    return { sceneCount: rows.length };
  });

// no-op re-export to keep tree-shaking honest
export type { StoryBibleRow };