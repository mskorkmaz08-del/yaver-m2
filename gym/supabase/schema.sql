-- CaliCoach: Supabase set-up. Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Every row and file belongs to the signed-in user; nobody else can read it (row-level security).

-- One row per workout (summary, sets, reps, faults; no 3D data)
create table if not exists public.sessions (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  started_at  timestamptz,
  ended_at    timestamptz,
  source      text,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);

-- One row per set: the 3D skeleton capture lives in Storage (file_path), this row describes it
create table if not exists public.captures (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id  text references public.sessions (id) on delete set null,
  set_index   int,
  exercise    text not null,
  recorded_at timestamptz,
  frames      int,
  fps         real,
  reps        int,
  clean_reps  int,
  score       int,
  file_path   text not null,
  bytes       int,
  meta        jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists captures_user_exercise on public.captures (user_id, exercise, recorded_at desc);

alter table public.sessions enable row level security;
alter table public.captures enable row level security;

drop policy if exists "own sessions" on public.sessions;
create policy "own sessions" on public.sessions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own captures" on public.captures;
create policy "own captures" on public.captures for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Private bucket for capture files: captures/<user id>/<capture id>.json.gz
insert into storage.buckets (id, name, public) values ('captures', 'captures', false)
on conflict (id) do nothing;

drop policy if exists "capture files: read own" on storage.objects;
create policy "capture files: read own" on storage.objects for select to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "capture files: add own" on storage.objects;
create policy "capture files: add own" on storage.objects for insert to authenticated
  with check (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "capture files: replace own" on storage.objects;
create policy "capture files: replace own" on storage.objects for update to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "capture files: delete own" on storage.objects;
create policy "capture files: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = auth.uid()::text);
