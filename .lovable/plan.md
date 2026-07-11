## Goal

Replace the hand-rolled linear pipeline in `dashboard_.agent.$id.tsx` + `longform-graph.ts` with a single **Qwen-driven agent orchestrator** that plans and executes the full film using tool calls. Only Qwen (planner/writer) and Happyhorse (image/video fallback) are used — no OpenAI / Gemini / Lovable AI Gateway in the pipeline. You'll add the new Happyhorse API key when ready.

## New architecture

```text
User prompt
   ↓
[Character Bible modal]   ← already wired
   ↓
runMakersAgent (server fn, streaming)
   ├─ Qwen planner loop (stopWhen: stepCountIs(50))
   │    tools:
   │      build_bible(prompt, refs)         → VisualBible
   │      write_script(bible, beats)        → Script (Output.object)
   │      generate_storyboard(script)       → Scene[] (Output.object)
   │      render_scene_image(scene, bible)  → Qwen image, HH fallback
   │      render_scene_video(scene, image)  → Wan i2v, HH fallback
   │      qa_scene(scene, video)            → {pass, issues[]}
   │      ask_user(question, choices)       → pauses stream, waits for reply
   │      stitch_film(scenes, audio)        → final mp4
   ↓
Client renders streamed message.parts (planner thoughts, tool calls, tool results)
   ↓
Result page: full-video player + per-scene inspector + context panel
```

## Files to add

- `src/lib/agent/qwen-provider.server.ts` — OpenAI-compatible provider pointed at DashScope (`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`) using `QWEN_API_KEY`. Wraps `@ai-sdk/openai-compatible`.
- `src/lib/agent/happyhorse.server.ts` — thin client for image + video endpoints, used as fallback inside tools.
- `src/lib/agent/tools.server.ts` — all `tool({ inputSchema, execute })` definitions above. Each tool returns compact JSON; large blobs (images/videos) are uploaded to Supabase Storage and only URLs pass back to the model.
- `src/lib/agent/orchestrator.functions.ts` — `runMakersAgent = createServerFn` that streams `toUIMessageStreamResponse`. Middleware: `requireSupabaseAuth`. System prompt encodes the Makers house style + demo limits (`MAX_SCENES=3`, `MAX_VIDEO_SECONDS_PER_PROJECT=15`).
- `src/routes/api/agent.ts` — streaming chat route for the workspace UI (uses `useChat` transport). Delegates to the same tool set.

## Files to modify

- `src/routes/dashboard_.agent.$id.tsx`
  - Rip out the current `runPipeline` + step cards.
  - Replace with `useChat({ transport: DefaultChatTransport({ api: "/api/agent" }) })`.
  - Render `message.parts`:
    - text → planner narration (markdown)
    - tool-call → collapsed card ("Rendering scene 2 image…")
    - tool-result → inline preview (image thumb, video player, script excerpt)
    - `ask_user` tool → renders inline question with buttons that call `sendMessage` with the answer (this is the "asks question again" step the user wanted)
  - Bible modal remains **step 1**; on submit, it calls `sendMessage` with the bible + prompt as the first user turn.
- `src/lib/longform-graph.ts` → delete (behavior moves into tools).
- `src/lib/makers-runtime.ts` → keep constants; drop `runWithConcurrency` (agent handles parallelism via multiple tool calls per step).

## Secrets

- Reuse existing `QWEN_API_KEY`, `QWEN_SCRIPT_MODEL=qwen3.7-max`, `QWEN_FAST_MODEL=qwen-plus`, `QWEN_IMAGE_MODEL`, `QWEN_VIDEO_MODEL`.
- Add `HAPPYHORSE_API_KEY` via `add_secret` (I'll trigger this at implementation time; user pastes value).
- No `LOVABLE_API_KEY` needed for the agent path.

## Reliability wins

- `stopWhen: stepCountIs(50)` lets the planner retry a failed scene (call `render_scene_video` again, or fall back to Happyhorse) without app code.
- Structured output via `Output.object` for script + storyboard — no more manual `JSON.parse` guessing.
- Tool schemas are narrow (no `.min/.max` per Qwen's OpenAI-compatible limits); prompt enforces caps and code clamps.
- Per-tool `try/catch` returns `{ok:false, error, fallback_available:true}` so the planner can decide to retry or reroute instead of crashing the stream.

## Out of scope

- No UI redesign of dashboard shell/sidebar/auth.
- Bible page and library remain untouched.
- Website-video and ads pages unaffected.

## Rollout

1. Land provider + tools + orchestrator server-side (no UI change yet).
2. Add `/api/agent` route + smoke-test via `stack_modern--invoke-server-function`.
3. Swap `dashboard_.agent.$id.tsx` to `useChat` UI with `message.parts` rendering + `ask_user` inline component.
4. Delete `longform-graph.ts` and dead helpers.
5. Typecheck + hit `/dashboard/agent/<id>` end-to-end with a demo prompt.

Approve and I'll implement it in that order, requesting the Happyhorse key at step 1.    
just use only happyhorse and wen that all 