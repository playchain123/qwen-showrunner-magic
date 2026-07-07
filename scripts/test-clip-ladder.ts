/** Test the screen_capture clip fallback ladder without the FC worker. */
import { getScreenshotImageUrl } from "../src/lib/website-screenshot-fallback";
import { buildScreenshotMotionSpec } from "../src/lib/website-render-pipeline";
import type { WebsiteBrandKit, WebsiteVideoBeat } from "../src/lib/website-video";

const url = process.argv[2] || "https://stripe.com";

const brandKit = {
  brand: {
    name: "Stripe",
    tagline: null,
    primary_color_hex: "#1c1e54",
    secondary_color_hex: "#5452fb",
    accent_color_hex: "#ff6118",
    neutral_color_hex: "#000000",
    heading_typeface: "sohne-var",
    body_typeface: "sohne-var",
    logo_asset_path: null,
    voice_tone: "confident",
  },
  product: { one_line_description: "", primary_use_cases: [], key_features: [], pricing_signal: null, social_proof: [] },
  site_map: [],
  confidence_flags: [],
  source_url: url,
  extracted_at: new Date().toISOString(),
} as unknown as WebsiteBrandKit;

const beat = {
  beat_id: "test-1",
  beat_purpose: "Visual identity tour",
  start_seconds: 0,
  duration_seconds: 30,
  production_method: "screen_capture",
  screen_capture_spec: { source_page: url, interaction_sequence: [], framing: "device_mockup_laptop" },
  motion_graphic_spec: null,
  ai_broll_spec: null,
  vo_line: "Let's explore the product in action.",
  transition_out: "match_cut",
} as WebsiteVideoBeat;

async function main() {
  const started = Date.now();
  const screenshotUrl = await getScreenshotImageUrl({
    url,
    userId: "test",
    projectId: "test-project",
    beatId: beat.beat_id,
    budgetMs: 35000,
  });
  console.log(`screenshot resolved in ${Date.now() - started}ms:`, screenshotUrl ? `${screenshotUrl.slice(0, 60)}... (${screenshotUrl.length} chars)` : null);
  if (!screenshotUrl) {
    console.log("FAILED — would fall back to motion card");
    return;
  }
  const spec = buildScreenshotMotionSpec(brandKit, beat, screenshotUrl, url);
  console.log("motion spec:", {
    layout: spec.layout,
    screenshot: Boolean(spec.screenshot_url),
    page: spec.screenshot_page_url,
    elements: spec.elements.map((e) => `${e.type}: ${e.content.slice(0, 40)}`),
  });
  // Second call should hit the cache instantly
  const cachedStart = Date.now();
  await getScreenshotImageUrl({ url, userId: "test", projectId: "test-project", beatId: "test-2", budgetMs: 35000 });
  console.log(`cache hit in ${Date.now() - cachedStart}ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
