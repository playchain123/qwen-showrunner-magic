// Server-only Lovable AI Gateway helper for JSON-mode LLM calls.
// Kept minimal to match the existing raw-fetch style in qwen.functions.ts.

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type GatewayJsonOptions = {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
};

export async function callGatewayJson<T>(opts: GatewayJsonOptions): Promise<T> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: opts.model || "google/gemini-3-flash-preview",
      temperature: opts.temperature ?? 0.6,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });
  if (res.status === 429) throw new Error("Rate limit exceeded (429). Try again shortly.");
  if (res.status === 402) throw new Error("AI credits exhausted (402). Add credits in workspace settings.");
  if (!res.ok) throw new Error(`Gateway error ${res.status}: ${await res.text()}`);
  const payload = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = payload.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Gateway returned empty content");
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`Gateway returned non-JSON content: ${(err as Error).message}`);
  }
}