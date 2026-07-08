export const MAKERS_DEMO_LIMITS = {
  minTotalVideoSeconds: readPositiveInt("MIN_TOTAL_DURATION_SECONDS", 30),
  defaultTotalVideoSeconds: readPositiveInt("DEFAULT_TOTAL_DURATION_SECONDS", 30),
  maxTotalVideoSeconds: readPositiveInt("MAX_TOTAL_DURATION_SECONDS", 45),
  maxScenes: readPositiveInt("MAX_SCENES", 9),
  safeScenes: readPositiveInt("DEFAULT_SCENE_COUNT", 6),
  extendedScenes: readPositiveInt("EXTENDED_SCENE_COUNT", 9),
  minSecondsPerScene: readPositiveInt("MIN_SCENE_DURATION_SECONDS", 4),
  maxSecondsPerScene: readPositiveInt("MAX_SCENE_DURATION_SECONDS", 6),
  defaultSecondsPerScene: readPositiveInt("DEFAULT_SCENE_DURATION_SECONDS", 5),
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
  return Math.max(MAKERS_DEMO_LIMITS.minSecondsPerScene, Math.min(MAKERS_DEMO_LIMITS.maxSecondsPerScene, Math.floor(seconds as number)));
}

export function normalizeTargetDuration(seconds: number | undefined) {
  if (!Number.isFinite(seconds ?? NaN)) return MAKERS_DEMO_LIMITS.defaultTotalVideoSeconds;
  return Math.max(
    MAKERS_DEMO_LIMITS.minTotalVideoSeconds,
    Math.min(MAKERS_DEMO_LIMITS.maxTotalVideoSeconds, Math.floor(seconds as number)),
  );
}

export function sceneCountForTargetDuration(seconds: number | undefined) {
  const target = normalizeTargetDuration(seconds);
  if (target >= MAKERS_DEMO_LIMITS.maxTotalVideoSeconds) return MAKERS_DEMO_LIMITS.extendedScenes;
  return MAKERS_DEMO_LIMITS.safeScenes;
}

export function targetDurationFromPrompt(prompt: string, fallback = MAKERS_DEMO_LIMITS.defaultTotalVideoSeconds) {
  const match = prompt.match(/(?:duration|length)\s*:?\s*(30|45)\s*(?:seconds?|secs?|s)?/i)
    || prompt.match(/\b(30|45)\s*(?:seconds?|secs?)\b/i);
  return normalizeTargetDuration(match ? Number(match[1]) : fallback);
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
