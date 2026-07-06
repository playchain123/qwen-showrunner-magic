export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export function classifyHttpStatus(status: number): "blocked" | "http_error" | "ok" {
  if (status === 403 || status === 429) return "blocked";
  if (status >= 400) return "http_error";
  return "ok";
}

export async function executeCaptureStep(
  page: import("playwright").Page,
  step: string,
): Promise<void> {
  const colon = step.indexOf(":");
  const action = colon >= 0 ? step.slice(0, colon) : step;
  const arg = colon >= 0 ? step.slice(colon + 1) : "";
  switch (action) {
    case "wait":
      await page.waitForTimeout(Number(arg) || 500);
      return;
    case "scroll":
      await page.mouse.wheel(0, Number(arg) || 400);
      await page.waitForTimeout(300);
      return;
    case "hover":
      try {
        await page.hover(arg, { timeout: 4000 });
      } catch {
        // resilient — selector may not exist at plan time
      }
      return;
    case "click":
      try {
        await page.click(arg, { timeout: 4000 });
      } catch {
        // resilient
      }
      return;
    default:
      return;
  }
}
