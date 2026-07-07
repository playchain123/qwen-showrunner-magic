/** Dump logo candidate scoring for a page. */
const url = process.argv[2] || "https://stripe.com";

async function main() {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  const html = await res.text();
  const target = /enterprise-accordion-hertz/;
  const imgs = Array.from(html.matchAll(/<img[^>]+>/gi));
  for (const img of imgs) {
    if (target.test(img[0])) {
      const index = img.index ?? 0;
      console.log("TAG:", img[0].slice(0, 400));
      console.log("CONTEXT BEFORE:", html.slice(Math.max(0, index - 500), index).slice(-400));
      // check header ranges
      const headerRe = /<header[\s>][\s\S]*?<\/header>/gi;
      let m: RegExpExecArray | null;
      let i = 0;
      while ((m = headerRe.exec(html)) && i < 8) {
        i++;
        const inRange = index >= m.index && index <= m.index + m[0].length;
        console.log(`header range ${i}: [${m.index}, ${m.index + m[0].length}] len=${m[0].length} contains=${inRange}`);
      }
      const navRe = /<nav[\s>][\s\S]*?<\/nav>/gi;
      i = 0;
      while ((m = navRe.exec(html)) && i < 8) {
        i++;
        const inRange = index >= m.index && index <= m.index + m[0].length;
        if (inRange) console.log(`nav range ${i}: contains=${inRange} len=${m[0].length}`);
      }
      break;
    }
  }
}

main().catch(console.error);
