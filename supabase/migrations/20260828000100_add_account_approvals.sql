create schema if not exists private;

create table if not exists public.account_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  approved boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

create index if not exists account_access_pending_idx
  on public.account_access (created_at)
  where approved = false;

insert into public.account_access (user_id, email, approved, is_admin, approved_at, created_at)
select id, email, true,
  id = (select id from auth.users order by created_at asc limit 1),
  now(), created_at
from auth.users
on conflict (user_id) do nothing;

create or replace function private.handle_new_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.account_access (user_id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_account() from public, anon, authenticated;

drop trigger if exists create_account_access_after_signup on auth.users;
create trigger create_account_access_after_signup
after insert on auth.users
for each row execute function private.handle_new_account();

create or replace function private.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.account_access
    where user_id = (select auth.uid()) and is_admin = true and approved = true
  );
$$;

create or replace function private.current_user_is_approved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.account_access
    where user_id = (select auth.uid()) and approved = true
  );
$$;

revoke all on function private.current_user_is_admin() from public, anon;
revoke all on function private.current_user_is_approved() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.current_user_is_admin() to authenticated;
grant execute on function private.current_user_is_approved() to authenticated;

alter table public.account_access enable row level security;
revoke all on table public.account_access from anon;
revoke all on table public.account_access from authenticated;
grant select, update on table public.account_access to authenticated;

create policy "Users read their access status"
on public.account_access for select to authenticated
using ((select auth.uid()) = user_id or (select private.current_user_is_admin()));

create policy "Admins approve accounts"
on public.account_access for update to authenticated
using ((select private.current_user_is_admin()))
with check ((select private.current_user_is_admin()));

create policy "Approved users access their ledger"
on public.ledger_states as restrictive for all to authenticated
using ((select private.current_user_is_approved()))
with check ((select private.current_user_is_approved()));

create policy "Approved users access their ledger history"
on public.ledger_state_history as restrictive for all to authenticated
using ((select private.current_user_is_approved()))
with check ((select private.current_user_is_approved()));

comment on table public.account_access is 'Aprovação administrativa e papel de administrador das contas.';
