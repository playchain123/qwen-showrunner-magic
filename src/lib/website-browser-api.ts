import type { CaptureChoreography } from "./website-render-pipeline";

export type BrowserExtractPayload = {
  success: boolean;
  blocked?: boolean;
  url: string;
  title?: string;
  description?: string | null;
  colors: string[];
  fonts: string[];
  logo_url?: string | null;
  hero_screenshot_base64?: string;
  nav_links: Array<{ label: string; href: string }>;
  font_urls: string[];
  error?: string;
};

export type CapturePayload = {
  success: boolean;
  blocked?: boolean;
  beat_id: string;
  video_base64?: string;
  content_type?: string;
  duration_seconds?: number;
  error?: string;
};

function captureApiBase() {
  const viteEnv =
    typeof import.meta !== "undefined" && import.meta.env
      ? (import.meta.env as Record<string, string | undefined>)
      : {};
  return (
    process.env.CAPTURE_API_BASE_URL ||
    process.env.VITE_API_BASE_URL ||
    process.env.VITE_CAPTURE_API_BASE_URL ||
    viteEnv.VITE_API_BASE_URL ||
    viteEnv.VITE_CAPTURE_API_BASE_URL ||
    ""
  ).replace(/\/$/, "");
}

async function postCaptureApi<T>(path: string, body: unknown, authToken?: string): Promise<T | null> {
  const base = captureApiBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { success?: boolean; extract?: BrowserExtractPayload; capture?: CapturePayload; blocked?: boolean };
    return json as T;
  } catch {
    return null;
  }
}

export function isCaptureApiConfigured() {
  return Boolean(captureApiBase());
}

export async function requestBrowserExtract(url: string, authToken?: string) {
  const json = await postCaptureApi<{
    success: boolean;
    extract?: BrowserExtractPayload;
    blocked?: boolean;
  }>("/api/website/extract", { url }, authToken);
  if (!json) return null;
  if (json.blocked && json.extract) return json.extract;
  if (json.extract?.success) return json.extract;
  if (json.extract) return json.extract;
  return null;
}

export async function requestScreenCapture(spec: CaptureChoreography, authToken?: string) {
  const json = await postCaptureApi<{
    success: boolean;
    capture?: CapturePayload;
    blocked?: boolean;
  }>(
    "/api/website/capture",
    {
      beat_id: spec.beat_id,
      url: spec.url,
      viewport: spec.viewport,
      interaction_sequence: spec.interaction_sequence,
      estimated_duration_seconds: spec.estimated_duration_seconds,
    },
    authToken,
  );
  if (!json) return null;
  return json.capture ?? null;
}
