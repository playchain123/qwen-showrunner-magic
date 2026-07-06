import { BROWSER_UA, classifyHttpStatus } from "./shared.js";

export type BrowserExtractResult = {
  success: boolean;
  blocked?: boolean;
  url: string;
  title?: string;
  description?: string | null;
  colors: string[];
  fonts: string[];
  logo_url?: string | null;
  hero_screenshot_base64?: string;
  nav_links: Array<{ label: string; href: string }>;
  font_urls: string[];
  error?: string;
};

function normalizeHex(value: string) {
  const match = value.match(/#[0-9a-f]{6}/i);
  return match ? match[0].toLowerCase() : null;
}

function isUsableColor(hex: string) {
  const banned = new Set(["#000000", "#ffffff", "#fff", "#000", "#111111", "#222222"]);
  return !banned.has(hex);
}

export async function extractSiteInBrowser(url: string): Promise<BrowserExtractResult> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return {
      success: false,
      url,
      colors: [],
      fonts: [],
      nav_links: [],
      font_urls: [],
      error: "playwright_not_installed",
    };
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });

  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      userAgent: BROWSER_UA,
    });

    const response = await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    const status = response?.status() ?? 0;
    const kind = classifyHttpStatus(status);
    if (kind === "blocked") {
      return {
        success: false,
        blocked: true,
        url,
        colors: [],
        fonts: [],
        nav_links: [],
        font_urls: [],
        error: `HTTP ${status}`,
      };
    }
    if (kind === "http_error") {
      return {
        success: false,
        url,
        colors: [],
        fonts: [],
        nav_links: [],
        font_urls: [],
        error: `HTTP ${status}`,
      };
    }

    const evaluated = await page.evaluate(() => {
      const pickFont = (el: Element | null) => {
        if (!el) return "";
        const family = getComputedStyle(el).fontFamily.split(",")[0]?.trim().replace(/['"]/g, "") || "";
        return family;
      };
      const colors = new Set<string>();
      const sample = (el: Element | null) => {
        if (!el) return;
        const style = getComputedStyle(el);
        for (const prop of ["color", "backgroundColor", "borderColor"] as const) {
          const raw = style[prop];
          const match = raw.match(/rgb\((\d+),\s*(\d+),\s*(\d+)/);
          if (match) {
            const hex =
              "#" +
              [match[1], match[2], match[3]]
                .map((n) => Number(n).toString(16).padStart(2, "0"))
                .join("");
            colors.add(hex);
          }
        }
      };
      sample(document.querySelector("header"));
      sample(document.querySelector("nav"));
      sample(document.querySelector("h1"));
      sample(document.querySelector("button"));
      sample(document.body);

      const logo =
        document.querySelector<HTMLImageElement>('header img, nav img, img[alt*="logo" i]') ||
        document.querySelector<HTMLImageElement>('link[rel="icon"]')?.getAttribute("href")
          ? null
          : null;
      const logoEl = document.querySelector<HTMLImageElement>('header img, nav img, img[alt*="logo" i]');
      const logoSrc = logoEl?.src || document.querySelector<HTMLLinkElement>('link[rel*="icon"]')?.href || null;

      const fontLinks = Array.from(document.querySelectorAll<HTMLLinkElement>('link[href*="fonts.googleapis.com"]')).map(
        (l) => l.href,
      );

      const navLinks = Array.from(document.querySelectorAll("nav a"))
        .slice(0, 12)
        .map((a) => ({
          label: (a.textContent || "").trim(),
          href: (a as HTMLAnchorElement).href,
        }))
        .filter((l) => l.label && l.href);

      return {
        title: document.title,
        description:
          document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ||
          document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.content ||
          null,
        colors: Array.from(colors),
        headingFont: pickFont(document.querySelector("h1")) || pickFont(document.querySelector("h2")),
        bodyFont: pickFont(document.querySelector("p")) || pickFont(document.querySelector("button")),
        logoSrc,
        fontLinks,
        navLinks,
      };
    });

    const screenshot = await page.screenshot({ type: "jpeg", quality: 82, fullPage: false });
    const colors = evaluated.colors.map(normalizeHex).filter((c): c is string => Boolean(c && isUsableColor(c)));
    const fonts = [evaluated.headingFont, evaluated.bodyFont].filter(Boolean);

    return {
      success: true,
      url,
      title: evaluated.title,
      description: evaluated.description,
      colors: colors.slice(0, 6),
      fonts: [...new Set(fonts)].slice(0, 4),
      logo_url: evaluated.logoSrc,
      hero_screenshot_base64: screenshot.toString("base64"),
      nav_links: evaluated.navLinks,
      font_urls: evaluated.fontLinks,
    };
  } catch (err) {
    return {
      success: false,
      url,
      colors: [],
      fonts: [],
      nav_links: [],
      font_urls: [],
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await browser.close();
  }
}
