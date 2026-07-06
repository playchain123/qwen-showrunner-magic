import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  runDirector,
  runScreenwriter,
  runArtDirector,
  runVoiceCaster,
  runShotPlanner,
  runShotRenderer,
  renderOneShot,
  runFullPipeline,
} from "./pipeline.server";

const BibleIdInput = (input: unknown) => z.object({ bibleId: z.string().uuid() }).parse(input);

export const createBible = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        brief: z.string().min(10).max(4000),
        projectId: z.string().max(120).optional().default("default"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("story_bibles")
      .insert({
        user_id: context.userId,
        project_id: data.projectId,
        brief: data.brief,
        status: "draft",
        stage: "created",
        plan: {},
        style_bible: {},
        global_seed: Math.floor(Math.random() * 2_000_000_000),
      })
      .select("id")
      .single();
    if (error || !row) throw new Error(`Failed to create bible: ${error?.message}`);
    return { id: row.id };
  });

export const getBible = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(BibleIdInput)
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const [bible, chars, locs, scenes, shots] = await Promise.all([
      sb.from("story_bibles").select("*").eq("id", data.bibleId).single(),
      sb.from("bible_characters").select("*").eq("bible_id", data.bibleId).order("token"),
      sb.from("bible_locations").select("*").eq("bible_id", data.bibleId).order("token"),
      sb.from("bible_scenes").select("*").eq("bible_id", data.bibleId).order("scene_index"),
      sb.from("bible_shots").select("*").eq("bible_id", data.bibleId).order("shot_index"),
    ]);
    if (bible.error) throw new Error(bible.error.message);
    return {
      bible: bible.data,
      characters: chars.data ?? [],
      locations: locs.data ?? [],
      scenes: scenes.data ?? [],
      shots: shots.data ?? [],
    };
  });

export const listBibles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("story_bibles")
      .select("id,brief,stage,status,updated_at")
      .order("updated_at", { ascending: false })
      .limit(30);
    return { bibles: data ?? [] };
  });

// Individual stage endpoints for UI-driven step-through:

export const stageDirector = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(BibleIdInput)
  .handler(({ data, context }) => runDirector(context.supabase, context.userId, data.bibleId));

export const stageScreenwriter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(BibleIdInput)
  .handler(({ data, context }) => runScreenwriter(context.supabase, context.userId, data.bibleId));

export const stageArtDirector = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(BibleIdInput)
  .handler(({ data, context }) => runArtDirector(context.supabase, context.userId, data.bibleId));

export const stageVoiceCaster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(BibleIdInput)
  .handler(({ data, context }) => runVoiceCaster(context.supabase, context.userId, data.bibleId));

export const stageShotPlanner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(BibleIdInput)
  .handler(({ data, context }) => runShotPlanner(context.supabase, context.userId, data.bibleId));

export const stageShotRenderer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(BibleIdInput)
  .handler(({ data, context }) => runShotRenderer(context.supabase, context.userId, data.bibleId));

export const renderShot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ bibleId: z.string().uuid(), shotId: z.string().uuid() }).parse(input),
  )
  .handler(({ data, context }) => renderOneShot(context.supabase, context.userId, data.bibleId, data.shotId));

export const runPipeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(BibleIdInput)
  .handler(({ data, context }) => runFullPipeline(context.supabase, context.userId, data.bibleId));