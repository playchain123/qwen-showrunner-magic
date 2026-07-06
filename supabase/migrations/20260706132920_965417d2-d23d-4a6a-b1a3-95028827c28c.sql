
-- Story Bible tables

CREATE TABLE public.story_bibles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  brief TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  stage TEXT NOT NULL DEFAULT 'director',
  plan JSONB NOT NULL DEFAULT '{}'::jsonb,
  style_bible JSONB NOT NULL DEFAULT '{}'::jsonb,
  global_seed BIGINT NOT NULL DEFAULT floor(random() * 1e9)::bigint,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.story_bibles TO authenticated;
GRANT ALL ON public.story_bibles TO service_role;
ALTER TABLE public.story_bibles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage story bibles" ON public.story_bibles
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.bible_characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bible_id UUID NOT NULL REFERENCES public.story_bibles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  ref_image_url TEXT,
  ref_image_variants JSONB NOT NULL DEFAULT '[]'::jsonb,
  voice_id TEXT,
  voice_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  visual_seed BIGINT NOT NULL DEFAULT floor(random() * 1e9)::bigint,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bible_id, token)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bible_characters TO authenticated;
GRANT ALL ON public.bible_characters TO service_role;
ALTER TABLE public.bible_characters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage bible characters" ON public.bible_characters
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.bible_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bible_id UUID NOT NULL REFERENCES public.story_bibles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  ref_image_url TEXT,
  palette JSONB NOT NULL DEFAULT '[]'::jsonb,
  lighting TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bible_id, token)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bible_locations TO authenticated;
GRANT ALL ON public.bible_locations TO service_role;
ALTER TABLE public.bible_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage bible locations" ON public.bible_locations
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.bible_scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bible_id UUID NOT NULL REFERENCES public.story_bibles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scene_index INT NOT NULL,
  location_id UUID REFERENCES public.bible_locations(id) ON DELETE SET NULL,
  character_ids UUID[] NOT NULL DEFAULT '{}',
  beat TEXT NOT NULL,
  dialogue JSONB NOT NULL DEFAULT '[]'::jsonb,
  duration_estimate NUMERIC NOT NULL DEFAULT 0,
  locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bible_id, scene_index)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bible_scenes TO authenticated;
GRANT ALL ON public.bible_scenes TO service_role;
ALTER TABLE public.bible_scenes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage bible scenes" ON public.bible_scenes
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.bible_shots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bible_id UUID NOT NULL REFERENCES public.story_bibles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scene_id UUID NOT NULL REFERENCES public.bible_scenes(id) ON DELETE CASCADE,
  shot_index INT NOT NULL,
  character_ids UUID[] NOT NULL DEFAULT '{}',
  location_id UUID REFERENCES public.bible_locations(id) ON DELETE SET NULL,
  dialogue_slice JSONB NOT NULL DEFAULT '[]'::jsonb,
  visual_prompt TEXT NOT NULL,
  camera TEXT,
  seed BIGINT NOT NULL DEFAULT floor(random() * 1e9)::bigint,
  duration_seconds NUMERIC NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INT NOT NULL DEFAULT 0,
  clip_url TEXT,
  audio_url TEXT,
  qc_score NUMERIC,
  qc_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scene_id, shot_index)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bible_shots TO authenticated;
GRANT ALL ON public.bible_shots TO service_role;
ALTER TABLE public.bible_shots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage bible shots" ON public.bible_shots
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX bible_characters_bible_idx ON public.bible_characters (bible_id);
CREATE INDEX bible_locations_bible_idx ON public.bible_locations (bible_id);
CREATE INDEX bible_scenes_bible_idx ON public.bible_scenes (bible_id, scene_index);
CREATE INDEX bible_shots_scene_idx ON public.bible_shots (scene_id, shot_index);
CREATE INDEX bible_shots_bible_status_idx ON public.bible_shots (bible_id, status);

-- Shared updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_story_bibles_updated BEFORE UPDATE ON public.story_bibles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_bible_characters_updated BEFORE UPDATE ON public.bible_characters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_bible_locations_updated BEFORE UPDATE ON public.bible_locations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_bible_scenes_updated BEFORE UPDATE ON public.bible_scenes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_bible_shots_updated BEFORE UPDATE ON public.bible_shots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
