# 10-Shot Consistent Video Agent (Happyhorse + Wan + CosyVoice)

Build an InVideo-style agent that plans a 10-shot storyboard and renders it end-to-end using **only** Qwen Cloud models: Happyhorse (I2V/T2V/R2V/Video-Edit), Wan (T2V/I2V/R2V/Image/VideoEdit), CosyVoice + Voice-Enrollment. The agent (AI SDK `streamText` + tools) drives every stage and is exposed as a chat UI at `/dashboard/agent/:id`.

## Model routing (locked — agent cannot substitute)
- **Character sheet image** (hero portrait, one per character): `wan2.7-image-pro`
- **Storyboard frame images** (one per shot, seeded from character sheet for identity): `wan2.7-image-pro` with reference image
- **Shot 1 video** (establishing, from character-anchored frame): `happyhorse-1.1-i2v` → fallback `wan2.7-i2v`
- **Shots 2–10 video** (continuity): `happyhorse-1.1-r2v` (reference-to-video, seeds character token + prior last frame) → fallback `wan2.7-r2v-2026-06-12`
- **Optional edit pass** (color match / small fixes): `wan2.7-videoedit` or `happyhorse-1.0-video-edit`
- **Voice clone enrollment** (once per character, from a short sample or synthesized seed): `voice-enrollment`
- **Dialogue TTS with cloned voice**: `cosyvoice-v3-plus`
- **Lip-sync**: Wan video-edit pass driven by the TTS wav per shot

No other providers. `ALLOW_NON_QWEN_FALLBACKS=false` stays enforced.

## Agent architecture (AI SDK, server-side)
`src/routes/api/agent.ts` (already scaffolded) streams `streamText` with `stopWhen: stepCountIs(50)`. Tool catalog in `src/lib/agent/tools.server.ts`:

1. `plan_story({ premise, characters?, tone? })` — Qwen `qwen3.7-max` returns `{logline, characters[], 10 shots[]}` via `Output.object` (flat schema, no bounds).
2. `build_character_sheets()` — for each character, generate a canonical portrait via `wan2.7-image-pro`, upload to Supabase storage, save URL as the identity anchor.
3. `enroll_voices()` — for each character, call `voice-enrollment` with a seed clip (generated via CosyVoice defaults if user provided none) → get `voice_id`.
4. `generate_storyboard_frames()` — for each of 10 shots, `wan2.7-image-pro` with the character sheet as reference (weight ≥ 0.9) + shot prompt.
5. `render_shot({ index })` — shot 1 uses `happyhorse-1.1-i2v(frame, prompt)`; shots 2–10 use `happyhorse-1.1-r2v(character_sheet + prev_last_frame, prompt)`. Wan i2v/r2v fallback on failure.
6. `synth_dialogue({ index })` — CosyVoice with the character's enrolled `voice_id`.
7. `lipsync_shot({ index })` — Wan video-edit pass, driven by the dialogue wav.
8. `stitch_final()` — ffmpeg concat + audio mux server-side (via existing `ffmpeg-post`).
9. `ask_user({ question, choices? })` — clarifications only.

Consistency invariants enforced in tool bodies (not the model):
- Character sheet URL is stored on the bible row and injected as `reference_image` on every subsequent image/video call.
- `render_shot(n>1)` refuses to run unless shot n-1 completed and its last-frame URL is present.
- `negative_prompt` from `src/lib/negative-prompts.ts` always appended.

## DB (new migration)
`agent_projects(id, user_id, bible_id, premise, status, character_sheet_url, created_at)`, `agent_shots(id, project_id, index, prompt, frame_url, video_url, audio_url, final_url, status)`, `agent_voices(id, project_id, character_name, voice_id)`. RLS: user_id = auth.uid(). GRANTs on all three.

## UI
Extend `src/routes/dashboard_.agent.$id.tsx` (already routed) with:
- Chat panel (AI Elements): threaded messages, `useChat({ id: projectId, transport: DefaultChatTransport({ api: "/api/agent" }) })`, render `message.parts`, tool activity chips.
- Right rail: 10 shot cards showing frame → video → final states live as tool results stream.
- Textarea auto-focus per contract.

## Files to add/edit
- edit `src/lib/agent/tools.server.ts` (replace bible-pipeline tools with the 9 above)
- add `src/lib/agent/dashscope.server.ts` (thin wrappers for image, i2v, r2v, video-edit, cosyvoice, voice-enrollment against `dashscope-intl` REST)
- add `src/lib/agent/consistency.server.ts` (character-sheet + last-frame anchoring)
- add `src/lib/agent/stitch.server.ts` (ffmpeg concat + mux)
- add `supabase/migrations/<ts>_agent_projects.sql`
- edit `src/routes/api/agent.ts` (wire new tools, bind project row instead of bible)
- rewrite `src/routes/dashboard_.agent.$id.tsx` (chat + shot grid)
- edit `.env.example` (document that `DASHSCOPE_API_KEY` alone powers everything; drop Happyhorse-only key)

## Out of scope
- Longform (>10 shots), music beds, subtitles, multi-language dubbing — can be added later on top of the same agent.

Scope check: this is ~8 new server files, 1 migration, 1 rewritten route, and 1 route edit. No changes to the existing bible pipeline or website flows. Confirm this plan and I'll build it.