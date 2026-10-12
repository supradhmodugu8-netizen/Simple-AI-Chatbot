create table if not exists public.chat_sessions (
  id uuid primary key,
  messages jsonb not null default '[]'::jsonb
    check (jsonb_typeof(messages) = 'array'),
  updated_at timestamptz not null default now()
);

alter table public.chat_sessions enable row level security;

revoke all on table public.chat_sessions from anon, authenticated;
grant select, insert, update, delete on table public.chat_sessions to service_role;
