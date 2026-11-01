-- =====================================================================
-- La Juntada — 0003 · Funciones RPC con validación explícita de permisos
-- ---------------------------------------------------------------------
-- Todas son SECURITY DEFINER con search_path vacío y verifican auth.uid()
-- antes de tocar datos. Los errores usan mensajes en español.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Utilidades internas (no expuestas a clientes)
-- ---------------------------------------------------------------------
create or replace function public._require_user()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then
    raise exception 'Tenés que iniciar sesión' using errcode = '28000';
  end if;
  return v;
end;
$$;

create or replace function public._audit(p_group uuid, p_action text, p_entity text, p_id uuid, p_data jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_events (group_id, actor_id, action, entity, entity_id, data)
  values (p_group, auth.uid(), p_action, p_entity, p_id, coalesce(p_data, '{}'::jsonb));
$$;

create or replace function public._notify(p_user uuid, p_group uuid, p_gathering uuid, p_kind text,
  p_title text, p_body text, p_link text, p_dedupe text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, group_id, gathering_id, kind, title, body, link, dedupe_key)
  values (p_user, p_group, p_gathering, p_kind, p_title, p_body, p_link, p_dedupe)
  on conflict (user_id, dedupe_key) do nothing;
$$;

create or replace function public._notify_group(p_group uuid, p_except uuid, p_gathering uuid, p_kind text,
  p_title text, p_body text, p_link text, p_dedupe text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, group_id, gathering_id, kind, title, body, link, dedupe_key)
  select m.user_id, p_group, p_gathering, p_kind, p_title, p_body, p_link, p_dedupe
  from public.group_members m
  where m.group_id = p_group and m.user_id is distinct from p_except
  on conflict (user_id, dedupe_key) do nothing;
$$;

create or replace function public._random_code()
returns text language sql volatile set search_path = '' as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 32) + 1, 1), '')
  from (select extensions.gen_random_bytes(8) as b) r, generate_series(0, 7) as i;
$$;

-- ---------------------------------------------------------------------
-- Grupos
-- ---------------------------------------------------------------------
create or replace function public.create_group(p_name text, p_description text default null, p_image_url text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := public._require_user(); v_id uuid;
begin
  insert into public.groups (name, description, image_url, created_by)
  values (trim(p_name), nullif(trim(p_description), ''), nullif(trim(p_image_url), ''), v_user)
  returning id into v_id;
  insert into public.group_members (group_id, user_id, role) values (v_id, v_user, 'admin');
  insert into public.group_settings (group_id) values (v_id);
  perform public._audit(v_id, 'create', 'group', v_id, jsonb_build_object('name', p_name));
  return v_id;
end;
$$;

create or replace function public.create_invitation(p_group uuid, p_days integer default 14, p_max_uses integer default null)
returns table (code text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := public._require_user(); v_code text; i int := 0;
begin
  if not public.is_group_member(p_group) then
    raise exception 'No pertenecés a este grupo' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 60 then
    raise exception 'La invitación debe durar entre 1 y 60 días';
  end if;
  loop
    v_code := public._random_code();
    begin
      insert into public.invitations (group_id, code, created_by, expires_at, max_uses)
      values (p_group, v_code, v_user, now() + make_interval(days => p_days), p_max_uses);
      exit;
    exception when unique_violation then
      i := i + 1;
      if i > 5 then raise; end if;
    end;
  end loop;
  return query select i2.code, i2.expires_at from public.invitations i2 where i2.code = v_code;
end;
$$;

-- Vista previa mínima de una invitación (no expone datos del grupo más allá del nombre).
create or replace function public.invitation_preview(p_code text)
returns table (group_name text, member_count integer, is_valid boolean, already_member boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := public._require_user(); r public.invitations;
begin
  select * into r from public.invitations where code = upper(trim(p_code));
  if not found then
    return query select null::text, 0, false, false;
    return;
  end if;
  return query
    select g.name,
           (select count(*)::int from public.group_members m where m.group_id = g.id),
           (r.revoked_at is null and r.expires_at > now() and (r.max_uses is null or r.uses < r.max_uses)),
           exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = v_user)
    from public.groups g where g.id = r.group_id;
end;
$$;

create or replace function public.accept_invitation(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := public._require_user(); r public.invitations; v_name text;
begin
  select * into r from public.invitations where code = upper(trim(p_code)) for update;
  if not found then
    raise exception 'El código de invitación no existe' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.group_members where group_id = r.group_id and user_id = v_user) then
    return r.group_id;                                   -- ya es integrante: no consume cupo
  end if;
  if r.revoked_at is not null then raise exception 'Esta invitación fue anulada'; end if;
  if r.expires_at <= now() then raise exception 'Esta invitación venció'; end if;
  if r.max_uses is not null and r.uses >= r.max_uses then raise exception 'Esta invitación ya no tiene cupo'; end if;

  insert into public.group_members (group_id, user_id, role) values (r.group_id, v_user, 'member');
  update public.invitations set uses = uses + 1 where id = r.id;
  select coalesce(nullif(display_name, ''), 'Alguien') into v_name from public.profiles where id = v_user;
  perform public._audit(r.group_id, 'join', 'group_member', v_user, jsonb_build_object('invitation', r.id));
  perform public._notify_group(r.group_id, v_user, null, 'member_joined',
    v_name || ' se sumó al grupo', null, '/grupos/' || r.group_id, 'join:' || r.group_id || ':' || v_user);
  return r.group_id;
end;
$$;

create or replace function public.leave_group(p_group uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := public._require_user(); v_role public.member_role; v_next uuid;
begin
  select role into v_role from public.group_members where group_id = p_group and user_id = v_user;
  if not found then raise exception 'No pertenecés a este grupo'; end if;

  delete from public.group_members where group_id = p_group and user_id = v_user;
  perform public._audit(p_group, 'leave', 'group_member', v_user, '{}'::jsonb);

  if not exists (select 1 from public.group_members where group_id = p_group) then
    delete from public.groups where id = p_group;        -- último integrante: el grupo desaparece
    return;
  end if;
  if v_role = 'admin' and not exists (select 1 from public.group_members where group_id = p_group and role = 'admin') then
    select user_id into v_next from public.group_members where group_id = p_group order by joined_at limit 1;
    update public.group_members set role = 'admin' where group_id = p_group and user_id = v_next;
  end if;
end;
$$;

create or replace function public.remove_member(p_group uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := public._require_user();
begin
  if not public.is_group_admin(p_group) then raise exception 'Solo un administrador puede quitar integrantes' using errcode = '42501'; end if;
  if p_user = v_user then raise exception 'Para salir del grupo usá "Abandonar grupo"'; end if;
  delete from public.group_members where group_id = p_group and user_id = p_user;
  perform public._audit(p_group, 'remove', 'group_member', p_user, '{}'::jsonb);
end;
$$;

create or replace function public.set_member_role(p_group uuid, p_user uuid, p_role public.member_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_user();
  if not public.is_group_admin(p_group) then raise exception 'Solo un administrador puede cambiar roles' using errcode = '42501'; end if;
  update public.group_members set role = p_role where group_id = p_group and user_id = p_user;
  if not found then raise exception 'Esa persona no es integrante del grupo'; end if;
  if not exists (select 1 from public.group_members where group_id = p_group and role = 'admin') then
    raise exception 'El grupo necesita al menos un administrador';
  end if;
  perform public._audit(p_group, 'role', 'group_member', p_user, jsonb_build_object('role', p_role));
end;
$$;

-- ---------------------------------------------------------------------
-- Juntadas y asistentes
-- ---------------------------------------------------------------------
create or replace function public.create_gathering(
  p_group uuid, p_title text, p_starts_at timestamptz default null, p_location text default null,
  p_description text default null, p_notes text default null, p_status public.gathering_status default 'proposed',
  p_invite_all boolean default true, p_date_options timestamptz[] default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := public._require_user(); v_id uuid; v_opt timestamptz; v_name text;
begin
  if not public.is_group_member(p_group) then raise exception 'No pertenecés a este grupo' using errcode = '42501'; end if;
  if p_status not in ('proposed', 'confirmed') then raise exception 'Estado inicial inválido'; end if;
  if p_status = 'confirmed' and p_starts_at is null then raise exception 'Una juntada confirmada necesita fecha'; end if;

  insert into public.gatherings (group_id, title, starts_at, location, description, notes, status, created_by)
  values (p_group, trim(p_title), p_starts_at, nullif(trim(p_location), ''), nullif(trim(p_description), ''),
          nullif(trim(p_notes), ''), p_status, v_user)
  returning id into v_id;

  insert into public.gathering_participants (gathering_id, user_id, rsvp, added_by)
  values (v_id, v_user, 'yes', v_user);
  if p_invite_all then
    insert into public.gathering_participants (gathering_id, user_id, rsvp, added_by)
    select v_id, m.user_id, 'pending', v_user from public.group_members m
    where m.group_id = p_group and m.user_id <> v_user;
  end if;

  if p_date_options is not null then
    foreach v_opt in array p_date_options loop
      insert into public.date_proposals (gathering_id, starts_at, created_by) values (v_id, v_opt, v_user)
      on conflict do nothing;
    end loop;
  end if;

  select coalesce(nullif(display_name, ''), 'Alguien') into v_name from public.profiles where id = v_user;
  perform public._audit(p_group, 'create', 'gathering', v_id, jsonb_build_object('title', p_title, 'status', p_status));
  perform public._notify_group(p_group, v_user, v_id,
    case when p_status = 'proposed' then 'gathering_proposed' else 'gathering_confirmed' end,
    case when p_status = 'proposed' then '🍻 ' || v_name || ' propuso: ' || trim(p_title)
         else '🔥 Nueva juntada confirmada: ' || trim(p_title) end,
    case when p_status = 'proposed' then 'Entrá a votar fecha, menú y lugar.' else 'Confirmá tu asistencia.' end,
    '/juntadas/' || v_id, 'gathering:' || v_id || ':created');
  return v_id;
end;
$$;

create or replace function public.add_participant(p_gathering uuid, p_user uuid default null, p_guest_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := public._require_user(); v_group uuid := public.gathering_group(p_gathering); v_id uuid;
begin
  if v_group is null then raise exception 'La juntada no existe'; end if;
  if (p_user is null) = (nullif(trim(p_guest_name), '') is null) then
    raise exception 'Indicá un integrante o el nombre de un invitado';
  end if;
  if p_user is not null then
    if not public.is_group_member(v_group) then raise exception 'No pertenecés a este grupo' using errcode = '42501'; end if;
    if p_user <> v_user and not public.can_manage_gathering(p_gathering) then
      raise exception 'Solo el organizador o un admin puede sumar a otras personas' using errcode = '42501';
    end if;
    if not exists (select 1 from public.group_members where group_id = v_group and user_id = p_user) then
      raise exception 'Esa persona no es integrante del grupo';
    end if;
    insert into public.gathering_participants (gathering_id, user_id, added_by)
    values (p_gathering, p_user, v_user)
    on conflict (gathering_id, user_id) do update set user_id = excluded.user_id
    returning id into v_id;
  else
    if not public.can_manage_gathering(p_gathering) then
      raise exception 'Solo el organizador o un admin puede sumar invitados' using errcode = '42501';
    end if;
    insert into public.gathering_participants (gathering_id, guest_name, rsvp, added_by)
    values (p_gathering, trim(p_guest_name), 'yes', v_user) returning id into v_id;
  end if;
  perform public._audit(v_group, 'add', 'participant', v_id, jsonb_build_object('user', p_user, 'guest', p_guest_name));
  return v_id;
end;
$$;

create or replace function public.remove_participant(p_participant uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := public._require_user(); r public.gathering_participants;
begin
  select * into r from public.gathering_participants where id = p_participant;
  if not found then raise exception 'El asistente no existe'; end if;
  if not (public.can_manage_gathering(r.gathering_id) or r.user_id = v_user) then
    raise exception 'No tenés permiso para quitar a este asistente' using errcode = '42501';
  end if;
  if exists (select 1 from public.expense_payers ep join public.expenses e on e.id = ep.expense_id
             where ep.participant_id = p_participant and e.deleted_at is null)
     or exists (select 1 from public.expense_splits es join public.expenses e on e.id = es.expense_id
             where es.participant_id = p_participant and e.deleted_at is null and es.amount_cents > 0)
     or exists (select 1 from public.settlements s where (s.from_participant = p_participant or s.to_participant = p_participant)
             and s.status <> 'rejected') then
    raise exception 'No se puede quitar: tiene gastos o pagos registrados. Marcá que no asiste.';
  end if;
  -- Quitar referencias de gastos borrados o con 0 para poder eliminar.
  delete from public.expense_splits where participant_id = p_participant;
  delete from public.expense_payers where participant_id = p_participant;
  delete from public.settlements where (from_participant = p_participant or to_participant = p_participant) and status = 'rejected';
  delete from public.gathering_participants where id = p_participant;
  perform public._audit(public.gathering_group(r.gathering_id), 'remove', 'participant', p_participant, '{}'::jsonb);
end;
$$;

create or replace function public.set_rsvp(p_gathering uuid, p_rsvp public.rsvp_status)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := public._require_user(); v_group uuid := public.gathering_group(p_gathering);
begin
  if not public.can_access_gathering(p_gathering) then raise exception 'No tenés acceso a esta juntada' using errcode = '42501'; end if;
  update public.gathering_participants set rsvp = p_rsvp where gathering_id = p_gathering and user_id = v_user;
  if not found then
    if not public.is_group_member(v_group) then raise exception 'No tenés acceso a esta juntada' using errcode = '42501'; end if;
    insert into public.gathering_participants (gathering_id, user_id, rsvp, added_by)
    values (p_gathering, v_user, p_rsvp, v_user);
  end if;
end;
$$;

create or replace function public.confirm_date(p_proposal uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.date_proposals; g public.gatherings;
begin
  perform public._require_user();
  select * into r from public.date_proposals where id = p_proposal;
  if not found then raise exception 'La opción de fecha no existe'; end if;
  if not public.can_manage_gathering(r.gathering_id) then
    raise exception 'Solo el organizador o un admin puede confirmar la fecha' using errcode = '42501';
  end if;
  update public.gatherings set starts_at = r.starts_at, status = 'confirmed'
  where id = r.gathering_id and status in ('proposed', 'confirmed')
  returning * into g;
  if not found then raise exception 'La juntada ya no admite cambios de fecha'; end if;
  perform public._audit(g.group_id, 'confirm_date', 'gathering', g.id, jsonb_build_object('starts_at', r.starts_at));
  perform public._notify_group(g.group_id, auth.uid(), g.id, 'gathering_confirmed',
    '🔥 Se confirmó: ' || g.title,
    'Fecha: ' || to_char(r.starts_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI') || ' hs. ¡Confirmá asistencia!',
    '/juntadas/' || g.id, 'gathering:' || g.id || ':confirmed:' || r.id);
end;
$$;

-- ---------------------------------------------------------------------
-- Saldos de una juntada (fuente de verdad para validar pagos)
-- net = pagado - consumido + enviado - recibido   (>0 le deben, <0 debe)
-- ---------------------------------------------------------------------
create or replace function public.gathering_balances(p_gathering uuid, p_include_reported boolean default false)
returns table (participant_id uuid, paid bigint, owed bigint, sent bigint, received bigint, net bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_access_gathering(p_gathering) then
    raise exception 'No tenés acceso a esta juntada' using errcode = '42501';
  end if;
  return query
  with p as (select gp.id from public.gathering_participants gp where gp.gathering_id = p_gathering),
  pay as (select ep.participant_id pid, sum(ep.amount_cents) v from public.expense_payers ep
          join public.expenses e on e.id = ep.expense_id
          where e.gathering_id = p_gathering and e.deleted_at is null group by 1),
  own as (select es.participant_id pid, sum(es.amount_cents) v from public.expense_splits es
          join public.expenses e on e.id = es.expense_id
          where e.gathering_id = p_gathering and e.deleted_at is null group by 1),
  snt as (select s.from_participant pid, sum(s.amount_cents) v from public.settlements s
          where s.gathering_id = p_gathering
            and (s.status = 'confirmed' or (p_include_reported and s.status = 'reported')) group by 1),
  rcv as (select s.to_participant pid, sum(s.amount_cents) v from public.settlements s
          where s.gathering_id = p_gathering
            and (s.status = 'confirmed' or (p_include_reported and s.status = 'reported')) group by 1)
  select p.id,
         coalesce(pay.v, 0)::bigint, coalesce(own.v, 0)::bigint,
         coalesce(snt.v, 0)::bigint, coalesce(rcv.v, 0)::bigint,
         (coalesce(pay.v, 0) - coalesce(own.v, 0) + coalesce(snt.v, 0) - coalesce(rcv.v, 0))::bigint
  from p
  left join pay on pay.pid = p.id left join own on own.pid = p.id
  left join snt on snt.pid = p.id left join rcv on rcv.pid = p.id;
end;
$$;

-- ---------------------------------------------------------------------
-- Gastos
-- p = { id?, gathering_id, description, category, amount_cents, currency?, split_method,
--       spent_on?, receipt_path?, notes?, payers:[{participant_id, amount_cents}],
--       splits:[{participant_id, share, amount_cents}] }
-- El servidor valida que pagadores y repartos sumen EXACTAMENTE el total.
-- ---------------------------------------------------------------------
create or replace function public.save_expense(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public._require_user();
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_gathering uuid := (p ->> 'gathering_id')::uuid;
  v_group uuid;
  v_status public.gathering_status;
  v_amount bigint := (p ->> 'amount_cents')::bigint;
  v_method public.split_method := coalesce(p ->> 'split_method', 'equal')::public.split_method;
  v_old public.expenses;
  v_sum bigint; v_cnt int; v_bad int; v_shares numeric;
begin
  select g.group_id, g.status into v_group, v_status from public.gatherings g where g.id = v_gathering;
  if v_group is null then raise exception 'La juntada no existe'; end if;
  if not public.can_access_gathering(v_gathering) then raise exception 'No tenés acceso a esta juntada' using errcode = '42501'; end if;
  if v_status = 'cancelled' then raise exception 'La juntada está cancelada'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'El importe debe ser mayor a cero'; end if;

  -- Pagadores
  select count(*), coalesce(sum((x ->> 'amount_cents')::bigint), 0),
         count(*) filter (where (x ->> 'amount_cents')::bigint <= 0
           or not exists (select 1 from public.gathering_participants gp where gp.id = (x ->> 'participant_id')::uuid and gp.gathering_id = v_gathering))
    into v_cnt, v_sum, v_bad
  from jsonb_array_elements(coalesce(p -> 'payers', '[]'::jsonb)) x;
  if v_cnt = 0 then raise exception 'Indicá quién pagó'; end if;
  if v_bad > 0 then raise exception 'Hay pagadores inválidos'; end if;
  if v_sum <> v_amount then raise exception 'Lo pagado (%) no coincide con el total (%)', v_sum, v_amount; end if;
  if (select count(distinct x ->> 'participant_id') from jsonb_array_elements(p -> 'payers') x) <> v_cnt then
    raise exception 'Hay pagadores repetidos';
  end if;

  -- Repartos
  select count(*), coalesce(sum((x ->> 'amount_cents')::bigint), 0), coalesce(sum((x ->> 'share')::numeric), 0),
         count(*) filter (where (x ->> 'amount_cents')::bigint < 0 or coalesce((x ->> 'share')::numeric, 0) < 0
           or not exists (select 1 from public.gathering_participants gp where gp.id = (x ->> 'participant_id')::uuid and gp.gathering_id = v_gathering))
    into v_cnt, v_sum, v_shares, v_bad
  from jsonb_array_elements(coalesce(p -> 'splits', '[]'::jsonb)) x;
  if v_cnt = 0 then raise exception 'Elegí entre quiénes se divide'; end if;
  if v_bad > 0 then raise exception 'Hay repartos inválidos'; end if;
  if v_sum <> v_amount then raise exception 'El reparto (%) no coincide con el total (%)', v_sum, v_amount; end if;
  if (select count(distinct x ->> 'participant_id') from jsonb_array_elements(p -> 'splits') x) <> v_cnt then
    raise exception 'Hay participantes repetidos en el reparto';
  end if;
  if v_method = 'percent' and abs(v_shares - 100) > 0.01 then raise exception 'Los porcentajes deben sumar 100%%'; end if;
  if v_method = 'weight' and v_shares <= 0 then raise exception 'Las proporciones deben ser mayores a cero'; end if;

  if v_id is null then
    insert into public.expenses (gathering_id, description, category, amount_cents, currency, split_method,
                                 spent_on, receipt_path, notes, created_by)
    values (v_gathering, trim(p ->> 'description'), coalesce(p ->> 'category', 'otros'), v_amount,
            coalesce(p ->> 'currency', 'ARS'), v_method, coalesce((p ->> 'spent_on')::date, current_date),
            nullif(p ->> 'receipt_path', ''), nullif(trim(p ->> 'notes'), ''), v_user)
    returning id into v_id;
    perform public._audit(v_group, 'create', 'expense', v_id, p);
  else
    select * into v_old from public.expenses where id = v_id for update;
    if not found or v_old.gathering_id <> v_gathering or v_old.deleted_at is not null then
      raise exception 'El gasto no existe';
    end if;
    if not (v_old.created_by = v_user or public.can_manage_gathering(v_gathering)) then
      raise exception 'Solo quien cargó el gasto o un admin puede editarlo' using errcode = '42501';
    end if;
    update public.expenses set description = trim(p ->> 'description'), category = coalesce(p ->> 'category', 'otros'),
      amount_cents = v_amount, currency = coalesce(p ->> 'currency', 'ARS'), split_method = v_method,
      spent_on = coalesce((p ->> 'spent_on')::date, spent_on), receipt_path = nullif(p ->> 'receipt_path', ''),
      notes = nullif(trim(p ->> 'notes'), '')
    where id = v_id;
    delete from public.expense_payers where expense_id = v_id;
    delete from public.expense_splits where expense_id = v_id;
    perform public._audit(v_group, 'update', 'expense', v_id, jsonb_build_object('before', to_jsonb(v_old), 'after', p));
  end if;

  insert into public.expense_payers (expense_id, participant_id, amount_cents)
  select v_id, (x ->> 'participant_id')::uuid, (x ->> 'amount_cents')::bigint
  from jsonb_array_elements(p -> 'payers') x;
  insert into public.expense_splits (expense_id, participant_id, share, amount_cents)
  select v_id, (x ->> 'participant_id')::uuid, coalesce((x ->> 'share')::numeric, 1), (x ->> 'amount_cents')::bigint
  from jsonb_array_elements(p -> 'splits') x;
  return v_id;
end;
$$;

create or replace function public.delete_expense(p_expense uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := public._require_user(); e public.expenses;
begin
  select * into e from public.expenses where id = p_expense and deleted_at is null for update;
  if not found then raise exception 'El gasto no existe'; end if;
  if not (e.created_by = v_user or public.can_manage_gathering(e.gathering_id)) then
    raise exception 'Solo quien cargó el gasto o un admin puede eliminarlo' using errcode = '42501';
  end if;
  update public.expenses set deleted_at = now() where id = p_expense;
  perform public._audit(public.gathering_group(e.gathering_id), 'delete', 'expense', p_expense, to_jsonb(e));
end;
$$;

-- ---------------------------------------------------------------------
-- Pagos (transferencias para saldar)
-- Reglas:
--   * Lo puede registrar el que paga, el que cobra o un admin/organizador.
--   * Si lo registra quien COBRA (o un admin para un invitado que cobra),
--     queda confirmado. Si lo registra quien PAGA, queda "informado" hasta
--     que quien cobra (o un admin distinto del que paga) lo confirme.
--   * No se puede pagar más de lo que se debe ni cobrar más de lo que corresponde
--     (contando pagos informados pendientes): evita duplicados.
--   * client_ref hace la operación idempotente.
-- ---------------------------------------------------------------------
create or replace function public.report_settlement(
  p_gathering uuid, p_from uuid, p_to uuid, p_amount_cents bigint,
  p_method text default 'transferencia', p_paid_on date default null, p_notes text default null,
  p_receipt_path text default null, p_client_ref uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := public._require_user();
  v_group uuid := public.gathering_group(p_gathering);
  f public.gathering_participants; t public.gathering_participants;
  v_from_net bigint; v_to_net bigint; v_status public.settlement_status; v_id uuid; v_admin boolean;
begin
  if v_group is null then raise exception 'La juntada no existe'; end if;
  if not public.can_access_gathering(p_gathering) then raise exception 'No tenés acceso a esta juntada' using errcode = '42501'; end if;
  if p_client_ref is not null then
    select id into v_id from public.settlements where client_ref = p_client_ref;
    if found then return v_id; end if;                  -- reintento del mismo pago
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'El importe debe ser mayor a cero'; end if;

  select * into f from public.gathering_participants where id = p_from and gathering_id = p_gathering;
  if not found then raise exception 'Quien paga no participa de la juntada'; end if;
  select * into t from public.gathering_participants where id = p_to and gathering_id = p_gathering;
  if not found then raise exception 'Quien cobra no participa de la juntada'; end if;
  if f.id = t.id then raise exception 'No podés pagarte a vos mismo'; end if;

  v_admin := public.can_manage_gathering(p_gathering);
  if not (f.user_id = v_user or t.user_id = v_user or v_admin) then
    raise exception 'Solo quien paga, quien cobra o un admin puede registrar este pago' using errcode = '42501';
  end if;

  -- Serializa pagos de la misma juntada para evitar condiciones de carrera.
  perform pg_advisory_xact_lock(hashtext('settle:' || p_gathering::text));

  select b.net into v_from_net from public.gathering_balances(p_gathering, true) b where b.participant_id = f.id;
  select b.net into v_to_net   from public.gathering_balances(p_gathering, true) b where b.participant_id = t.id;
  if -v_from_net < p_amount_cents then
    raise exception 'El pago supera lo que debe (pendiente: % centavos)', greatest(-v_from_net, 0);
  end if;
  if v_to_net < p_amount_cents then
    raise exception 'El pago supera lo que le deben a quien cobra (pendiente: % centavos)', greatest(v_to_net, 0);
  end if;

  v_status := case
    when t.user_id = v_user then 'confirmed'
    when t.user_id is null and v_admin and f.user_id is distinct from v_user then 'confirmed'
    when t.user_id is null and v_admin and public.is_group_admin(v_group) then 'confirmed'
    else 'reported' end;

  insert into public.settlements (gathering_id, from_participant, to_participant, amount_cents, method, paid_on,
                                  notes, receipt_path, status, client_ref, created_by, confirmed_by, confirmed_at)
  values (p_gathering, f.id, t.id, p_amount_cents, coalesce(p_method, 'transferencia'), coalesce(p_paid_on, current_date),
          nullif(trim(p_notes), ''), nullif(p_receipt_path, ''), v_status, p_client_ref, v_user,
          case when v_status = 'confirmed' then v_user end, case when v_status = 'confirmed' then now() end)
  returning id into v_id;

  perform public._audit(v_group, 'report', 'settlement', v_id,
    jsonb_build_object('from', f.id, 'to', t.id, 'amount_cents', p_amount_cents, 'status', v_status));
  if v_status = 'reported' and t.user_id is not null then
    perform public._notify(t.user_id, v_group, p_gathering, 'settlement_reported', '💸 Te informaron un pago',
      'Revisá y confirmá si lo recibiste.', '/juntadas/' || p_gathering || '/cuentas', 'settlement:' || v_id || ':reported');
  elsif v_status = 'confirmed' and f.user_id is not null and f.user_id <> v_user then
    perform public._notify(f.user_id, v_group, p_gathering, 'settlement_confirmed', '✅ Pago confirmado',
      'Se registró tu pago como recibido.', '/juntadas/' || p_gathering || '/cuentas', 'settlement:' || v_id || ':confirmed');
  end if;
  return v_id;
end;
$$;

create or replace function public.review_settlement(p_settlement uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := public._require_user(); s public.settlements; f public.gathering_participants;
        t public.gathering_participants; v_group uuid;
begin
  select * into s from public.settlements where id = p_settlement for update;
  if not found then raise exception 'El pago no existe'; end if;
  if s.status <> 'reported' then raise exception 'Este pago ya fue revisado'; end if;
  select * into f from public.gathering_participants where id = s.from_participant;
  select * into t from public.gathering_participants where id = s.to_participant;
  v_group := public.gathering_group(s.gathering_id);
  -- Confirma quien cobra; un admin solo si no es quien pagó.
  if not (t.user_id = v_user or (public.is_group_admin(v_group) and f.user_id is distinct from v_user)) then
    raise exception 'Solo quien recibe el pago o un admin puede confirmarlo' using errcode = '42501';
  end if;
  update public.settlements
     set status = case when p_accept then 'confirmed'::public.settlement_status else 'rejected'::public.settlement_status end,
         confirmed_by = v_user, confirmed_at = now()
   where id = p_settlement;
  perform public._audit(v_group, case when p_accept then 'confirm' else 'reject' end, 'settlement', s.id, '{}'::jsonb);
  if f.user_id is not null then
    perform public._notify(f.user_id, v_group, s.gathering_id,
      case when p_accept then 'settlement_confirmed' else 'settlement_rejected' end,
      case when p_accept then '✅ Confirmaron tu pago' else '⚠️ Rechazaron un pago informado' end,
      null, '/juntadas/' || s.gathering_id || '/cuentas', 'settlement:' || s.id || ':reviewed');
  end if;
end;
$$;

-- Permisos de ejecución: solo usuarios autenticados y solo las RPC públicas.
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.create_group(text, text, text),
  public.create_invitation(uuid, integer, integer),
  public.invitation_preview(text),
  public.accept_invitation(text),
  public.leave_group(uuid),
  public.remove_member(uuid, uuid),
  public.set_member_role(uuid, uuid, public.member_role),
  public.create_gathering(uuid, text, timestamptz, text, text, text, public.gathering_status, boolean, timestamptz[]),
  public.add_participant(uuid, uuid, text),
  public.remove_participant(uuid),
  public.set_rsvp(uuid, public.rsvp_status),
  public.confirm_date(uuid),
  public.gathering_balances(uuid, boolean),
  public.save_expense(jsonb),
  public.delete_expense(uuid),
  public.report_settlement(uuid, uuid, uuid, bigint, text, date, text, text, uuid),
  public.review_settlement(uuid, boolean),
  public.is_group_member(uuid), public.is_group_admin(uuid), public.gathering_group(uuid),
  public.can_access_gathering(uuid), public.can_manage_gathering(uuid), public.shares_context_with(uuid)
to authenticated;
