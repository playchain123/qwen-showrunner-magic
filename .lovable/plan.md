## Goal

Make every generated video internally consistent — same characters look the same across shots, each character always speaks in the same voice, dialogue never gets rephrased between stages, and locations/style stay locked. Do this by refactoring the pipeline around a single canonical **Story Bible** object that every agent reads from and writes back to.

## Architecture (target)

```text
User brief
   │
   ▼
[1 Director]  ──►  writes bible.plan (logline, style, characters[], locations[], acts[])
   │
   ▼
[2 Screenwriter] ──►  writes bible.scenes[]  (beats + dialogue lines, LOCKED after this step)
   │
   ▼
[3 Art Director] ──►  generates + stores character sheets & location sheets → bible.characters[i].refImageUrl
   │
   ▼
[4 Voice Caster] ──►  picks ONE voice per character → bible.characters[i].voice { id, speed, pitch, style }
   │
   ▼
[5 Shot Planner] ──►  bible.shots[]  (each shot inherits characterRefs, locationRef, styleBible, dialogueSlice)
   │
   ▼
[6 Shot Renderer] ──►  video per shot, using image conditioning from refImageUrl (NOT text description of face)
   │
   ▼
[7 Voice Renderer] ──►  TTS per dialogue line, always with that character's stored voice params
   │
   ▼
[8 Continuity QC] ──►  CLIP/face-embedding check per shot vs. character sheet → regenerate only failing shots
   │
   ▼
[9 Assembler] ──►  ffmpeg / Remotion (deterministic, no LLM)
```

The bible is the single source of truth. No downstream agent is allowed to re-read the original user brief or invent new characters/locations/dialogue.

## Data model

New tables (Lovable Cloud):

- `story_bibles` — one row per project. `bible jsonb` holds the whole locked plan.
- `bible_characters` — per-character record: `id`, `project_id`, `token`, `name`, `description`, `ref_image_url`, `ref_image_variants jsonb` (front/3-4/profile), `voice_id`, `voice_params jsonb`, `visual_seed`.
- `bible_locations` — per-location record with `ref_image_url`, `palette`, `lighting`.
- `bible_scenes` — locked scenes with `beat`, `location_id`, `character_ids[]`, `dialogue jsonb[]` (`{speaker_id, text, duration_est}`).
- `bible_shots` — per shot: `scene_id`, `character_ids[]`, `location_id`, `dialogue_slice`, `visual_prompt`, `seed`, `status`, `clip_url`, `qc_score`.

Reuse existing `character_embeddings` and `scene_embeddings` for the QC step (cosine-similarity check on each rendered shot's embedding vs. the stored character sheet embedding).

Add storage bucket `bible-refs` for character sheets and location plates.

## Code changes

Server functions (all under `src/lib/`, all with `requireSupabaseAuth`):

- `src/lib/bible/director.functions.ts` — `planStory({ brief }) → bible.plan`
- `src/lib/bible/screenwriter.functions.ts` — `writeScenes({ bibleId }) → bible.scenes` (locks dialogue)
- `src/lib/bible/art-director.functions.ts` — `generateSheets({ bibleId })` → creates + persists character/location ref images to storage, updates rows
- `src/lib/bible/voice-caster.functions.ts` — `assignVoices({ bibleId })` → picks & stores one voice per character
- `src/lib/bible/shot-planner.functions.ts` — `planShots({ bibleId })`
- `src/lib/bible/shot-renderer.functions.ts` — `renderShot({ shotId })` — MUST pass the character `ref_image_url` as image conditioning (Qwen/Wan i2v with first-frame ref), MUST use the stored seed, MUST NOT re-describe the character in the text prompt
- `src/lib/bible/voice-renderer.functions.ts` — `renderVoice({ shotId, dialogueIndex })` — reads voice from `bible_characters`, sends the exact locked dialogue string, no paraphrasing
- `src/lib/bible/continuity-qc.functions.ts` — `qcShot({ shotId })` — embeds a keyframe, compares to character sheet embedding via `match_character_embedding`, returns pass/fail
- `src/lib/bible/orchestrator.functions.ts` — the loop: runs steps 1→9, retries only failing units, writes progress back to `story_bibles.status`

Refactor existing code, do not rewrite:

- `src/lib/qwen.functions.ts` — add an internal `generateVoiceForCharacter({ characterId, text })` that ignores any caller-supplied voice params and reads them from `bible_characters`. Existing `generateVoice` stays for ad-hoc use but is no longer called by the pipeline.
- `src/lib/continuity.ts` — extend `StoryScene` to reference `bible_characters.id` and `bible_locations.id`; keep the negative-prompt system.
- `src/lib/website-video.ts` and `website-render-pipeline.ts` — become consumers of `bible_shots` instead of generating shots independently. Fallback compiled motion graphics still allowed, but only when a shot fails QC 3× in a row.

UI (agent page):

- `src/routes/dashboard_.agent.$id.tsx` — show the bible as it fills in: plan → scenes → character sheets (with the ref images) → voices (with a "listen" preview) → shots grid → QC results. Each stage has a "regenerate this only" button so the user never has to restart the whole run.

## Consistency guarantees (the rules that make it work)

1. **Bible is append-only after each step.** A later agent can add fields but never rewrite an earlier one. Enforced by a per-step JSON schema validator.
2. **Dialogue is frozen after Screenwriter.** TTS input === bible scene dialogue string, byte for byte. No summarization step in between.
3. **One voice per character, ever.** `bible_characters.voice_id` is set once by Voice Caster; every TTS call reads from that row.
4. **Character refs are inputs, not descriptions.** Shot renderer sends the reference image as conditioning (Qwen i2v / Wan i2v first-frame). Text prompt describes action + camera only, never the face.
5. **Deterministic seeds.** Global project seed + per-character seed stored in the bible; every regeneration reuses them.
6. **QC gate before assembly.** A shot below the similarity threshold is regenerated (up to N times), not shipped.
7. **Style bible is a prompt suffix**, appended to every shot prompt and every regen. Never re-derived.

## Rollout order

1. Migration: `story_bibles`, `bible_characters`, `bible_locations`, `bible_scenes`, `bible_shots` + GRANTs + RLS scoped to `auth.uid()`; storage bucket `bible-refs`.
2. Director + Screenwriter server functions and the bible-status UI panel.
3. Art Director (character sheet generation + storage) and Voice Caster.
4. Shot Planner + Shot Renderer wired to image conditioning; refactor `qwen.functions.ts` voice path to read from `bible_characters`.
5. Continuity QC using existing embedding tables + `match_character_embedding` RPC.
6. Orchestrator + per-stage "regenerate this only" buttons on the agent page.
7. Retire the old ad-hoc generation path once the bible pipeline covers the same features.

## Out of scope for this plan

- Editor-style manual bible editing UI (nice-to-have, add after the pipeline works).
- Multi-language dialogue (existing Sarvam/Qwen TTS routing keeps working; voice choice is still one-per-character-per-language).
- Character LoRA training (image conditioning is enough at this quality level; add LoRA only if similarity scores plateau).
