import { BROWSER_UA, classifyHttpStatus, executeCaptureStep } from "./shared.js";

export type CaptureChoreographyInput = {
  beat_id: string;
  url: string;
  viewport: { width: number; height: number };
  interaction_sequence: string[];
  estimated_duration_seconds: number;
};

export type CaptureBeatResult = {
  success: boolean;
  blocked?: boolean;
  beat_id: string;
  video_base64?: string;
  content_type?: string;
  duration_seconds?: number;
  error?: string;
};

export async function captureBeatVideo(spec: CaptureChoreographyInput): Promise<CaptureBeatResult> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return {
      success: false,
      beat_id: spec.beat_id,
      error: "playwright_not_installed",
    };
  }

  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "makers-capture-"));

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });

  try {
    const context = await browser.newContext({
      viewport: spec.viewport,
      recordVideo: { dir: outputDir, size: spec.viewport },
      userAgent: BROWSER_UA,
    });
    const page = await context.newPage();
    const response = await page.goto(spec.url, { waitUntil: "networkidle", timeout: 45_000 });
    const status = response?.status() ?? 0;
    const kind = classifyHttpStatus(status);
    if (kind === "blocked") {
      await context.close();
      return { success: false, blocked: true, beat_id: spec.beat_id, error: `HTTP ${status}` };
    }
    if (kind === "http_error") {
      await context.close();
      return { success: false, beat_id: spec.beat_id, error: `HTTP ${status}` };
    }

    for (const step of spec.interaction_sequence) {
      await executeCaptureStep(page, step);
    }

    await context.close();

    const files = await fs.readdir(outputDir);
    const videoFile = files.find((f) => f.endsWith(".webm"));
    if (!videoFile) {
      return { success: false, beat_id: spec.beat_id, error: "no_video_file" };
    }
    const buffer = await fs.readFile(path.join(outputDir, videoFile));
    return {
      success: true,
      beat_id: spec.beat_id,
      video_base64: buffer.toString("base64"),
      content_type: "video/webm",
      duration_seconds: spec.estimated_duration_seconds,
    };
  } catch (err) {
    return {
      success: false,
      beat_id: spec.beat_id,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await browser.close();
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
