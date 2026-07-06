const BUCKET = "website-assets";

function extensionFor(contentType: string) {
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("mp4")) return "mp4";
  return "bin";
}

export async function uploadWebsiteAsset({
  userId,
  projectId,
  beatId,
  buffer,
  contentType,
  kind,
}: {
  userId: string;
  projectId: string;
  beatId: string;
  buffer: Uint8Array;
  contentType: string;
  kind: "capture" | "screenshot" | "export";
}): Promise<string | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ext = extensionFor(contentType);
    const path = `${userId}/${projectId}/${beatId}-${kind}-${Date.now()}.${ext}`;
    const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, buffer, {
      contentType,
      upsert: true,
    });
    if (error) {
      console.warn("[website-storage] upload failed:", error.message);
      return null;
    }
    const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl || null;
  } catch (err) {
    console.warn("[website-storage] unavailable:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

export function dataUrlFromBase64(base64: string, contentType: string) {
  return `data:${contentType};base64,${base64}`;
}

export async function persistCaptureClip({
  userId,
  projectId,
  beatId,
  videoBase64,
  contentType = "video/webm",
}: {
  userId: string;
  projectId: string;
  beatId: string;
  videoBase64: string;
  contentType?: string;
}): Promise<string> {
  const bytes = Uint8Array.from(atob(videoBase64), (c) => c.charCodeAt(0));
  const uploaded = await uploadWebsiteAsset({
    userId,
    projectId,
    beatId,
    buffer: bytes,
    contentType,
    kind: "capture",
  });
  if (uploaded) return uploaded;
  return dataUrlFromBase64(videoBase64, contentType);
}

export async function persistHeroScreenshot({
  userId,
  projectId,
  imageBase64,
  contentType = "image/jpeg",
}: {
  userId: string;
  projectId: string;
  imageBase64: string;
  contentType?: string;
}): Promise<string | null> {
  const bytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
  return uploadWebsiteAsset({
    userId,
    projectId,
    beatId: "hero",
    buffer: bytes,
    contentType,
    kind: "screenshot",
  });
}
