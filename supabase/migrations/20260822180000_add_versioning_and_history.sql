alter table public.ledger_states
  add column if not exists version bigint not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ledger_states_version_positive'
      and conrelid = 'public.ledger_states'::regclass
  ) then
    alter table public.ledger_states
      add constraint ledger_states_version_positive check (version > 0);
  end if;
end
$$;

create table if not exists public.ledger_state_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  version bigint not null,
  state jsonb not null,
  created_at timestamptz not null default now(),
  constraint ledger_state_history_version_positive check (version > 0)
);

create index if not exists ledger_state_history_user_created_idx
  on public.ledger_state_history (user_id, created_at desc);

alter table public.ledger_state_history enable row level security;

revoke all on table public.ledger_state_history from anon;
revoke all on table public.ledger_state_history from authenticated;
grant select, insert on table public.ledger_state_history to authenticated;
grant usage, select on sequence public.ledger_state_history_id_seq to authenticated;

drop policy if exists "Users can read their ledger history" on public.ledger_state_history;
create policy "Users can read their ledger history"
on public.ledger_state_history for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their ledger history" on public.ledger_state_history;
create policy "Users can create their ledger history"
on public.ledger_state_history for insert to authenticated
with check ((select auth.uid()) = user_id);

create or replace function public.archive_ledger_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.ledger_state_history (user_id, version, state)
  values (old.user_id, old.version, old.state);
  return new;
end;
$$;

revoke all on function public.archive_ledger_state() from public;
grant execute on function public.archive_ledger_state() to authenticated;

drop trigger if exists archive_ledger_state_before_change on public.ledger_states;
create trigger archive_ledger_state_before_change
before update or delete on public.ledger_states
for each row execute function public.archive_ledger_state();

comment on table public.ledger_state_history is 'Versões anteriores do caderno para auditoria e recuperação pelo proprietário.';
comment on column public.ledger_states.version is 'Versão usada para impedir sobrescritas concorrentes.';
