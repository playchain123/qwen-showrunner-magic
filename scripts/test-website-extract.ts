/** Manual smoke test: npx tsx scripts/test-website-extract.ts <url> */
import { extractDeepBrandSignals } from "../src/lib/website-brand-extract-deep";
import { extractDominantLogoColors, kitHasChromaticColor } from "../src/lib/website-logo-color";
import { fetchWebsiteScreenshot, warmScreenshot } from "../src/lib/website-screenshot-fallback";

const url = process.argv[2] || "https://stripe.com";

async function main() {
  console.log(`\n=== Deep brand extraction: ${url} ===`);
  warmScreenshot(url);
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  console.log("page status:", res.status);
  const html = await res.text();
  const started = Date.now();
  const signals = await extractDeepBrandSignals(url, html);
  console.log(`deep extraction took ${Date.now() - started}ms`);
  console.log(JSON.stringify(signals, null, 2));

  if (!kitHasChromaticColor(signals.colors) && signals.logoUrl) {
    console.log("\n=== Logo dominant colors (no chromatic site colors) ===");
    const dominant = await extractDominantLogoColors(signals.logoUrl);
    console.log("dominant:", dominant);
  }

  console.log("\n=== Screenshot fallback ===");
  const shotStart = Date.now();
  const shot = await fetchWebsiteScreenshot({ url, budgetMs: 40000 });
  if (shot) {
    console.log(`screenshot OK via ${shot.provider}: ${shot.bytes.byteLength} bytes, ${shot.contentType} (${Date.now() - shotStart}ms)`);
  } else {
    console.log(`screenshot FAILED after ${Date.now() - shotStart}ms`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
