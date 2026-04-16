-- Cache Redmine account mappings for fast, user-specific project filtering
create table if not exists public.redmine_project_account_cache (
  project_identifier text primary key,
  project_name text,
  account_identities text[] not null default '{}',
  account_display_names text[] not null default '{}',
  has_account_data boolean not null default false,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_redmine_project_account_cache_has_data
  on public.redmine_project_account_cache (has_account_data);

create index if not exists idx_redmine_project_account_cache_identities_gin
  on public.redmine_project_account_cache using gin (account_identities);

create or replace function public.set_redmine_project_account_cache_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_redmine_project_account_cache_updated_at
  on public.redmine_project_account_cache;

create trigger trg_redmine_project_account_cache_updated_at
before update on public.redmine_project_account_cache
for each row
execute function public.set_redmine_project_account_cache_updated_at();

alter table public.redmine_project_account_cache enable row level security;
