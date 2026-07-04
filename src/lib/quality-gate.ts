// §2.6 — Quality-Critique gate: draft → critique → conditionally refine.
// Kept pure (no fetches) so it stays trivially unit-testable and can
// live outside qwen.functions.ts. The caller supplies the generator +
// critic functions and receives back the frame plus a trace of every
// critique verdict for `agent_trace`.
import type { SceneSpec } from "./scene-spec";
import { cosineSimilarity, CONTINUITY_THRESHOLD } from "./continuity";

export type QualityResult = {
  prompt_fidelity_score: number;
  continuity_score: number;
  realism_score: number;
  artifact_flags: string[];
  verdict: "accept" | "refine" | "reject";
  refine_instructions: string | null;
};

export type GeneratedFrame = {
  imageUrl: string;
  embedding?: number[]; // hero-frame embedding once §2.2 is wired in
};

export const ACCEPT_THRESHOLD = 0.8;
export const MAX_REGENS_PER_SCENE = 1; // §6 cost guardrail

/** Fold refine instructions back into the spec before re-generating. */
export function applyRefineInstructions(spec: SceneSpec, instructions: string): SceneSpec {
  const raised = Math.min(0.95, Math.max(spec.reference_image_weight, 0.9));
  return {
    ...spec,
    reference_image_weight: raised,
    positive_prompt: `${spec.positive_prompt}\n\nREFINEMENT NOTES: ${instructions}`,
  };
}

export type GenerateFn = (spec: SceneSpec) => Promise<GeneratedFrame>;
export type CritiqueFn = (spec: SceneSpec, frame: GeneratedFrame) => Promise<QualityResult>;

export async function generateSceneWithQualityGate({
  spec,
  generate,
  critique,
  referenceEmbedding,
  regenBudget = MAX_REGENS_PER_SCENE,
}: {
  spec: SceneSpec;
  generate: GenerateFn;
  critique: CritiqueFn;
  referenceEmbedding?: number[];
  regenBudget?: number;
}): Promise<{ frame: GeneratedFrame; trace: QualityResult[]; finalSpec: SceneSpec }> {
  const trace: QualityResult[] = [];
  let currentSpec = spec;
  let attempt = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const frame = await generate(currentSpec);
    const verdict = await critique(currentSpec, frame);

    // Cross-check with stored character embedding if we have both.
    if (referenceEmbedding && frame.embedding) {
      const sim = cosineSimilarity(frame.embedding, referenceEmbedding);
      if (sim < CONTINUITY_THRESHOLD && verdict.continuity_score > sim) {
        verdict.continuity_score = sim;
        if (verdict.verdict === "accept") verdict.verdict = "refine";
        verdict.refine_instructions =
          (verdict.refine_instructions ? `${verdict.refine_instructions}. ` : "") +
          `Raise reference_image_weight and re-lock character token ${currentSpec.continuity_anchor.character_token} — embedding similarity ${sim.toFixed(3)} < ${CONTINUITY_THRESHOLD}.`;
      }
    }

    trace.push(verdict);

    const passed =
      verdict.prompt_fidelity_score >= ACCEPT_THRESHOLD &&
      verdict.continuity_score >= ACCEPT_THRESHOLD &&
      verdict.realism_score >= ACCEPT_THRESHOLD &&
      verdict.artifact_flags.length === 0 &&
      verdict.verdict === "accept";

    if (passed || attempt >= regenBudget || verdict.verdict === "reject") {
      return { frame, trace, finalSpec: currentSpec };
    }

    currentSpec = applyRefineInstructions(currentSpec, verdict.refine_instructions ?? "raise fidelity and continuity");
    attempt++;
  }
}