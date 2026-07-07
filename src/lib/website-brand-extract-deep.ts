import { fetchWithTimeout, isSafePublicHttpUrl } from "./website-url-safety";

/**
 * Deep, browser-free brand signal extraction.
 *
 * The plain regex-over-HTML approach misses almost every modern site because
 * colors live in external stylesheets, CSS variables, theme-color meta tags,
 * and web manifests — not as raw hex codes in the markup. This module fetches
 * those secondary resources (with strict SSRF guards and byte caps) and ranks
 * real brand colors, typefaces, and logo candidates.
 */

export type DeepBrandSignals = {
  /** Ordered [primary, secondary, accent, neutral]; empty when nothing usable found. */
  colors: string[];
  themeColor: string | null;
  fonts: string[];
  fontUrls: string[];
  logoUrl: string | null;
  logoSource: string | null;
  ogImage: string | null;
};

const MAX_STYLESHEETS = 4;
const MAX_CSS_BYTES = 300_000;
const FETCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const GENERIC_FONT_KEYWORDS = new Set([
  "sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif",
  "ui-serif", "ui-monospace", "ui-rounded", "inherit", "initial", "unset", "revert",
  "-apple-system", "blinkmacsystemfont", "segoe ui", "arial", "helvetica", "helvetica neue",
  "times new roman", "emoji", "math", "none",
]);

const ICON_FONT_PATTERN =
  /font ?awesome|material (icons|symbols)|icomoon|glyphicons|bootstrap-icons|remixicon|feather|katex|mathjax|fontello|icofont|weather ?icons|slick|swiper/i;

type WeightedColor = { hex: string; weight: number };

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

export function normalizeCssColor(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  const hexMatch = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b] = hex.slice(0, 3).split("");
      if (hex.length === 4 && parseInt(hex[3] + hex[3], 16) < 102) return null; // mostly transparent
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    if (hex.length === 6) return `#${hex}`;
    if (hex.length === 8) {
      if (parseInt(hex.slice(6, 8), 16) < 102) return null;
      return `#${hex.slice(0, 6)}`;
    }
    return null;
  }
  const rgbMatch = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/ ]\s*([\d.]+%?))?\s*\)$/.exec(value);
  if (rgbMatch) {
    const [r, g, b] = [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
    if ([r, g, b].some((c) => c > 255)) return null;
    if (rgbMatch[4]) {
      const alpha = rgbMatch[4].endsWith("%") ? Number(rgbMatch[4].slice(0, -1)) / 100 : Number(rgbMatch[4]);
      if (Number.isFinite(alpha) && alpha < 0.4) return null;
    }
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  }
  return null;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

function colorDistance(a: string, b: string) {
  const dr = parseInt(a.slice(1, 3), 16) - parseInt(b.slice(1, 3), 16);
  const dg = parseInt(a.slice(3, 5), 16) - parseInt(b.slice(3, 5), 16);
  const db = parseInt(a.slice(5, 7), 16) - parseInt(b.slice(5, 7), 16);
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function hueDistance(a: number, b: number) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function isChromatic(hex: string) {
  const { s, l } = hexToHsl(hex);
  return s >= 0.18 && l >= 0.12 && l <= 0.92;
}

function isDarkNeutral(hex: string) {
  const { s, l } = hexToHsl(hex);
  return l <= 0.22 && s <= 0.35;
}

/** Merge visually-identical colors, summing weights. */
function bucketColors(candidates: WeightedColor[]): WeightedColor[] {
  const buckets: WeightedColor[] = [];
  const sorted = [...candidates].sort((a, b) => b.weight - a.weight);
  for (const candidate of sorted) {
    const existing = buckets.find((bucket) => colorDistance(bucket.hex, candidate.hex) < 36);
    if (existing) existing.weight += candidate.weight;
    else buckets.push({ ...candidate });
  }
  return buckets.sort((a, b) => b.weight - a.weight);
}

/**
 * Rank the weighted pool into [primary, secondary, accent, neutral].
 * Primary favors the theme-color when it is chromatic, accent favors a hue
 * distinct from primary so motion cards keep contrast.
 */
export function rankBrandColors(pool: WeightedColor[], themeColor: string | null): string[] {
  const buckets = bucketColors(pool);
  // A brand color should repeat across the page/stylesheets. Scale the bar
  // with the most common bucket so huge utility stylesheets full of neutrals
  // don't let one-off chromatic noise through, but cap it so genuinely-used
  // brand colors always qualify.
  const topWeight = buckets[0]?.weight || 0;
  const chromaticFloor = Math.max(3, Math.min(12, Math.round(topWeight * 0.03)));
  const chromatic = buckets.filter((c) => isChromatic(c.hex) && c.weight >= chromaticFloor);
  const darks = buckets.filter((c) => isDarkNeutral(c.hex));

  // Monochrome-brand detection: when the palette is overwhelmingly
  // black/white/grey and no chromatic color carries real usage weight, the
  // stray chromatic hits are third-party logos or syntax highlighting — not
  // the brand. Stay monochrome instead of adopting a customer's green.
  const neutralsWeight = buckets.filter((c) => !isChromatic(c.hex)).reduce((sum, c) => sum + c.weight, 0);
  const topChromaticWeight = chromatic[0]?.weight || 0;
  const themeIsChromatic = Boolean(themeColor && isChromatic(themeColor));
  if (!themeIsChromatic && topChromaticWeight < Math.max(8, neutralsWeight * 0.05)) {
    const light =
      buckets.find((c) => {
        const { s, l } = hexToHsl(c.hex);
        return l >= 0.82 && s <= 0.25;
      })?.hex || "#ffffff";
    const dark = darks[0]?.hex || "#0a0a0a";
    return dedupe([light, dark, light, dark]);
  }

  let primary: string | null = null;
  if (themeIsChromatic && themeColor) primary = themeColor;
  else if (chromatic[0]) primary = chromatic[0].hex;
  else if (themeColor) primary = themeColor;

  if (!primary) return [];

  const primaryHue = hexToHsl(primary).h;
  const remaining = chromatic.filter((c) => colorDistance(c.hex, primary!) >= 36);
  const accent =
    remaining.find((c) => hueDistance(hexToHsl(c.hex).h, primaryHue) >= 28)?.hex ||
    remaining[0]?.hex ||
    primary;
  const secondary =
    remaining.find((c) => c.hex !== accent)?.hex ||
    darks[0]?.hex ||
    shadeHex(primary, -0.45);
  const neutral = darks[0]?.hex || "#0a0a0a";

  return dedupe([primary, secondary, accent, neutral]);
}

function shadeHex(hex: string, amount: number) {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(parseInt(hex.slice(1, 3), 16) * (1 + amount));
  const g = clamp(parseInt(hex.slice(3, 5), 16) * (1 + amount));
  const b = clamp(parseInt(hex.slice(5, 7), 16) * (1 + amount));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function dedupe(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

// ---------------------------------------------------------------------------
// CSS / HTML harvesting
// ---------------------------------------------------------------------------

const BRAND_VAR_PATTERN = /--(?:[\w-]*)(?:primary|brand|accent|main|theme)(?:[\w-]*)\s*:\s*([^;}]+)/gi;
const COLOR_TOKEN_PATTERN = /(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]{3,40}\))/g;
const BACKGROUND_DECL_PATTERN = /background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]{3,40}\))/gi;
const CUSTOM_PROP_PATTERN = /--[\w-]+\s*:\s*(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]{3,40}\))/gi;

function harvestColorsFromCss(css: string, baseWeight: number, into: WeightedColor[]) {
  let match: RegExpExecArray | null;
  BRAND_VAR_PATTERN.lastIndex = 0;
  while ((match = BRAND_VAR_PATTERN.exec(css))) {
    const hex = normalizeCssColor(match[1].trim().split(/\s/)[0]);
    if (hex) into.push({ hex, weight: baseWeight + 30 });
  }
  CUSTOM_PROP_PATTERN.lastIndex = 0;
  while ((match = CUSTOM_PROP_PATTERN.exec(css))) {
    const hex = normalizeCssColor(match[1]);
    if (hex) into.push({ hex, weight: baseWeight + 3 });
  }
  BACKGROUND_DECL_PATTERN.lastIndex = 0;
  while ((match = BACKGROUND_DECL_PATTERN.exec(css))) {
    const hex = normalizeCssColor(match[1]);
    if (hex) into.push({ hex, weight: baseWeight + 3 });
  }
  COLOR_TOKEN_PATTERN.lastIndex = 0;
  let scanned = 0;
  while ((match = COLOR_TOKEN_PATTERN.exec(css)) && scanned < 6000) {
    scanned += 1;
    // Skip Tailwind arbitrary-value selectors like `.border-\[\#95BF47\]` —
    // those are one-off utilities that frequently carry *other* brands'
    // colors (customer logos, integration cards).
    if (match.index > 0 && css[match.index - 1] === "\\") continue;
    const hex = normalizeCssColor(match[1]);
    if (hex) into.push({ hex, weight: baseWeight });
  }
}

function harvestFontsFromCss(css: string, into: Map<string, number>) {
  const declarations = css.matchAll(/font-family\s*:\s*([^;}{]+)/gi);
  for (const decl of declarations) {
    const first = decl[1].split(",")[0]?.replace(/["']/g, "").trim();
    if (!first) continue;
    const lower = first.toLowerCase();
    if (GENERIC_FONT_KEYWORDS.has(lower) || lower.startsWith("var(") || ICON_FONT_PATTERN.test(first)) continue;
    into.set(first, (into.get(first) || 0) + 1);
  }
  // @font-face declares availability, not usage — count it lightly so libraries
  // that self-host many families don't outrank the fonts actually applied.
  const fontFaces = css.matchAll(/@font-face\s*{[^}]*font-family\s*:\s*["']?([^;"'}]+)/gi);
  for (const face of fontFaces) {
    const family = face[1].trim();
    if (family && !ICON_FONT_PATTERN.test(family)) into.set(family, (into.get(family) || 0) + 1);
  }
}

function extractStylesheetUrls(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const links = html.matchAll(/<link[^>]+rel=["'][^"']*stylesheet[^"']*["'][^>]*>/gi);
  for (const link of links) {
    const href = /href=["']([^"']+)["']/i.exec(link[0])?.[1];
    const abs = absolutize(baseUrl, href);
    if (abs) urls.push(abs);
  }
  return urls;
}

function extractGoogleFonts(html: string): { families: string[]; urls: string[] } {
  const families: string[] = [];
  const urls: string[] = [];
  const links = html.matchAll(/https:\/\/fonts\.googleapis\.com\/css2?\?[^"'\s)]+/gi);
  for (const link of links) {
    const url = link[0].replace(/&amp;/g, "&");
    urls.push(url);
    const familyParams = url.matchAll(/family=([^&:]+)/gi);
    for (const param of familyParams) {
      const family = decodeURIComponent(param[1]).replace(/\+/g, " ").trim();
      if (family && !ICON_FONT_PATTERN.test(family)) families.push(family);
    }
  }
  return { families: dedupe(families), urls: dedupe(urls) };
}

// ---------------------------------------------------------------------------
// Logo ladder
// ---------------------------------------------------------------------------

type LogoCandidate = { url: string; score: number; source: string };

const CUSTOMER_CONTEXT_PATTERN =
  /customers?|clients?|partners?|trusted[- ]by|brands|testimonials?|logos?-grid|logo-cloud|logo-wall|marquee|carousel|press|featured[- ]in|as[- ]seen/i;

function findTagRanges(html: string, tag: "header" | "nav" | "footer"): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && ranges.length < 8) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

function inRanges(index: number, ranges: Array<[number, number]>) {
  return ranges.some(([start, end]) => index >= start && index <= end);
}

function collectLogoCandidates(html: string, baseUrl: string): LogoCandidate[] {
  const candidates: LogoCandidate[] = [];
  const headerRanges = [...findTagRanges(html, "header"), ...findTagRanges(html, "nav")];
  const footerRanges = findTagRanges(html, "footer");
  const brandToken = (() => {
    try {
      const label = new URL(baseUrl).hostname.replace(/^www\./, "").split(".")[0];
      return label.length >= 3 ? label.toLowerCase() : null;
    } catch {
      return null;
    }
  })();

  const imgs = Array.from(html.matchAll(/<img[^>]+>/gi));
  for (const img of imgs) {
    const tag = img[0];
    const src =
      /(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i.exec(tag)?.[1] ||
      /srcset=["']([^\s"',]+)/i.exec(tag)?.[1];
    const abs = absolutize(baseUrl, src);
    if (!abs) continue;
    const classId = [
      /class=["']([^"']*)["']/i.exec(tag)?.[1] || "",
      /id=["']([^"']*)["']/i.exec(tag)?.[1] || "",
    ]
      .join(" ")
      .toLowerCase();
    const alt = (/alt=["']([^"']*)["']/i.exec(tag)?.[1] || "").toLowerCase();
    const attrValues = `${classId} ${alt}`;
    const width = Number(/width=["']?(\d+)/i.exec(tag)?.[1] || 0);
    const height = Number(/height=["']?(\d+)/i.exec(tag)?.[1] || 0);
    const isLazy = /loading=["']?lazy/i.test(tag);
    const index = img.index ?? 0;
    const context = html.slice(Math.max(0, index - 500), index).toLowerCase();
    // Brand-token matching must ignore the hostname: assets on the brand's own
    // CDN (images.stripeassets.com, cdn.shopify.com…) would otherwise make
    // every customer-logo image look like the brand's logo.
    const urlPath = (() => {
      try {
        return new URL(abs).pathname.toLowerCase();
      } catch {
        return abs.toLowerCase();
      }
    })();
    // "imitating the Stripe logo" in an alt text is a description of a photo,
    // not a logo. Only trust class/id/URL for the "logo" keyword; alt text
    // needs to *end* with "logo" (e.g. alt="Stripe logo") to count.
    const logoInMarkup = /logo/.test(classId) || /logo/.test(urlPath);
    const logoInAlt = /(^|\s)logo\b|\blogo$/.test(alt.trim()) && alt.trim().split(/\s+/).length <= 6;
    const brandTokenMatch =
      brandToken !== null && (attrValues.includes(brandToken) || urlPath.includes(brandToken));
    let score = 0;
    if (logoInMarkup) score += 40;
    else if (logoInAlt) score += 25;
    if (inRanges(index, headerRanges)) score += 30;
    if (inRanges(index, footerRanges)) score -= 10;
    if (brandTokenMatch) score += 22;
    // Customer/partner logo walls advertise other brands, not this one.
    if (CUSTOMER_CONTEXT_PATTERN.test(context) && !inRanges(index, headerRanges)) score -= 35;
    if (/\.svg(\?|$)/i.test(abs)) score += 12;
    if (/\.(png|webp)(\?|$)/i.test(abs)) score += 6;
    if (/icon|favicon/.test(attrValues) && !/logo/.test(attrValues)) score -= 10;
    if (/avatar|profile|photo|hero|banner|screenshot|thumb/.test(attrValues)) score -= 30;
    // Logos are small-ish marks; a 2000px-wide lazy-loaded image is content
    // photography even when its alt text namechecks the brand.
    if (width >= 800 || height >= 600) score -= 35;
    if (isLazy && !inRanges(index, headerRanges)) score -= 15;
    // Without the brand's own name or a header placement we cannot be sure the
    // image is *this* brand's logo (customer walls, partner sections, article
    // images). Demote so apple-touch-icon / favicon rungs win instead.
    const confident = inRanges(index, headerRanges) || brandTokenMatch;
    if (!confident) score -= 40;
    if (!logoInMarkup && !logoInAlt) score -= 25;
    if (score >= 55) candidates.push({ url: abs, score, source: "img_logo" });
  }

  // JSON-LD Organization logo
  const ldBlocks = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const block of ldBlocks) {
    try {
      const raw = JSON.parse(block[1]) as unknown;
      const items = Array.isArray(raw) ? raw : [raw];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        const logo = record.logo;
        const logoUrl =
          typeof logo === "string"
            ? logo
            : logo && typeof logo === "object" && typeof (logo as Record<string, unknown>).url === "string"
              ? String((logo as Record<string, unknown>).url)
              : null;
        const abs = absolutize(baseUrl, logoUrl);
        if (abs) candidates.push({ url: abs, score: 46, source: "jsonld_logo" });
      }
    } catch {
      continue;
    }
  }

  // apple-touch-icon (usually a clean, high-res brand mark)
  const touchIcons = html.matchAll(/<link[^>]+rel=["']apple-touch-icon[^"']*["'][^>]*>/gi);
  for (const link of touchIcons) {
    const href = /href=["']([^"']+)["']/i.exec(link[0])?.[1];
    const abs = absolutize(baseUrl, href);
    if (abs) {
      const size = Number(/sizes=["'](\d+)/i.exec(link[0])?.[1] || 0);
      candidates.push({ url: abs, score: 38 + Math.min(6, size / 40), source: "apple_touch_icon" });
    }
  }

  // Regular icons — prefer larger, prefer svg/png over ico
  const icons = html.matchAll(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*>/gi);
  for (const link of icons) {
    const href = /href=["']([^"']+)["']/i.exec(link[0])?.[1];
    const abs = absolutize(baseUrl, href);
    if (!abs) continue;
    const size = Number(/sizes=["'](\d+)/i.exec(link[0])?.[1] || 0);
    const extBoost = /\.svg(\?|$)/i.test(abs) ? 8 : /\.png(\?|$)/i.test(abs) ? 4 : 0;
    candidates.push({ url: abs, score: 22 + extBoost + Math.min(8, size / 32), source: "favicon_link" });
  }

  // og:image only counts when it clearly is a logo file
  const ogImage = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1];
  const ogAbs = absolutize(baseUrl, ogImage);
  if (ogAbs && /logo/i.test(ogAbs)) candidates.push({ url: ogAbs, score: 44, source: "og_image_logo" });

  return candidates.sort((a, b) => b.score - a.score);
}

/** Keyless favicon service — works for any public domain, used as the last rung. */
export function faviconServiceUrl(pageUrl: string, size = 128): string | null {
  try {
    const host = new URL(pageUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

async function fetchManifest(html: string, baseUrl: string): Promise<{
  themeColor: string | null;
  backgroundColor: string | null;
  icon: string | null;
} | null> {
  const href = /<link[^>]+rel=["']manifest["'][^>]+href=["']([^"']+)["']/i.exec(html)?.[1] ||
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']manifest["']/i.exec(html)?.[1];
  const abs = absolutize(baseUrl, href);
  if (!abs) return null;
  const res = await fetchWithTimeout(abs, { timeoutMs: 5000, headers: { "User-Agent": FETCH_UA } });
  if (!res?.ok) return null;
  try {
    const manifest = (await res.json()) as {
      theme_color?: string;
      background_color?: string;
      icons?: Array<{ src?: string; sizes?: string }>;
    };
    const biggestIcon = (manifest.icons || [])
      .filter((icon) => icon.src)
      .sort((a, b) => Number((b.sizes || "0").split("x")[0]) - Number((a.sizes || "0").split("x")[0]))[0];
    return {
      themeColor: manifest.theme_color ? normalizeCssColor(manifest.theme_color) : null,
      backgroundColor: manifest.background_color ? normalizeCssColor(manifest.background_color) : null,
      icon: absolutize(abs, biggestIcon?.src),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function extractDeepBrandSignals(pageUrl: string, html: string): Promise<DeepBrandSignals> {
  const colorPool: WeightedColor[] = [];
  const fontCounts = new Map<string, number>();

  // 1) theme-color meta — strongest single signal for the primary brand color
  const themeColorRaw =
    /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] ||
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']theme-color["']/i.exec(html)?.[1];
  let themeColor = themeColorRaw ? normalizeCssColor(themeColorRaw) : null;
  if (themeColor) colorPool.push({ hex: themeColor, weight: 45 });

  // 2) inline <style> blocks
  const inlineStyles = html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  for (const style of inlineStyles) {
    harvestColorsFromCss(style[1], 2, colorPool);
    harvestFontsFromCss(style[1], fontCounts);
  }

  // 3) inline style="" attributes (fill/stroke attrs are skipped on purpose:
  // customer-logo walls would inject other brands' colors)
  harvestColorsFromCss(
    Array.from(html.matchAll(/style=["']([^"']+)["']/gi)).map((m) => m[1]).join(";"),
    1,
    colorPool,
  );

  // 4) external stylesheets (bounded)
  const stylesheetUrls = extractStylesheetUrls(html, pageUrl).slice(0, MAX_STYLESHEETS);
  await Promise.all(
    stylesheetUrls.map(async (sheetUrl) => {
      if (/fonts\.googleapis\.com/i.test(sheetUrl)) return; // handled separately
      const res = await fetchWithTimeout(sheetUrl, { timeoutMs: 6000, headers: { "User-Agent": FETCH_UA } });
      if (!res?.ok) return;
      const css = (await res.text()).slice(0, MAX_CSS_BYTES);
      harvestColorsFromCss(css, 1, colorPool);
      harvestFontsFromCss(css, fontCounts);
    }),
  );

  // 5) web manifest
  const manifest = await fetchManifest(html, pageUrl);
  if (manifest?.themeColor) {
    colorPool.push({ hex: manifest.themeColor, weight: 30 });
    if (!themeColor) themeColor = manifest.themeColor;
  }
  if (manifest?.backgroundColor) colorPool.push({ hex: manifest.backgroundColor, weight: 8 });

  // 6) Google Fonts links give both families and loadable URLs
  const googleFonts = extractGoogleFonts(html);

  // Rank fonts: Google Fonts families first (they are the intentional brand
  // choices), then most-used families from CSS.
  const cssFonts = Array.from(fontCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([family]) => family);
  const fonts = dedupe([...googleFonts.families, ...cssFonts]).slice(0, 3);

  // Logo ladder
  const logoCandidates = collectLogoCandidates(html, pageUrl);
  if (manifest?.icon) logoCandidates.push({ url: manifest.icon, score: 34, source: "manifest_icon" });
  logoCandidates.sort((a, b) => b.score - a.score);
  let logoUrl = logoCandidates[0]?.url || null;
  let logoSource = logoCandidates[0]?.source || null;
  if (!logoUrl) {
    logoUrl = faviconServiceUrl(pageUrl, 128);
    logoSource = logoUrl ? "favicon_service" : null;
  }

  const ogImage = absolutize(
    pageUrl,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1],
  );

  return {
    colors: rankBrandColors(colorPool, themeColor),
    themeColor,
    fonts,
    fontUrls: googleFonts.urls.slice(0, 3),
    logoUrl,
    logoSource,
    ogImage,
  };
}

function absolutize(base: string, value?: string | null): string | null {
  if (!value || value.startsWith("data:")) return null;
  const decoded = value.replace(/&amp;/g, "&").replace(/&#38;/g, "&");
  try {
    const abs = new URL(decoded, base).toString();
    return isSafePublicHttpUrl(abs) ? abs : null;
  } catch {
    return null;
  }
}
