// §2.3 — Negative-prompt taxonomy. Compile per-scene from categories
// rather than reusing one static blob everywhere.
import type { SceneSpec } from "./scene-spec";

const CATEGORIES = {
  anatomy: [
    "extra fingers", "missing fingers", "fused limbs", "warped hands",
    "asymmetrical eyes", "deformed face", "melted anatomy",
  ],
  branding: [
    "watermark", "subtitle burn-in", "logo overlay", "UI overlay",
    "random text", "signature",
  ],
  styleBreak: [
    "cartoon", "illustration", "3D render look", "anime", "oversaturated",
    "plastic skin", "waxy skin",
  ],
  temporal: [
    "flickering light source", "morphing face", "inconsistent shadow direction",
    "frame stutter",
  ],
  lighting: [
    "flat lighting", "mismatched color temperature", "unmotivated highlight",
    "washed-out highlights",
  ],
  framing: [
    "black frame", "fade to black", "title card", "letterbox burn-in",
  ],
} as const;

/** Build a scene-specific negative prompt from the taxonomy. */
export function compileNegativePrompt(spec: SceneSpec, sceneKind: string): string {
  const parts: string[] = [
    ...CATEGORIES.anatomy,
    ...CATEGORIES.branding,
    ...CATEGORIES.framing,
  ];

  // Photoreal target → aggressively exclude style breaks.
  parts.push(...CATEGORIES.styleBreak);

  // Any scene with an identity anchor cares about temporal consistency.
  if (spec.continuity_anchor.prior_scene_ref) parts.push(...CATEGORIES.temporal);

  // Lighting-critical scenes (soft/hard called out) exclude flat lighting.
  if (spec.lighting.quality !== "mixed") parts.push(...CATEGORIES.lighting);

  // Fold in any scene-specific negatives the DP wrote.
  if (spec.negative_prompt) parts.push(spec.negative_prompt);

  // Dedup, preserve order.
  const seen = new Set<string>();
  const dedup: string[] = [];
  for (const raw of parts.flatMap((p) => p.split(",").map((s) => s.trim())).filter(Boolean)) {
    const k = raw.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(raw);
  }
  void sceneKind;
  return dedup.join(", ");
}