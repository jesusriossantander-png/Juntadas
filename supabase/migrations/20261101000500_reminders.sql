-- =====================================================================
-- La Juntada — 0005 · Recordatorios inteligentes y cola de Web Push
-- ---------------------------------------------------------------------
-- generate_due_reminders(): crea notificaciones in-app (sin duplicados)
-- para los grupos que superaron su frecuencia sin juntarse.
-- claim_pending_pushes(): toma en forma atómica las notificaciones que
-- aún no se enviaron por push (la usa la Edge Function send-reminders).
-- Ambas son SOLO para service_role / cron: no las puede llamar un cliente.
-- =====================================================================

create or replace function public.generate_due_reminders(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; v_count int := 0; v_rows int; v_days int; v_cycle int;
begin
  for r in
    select g.id as group_id, g.name, s.reminder_days,
           coalesce((select max(x.starts_at) from public.gatherings x
                     where x.group_id = g.id and x.starts_at <= p_now
                       and x.status in ('done', 'confirmed')), g.created_at) as last_at,
           (select x.id from public.gatherings x
             where x.group_id = g.id and x.starts_at <= p_now and x.status in ('done', 'confirmed')
             order by x.starts_at desc limit 1) as last_id
    from public.groups g
    join public.group_settings s on s.group_id = g.id
    where s.reminders_enabled
      and not exists (                       -- si ya hay algo en marcha, no molestamos
        select 1 from public.gatherings u
        where u.group_id = g.id
          and (u.status = 'proposed' or (u.status = 'confirmed' and u.starts_at > p_now)))
  loop
    v_days := floor(extract(epoch from (p_now - r.last_at)) / 86400)::int;
    if v_days >= r.reminder_days then
      v_cycle := v_days / r.reminder_days;   -- un recordatorio por ciclo vencido
      insert into public.notifications (user_id, group_id, kind, title, body, link, dedupe_key)
      select m.user_id, r.group_id, 'reminder',
             '🍻 ¡Hace ' || v_days || ' días que no se juntan!',
             'Ya va siendo hora de organizar otro asado con ' || r.name || '.',
             '/juntadas/nueva?grupo=' || r.group_id,
             'reminder:' || r.group_id || ':' || coalesce(r.last_id::text, 'none') || ':' || v_cycle
      from public.group_members m where m.group_id = r.group_id
      on conflict (user_id, dedupe_key) do nothing;
      get diagnostics v_rows = row_count;
      if v_rows > 0 then
        update public.group_settings set last_reminder_at = p_now where group_id = r.group_id;
        v_count := v_count + v_rows;
      end if;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Devuelve y marca como enviadas (en una sola operación) las notificaciones pendientes de push.
create or replace function public.claim_pending_pushes(p_limit integer default 200)
returns table (notification_id uuid, user_id uuid, title text, body text, link text, kind text)
language sql security definer set search_path = '' as $$
  with picked as (
    select n.id from public.notifications n
    where n.push_sent_at is null
      and n.read_at is null
      and n.created_at > now() - interval '2 days'
      and exists (select 1 from public.push_subscriptions ps where ps.user_id = n.user_id)
    order by n.created_at
    limit p_limit
    for update skip locked
  )
  update public.notifications n set push_sent_at = now()
  from picked where n.id = picked.id
  returning n.id, n.user_id, n.title, n.body, n.link, n.kind;
$$;

revoke execute on function public.generate_due_reminders(timestamptz) from public, anon, authenticated;
revoke execute on function public.claim_pending_pushes(integer) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.generate_due_reminders(timestamptz) to service_role';
    execute 'grant execute on function public.claim_pending_pushes(integer) to service_role';
  end if;
end;
$$;

-- Programación diaria con pg_cron (10:00 hora argentina = 13:00 UTC), si está disponible.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron no disponible: %', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('la-juntada-reminders', '0 13 * * *', 'select public.generate_due_reminders()');
  end if;
end;
$$;
