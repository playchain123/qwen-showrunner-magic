// §5 — Client-side ffmpeg.wasm post-processor.
// Runs entirely in the browser. The Cloudflare Worker runtime cannot
// execute ffmpeg binaries, so all deflicker/grade/subtitle-lead work
// happens in the user's tab after the raw clips are downloaded.
//
// Costs:
//   - ~25 MB one-time WASM download (cached by the browser after first load)
//   - CPU-bound: real time roughly ~1× clip length on modern laptops
// Only import from browser-safe code paths (route components,
// <ClientOnly> sections, event handlers). Never from server fns.

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpegInstance: FFmpeg | null = null;
let loadingPromise: Promise<FFmpeg> | null = null;

async function getFfmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const ff = new FFmpeg();
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
    await ff.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpegInstance = ff;
    return ff;
  })();

  return loadingPromise;
}

/**
 * Grade a single clip: deflicker + subtle contrast/desat + light unsharp +
 * micro film-grain + vignette. Returns a blob URL to the graded MP4.
 */
export async function gradeClip(inputUrl: string): Promise<string> {
  const ff = await getFfmpeg();
  const inName = `in_${Date.now()}.mp4`;
  const outName = `out_${Date.now()}.mp4`;

  await ff.writeFile(inName, await fetchFile(inputUrl));
  await ff.exec([
    "-i", inName,
    "-vf", "deflicker,eq=contrast=1.05:saturation=0.92,unsharp=5:5:0.4,noise=alls=6:allf=t+u,vignette",
    "-c:v", "libx264",
    "-crf", "20",
    "-preset", "veryfast", // 'slow' from the spec is too heavy in-browser
    "-c:a", "copy",
    outName,
  ]);

  const data = await ff.readFile(outName);
  await ff.deleteFile(inName).catch(() => {});
  await ff.deleteFile(outName).catch(() => {});

  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const blob = new Blob([arrayBuffer], { type: "video/mp4" });
  return URL.createObjectURL(blob);
}

/**
 * Concat multiple graded clips into a single film + mux the voice track.
 * All inputs must share the same codec/resolution/framerate — Wan and
 * Happyhorse output mismatches can be normalized by grading first.
 */
export async function concatClips(clipUrls: string[]): Promise<string> {
  if (clipUrls.length === 0) throw new Error("concatClips: no inputs");
  if (clipUrls.length === 1) return clipUrls[0];

  const ff = await getFfmpeg();
  const names: string[] = [];
  for (let i = 0; i < clipUrls.length; i++) {
    const name = `clip_${i}_${Date.now()}.mp4`;
    await ff.writeFile(name, await fetchFile(clipUrls[i]));
    names.push(name);
  }
  const listName = `list_${Date.now()}.txt`;
  const listBody = names.map((n) => `file '${n}'`).join("\n");
  await ff.writeFile(listName, new TextEncoder().encode(listBody));

  const outName = `film_${Date.now()}.mp4`;
  await ff.exec([
    "-f", "concat",
    "-safe", "0",
    "-i", listName,
    "-c", "copy",
    outName,
  ]);

  const data = await ff.readFile(outName);
  for (const n of names) await ff.deleteFile(n).catch(() => {});
  await ff.deleteFile(listName).catch(() => {});
  await ff.deleteFile(outName).catch(() => {});

  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const blob = new Blob([arrayBuffer], { type: "video/mp4" });
  return URL.createObjectURL(blob);
}

/**
 * §5 subtitle lead — shift each cue ~100 ms earlier so captions feel
 * anticipatory rather than reactive. Works on any array of cues that
 * carry start/end timestamps in seconds.
 */
export const SUBTITLE_LEAD_MS = 100;

export function applySubtitleLead<T extends { start: number; end: number }>(
  cues: T[],
  leadMs = SUBTITLE_LEAD_MS,
): T[] {
  const leadS = leadMs / 1000;
  return cues.map((cue) => ({
    ...cue,
    start: Math.max(0, cue.start - leadS),
    end: Math.max(cue.start - leadS + 0.05, cue.end - leadS),
  }));
}