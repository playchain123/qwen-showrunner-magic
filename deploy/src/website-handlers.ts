import { z } from "zod";
import { extractSiteInBrowser } from "./playwright/browser-extract.js";
import { captureBeatVideo } from "./playwright/screen-capture.js";
import { traceAgent } from "./dashscope.js";
import type { HandlerContext } from "./handlers.js";

type Handler = (request: Request, context: HandlerContext) => Promise<Response>;

const extractSchema = z.object({
  url: z.string().url().max(2048),
});

const captureSchema = z.object({
  beat_id: z.string().min(1),
  url: z.string().url().max(2048),
  viewport: z.object({ width: z.number().int(), height: z.number().int() }),
  interaction_sequence: z.array(z.string()).min(1).max(40),
  estimated_duration_seconds: z.number().min(2).max(120),
});

function ok(context: HandlerContext, stage: string, provider: string, body: Record<string, unknown>) {
  return json(context, 200, {
    success: true,
    stage,
    provider,
    ...body,
    agent_trace: [traceAgent(stage, provider, context.startedAt, context.requestId, "ok")],
  });
}

function fail(context: HandlerContext, status: number, stage: string, provider: string, message: string) {
  return json(context, status, {
    success: false,
    stage,
    provider,
    message,
    retryable: status >= 500,
    agent_trace: [traceAgent(stage, provider, context.startedAt, context.requestId, "error")],
  });
}

function json(context: HandlerContext, status: number, body: Record<string, unknown>) {
  return new Response(
    JSON.stringify({ ...body, request_id: context.requestId, latency_ms: Date.now() - context.startedAt }),
    { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } },
  );
}

async function readJson<T>(request: Request, schema: z.ZodSchema<T>) {
  return schema.parse(await request.json().catch(() => ({})));
}

export const handleWebsiteExtract: Handler = async (request, context) => {
  const data = await readJson(request, extractSchema);
  const result = await extractSiteInBrowser(data.url);
  if (!result.success) {
    if (result.blocked) {
      return ok(context, "website_extract", "playwright", { blocked: true, ...result });
    }
    return fail(context, 502, "website_extract", "playwright", result.error || "extract_failed");
  }
  return ok(context, "website_extract", "playwright", { extract: result });
};

export const handleWebsiteCapture: Handler = async (request, context) => {
  const data = await readJson(request, captureSchema);
  const result = await captureBeatVideo(data);
  if (!result.success) {
    if (result.blocked) {
      return ok(context, "website_capture", "playwright", { blocked: true, ...result });
    }
    return fail(context, 502, "website_capture", "playwright", result.error || "capture_failed");
  }
  return ok(context, "website_capture", "playwright", { capture: result });
};
