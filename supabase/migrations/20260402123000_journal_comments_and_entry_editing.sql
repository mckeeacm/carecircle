create table if not exists public.journal_comments (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  content_encrypted jsonb not null
);

create index if not exists journal_comments_journal_entry_id_idx
  on public.journal_comments (journal_entry_id, created_at desc);

alter table public.journal_comments enable row level security;

alter table public.journal_entries
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'journal_entries'
      and policyname = 'journal entries update by author'
  ) then
    create policy "journal entries update by author"
    on public.journal_entries
    for update
    to authenticated
    using (
      created_by = auth.uid()
      and exists (
        select 1
        from public.patient_members pm
        where pm.patient_id = journal_entries.patient_id
          and pm.user_id = auth.uid()
      )
    )
    with check (
      created_by = auth.uid()
      and exists (
        select 1
        from public.patient_members pm
        where pm.patient_id = journal_entries.patient_id
          and pm.user_id = auth.uid()
      )
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'journal_comments'
      and policyname = 'journal comments select for members'
  ) then
    create policy "journal comments select for members"
    on public.journal_comments
    for select
    to authenticated
    using (
      exists (
        select 1
        from public.patient_members pm
        where pm.patient_id = journal_comments.patient_id
          and pm.user_id = auth.uid()
      )
    );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'journal_comments'
      and policyname = 'journal comments insert by members'
  ) then
    create policy "journal comments insert by members"
    on public.journal_comments
    for insert
    to authenticated
    with check (
      created_by = auth.uid()
      and exists (
        select 1
        from public.patient_members pm
        where pm.patient_id = journal_comments.patient_id
          and pm.user_id = auth.uid()
      )
    );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'journal_comments'
      and policyname = 'journal comments update by author'
  ) then
    create policy "journal comments update by author"
    on public.journal_comments
    for update
    to authenticated
    using (
      created_by = auth.uid()
      and exists (
        select 1
        from public.patient_members pm
        where pm.patient_id = journal_comments.patient_id
          and pm.user_id = auth.uid()
      )
    )
    with check (
      created_by = auth.uid()
      and exists (
        select 1
        from public.patient_members pm
        where pm.patient_id = journal_comments.patient_id
          and pm.user_id = auth.uid()
      )
    );
  end if;
end $$;
