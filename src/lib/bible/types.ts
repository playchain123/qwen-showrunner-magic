// Story Bible shared types. Client-safe (no server imports here).

export type BibleStage =
  | "director"
  | "screenwriter"
  | "art_director"
  | "voice_caster"
  | "shot_planner"
  | "shot_renderer"
  | "voice_renderer"
  | "continuity_qc"
  | "assembler"
  | "done";

export type BibleStatus = "draft" | "running" | "blocked" | "done" | "failed";

export type StyleBible = {
  palette: string[];
  lighting: string;
  lens: string;
  film_stock: string;
  aspect_ratio: "16:9" | "9:16" | "1:1";
  tone: string;
  negative_prompt: string;
};

export type DirectorPlan = {
  logline: string;
  synopsis: string;
  target_seconds: number;
  acts: Array<{ name: string; summary: string }>;
  characters: Array<{
    token: string;
    name: string;
    description: string;
    role: "protagonist" | "supporting" | "antagonist" | "narrator";
  }>;
  locations: Array<{
    token: string;
    name: string;
    description: string;
  }>;
};

export type DialogueLine = {
  speaker_token: string; // references bible_characters.token
  text: string;
  duration_est: number;
};

export type ScenePlan = {
  scene_index: number;
  location_token: string;
  character_tokens: string[];
  beat: string;
  dialogue: DialogueLine[];
  duration_estimate: number;
};

export type VoiceParams = {
  speed: number;
  pitch: number;
  style: string;
};

export type StoryBibleRow = {
  id: string;
  user_id: string;
  project_id: string;
  brief: string;
  status: BibleStatus;
  stage: BibleStage;
  plan: DirectorPlan | Record<string, never>;
  style_bible: StyleBible | Record<string, never>;
  global_seed: number;
  created_at: string;
  updated_at: string;
};

export type CharacterRow = {
  id: string;
  bible_id: string;
  token: string;
  name: string;
  description: string;
  ref_image_url: string | null;
  ref_image_variants: Array<{ pose: string; url: string }>;
  voice_id: string | null;
  voice_params: VoiceParams | Record<string, never>;
  visual_seed: number;
};

export type LocationRow = {
  id: string;
  bible_id: string;
  token: string;
  name: string;
  description: string;
  ref_image_url: string | null;
  palette: string[];
  lighting: string | null;
};

export type SceneRow = {
  id: string;
  bible_id: string;
  scene_index: number;
  location_id: string | null;
  character_ids: string[];
  beat: string;
  dialogue: DialogueLine[];
  duration_estimate: number;
  locked: boolean;
};

export type ShotRow = {
  id: string;
  bible_id: string;
  scene_id: string;
  shot_index: number;
  character_ids: string[];
  location_id: string | null;
  dialogue_slice: DialogueLine[];
  visual_prompt: string;
  camera: string | null;
  seed: number;
  duration_seconds: number;
  status: "pending" | "generating" | "ready" | "failed";
  attempt_count: number;
  clip_url: string | null;
  audio_url: string | null;
  qc_score: number | null;
  qc_notes: string | null;
};

export type BibleSnapshot = {
  bible: StoryBibleRow;
  characters: CharacterRow[];
  locations: LocationRow[];
  scenes: SceneRow[];
  shots: ShotRow[];
};