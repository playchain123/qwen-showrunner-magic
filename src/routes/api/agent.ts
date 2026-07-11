import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, stepCountIs, type UIMessage } from "ai";
import { createQwenProvider, QWEN_PLANNER_MODEL } from "@/lib/agent/qwen-provider.server";

type ChatRequestBody = { messages?: unknown; projectId?: unknown };

export const Route = createFileRoute("/api/agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: ChatRequestBody;
        try {
          body = (await request.json()) as ChatRequestBody;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const messages = Array.isArray(body.messages) ? (body.messages as UIMessage[]) : null;
        const projectId = typeof body.projectId === "string" ? body.projectId : null;
        if (!messages) return new Response("messages required", { status: 400 });
        if (!projectId) return new Response("projectId required", { status: 400 });

        // Authenticate the caller with the Supabase publishable client + bearer token.
        const auth = request.headers.get("authorization") || request.headers.get("Authorization");
        if (!auth) return new Response("Unauthorized", { status: 401 });
        const token = auth.replace(/^Bearer\s+/i, "");

        const { createClient } = await import("@supabase/supabase-js");
        const url = process.env.SUPABASE_URL;
        const pubKey = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!url || !pubKey) return new Response("Supabase not configured", { status: 500 });
        const sb = createClient(url, pubKey, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: userRes, error: userErr } = await sb.auth.getUser(token);
        if (userErr || !userRes.user) return new Response("Unauthorized", { status: 401 });
        const userId = userRes.user.id;

        // Verify the project belongs to the user before exposing tools that mutate it.
        const { data: projRow, error: projErr } = await sb
          .from("agent_projects")
          .select("id")
          .eq("id", projectId)
          .eq("user_id", userId)
          .maybeSingle();
        if (projErr || !projRow) return new Response("Project not found", { status: 404 });

        const { buildShowrunnerTools, SHOWRUNNER_SYSTEM_PROMPT } = await import("@/lib/agent/tools.server");
        const tools = buildShowrunnerTools(sb as never, userId, projectId);

        let provider;
        try {
          provider = createQwenProvider();
        } catch (err) {
          return new Response(err instanceof Error ? err.message : "Qwen provider missing", { status: 500 });
        }

        const result = streamText({
          model: provider(QWEN_PLANNER_MODEL()),
          system: SHOWRUNNER_SYSTEM_PROMPT,
          messages: await convertToModelMessages(messages),
          tools,
          stopWhen: stepCountIs(50),
        });

        return result.toUIMessageStreamResponse({ originalMessages: messages });
      },
    },
  },
});