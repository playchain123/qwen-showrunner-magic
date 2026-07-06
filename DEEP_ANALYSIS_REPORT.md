# Qwen Showrunner Magic: Deep Architectural & Technical Analysis Report

## 1. Project Overview & Product Vision

**Project Name**: Makers (Qwen Showrunner Magic)
**Purpose**: An autonomous AI Showrunner built for the Global AI Hackathon (Qwen Cloud, Track 2). It transforms a user's single logline into a complete short drama workflow, generating scripts, storyboards, cinematic stills, voiceovers, and final stitched videos.
**Target Audience**: Independent creators, screenwriters, marketers, and social media producers.
**Core Value Proposition**: "Idea to finished short film in minutes" using a multimodal AI orchestration approach rather than a single generic text-to-video prompt.

### Hackathon MVP Constraints (Demo Mode)
To manage costs and ensure reliability, the MVP is strictly constrained:
- **Maximum Scenes**: 3
- **Scene Duration**: 3-5 seconds
- **Total Render Length**: ~15 seconds maximum
- **Resolution**: 720p (or 480p for speed)
- **Concurrency Limits**: Max 2-3 parallel image jobs, max 3 parallel video jobs.

---

## 2. Technical Stack & Architecture

The architecture is explicitly separated into a UI layer managed by **Lovable** and a robust backend proof layer managed on **Alibaba Cloud**.

### Frontend (UI & Client Logic)
- **Framework**: React 19.2.0 (latest) with DOM bindings.
- **Meta-Framework & Routing**: TanStack Start & TanStack Router (`@tanstack/react-start`, `@tanstack/react-router`). This handles SSR and full-stack routing.
- **Build Tool**: Vite (configured via `@lovable.dev/vite-tanstack-config`), with Nitro bundling for server deployments.
- **Styling**: Tailwind CSS v4 (`@tailwindcss/vite`) combined with Radix UI headless components and Shadcn/ui patterns (`class-variance-authority`, `clsx`, `tailwind-merge`).
- **State & Data Fetching**: TanStack React Query (`@tanstack/react-query`).
- **Form Handling**: React Hook Form (`react-hook-form`) combined with Zod (`zod`) for robust schema validation.

### Backend (Serverless Orchestration)
- **Hosting / Compute**: Alibaba Cloud Function Compute (`fc3` component), managed via Serverless Devs (`deploy/s.yaml`).
- **API Layer**: Exposes stable REST/RPC endpoints via TanStack Start's `createServerFn`.
- **Database & Auth**: Supabase (PostgreSQL, JWT). Used primarily for state management, user authentication, and as a fallback metadata store. JWT validation is required before executing expensive AI generation.

### AI Integration Layer (Qwen Maas / DashScope)
The core intelligence relies heavily on Alibaba's DashScope APIs, orchestrated via server-side functions.
- **Text & Scripting**: `qwen3.7-max` and `qwen-plus` for complex reasoning (Writer & Director agents).
- **Image Generation (Storyboards)**: `qwen-image-2.0` (with 1664x928 default resolution).
- **Video Generation**: `happyhorse-1.1-t2v` & `happyhorse-1.1-i2v` (with fallbacks to `wan2.2-t2v-plus`).
- **Voice / TTS**: `qwen3-tts-flash` (and CosyVoice) for cinematic voice acting.
- **Speech Recognition (ASR)**: `paraformer-v2` for generating precise word-level subtitle timing.

---

## 3. Deep Dive: Project Structure & File Analysis

### 3.1 Root Configuration
- **`package.json`**: Reveals a modern Node environment utilizing ESM (`"type": "module"`). It heavily leverages the `@tanstack` ecosystem and bleeding-edge React 19 features. The build process relies on `vite`.
- **`vite.config.ts`**: Minimal configuration relying on a centralized `@lovable.dev/vite-tanstack-config` plugin. It redirects the server entry to `src/server.ts`, indicating a custom SSR or error-handling wrapper before hitting Nitro.
- **`.env.example`**: Clearly demarcates "Frontend-safe" variables (Supabase URL/Key) from "Backend-only" variables (DashScope API keys, model designations, execution limits like `MAX_SCENES=3`).
- **`eslint.config.js` / `.prettierrc`**: Standardized code formatting and linting setup to maintain code hygiene in a potentially fast-paced hackathon environment.

### 3.2 Source Directory (`/src`)
- **`/routes`**: Contains TanStack router file-based routing logic.
  - `__root.tsx`: The main application shell/layout.
  - `auth.tsx`: Authentication flows (likely Supabase integration).
  - `dashboard.tsx`, `dashboard_.library.tsx`, `dashboard_.agent.$id.tsx`: The core application views where users interact with the autonomous agents and their generated projects.
- **`router.tsx` & `routeTree.gen.ts`**: Generated and manual configurations for the TanStack router mapping.
- **`server.ts` & `start.ts`**: Entry points for the Nitro server backend and the React frontend respectively.
- **`/components`, `/hooks`, `/lib`**: Standard React architecture for UI components, custom React hooks, and utility libraries.

### 3.3 Deployment Configuration (`/deploy`)
- **`s.yaml`**: The critical Serverless Devs configuration for Alibaba Cloud. 
  - Deploys to `ap-southeast-1`.
  - Uses `custom.debian10` runtime with 1024MB memory.
  - Sets strict concurrency (10 instances) and timeout (120s) rules.
  - Injects environment variables directly into the Function Compute instance, ensuring the frontend never sees Qwen API keys.

### 3.4 AI Orchestration (`qwen.functions.ts.original`)
This file is the "brain" of the backend AI interaction.
1. **TTS Engine (`generateSceneAudio`)**: 
   - Uses `qwen3-tts-flash`.
   - Injects rich system prompts to enforce cinematic voice acting over robotic narration.
   - Handles fallback mechanisms dynamically.
2. **Image Generation (`generateSceneImage`)**:
   - Uses `qwen-image-2.0`.
   - Takes a scene prompt and optional reference images for character/style continuity (weighted at 75% by default).
   - Enforces negative prompts to avoid subtitles/watermarks, ensuring clean cinematic output.
3. **Asynchronous Audio Transcription (`transcribeAudio`)**:
   - Uses `paraformer-v2`.
   - Because transcription is a slow, asynchronous job on DashScope, it implements a polling loop (checking task status via `TASK_URL` every 2 seconds for up to 60 seconds).
   - Extracts word-level timestamps (`begin_time`, `end_time`) for subtitle synchronization.

---

## 4. Agentic Workflow Architecture

According to `PROJECT_CONTEXT.md`, the platform does not use a single "mega-prompt". Instead, it utilizes a sophisticated multi-agent pipeline:

1. **Writer Agent**: Logline → Title, Concept, Script (JSON).
2. **Director Agent**: Script → Scene breakdowns, shots, camera directions.
3. **Continuity Agent**: Maintains character, wardrobe, and tone state across scenes.
4. **Cinematographer Agent**: Creates Qwen-Image prompts and storyboard stills.
5. **Video Producer Agent**: Submits image/text to the HappyHorse/Wan video engines and polls for completion.
6. **Voice Agent**: Generates aligned TTS dialogue.
7. **Editor Agent**: FFMPEG rendering, stitching clips, audio, and subtitles together.

All agents must output strictly formatted JSON to be consumed by the UI, with an `agent_trace` attached to payloads for debugging latency, model usage, and provider status.

---

## 5. Security & Cost Optimization

1. **Secret Isolation**: DashScope keys and Supabase Service Role keys exist *only* in backend environment variables.
2. **Pre-Flight Quota Checks**: A `POST /api/quota/check` endpoint ensures users haven't exceeded their daily limits before kicking off expensive DashScope jobs.
3. **Idempotency & Polling**: The video producer agent is designed to *never* resubmit a job if a `provider_job_id` exists. It relies on polling with exponential backoff (5s → 10s → 15s) to save API costs and prevent duplicate renders.
4. **JWT Verification**: Every expensive API endpoint (`/api/video`, `/api/image`) must parse and validate the Supabase JWT before communicating with Qwen Cloud.

---

## 6. Conclusion

The "Makers" project is a highly sophisticated, production-ready AI orchestration platform. It excellently separates concerns by keeping the UI responsive and optimistic (via React 19 + TanStack) while offloading heavy, stateful, and secure AI generation polling to Alibaba Cloud serverless functions. Its use of specialized agents and strict MVP limits indicates a highly practical approach to building AI video generation products within hackathon constraints.
