export type CaptionWord = {
  text: string;
  startTime: number;
  endTime: number;
};

export type CaptionSegment = {
  id: string;
  sceneId: string;
  text: string;
  startTime: number;
  endTime: number;
  words?: CaptionWord[];
};

export type TimelineScene<T> = T & {
  sceneId: string;
  startTime: number;
  endTime: number;
};

export type FinalTimeline<T> = {
  scenes: Array<TimelineScene<T>>;
  totalDurationSeconds: number;
  captions: CaptionSegment[];
  audioTracks: Array<{ sceneId: string; audioUrl: string; startTime: number; endTime: number }>;
  videoUrls: string[];
};

export function normalizeVoiceLine(line: string | undefined, fallback = "One opportunity can change everything.") {
  const cleaned = (line || "").replace(/\s+/g, " ").trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return fallback;
  if (words.length <= 14) return cleaned;
  return words.slice(0, 12).join(" ").replace(/[,.!?;:]+$/, "") + ".";
}

export function buildCaptionSegments({
  sceneId,
  text,
  sceneStart,
  sceneEnd,
}: {
  sceneId: string;
  text: string;
  sceneStart: number;
  sceneEnd: number;
}): CaptionSegment[] {
  const safeText = normalizeVoiceLine(text);
  const words = safeText.split(/\s+/).filter(Boolean);
  const chunks = chunkWords(words, 7);
  const start = Math.min(sceneEnd - 0.2, sceneStart + 0.2);
  const end = Math.max(start + 0.6, sceneEnd - 0.4);
  const span = Math.max(0.6, end - start);
  return chunks.map((chunk, index) => {
    const chunkStart = start + (span / chunks.length) * index;
    const chunkEnd = index + 1 === chunks.length ? end : start + (span / chunks.length) * (index + 1);
    return {
      id: `${sceneId}-caption-${index + 1}`,
      sceneId,
      text: chunk.join(" "),
      startTime: Math.max(sceneStart, chunkStart - 0.1),
      endTime: Math.min(sceneEnd, chunkEnd),
      words: chunk.map((word, wordIndex) => {
        const wordStart = chunkStart + ((chunkEnd - chunkStart) / Math.max(1, chunk.length)) * wordIndex;
        return {
          text: word,
          startTime: Math.max(sceneStart, wordStart - 0.1),
          endTime: Math.min(sceneEnd, wordStart + (chunkEnd - chunkStart) / Math.max(1, chunk.length)),
        };
      }),
    };
  });
}

export function buildFinalTimeline<T extends {
  videoUrl?: string;
  audioUrl?: string;
  durationSeconds?: number;
  spokenLine?: string;
  caption?: string;
}>(
  scenes: T[],
  durationPerScene: number,
): FinalTimeline<T> {
  let cursor = 0;
  const timelineScenes = scenes.map((scene, index) => {
    const duration = scene.durationSeconds || durationPerScene;
    const sceneId = `scene-${index + 1}`;
    const startTime = cursor;
    const endTime = cursor + duration;
    cursor = endTime;
    return { ...scene, sceneId, startTime, endTime };
  });
  const captions = timelineScenes.flatMap((scene) =>
    buildCaptionSegments({
      sceneId: scene.sceneId,
      text: scene.spokenLine || scene.caption || "",
      sceneStart: scene.startTime,
      sceneEnd: scene.endTime,
    }),
  );
  return {
    scenes: timelineScenes,
    totalDurationSeconds: cursor,
    captions,
    audioTracks: timelineScenes
      .filter((scene) => Boolean(scene.audioUrl))
      .map((scene) => ({ sceneId: scene.sceneId, audioUrl: scene.audioUrl as string, startTime: scene.startTime, endTime: scene.endTime })),
    videoUrls: timelineScenes.map((scene) => scene.videoUrl).filter((url): url is string => Boolean(url)),
  };
}

function chunkWords(words: string[], maxWords: number) {
  if (words.length <= maxWords) return [words];
  const chunks: string[][] = [];
  for (let i = 0; i < words.length; i += maxWords) chunks.push(words.slice(i, i + maxWords));
  return chunks;
}
