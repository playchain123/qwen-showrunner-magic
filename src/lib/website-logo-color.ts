import { decode as decodePng } from "fast-png";
import { decode as decodeJpeg } from "jpeg-js";
import { fetchWithTimeout } from "./website-url-safety";
import { hexToHsl } from "./website-brand-extract-deep";

/**
 * Dominant brand-color extraction from the logo/favicon image.
 *
 * Many modern sites (CSS-in-JS SPAs) expose no usable colors in their HTML or
 * stylesheets — but the logo always carries the brand color. Decoding is pure
 * JS (fast-png / jpeg-js) so it runs in any server runtime.
 */

const MAX_LOGO_BYTES = 1_500_000;
const MAX_SAMPLES = 60_000;

type Rgba = { data: Uint8Array | Uint8ClampedArray | Uint16Array; width: number; height: number; channels: number };

function decodeImage(bytes: Uint8Array, contentType: string): Rgba | null {
  try {
    const isPng =
      contentType.includes("png") ||
      (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47);
    if (isPng) {
      const png = decodePng(bytes);
      return { data: png.data, width: png.width, height: png.height, channels: png.channels };
    }
    const isJpeg = contentType.includes("jpeg") || contentType.includes("jpg") || (bytes[0] === 0xff && bytes[1] === 0xd8);
    if (isJpeg) {
      const jpg = decodeJpeg(bytes, { maxMemoryUsageInMB: 64, maxResolutionInMP: 16 });
      return { data: jpg.data, width: jpg.width, height: jpg.height, channels: 4 };
    }
    return null;
  } catch {
    return null;
  }
}

function isChromaticHex(hex: string) {
  const { s, l } = hexToHsl(hex);
  return s >= 0.25 && l >= 0.15 && l <= 0.88;
}

export function kitHasChromaticColor(colors: string[]) {
  return colors.some((color) => /^#[0-9a-f]{6}$/i.test(color) && isChromaticHex(color));
}

/**
 * Returns the dominant chromatic colors of a logo image, most-used first.
 * Transparent, near-white, and near-black pixels are treated as background.
 */
export async function extractDominantLogoColors(logoUrl: string): Promise<string[]> {
  const res = await fetchWithTimeout(logoUrl, { timeoutMs: 8000 });
  if (!res?.ok) return [];
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("svg")) return extractSvgColors(await res.text());
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_LOGO_BYTES) return [];

  const image = decodeImage(bytes, contentType);
  if (!image) return [];

  const { data, width, height, channels } = image;
  const totalPixels = width * height;
  const stride = Math.max(1, Math.floor(totalPixels / MAX_SAMPLES));
  const is16Bit = data instanceof Uint16Array;
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();

  for (let i = 0; i < totalPixels; i += stride) {
    const offset = i * channels;
    let r = data[offset];
    let g = channels >= 3 ? data[offset + 1] : r;
    let b = channels >= 3 ? data[offset + 2] : r;
    const a = channels === 4 || channels === 2 ? data[offset + (channels - 1)] : is16Bit ? 65535 : 255;
    if (is16Bit) {
      r >>= 8; g >>= 8; b >>= 8;
      if (a >> 8 < 128) continue;
    } else if (a < 128) {
      continue;
    }
    // Skip background-ish pixels
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > 236 && min > 226) continue; // near-white
    if (max < 26) continue; // near-black
    if (max - min < 24) continue; // grey
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.r += r; bucket.g += g; bucket.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }

  const ranked = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
    .map((bucket) => {
      const r = Math.round(bucket.r / bucket.count);
      const g = Math.round(bucket.g / bucket.count);
      const b = Math.round(bucket.b / bucket.count);
      return { hex: `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`, count: bucket.count };
    })
    .filter((entry) => isChromaticHex(entry.hex));

  // Merge visually-close buckets so anti-aliased edges don't split the winner.
  const merged: Array<{ hex: string; count: number }> = [];
  for (const entry of ranked) {
    const existing = merged.find((m) => colorDistance(m.hex, entry.hex) < 60);
    if (existing) existing.count += entry.count;
    else merged.push({ ...entry });
  }
  return merged.sort((a, b) => b.count - a.count).slice(0, 3).map((m) => m.hex);
}

function extractSvgColors(svg: string): string[] {
  const counts = new Map<string, number>();
  for (const match of svg.matchAll(/(?:fill|stroke|stop-color)[=:]\s*["']?(#[0-9a-fA-F]{3,8}|rgb\([^)]+\))/gi)) {
    const hex = normalizeHexish(match[1]);
    if (hex && isChromaticHex(hex)) counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([hex]) => hex);
}

function normalizeHexish(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value)?.[1];
  if (hex) {
    if (hex.length === 3) {
      const [r, g, b] = hex.split("");
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    return `#${hex}`;
  }
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(value);
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]].map((c) => Number(c).toString(16).padStart(2, "0")).join("")}`;
  }
  return null;
}

function colorDistance(a: string, b: string) {
  const dr = parseInt(a.slice(1, 3), 16) - parseInt(b.slice(1, 3), 16);
  const dg = parseInt(a.slice(3, 5), 16) - parseInt(b.slice(3, 5), 16);
  const db = parseInt(a.slice(5, 7), 16) - parseInt(b.slice(5, 7), 16);
  return Math.sqrt(dr * dr + dg * dg + db * db);
}
