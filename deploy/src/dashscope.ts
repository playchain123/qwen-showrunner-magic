const DASHSCOPE_BASE = process.env.DASHSCOPE_BASE_URL || "https://dashscope-intl.aliyuncs.com";
export const CHAT_URL = `${DASHSCOPE_BASE}/compatible-mode/v1/chat/completions`;
export const VIDEO_SUBMIT_URL = `${DASHSCOPE_BASE}/api/v1/services/aigc/video-generation/video-synthesis`;
export const TASK_URL = (id: string) => `${DASHSCOPE_BASE}/api/v1/tasks/${id}`;

export function qwenModel(name: string, fallback: string) {
  return process.env[name] || fallback;
}

export function qwenMaasGenerationUrl() {
  const workspaceId = process.env.QWEN_WORKSPACE_ID;
  const region = process.env.QWEN_REGION || "ap-southeast-1";
  if (!workspaceId) {
    return `${DASHSCOPE_BASE}/api/v1/services/aigc/multimodal-generation/generation`;
  }
  return `https://${workspaceId}.${region}.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`;
}

export async function dashscopeFetch(url: string, init: RequestInit, timeoutMs = 60_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export function requireDashscopeKey() {
  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) throw new Error("DASHSCOPE_API_KEY not configured");
  return key;
}

export function traceAgent(stage: string, provider: string, startedAt: number, requestId: string, status: string) {
  return {
    agent: stage,
    provider,
    status,
    latency_ms: Date.now() - startedAt,
    request_id: requestId,
  };
}
