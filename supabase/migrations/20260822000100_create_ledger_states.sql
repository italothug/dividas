create table if not exists public.ledger_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.ledger_states enable row level security;

grant select, insert, update, delete on table public.ledger_states to authenticated;
revoke all on table public.ledger_states from anon;

create policy "Users can read their own ledger"
on public.ledger_states for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own ledger"
on public.ledger_states for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own ledger"
on public.ledger_states for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own ledger"
on public.ledger_states for delete to authenticated
using ((select auth.uid()) = user_id);

comment on table public.ledger_states is 'Estado mensal do Caderno de Contas, isolado por usuário via RLS.';
