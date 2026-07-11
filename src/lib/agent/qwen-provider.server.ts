// Qwen provider for the Vercel AI SDK.
// Uses DashScope's OpenAI-compatible endpoint so we can drive Qwen with
// streamText + tool() + Output.object.

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function createQwenProvider() {
  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) throw new Error("DASHSCOPE_API_KEY missing");
  return createOpenAICompatible({
    name: "qwen",
    baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    apiKey: key,
    headers: { "X-DashScope-Client": "makers-agent" },
  });
}

export const QWEN_PLANNER_MODEL = () => process.env.QWEN_SCRIPT_MODEL || "qwen-plus";
export const QWEN_FAST_MODEL = () => process.env.QWEN_FAST_MODEL || "qwen-plus";