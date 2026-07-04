-- pgvector for continuity embeddings
create extension if not exists vector;

-- Per-scene generated frame embeddings
create table public.scene_embeddings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null,
  scene_id text not null,
  character_token text not null,
  model_version text not null default 'openai/text-embedding-3-small',
  embedding vector(1536) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index scene_embeddings_lookup_idx
  on public.scene_embeddings (user_id, project_id, character_token);
create index scene_embeddings_vec_idx
  on public.scene_embeddings using hnsw (embedding vector_cosine_ops);

grant select, insert, update, delete on public.scene_embeddings to authenticated;
grant all on public.scene_embeddings to service_role;

alter table public.scene_embeddings enable row level security;

create policy "Owners manage scene embeddings"
  on public.scene_embeddings
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Canonical per-character reference embedding
create table public.character_embeddings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null,
  character_token text not null,
  model_version text not null default 'openai/text-embedding-3-small',
  embedding vector(1536) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, project_id, character_token)
);

create index character_embeddings_vec_idx
  on public.character_embeddings using hnsw (embedding vector_cosine_ops);

grant select, insert, update, delete on public.character_embeddings to authenticated;
grant all on public.character_embeddings to service_role;

alter table public.character_embeddings enable row level security;

create policy "Owners manage character embeddings"
  on public.character_embeddings
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.update_character_embeddings_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger character_embeddings_set_updated_at
  before update on public.character_embeddings
  for each row execute function public.update_character_embeddings_updated_at();

-- Closest stored character embedding lookup
create or replace function public.match_character_embedding(
  p_project_id text,
  p_character_token text,
  p_query_embedding vector(1536)
)
returns table (
  id uuid,
  similarity float,
  metadata jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    ce.id,
    1 - (ce.embedding <=> p_query_embedding) as similarity,
    ce.metadata
  from public.character_embeddings ce
  where ce.user_id = auth.uid()
    and ce.project_id = p_project_id
    and ce.character_token = p_character_token
  order by ce.embedding <=> p_query_embedding
  limit 1;
$$;