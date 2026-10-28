-- Status de decisão (proposed → applied) sem misturar com a evidência da conversa.

alter table decision_events
  add column if not exists person_id uuid references people (id) on delete set null;

alter table decision_events
  add column if not exists status text;

update decision_events set status = 'applied' where status is null;

alter table decision_events
  alter column status set default 'applied',
  alter column status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'decision_events_status_check'
  ) then
    alter table decision_events
      add constraint decision_events_status_check
      check (status in ('proposed', 'applied', 'skipped', 'rejected'));
  end if;
end $$;

alter table decision_events
  add column if not exists decided_at timestamptz;

create index if not exists decision_events_proposed_idx
  on decision_events (tenant_id, created_at desc)
  where status = 'proposed';
