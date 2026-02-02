create table if not exists public.help_kb (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('customer', 'manager')),
  title text not null,
  content text not null,
  url text,
  tags text[] not null default '{}',
  source_path text,
  hash text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists help_kb_mode_idx on public.help_kb (mode);
create index if not exists help_kb_search_idx on public.help_kb using gin (to_tsvector('english', title || ' ' || content));

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_help_kb_updated_at
before update on public.help_kb
for each row
execute function public.set_updated_at();

alter table public.help_kb enable row level security;
