# Makers / Qwen Showrunner Magic

Makers uses a Qwen-powered agentic showrunner pipeline. Qwen3.7 models handle planning, writing, storyboarding, visual bible creation, cinematography, prompt compilation, and quality checking. Qwen-Image generates locked storyboard stills. Wan and HappyHorse perform the core video generation work. Qwen-TTS adds optional cinematic voice-over. The output is assembled by the Editor Agent into a final preview.

## Hackathon Model Strategy

- Qwen is the brain: planner, writer, director, prompt compiler, continuity checker, and critic.
- Qwen-Image is the visual anchor: storyboard stills, character/product references, hero frames.
- HappyHorse and Wan are the video engines: image-to-video first, text-to-video only as fallback or for wide establishing shots.
- Qwen-TTS provides optional voice-over and dialogue.
- FilmPlayer and local render/export logic assemble the final preview.

The primary route is:

```text
Qwen planning -> Qwen Image still/reference -> HappyHorse/Wan I2V -> Qwen quality check -> FilmPlayer/editor
```
