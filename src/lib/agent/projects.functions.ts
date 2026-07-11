import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const ensureAgentProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().nullable(),
        premise: z.string().min(1).max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.id) {
      const { data: existing } = await supabase
        .from("agent_projects")
        .select("id, premise, logline, status, characters, shots_plan")
        .eq("id", data.id)
        .eq("user_id", userId)
        .maybeSingle();
      if (existing) return existing;
    }
    const insertRow: {
      user_id: string;
      premise: string;
      status: string;
      id?: string;
    } = { user_id: userId, premise: data.premise, status: "draft" };
    if (data.id) insertRow.id = data.id;
    const { data: created, error } = await supabase
      .from("agent_projects")
      .insert(insertRow)
      .select("id, premise, logline, status, characters, shots_plan")
      .single();
    if (error) throw new Error(error.message);
    return created;
  });

export const listAgentShots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("agent_shots")
      .select("idx, prompt, speaker, dialogue, frame_url, video_url, audio_url, status")
      .eq("project_id", data.projectId)
      .order("idx");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });