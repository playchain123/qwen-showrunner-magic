# Makers Project Context

## Product Concept

Makers is an autonomous AI Showrunner for the Global AI Hackathon with Qwen Cloud, Track 2. The product turns one user logline into a short drama workflow: script, storyboard, visuals, video, voice, and final preview/download.

Target users are independent creators, screenwriters, marketers, and social-media producers who want cinematic short-form video without a full production crew.

The MVP value proposition is:

- Idea to finished short film in minutes.
- Narrative-first output with script, shot list, continuity, and editing.
- Multimodal Qwen orchestration instead of a generic text-to-video prompt.

## Architecture Direction

Lovable is responsible for UI, auth, dashboard, project creation, editing screens, progress boards, and preview/player UX.

Alibaba Cloud is responsible for the backend proof layer:

- API Gateway exposes stable REST endpoints to Lovable.
- Function Compute runs the AI orchestrator, verifies JWTs, enforces quotas, calls Qwen/DashScope, manages jobs, and logs model/request metadata.
- OSS/RDS are preferred for generated assets and metadata. Supabase or local fallbacks are acceptable for MVP only.

Qwen Cloud / DashScope is the primary AI provider for all core generation:

- Qwen-Max or Qwen text model for story/script generation.
- Qwen-Max or Qwen-Plus for storyboard and shot planning.
- Qwen-Image for storyboard stills.
- Wan / HappyHorse for video generation.
- Qwen-TTS / CosyVoice for narration or dialogue.
- Qwen-VL or text continuity checks where practical.

Secret keys must stay in backend environment variables only. Browser/Lovable code must never contain `DASHSCOPE_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, OSS secrets, or other provider secrets.

## MVP Demo Scope

The first stable demo should be deliberately constrained:

- 3 scenes total.
- 3 to 5 seconds per scene.
- 12 to 15 seconds total rendered output.
- 720p if stable, 480p if speed is more important.
- One simple narration or one character line per scene.
- Regenerate failed scenes individually instead of restarting the full project.

Recommended demo prompt:

> A young inventor in Chennai builds a tiny robot to deliver one forgotten birthday gift before midnight, but the city rain turns the journey into an emotional race against time.

Scene shape:

1. Inventor creates robot in a small workshop during rain.
2. Robot travels through wet neon streets carrying the gift.
3. Robot reaches the birthday child just before midnight.

## Backend Priorities

Implement backend work in this order:

1. Make the AI path Qwen-first.
   - Use a common DashScope/Qwen client.
   - Use Qwen-Image as the primary image path.
   - Use Qwen-TTS or CosyVoice as the primary voice path.
   - Keep non-Qwen providers only as fallbacks if needed.

2. Stabilize demo execution.
   - Add `DEMO_MODE=true`.
   - Enforce max 3 scenes.
   - Enforce max 15 total video seconds.
   - Add controlled concurrency for image/video jobs.
   - Add polling backoff for async video jobs.
   - Add retry handling for network failures without duplicating paid jobs.

3. Add Alibaba Function Compute proof.
   - Create a `deploy/` backend folder.
   - Include `s.yaml`.
   - Add handlers for script, storyboard, image, video, video status, voice, render, and quota.
   - Log request IDs, user IDs, project IDs, endpoints, models, providers, latency, status, and errors.

4. Prepare hackathon deliverables.
   - Lovable public app URL.
   - Alibaba API Gateway URL.
   - Function Compute logs and proof recording.
   - Architecture diagram.
   - Two-minute demo video from logline to final preview.

## Expected API Surface

The backend should expose these routes:

- `POST /api/script`: logline to screenplay JSON using Qwen text.
- `POST /api/storyboard`: script to scene/shot JSON using Qwen text.
- `POST /api/image`: shot to storyboard still using Qwen-Image.
- `POST /api/video`: submit one shot video job using Wan or HappyHorse.
- `GET /api/video-status`: poll one provider job.
- `POST /api/voice`: generate dialogue or narration audio using Qwen-TTS or CosyVoice.
- `POST /api/render`: stitch clips, audio, and captions with ffmpeg.
- `GET /api/project/:id`: return full project status.
- `POST /api/quota/check`: check quota before expensive calls.

Every expensive endpoint should verify the Supabase JWT before calling Qwen.

## Agent Orchestration

Makers should behave like a planner-executor loop, not one giant prompt:

1. Writer Agent creates title, concept, characters, and script.
2. Director Agent creates scenes, shots, camera directions, and timing.
3. Continuity Agent keeps character, wardrobe, location, and tone consistent.
4. Cinematographer Agent creates Qwen-Image prompts and storyboard stills.
5. Video Producer Agent submits and polls Wan/HappyHorse jobs.
6. Voice Agent creates audio.
7. Editor Agent stitches or exports the final timeline.

Responses should expose an `agent_trace` with agent name, model, provider, status, latency, and request/job IDs. This helps judge clarity and debugging.

## Output Schema Rules

Backend responses consumed by the UI should use valid JSON only. Do not return markdown from generation endpoints.

Screenplay JSON should include:

- `title`
- `genre`
- `tone`
- `logline`
- `characters[]`
- `world`
- `scenes[]`

Each scene should include:

- `scene_number`
- `heading`
- `duration_seconds`
- `action`
- `dialogue[]`
- `camera`
- `image_prompt`
- `video_prompt`
- `negative_prompt`

## Cost And Reliability Rules

Use conservative limits for the hackathon MVP:

- Max scenes per demo project: 3.
- Max seconds per scene: 5.
- Max total video seconds: 15.
- Max parallel image jobs: 2 to 3.
- Max parallel video jobs: 3.
- Daily projects per user: 3.
- Video polling interval: 5s, then 10s, then 15s.
- Retry count: 2 for network failures.

Never resubmit an expensive provider job if a `provider_job_id` already exists. Poll the existing job instead.

## Environment Variables

Backend-only:

- `DASHSCOPE_API_KEY`
- `QWEN_WORKSPACE_ID`
- `QWEN_REGION`
- `QWEN_SCRIPT_MODEL`
- `QWEN_FAST_MODEL`
- `QWEN_IMAGE_MODEL`
- `QWEN_VIDEO_MODEL`
- `QWEN_TTS_MODEL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DEMO_MODE`
- `MAX_SCENES`
- `MAX_PARALLEL_VIDEO_JOBS`
- `MAX_VIDEO_SECONDS_PER_PROJECT`
- `MAX_PROJECTS_PER_USER_PER_DAY`

Frontend-safe:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_API_BASE_URL`

## Current Implementation Lens

When changing this repo, preserve Lovable as the UI layer and move AI provider calls, secrets, quotas, expensive job orchestration, and Alibaba deployment proof into backend/serverless code.

The first implementation target should be a stable Qwen-first 3-scene flow, not the full 30 to 90 second product.
