import { z } from "zod";

export const WebsiteVideoTypeSchema = z.enum(["saas_launch", "website_promo", "user_demo", "user_manual"]);

export const NewProjectSchema = z.discriminatedUnion("input_mode", [
  z.object({
    input_mode: z.literal("logline"),
    logline: z.string().min(10),
  }),
  z.object({
    input_mode: z.literal("reference_image"),
    logline: z.string().min(10),
    reference_image_ids: z.array(z.string()).min(1),
  }),
  z.object({
    input_mode: z.literal("website_url"),
    source_url: z.string().url(),
    video_type: WebsiteVideoTypeSchema,
    target_duration_seconds: z.number().min(180).max(240).default(210),
  }),
]);

export type NewProjectInput = z.infer<typeof NewProjectSchema>;

export const ReviewActionSchema = z.object({
  project_id: z.string().min(1),
  scene_title: z.string().min(1),
  action: z.enum(["accepted", "regenerated", "manually_edited", "rejected"]),
  edits: z.record(z.string(), z.unknown()).optional(),
});

export type ReviewActionInput = z.infer<typeof ReviewActionSchema>;
