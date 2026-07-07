export const MAKERS_DEMO_LIMITS = {
  maxScenes: readPositiveInt("MAX_SCENES", 3),
  maxSecondsPerScene: readPositiveInt("MAX_SCENE_DURATION", 5),
  defaultSecondsPerScene: readPositiveInt("DEFAULT_SCENE_DURATION", 4),
  maxTotalVideoSeconds: readPositiveInt("MAX_TOTAL_VIDEO_SECONDS", 16),
  maxParallelImageJobs: readPositiveInt("MAX_PARALLEL_IMAGE_JOBS", 2),
  maxParallelVideoJobs: readPositiveInt("MAX_PARALLEL_VIDEO_JOBS", 3),
  maxVideoPollAttempts: 60,
  videoPollBackoffMs: [5000, 10000, 15000],
} as const;

export function clampSceneCount(requested: number) {
  if (!Number.isFinite(requested)) return MAKERS_DEMO_LIMITS.maxScenes;
  return Math.max(1, Math.min(MAKERS_DEMO_LIMITS.maxScenes, Math.floor(requested)));
}

export function normalizeSceneDuration(seconds: number | undefined) {
  if (!Number.isFinite(seconds ?? NaN)) return MAKERS_DEMO_LIMITS.defaultSecondsPerScene;
  return Math.max(1, Math.min(MAKERS_DEMO_LIMITS.maxSecondsPerScene, Math.floor(seconds as number)));
}

export function getVideoPollDelayMs(attempt: number) {
  if (attempt < 6) return MAKERS_DEMO_LIMITS.videoPollBackoffMs[0];
  if (attempt < 12) return MAKERS_DEMO_LIMITS.videoPollBackoffMs[1];
  return MAKERS_DEMO_LIMITS.videoPollBackoffMs[2];
}

export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  const executing = new Set<Promise<void>>();

  for (let index = 0; index < items.length; index++) {
    const task = worker(items[index], index).finally(() => executing.delete(task));
    executing.add(task);

    if (executing.size >= Math.max(1, limit)) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
}

function readPositiveInt(name: string, fallback: number) {
  const value = readEnv(name);
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readEnv(name: string) {
  if (typeof process !== "undefined" && process.env?.[name]) return process.env[name];
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return viteEnv?.[name] ?? viteEnv?.[`VITE_${name}`];
}
