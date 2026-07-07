/**
 * Shared SSRF guard for every server-side fetch in the website-to-video pipeline.
 * Blocks loopback, private, link-local, CGNAT, metadata, and non-http(s) targets.
 */
export function isSafePublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  const hostname = u.hostname.toLowerCase();
  if (!hostname) return false;
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return false;
  }
  // IPv6 loopback / unspecified / link-local / unique-local
  if (hostname.startsWith("[")) {
    const v6 = hostname.slice(1, -1);
    if (v6 === "::1" || v6 === "::" || /^fe80:/i.test(v6) || /^fc/i.test(v6) || /^fd/i.test(v6)) {
      return false;
    }
  }
  // IPv4 literal deny-list (loopback, private, link-local, CGNAT, metadata, broadcast, unspecified)
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10) return false;
    if (a === 127) return false;
    if (a === 0) return false;
    if (a === 169 && b === 254) return false; // link-local + AWS/GCP/Azure metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a >= 224) return false; // multicast + reserved + broadcast
  }
  return true;
}

/** Fetch with a hard timeout; returns null on any failure instead of throwing. */
export async function fetchWithTimeout(
  url: string,
  {
    timeoutMs = 8000,
    headers,
    redirect = "follow",
  }: { timeoutMs?: number; headers?: Record<string, string>; redirect?: RequestRedirect } = {},
): Promise<Response | null> {
  if (!isSafePublicHttpUrl(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { redirect, headers, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
