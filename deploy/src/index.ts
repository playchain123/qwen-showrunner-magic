import {
  handleImage,
  handleRender,
  handleScript,
  handleStoryboard,
  handleVideoStatus,
  handleVideoSubmit,
  handleVoice,
  type HandlerContext,
} from "./handlers.js";
import { handleWebsiteCapture, handleWebsiteExtract } from "./website-handlers.js";

type ApiHandler = (request: Request, context: HandlerContext) => Promise<Response>;

const routes: Record<string, ApiHandler> = {
  "POST /api/script": handleScript,
  "POST /api/storyboard": handleStoryboard,
  "POST /api/image": handleImage,
  "POST /api/video": handleVideoSubmit,
  "GET /api/video-status": handleVideoStatus,
  "POST /api/voice": handleVoice,
  "POST /api/render": handleRender,
  "POST /api/quota/check": quotaCheck,
  "POST /api/website/extract": handleWebsiteExtract,
  "POST /api/website/capture": handleWebsiteCapture,
  "GET /api/health": healthCheck,
};

export async function handler(request: Request) {
  const context: HandlerContext = {
    requestId: crypto.randomUUID(),
    startedAt: Date.now(),
    userId: readBearerSubject(request),
  };
  const url = new URL(request.url);
  const key = `${request.method.toUpperCase()} ${url.pathname}`;
  const route = routes[key];

  if (!route) {
    return jsonResponse(context, 404, {
      success: false,
      stage: "routing",
      message: "Endpoint not found",
      retryable: false,
    });
  }

  try {
    return await route(request, context);
  } catch (error) {
    return jsonResponse(context, error instanceof Error && error.message === "Authorization required" ? 401 : 500, {
      success: false,
      stage: "server",
      message: error instanceof Error ? error.message : "Unhandled backend error",
      retryable: false,
    });
  }
}

async function quotaCheck(_request: Request, context: HandlerContext) {
  const maxProjects = Number(process.env.MAX_PROJECTS_PER_USER_PER_DAY || 3);
  return jsonResponse(context, 200, {
    success: true,
    stage: "quota",
    allowed: true,
    max_projects_per_user_per_day: maxProjects,
    request_id: context.requestId,
  });
}

async function healthCheck(_request: Request, context: HandlerContext) {
  return jsonResponse(context, 200, {
    success: true,
    stage: "health",
    playwright_enabled: process.env.PLAYWRIGHT_ENABLED === "true",
    routes: ["POST /api/website/extract", "POST /api/website/capture"],
  });
}

function jsonResponse(context: HandlerContext, status: number, body: Record<string, unknown>) {
  return new Response(
    JSON.stringify(
      {
        ...body,
        request_id: context.requestId,
        latency_ms: Date.now() - context.startedAt,
      },
      null,
      2,
    ),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

function readBearerSubject(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length);
  const [, payload] = token.split(".");
  if (!payload) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string };
    return decoded.sub ?? null;
  } catch {
    return null;
  }
}
