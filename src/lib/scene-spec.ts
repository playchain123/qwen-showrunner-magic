// Cinematographer Agent v2 output shape (§1.1 of the pipeline spec).
// Every downstream node (prompt compiler, model router, quality gate)
// reads from this — the Cinematographer LLM is the only writer.
import { z } from "zod";

export const SceneSpecSchema = z.object({
  scene_id: z.string(),
  subject: z.string(),
  action: z.string(),
  camera: z.object({
    shot_type: z.string(),
    angle: z.string(),
    lens_mm: z.number(),
    movement: z.string(),
  }),
  lighting: z.object({
    key_source: z.string(),
    quality: z.enum(["hard", "soft", "mixed"]),
    color_temp_k: z.number(),
    mood: z.string(),
  }),
  color_grade: z.object({
    reference_stock_or_look: z.string(),
    contrast: z.enum(["low", "medium", "high"]),
  }),
  environment: z.object({
    location: z.string(),
    atmosphere: z.string(),
  }),
  continuity_anchor: z.object({
    character_token: z.string(),
    wardrobe_token: z.string(),
    prior_scene_ref: z.string().nullable(),
  }),
  positive_prompt: z.string(),
  negative_prompt: z.string(),
  reference_image_weight: z.number().min(0.5).max(0.95),
});

export type SceneSpec = z.infer<typeof SceneSpecSchema>;

/** Classify a scene for §2.4 model routing. */
export type SceneKind = "establishing_wide" | "dialogue_close_up" | "continuity_i2v";

export function classifyScene(spec: SceneSpec): SceneKind {
  if (spec.continuity_anchor.prior_scene_ref) return "continuity_i2v";
  const shot = spec.camera.shot_type.toLowerCase();
  if (/(wide|establishing|master|extreme wide)/.test(shot)) return "establishing_wide";
  return "dialogue_close_up";
}