type ApiHandler = (request: Request, context: RequestContext) => Promise<Response>;

type RequestContext = {
  requestId: string;
  startedAt: number;
  userId: string | null;
};

const routes: Record<string, ApiHandler> = {
  "POST /api/script": notImplemented("script_generation", "qwen-text"),
  "POST /api/storyboard": notImplemented("storyboard_generation", "qwen-text"),
  "POST /api/image": notImplemented("image_generation", "qwen-image"),
  "POST /api/video": notImplemented("video_generation", "wan"),
  "GET /api/video-status": notImplemented("video_status", "dashscope"),
  "POST /api/voice": notImplemented("voice_generation", "qwen-tts"),
  "POST /api/render": notImplemented("render", "ffmpeg"),
  "POST /api/quota/check": quotaCheck,
};

export async function handler(request: Request) {
  const context: RequestContext = {
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
    return jsonResponse(context, 500, {
      success: false,
      stage: "server",
      message: error instanceof Error ? error.message : "Unhandled backend error",
      retryable: false,
    });
  }
}

function notImplemented(stage: string, provider: string): ApiHandler {
  return async (_request, context) => {
    logTrace(context, stage, provider, "not_implemented");
    return jsonResponse(context, 501, {
      success: false,
      stage,
      provider,
      message: "Function Compute route scaffold is ready; provider implementation is pending.",
      retryable: false,
      agent_trace: [
        {
          agent: stageToAgent(stage),
          provider,
          status: "pending_implementation",
          latency_ms: Date.now() - context.startedAt,
          request_id: context.requestId,
        },
      ],
    });
  };
}

async function quotaCheck(_request: Request, context: RequestContext) {
  const maxProjects = Number(process.env.MAX_PROJECTS_PER_USER_PER_DAY || 3);
  logTrace(context, "quota", "backend", "allowed");
  return jsonResponse(context, 200, {
    success: true,
    stage: "quota",
    allowed: true,
    max_projects_per_user_per_day: maxProjects,
    request_id: context.requestId,
  });
}

function jsonResponse(context: RequestContext, status: number, body: Record<string, unknown>) {
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

function logTrace(context: RequestContext, stage: string, provider: string, status: string) {
  console.log(
    JSON.stringify({
      request_id: context.requestId,
      user_id: context.userId,
      stage,
      provider,
      status,
      latency_ms: Date.now() - context.startedAt,
    }),
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

function stageToAgent(stage: string) {
  const agents: Record<string, string> = {
    script_generation: "Writer",
    storyboard_generation: "Director",
    image_generation: "Cinematographer",
    video_generation: "Video Producer",
    video_status: "Video Producer",
    voice_generation: "Voice Actor",
    render: "Editor",
  };
  return agents[stage] ?? "Backend";
}
