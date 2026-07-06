import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { DirectorPlan, StyleBible, StoryBibleRow } from "./types";

const CreateInput = z.object({
  projectId: z.string().min(1).max(128),
  brief: z.string().min(10).max(4000),
});

const PlanInput = z.object({ bibleId: z.string().uuid() });

const SYSTEM = `You are the Director agent for a short-video generation pipeline.
You produce a JSON plan that later agents will treat as the single source of truth.
You MUST NOT invent facts outside the user brief. Prefer 1-3 characters and 1-3 locations for short videos.
Return STRICT JSON matching this TypeScript type (no prose, no code fences):
{
  "plan": {
    "logline": string,
    "synopsis": string,
    "target_seconds": number,      // 10-60
    "acts": [{ "name": string, "summary": string }],
    "characters": [{
      "token": string,             // snake_case unique id, e.g. "maya"
      "name": string,
      "description": string,       // physical traits, wardrobe, age. Concrete, visual.
      "role": "protagonist" | "supporting" | "antagonist" | "narrator"
    }],
    "locations": [{
      "token": string,             // snake_case, e.g. "rain_alley"
      "name": string,
      "description": string        // concrete visual details
    }]
  },
  "style_bible": {
    "palette": [string, string, string, string],  // hex colors
    "lighting": string,
    "lens": string,
    "film_stock": string,
    "aspect_ratio": "16:9" | "9:16" | "1:1",
    "tone": string,
    "negative_prompt": string
  }
}`;

export const createStoryBible = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: row, error } = await context.supabase
      .from("story_bibles")
      .insert({
        user_id: context.userId,
        project_id: data.projectId,
        brief: data.brief,
        status: "draft",
        stage: "director",
      })
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message || "Failed to create story bible");
    return { id: row.id };
  });

export const runDirector = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PlanInput.parse(input))
  .handler(async ({ data, context }): Promise<StoryBibleRow> => {
    const { data: bible, error: readErr } = await context.supabase
      .from("story_bibles")
      .select("*")
      .eq("id", data.bibleId)
      .eq("user_id", context.userId)
      .single();
    if (readErr || !bible) throw new Error(readErr?.message || "Bible not found");

    const { callGatewayJson } = await import("./gateway.server");
    const result = await callGatewayJson<{ plan: DirectorPlan; style_bible: StyleBible }>({
      system: SYSTEM,
      user: `USER BRIEF:\n${bible.brief}\n\nReturn the JSON now.`,
      temperature: 0.7,
    });

    // Persist plan + style bible on the parent row, and materialize characters & locations.
    const { error: updErr } = await context.supabase
      .from("story_bibles")
      .update({
        plan: result.plan as unknown as never,
        style_bible: result.style_bible as unknown as never,
        stage: "screenwriter",
        status: "running",
      })
      .eq("id", bible.id)
      .eq("user_id", context.userId);
    if (updErr) throw new Error(updErr.message);

    // Wipe & recreate characters/locations for this bible (director step is idempotent).
    await context.supabase.from("bible_characters").delete().eq("bible_id", bible.id);
    await context.supabase.from("bible_locations").delete().eq("bible_id", bible.id);

    if (result.plan.characters?.length) {
      const rows = result.plan.characters.map((c) => ({
        bible_id: bible.id,
        user_id: context.userId,
        token: c.token,
        name: c.name,
        description: c.description,
      }));
      const { error } = await context.supabase.from("bible_characters").insert(rows);
      if (error) throw new Error(`Insert characters failed: ${error.message}`);
    }
    if (result.plan.locations?.length) {
      const rows = result.plan.locations.map((l) => ({
        bible_id: bible.id,
        user_id: context.userId,
        token: l.token,
        name: l.name,
        description: l.description,
      }));
      const { error } = await context.supabase.from("bible_locations").insert(rows);
      if (error) throw new Error(`Insert locations failed: ${error.message}`);
    }

    const { data: refreshed } = await context.supabase
      .from("story_bibles")
      .select("*")
      .eq("id", bible.id)
      .single();
    return refreshed as unknown as StoryBibleRow;
  });