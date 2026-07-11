import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, stepCountIs, type UIMessage } from "ai";
import { createQwenProvider, QWEN_PLANNER_MODEL } from "@/lib/agent/qwen-provider.server";

type ChatRequestBody = { messages?: unknown; bibleId?: unknown };

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
        const bibleId = typeof body.bibleId === "string" ? body.bibleId : null;
        if (!messages) return new Response("messages required", { status: 400 });
        if (!bibleId) return new Response("bibleId required", { status: 400 });

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

        // Verify the bible belongs to the user before exposing tools that mutate it.
        const { data: bibleRow, error: bibleErr } = await sb
          .from("story_bibles")
          .select("id")
          .eq("id", bibleId)
          .eq("user_id", userId)
          .maybeSingle();
        if (bibleErr || !bibleRow) return new Response("Bible not found", { status: 404 });

        const { buildMakersTools, MAKERS_SYSTEM_PROMPT } = await import("@/lib/agent/tools.server");
        // Cast: tools.server.ts imports from bible/pipeline.server.ts, which is typed with our Database.
        // The Supabase client here is created with generic Database via the types module.
        const { supabaseAdmin: _unused } = { supabaseAdmin: null } as { supabaseAdmin: null };
        void _unused;
        const tools = buildMakersTools(sb as never, userId, bibleId);

        let provider;
        try {
          provider = createQwenProvider();
        } catch (err) {
          return new Response(err instanceof Error ? err.message : "Qwen provider missing", { status: 500 });
        }

        const result = streamText({
          model: provider(QWEN_PLANNER_MODEL()),
          system: MAKERS_SYSTEM_PROMPT,
          messages: await convertToModelMessages(messages),
          tools,
          stopWhen: stepCountIs(50),
        });

        return result.toUIMessageStreamResponse({ originalMessages: messages });
      },
    },
  },
});