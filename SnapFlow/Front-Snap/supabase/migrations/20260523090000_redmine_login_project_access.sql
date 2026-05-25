-- Redmine-backed identity, project import, and assignment permissions.

alter table public.projects
  add column if not exists redmine_identifier text,
  add column if not exists audit_url_needs_review boolean not null default false;

create unique index if not exists idx_projects_redmine_identifier
  on public.projects (redmine_identifier)
  where redmine_identifier is not null;

alter table public.project_assignments
  add column if not exists source text not null default 'manual',
  add column if not exists redmine_role_ids integer[] not null default '{}',
  add column if not exists redmine_role_names text[] not null default '{}',
  add column if not exists redmine_group_ids integer[] not null default '{}',
  add column if not exists access_level text not null default 'full',
  add column if not exists redmine_synced_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'project_assignments_source_check'
      and conrelid = 'public.project_assignments'::regclass
  ) then
    alter table public.project_assignments
      add constraint project_assignments_source_check
      check (source in ('manual', 'redmine'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'project_assignments_access_level_check'
      and conrelid = 'public.project_assignments'::regclass
  ) then
    alter table public.project_assignments
      add constraint project_assignments_access_level_check
      check (access_level in ('read_only', 'full'));
  end if;
end $$;

create table if not exists public.redmine_user_identities (
  user_id uuid primary key references auth.users(id) on delete cascade,
  redmine_user_id bigint not null unique,
  redmine_login text not null unique,
  redmine_email text,
  redmine_display_name text,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.redmine_role_mappings (
  redmine_role_id integer primary key,
  redmine_role_name text not null,
  access_level text not null default 'read_only'
    check (access_level in ('read_only', 'full')),
  can_import boolean not null default true,
  can_launch_audit boolean not null default false,
  can_create_ticket boolean not null default false,
  can_view_reports boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.redmine_role_mappings (
  redmine_role_id,
  redmine_role_name,
  access_level,
  can_import,
  can_launch_audit,
  can_create_ticket,
  can_view_reports
) values
  (3,  'Manager',   'full',      true, true,  true,  true),
  (4,  'Developer', 'full',      true, true,  true,  true),
  (5,  'Reporter',  'full',      true, true,  true,  true),
  (6,  'Guest',     'read_only', true, false, false, true),
  (7,  'Testeur',   'full',      true, true,  true,  true),
  (9,  'Account',   'full',      true, true,  true,  true),
  (10, 'Account 3', 'full',      true, true,  true,  true),
  (11, 'Webmaster', 'full',      true, true,  true,  true),
  (12, 'SEO',       'full',      true, true,  true,  true)
on conflict (redmine_role_id) do update set
  redmine_role_name = excluded.redmine_role_name,
  access_level = excluded.access_level,
  can_import = excluded.can_import,
  can_launch_audit = excluded.can_launch_audit,
  can_create_ticket = excluded.can_create_ticket,
  can_view_reports = excluded.can_view_reports,
  updated_at = now();

create table if not exists public.redmine_login_attempts (
  id uuid primary key default gen_random_uuid(),
  login_hash text not null,
  ip_hash text not null,
  success boolean not null default false,
  failure_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_redmine_login_attempts_window
  on public.redmine_login_attempts (login_hash, ip_hash, created_at desc);

create table if not exists public.redmine_auth_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  redmine_user_id bigint,
  login_hash text not null,
  ip_hash text not null,
  event_type text not null,
  reason text,
  created_at timestamptz not null default now()
);

create or replace function public.set_redmine_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_redmine_user_identities_updated_at
  on public.redmine_user_identities;
create trigger trg_redmine_user_identities_updated_at
before update on public.redmine_user_identities
for each row execute function public.set_redmine_updated_at();

drop trigger if exists trg_redmine_role_mappings_updated_at
  on public.redmine_role_mappings;
create trigger trg_redmine_role_mappings_updated_at
before update on public.redmine_role_mappings
for each row execute function public.set_redmine_updated_at();

alter table public.redmine_user_identities enable row level security;
alter table public.redmine_role_mappings enable row level security;
alter table public.redmine_login_attempts enable row level security;
alter table public.redmine_auth_events enable row level security;

drop policy if exists "Users can view own Redmine identity" on public.redmine_user_identities;
create policy "Users can view own Redmine identity"
  on public.redmine_user_identities for select
  using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins can manage Redmine identities" on public.redmine_user_identities;
create policy "Admins can manage Redmine identities"
  on public.redmine_user_identities for all
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Authenticated users can view Redmine role mappings" on public.redmine_role_mappings;
create policy "Authenticated users can view Redmine role mappings"
  on public.redmine_role_mappings for select
  using (auth.role() = 'authenticated');

drop policy if exists "Admins can manage Redmine role mappings" on public.redmine_role_mappings;
create policy "Admins can manage Redmine role mappings"
  on public.redmine_role_mappings for all
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins can view Redmine auth events" on public.redmine_auth_events;
create policy "Admins can view Redmine auth events"
  on public.redmine_auth_events for select
  using (public.has_role(auth.uid(), 'admin'));

create or replace function public.can_view_project(_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(auth.uid(), 'admin')
    or exists (
      select 1
      from public.project_assignments pa
      where pa.project_id = _project_id
        and pa.user_id = auth.uid()
    )
$$;

create or replace function public.can_launch_project_audit(_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(auth.uid(), 'admin')
    or exists (
      select 1
      from public.project_assignments pa
      where pa.project_id = _project_id
        and pa.user_id = auth.uid()
        and pa.access_level = 'full'
    )
$$;

create or replace function public.can_create_project_ticket(_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_launch_project_audit(_project_id)
$$;

drop policy if exists "Chargés can create audits for assigned projects" on public.audits;
create policy "Users can create audits when assignment permits"
  on public.audits for insert
  with check (public.can_launch_project_audit(project_id));

drop policy if exists "Chargés can update assigned project audits" on public.audits;
create policy "Users can update audits when assignment permits"
  on public.audits for update
  using (public.can_launch_project_audit(project_id))
  with check (public.can_launch_project_audit(project_id));

drop policy if exists "Chargés can create schedules for assigned projects" on public.report_schedules;
create policy "Users can create schedules when assignment permits"
  on public.report_schedules for insert
  with check (public.can_launch_project_audit(project_id));

drop policy if exists "Chargés can update own schedules" on public.report_schedules;
create policy "Users can update schedules when assignment permits"
  on public.report_schedules for update
  using (public.can_launch_project_audit(project_id))
  with check (public.can_launch_project_audit(project_id));

drop policy if exists "Chargés can delete own schedules" on public.report_schedules;
create policy "Users can delete schedules when assignment permits"
  on public.report_schedules for delete
  using (public.can_launch_project_audit(project_id));
