
CREATE TABLE public.agent_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  premise TEXT NOT NULL,
  logline TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  characters JSONB NOT NULL DEFAULT '[]'::jsonb,
  shots_plan JSONB NOT NULL DEFAULT '[]'::jsonb,
  final_video_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_projects TO authenticated;
GRANT ALL ON public.agent_projects TO service_role;
ALTER TABLE public.agent_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own agent projects" ON public.agent_projects FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.agent_shots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.agent_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  idx INT NOT NULL,
  prompt TEXT NOT NULL,
  dialogue TEXT,
  speaker TEXT,
  frame_url TEXT,
  video_url TEXT,
  audio_url TEXT,
  final_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, idx)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_shots TO authenticated;
GRANT ALL ON public.agent_shots TO service_role;
ALTER TABLE public.agent_shots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own agent shots" ON public.agent_shots FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.agent_voices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.agent_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  character_name TEXT NOT NULL,
  voice_id TEXT NOT NULL,
  sheet_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, character_name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_voices TO authenticated;
GRANT ALL ON public.agent_voices TO service_role;
ALTER TABLE public.agent_voices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own agent voices" ON public.agent_voices FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER agent_projects_updated_at BEFORE UPDATE ON public.agent_projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER agent_shots_updated_at BEFORE UPDATE ON public.agent_shots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
