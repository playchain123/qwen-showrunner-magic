import type { WebsiteVideoBeat } from "./website-video";

export type WebsiteBeatAssetJob = {
  beat_id: string;
  asset_status: "pending" | "generating" | "ready" | "failed";
  asset_source?: "captured" | "generated" | "compiled" | "fallback";
  clip_url?: string;
  progress?: number;
  error?: string;
};

export type WebsiteProjectJob = {
  project_id: string;
  status: "idle" | "generating" | "ready" | "failed";
  beats: WebsiteBeatAssetJob[];
  updated_at: string;
};

export function createWebsiteProjectJob(projectId: string, beats: WebsiteVideoBeat[]): WebsiteProjectJob {
  return {
    project_id: projectId,
    status: "generating",
    updated_at: new Date().toISOString(),
    beats: beats.map((beat) => ({
      beat_id: beat.beat_id,
      asset_status: "pending",
      progress: 0,
    })),
  };
}

export function updateBeatJob(
  job: WebsiteProjectJob,
  beatId: string,
  patch: Partial<WebsiteBeatAssetJob>,
): WebsiteProjectJob {
  const beats = job.beats.map((beat) => (beat.beat_id === beatId ? { ...beat, ...patch } : beat));
  const allReady = beats.every((beat) => beat.asset_status === "ready");
  const anyFailed = beats.some((beat) => beat.asset_status === "failed");
  return {
    ...job,
    beats,
    status: allReady ? "ready" : anyFailed && beats.every((b) => b.asset_status !== "generating" && b.asset_status !== "pending") ? "failed" : "generating",
    updated_at: new Date().toISOString(),
  };
}

export function summarizeJobProgress(job: WebsiteProjectJob) {
  const total = job.beats.length;
  const ready = job.beats.filter((beat) => beat.asset_status === "ready").length;
  const generating = job.beats.filter((beat) => beat.asset_status === "generating").length;
  const failed = job.beats.filter((beat) => beat.asset_status === "failed").length;
  return { total, ready, generating, failed, percent: total ? Math.round((ready / total) * 100) : 0 };
}

/** Poll until all beats are terminal (ready/failed) or timeout. */
export async function pollWebsiteProjectJob<T>(
  fetchJob: () => Promise<T & WebsiteProjectJob>,
  {
    intervalMs = 2000,
    timeoutMs = 300_000,
    onTick,
  }: {
    intervalMs?: number;
    timeoutMs?: number;
    onTick?: (job: T & WebsiteProjectJob) => void;
  } = {},
): Promise<T & WebsiteProjectJob> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = await fetchJob();
    onTick?.(job);
    const pending = job.beats.some((beat) => beat.asset_status === "pending" || beat.asset_status === "generating");
    if (!pending) return job;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Website asset generation timed out");
}
