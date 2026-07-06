import type { CaptureChoreography } from "./website-render-pipeline";
import { requestScreenCapture } from "./website-browser-api";
import { persistCaptureClip } from "./website-storage";

export type ScreenCaptureOutcome =
  | { ok: true; clip_url: string; asset_source: "captured" }
  | { ok: false; blocked: boolean; reason: string };

export async function captureBeatRemote({
  spec,
  userId,
  projectId,
  authToken,
}: {
  spec: CaptureChoreography;
  userId: string;
  projectId: string;
  authToken?: string;
}): Promise<ScreenCaptureOutcome> {
  const result = await requestScreenCapture(spec, authToken);
  if (!result) {
    return { ok: false, blocked: false, reason: "capture_api_unavailable" };
  }
  if (result.blocked || !result.success) {
    return { ok: false, blocked: Boolean(result.blocked), reason: result.error || "capture_blocked" };
  }
  if (!result.video_base64) {
    return { ok: false, blocked: false, reason: "capture_empty_video" };
  }
  const clip_url = await persistCaptureClip({
    userId,
    projectId,
    beatId: spec.beat_id,
    videoBase64: result.video_base64,
    contentType: result.content_type || "video/webm",
  });
  return { ok: true, clip_url, asset_source: "captured" };
}
