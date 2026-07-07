import type { AgentTraceItem } from "./library";

export const MODEL_STRATEGY = {
  planner: envDefault("QWEN_PLANNER_MODEL", "qwen3.7-plus"),
  final: envDefault("QWEN_FINAL_MODEL", "qwen3.7-max"),
  fast: envDefault("QWEN_FAST_MODEL", "qwen3.6-flash"),
  image: envDefault("QWEN_IMAGE_MODEL", "qwen-image-2.0"),
  imagePro: envDefault("QWEN_IMAGE_PRO_MODEL", "qwen-image-2.0-pro"),
  videoPrimary: envDefault("QWEN_VIDEO_PRIMARY_MODEL", "happyhorse-1.1-i2v"),
  videoT2v: envDefault("QWEN_VIDEO_T2V_MODEL", "happyhorse-1.1-t2v"),
  videoFallback: envDefault("QWEN_VIDEO_FALLBACK_MODEL", "wan2.2-t2v-plus"),
  videoI2vFallback: envDefault("QWEN_VIDEO_I2V_FALLBACK_MODEL", "wan2.2-i2v-plus"),
  tts: envDefault("QWEN_TTS_MODEL", "qwen3-tts-instruct-flash"),
  transcribe: envDefault("QWEN_TRANSCRIBE_MODEL", "paraformer-v2"),
} as const;

export const HACKATHON_ARCHITECTURE_SUMMARY =
  "Makers uses a Qwen-powered agentic showrunner pipeline. Qwen3.7 models handle planning, writing, storyboarding, visual bible creation, cinematography, prompt compilation, and quality checking. Qwen-Image generates locked storyboard stills. Wan and HappyHorse perform the core video generation work. Qwen-TTS adds optional cinematic voice-over. The output is assembled by the Editor Agent into a final preview.";

export function buildHackathonAgentTrace(overrides: Partial<Record<string, string>> = {}): AgentTraceItem[] {
  return [
    trace("Planner Agent", overrides["Planner Agent"] || MODEL_STRATEGY.planner, "Qwen planning and project structure"),
    trace("Script Writer Agent", overrides["Script Writer Agent"] || MODEL_STRATEGY.planner, "Qwen script and scene writing"),
    trace("Storyboard Agent", overrides["Storyboard Agent"] || MODEL_STRATEGY.planner, "Qwen storyboard planning"),
    trace("Visual Bible Agent", overrides["Visual Bible Agent"] || MODEL_STRATEGY.final, "Qwen identity and continuity lock"),
    trace("Cinematographer Agent", overrides["Cinematographer Agent"] || MODEL_STRATEGY.planner, "Qwen shot language and camera direction"),
    trace("Prompt Compiler", overrides["Prompt Compiler"] || MODEL_STRATEGY.planner, "Qwen prompt compilation"),
    trace("Image Producer", overrides["Image Producer"] || MODEL_STRATEGY.image, "Qwen Image storyboard stills"),
    trace("Video Producer", overrides["Video Producer"] || MODEL_STRATEGY.videoPrimary, "HappyHorse/Wan video generation"),
    trace("Voice Agent", overrides["Voice Agent"] || MODEL_STRATEGY.tts, "Qwen-TTS voice generation"),
    trace("Quality Check Agent", overrides["Quality Check Agent"] || MODEL_STRATEGY.planner, "Qwen quality and continuity checking"),
    trace("Editor Agent", overrides["Editor Agent"] || "FilmPlayer / ffmpeg", "Local assembly and playback"),
  ];
}

function trace(agent: string, model: string, note: string): AgentTraceItem {
  return {
    agent,
    status: "complete",
    model,
    note,
  };
}

function envDefault(name: string, fallback: string) {
  if (typeof process !== "undefined" && process.env?.[name]) return process.env[name] as string;
  return fallback;
}
