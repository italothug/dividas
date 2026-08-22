do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ledger_states'
  ) then
    alter publication supabase_realtime add table public.ledger_states;
  end if;
end
$$;
