// §2.4 — Model routing decision tree.
import { classifyScene, type SceneSpec } from "./scene-spec";
import { MODEL_STRATEGY } from "./model-strategy";

export type VideoModel =
  | "happyhorse-1.1-t2v"
  | "happyhorse-1.1-i2v"
  | "wan2.2-t2v-plus"
  | "wan2.2-i2v-plus";

export type RoutingDecision = {
  primary: VideoModel;
  fallback: VideoModel | null;
  requiresStartingImage: boolean;
  referenceWeightFloor: number;
  reason: string;
};

export function routeSceneToVideoModel(spec: SceneSpec): RoutingDecision {
  const kind = classifyScene(spec);

  if (kind === "continuity_i2v") {
    return {
      primary: "happyhorse-1.1-i2v",
      fallback: MODEL_STRATEGY.videoI2vFallback as VideoModel,
      requiresStartingImage: true,
      referenceWeightFloor: 0.85,
      reason: "prior_scene_ref present — seed from last frame for identity carry-over",
    };
  }

  if (kind === "establishing_wide") {
    return {
      primary: "happyhorse-1.1-t2v",
      fallback: MODEL_STRATEGY.videoFallback as VideoModel,
      requiresStartingImage: false,
      referenceWeightFloor: spec.reference_image_weight,
      reason: "wide/establishing shot — text-to-video is cheapest and sufficient",
    };
  }

  // Dialogue close-up: highest reference weight, i2v.
  return {
    primary: "happyhorse-1.1-i2v",
    fallback: MODEL_STRATEGY.videoI2vFallback as VideoModel,
    requiresStartingImage: true,
    referenceWeightFloor: Math.max(spec.reference_image_weight, 0.9),
    reason: "dialogue close-up — lock character identity hard via i2v with high reference weight",
  };
}
