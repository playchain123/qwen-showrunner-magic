import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  BibleSnapshot,
  CharacterRow,
  LocationRow,
  SceneRow,
  ShotRow,
  StoryBibleRow,
} from "./types";

const Input = z.object({ bibleId: z.string().uuid() });

export const getBibleSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<BibleSnapshot | null> => {
    const { data: bible } = await context.supabase
      .from("story_bibles")
      .select("*")
      .eq("id", data.bibleId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!bible) return null;

    const [chars, locs, scenes, shots] = await Promise.all([
      context.supabase.from("bible_characters").select("*").eq("bible_id", bible.id).order("created_at"),
      context.supabase.from("bible_locations").select("*").eq("bible_id", bible.id).order("created_at"),
      context.supabase.from("bible_scenes").select("*").eq("bible_id", bible.id).order("scene_index"),
      context.supabase.from("bible_shots").select("*").eq("bible_id", bible.id).order("shot_index"),
    ]);

    return {
      bible: bible as unknown as StoryBibleRow,
      characters: (chars.data || []) as unknown as CharacterRow[],
      locations: (locs.data || []) as unknown as LocationRow[],
      scenes: (scenes.data || []) as unknown as SceneRow[],
      shots: (shots.data || []) as unknown as ShotRow[],
    };
  });

const ListInput = z.object({ projectId: z.string().min(1).max(128).optional() });

export const listStoryBibles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<StoryBibleRow[]> => {
    let q = context.supabase
      .from("story_bibles")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (data.projectId) q = q.eq("project_id", data.projectId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows || []) as unknown as StoryBibleRow[];
  });