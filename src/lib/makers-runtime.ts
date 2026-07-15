export const MAKERS_DEMO_LIMITS = {
  maxScenes: 3,
  maxSecondsPerScene: 5,
  defaultSecondsPerScene: 4,
  maxTotalVideoSeconds: 15,
  maxParallelImageJobs: 2,
  maxParallelVideoJobs: 3,
  maxVideoPollAttempts: 60,
  videoPollBackoffMs: [5000, 10000, 15000],
} as const;

/** Long-form pipeline: 30+ second films with lip-synced wan2.6-i2v clips. */
export const LONGFORM_LIMITS = {
  maxScenes: 8,
  minSecondsPerScene: 4,
  maxSecondsPerScene: 5,
  defaultSecondsPerScene: 4,
  targetTotalVideoSeconds: 35,
  minTotalVideoSeconds: 35,
  maxTotalVideoSeconds: 35,
  maxParallelImageJobs: 2,
  maxParallelVideoJobs: 1,
  maxVideoPollAttempts: 140,
  maxRetriesPerScene: 2,
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

export function clampLongformSceneCount(requested: number) {
  if (!Number.isFinite(requested)) return LONGFORM_LIMITS.maxScenes;
  return Math.max(1, Math.min(LONGFORM_LIMITS.maxScenes, Math.floor(requested)));
}

export function normalizeLongformSceneDuration(seconds: number | undefined) {
  if (!Number.isFinite(seconds ?? NaN)) return LONGFORM_LIMITS.defaultSecondsPerScene;
  return Math.max(
    LONGFORM_LIMITS.minSecondsPerScene,
    Math.min(LONGFORM_LIMITS.maxSecondsPerScene, Math.floor(seconds as number)),
  );
}

export function targetLongformSceneDuration(sceneIndex: number, sceneCount: number = LONGFORM_LIMITS.maxScenes) {
  if (sceneCount === LONGFORM_LIMITS.maxScenes && sceneIndex < 3) return LONGFORM_LIMITS.maxSecondsPerScene;
  return LONGFORM_LIMITS.defaultSecondsPerScene;
}

export function computeSceneDurationFromAudio(audioSeconds: number) {
  const padded = Math.ceil(audioSeconds) + 2;
  return normalizeLongformSceneDuration(padded);
}

export function getLongformVideoPollDelayMs(attempt: number) {
  if (attempt < 6) return LONGFORM_LIMITS.videoPollBackoffMs[0];
  if (attempt < 12) return LONGFORM_LIMITS.videoPollBackoffMs[1];
  return LONGFORM_LIMITS.videoPollBackoffMs[2];
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
