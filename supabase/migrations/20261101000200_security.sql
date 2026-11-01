-- =====================================================================
-- La Juntada — 0002 · Seguridad: funciones auxiliares, RLS y permisos
-- ---------------------------------------------------------------------
-- Principio: el cliente (rol "authenticated") SOLO puede leer lo de sus
-- grupos/juntadas. Las escrituras críticas pasan por RPCs (0003).
-- El rol "anon" no tiene acceso a ninguna tabla.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Funciones auxiliares (security definer para evitar recursión de RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_group_member(p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = p_group and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_group_admin(p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = p_group and m.user_id = auth.uid() and m.role = 'admin'
  );
$$;

create or replace function public.gathering_group(p_gathering uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select g.group_id from public.gatherings g where g.id = p_gathering;
$$;

-- Acceso a una juntada: integrante del grupo o invitado con cuenta.
create or replace function public.can_access_gathering(p_gathering uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.gatherings g
    join public.group_members m on m.group_id = g.group_id
    where g.id = p_gathering and m.user_id = auth.uid()
  ) or exists (
    select 1 from public.gathering_participants p
    where p.gathering_id = p_gathering and p.user_id = auth.uid()
  );
$$;

-- Puede administrar la juntada: admin del grupo o quien la creó.
create or replace function public.can_manage_gathering(p_gathering uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.gatherings g
    where g.id = p_gathering
      and (g.created_by = auth.uid() or public.is_group_admin(g.group_id))
  );
$$;

-- ¿Comparte algún grupo o juntada con otra persona? (para ver su perfil)
create or replace function public.shares_context_with(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user = auth.uid()
    or exists (
      select 1 from public.group_members a
      join public.group_members b on a.group_id = b.group_id
      where a.user_id = auth.uid() and b.user_id = p_user
    )
    or exists (
      select 1 from public.gathering_participants p
      where p.user_id = p_user and public.can_access_gathering(p.gathering_id)
    );
$$;

-- ---------------------------------------------------------------------
-- Perfil automático al registrarse
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
                  split_part(coalesce(new.email, 'amigo'), '@', 1)), 60)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at genérico
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch   before update on public.profiles   for each row execute function public.touch_updated_at();
create trigger gatherings_touch before update on public.gatherings for each row execute function public.touch_updated_at();
create trigger expenses_touch   before update on public.expenses   for each row execute function public.touch_updated_at();
create trigger settings_touch   before update on public.group_settings for each row execute function public.touch_updated_at();

-- Protección: no se puede mover una juntada de grupo ni cambiar su autor.
create or replace function public.guard_gathering_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.group_id <> old.group_id or new.created_by is distinct from old.created_by then
    raise exception 'No se puede cambiar el grupo ni el autor de una juntada' using errcode = '42501';
  end if;
  if new.status = 'confirmed' and old.status <> 'confirmed' then
    new.confirmed_at := now();
  end if;
  return new;
end;
$$;
create trigger gatherings_guard before update on public.gatherings
  for each row execute function public.guard_gathering_update();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles               enable row level security;
alter table public.groups                 enable row level security;
alter table public.group_members          enable row level security;
alter table public.group_settings         enable row level security;
alter table public.invitations            enable row level security;
alter table public.gatherings             enable row level security;
alter table public.gathering_participants enable row level security;
alter table public.gathering_photos       enable row level security;
alter table public.expenses               enable row level security;
alter table public.expense_payers         enable row level security;
alter table public.expense_splits         enable row level security;
alter table public.settlements            enable row level security;
alter table public.date_proposals         enable row level security;
alter table public.date_votes             enable row level security;
alter table public.menu_proposals         enable row level security;
alter table public.menu_votes             enable row level security;
alter table public.venue_proposals        enable row level security;
alter table public.venue_votes            enable row level security;
alter table public.notifications          enable row level security;
alter table public.push_subscriptions     enable row level security;
alter table public.audit_events           enable row level security;

-- Perfiles
create policy profiles_select on public.profiles for select to authenticated
  using (public.shares_context_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Grupos
create policy groups_select on public.groups for select to authenticated
  using (public.is_group_member(id));
create policy groups_update on public.groups for update to authenticated
  using (public.is_group_admin(id)) with check (public.is_group_admin(id));
create policy groups_delete on public.groups for delete to authenticated
  using (public.is_group_admin(id));

create policy group_members_select on public.group_members for select to authenticated
  using (public.is_group_member(group_id));

create policy group_settings_select on public.group_settings for select to authenticated
  using (public.is_group_member(group_id));
create policy group_settings_update on public.group_settings for update to authenticated
  using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id));

create policy invitations_select on public.invitations for select to authenticated
  using (public.is_group_member(group_id));
create policy invitations_update on public.invitations for update to authenticated
  using (public.is_group_admin(group_id) or created_by = auth.uid())
  with check (public.is_group_admin(group_id) or created_by = auth.uid());

-- Juntadas
create policy gatherings_select on public.gatherings for select to authenticated
  using (public.can_access_gathering(id));
create policy gatherings_insert on public.gatherings for insert to authenticated
  with check (public.is_group_member(group_id) and created_by = auth.uid());
create policy gatherings_update on public.gatherings for update to authenticated
  using (public.can_manage_gathering(id)) with check (public.is_group_member(group_id));
create policy gatherings_delete on public.gatherings for delete to authenticated
  using (public.is_group_admin(group_id));

create policy participants_select on public.gathering_participants for select to authenticated
  using (public.can_access_gathering(gathering_id));

create policy photos_select on public.gathering_photos for select to authenticated
  using (public.can_access_gathering(gathering_id));
create policy photos_insert on public.gathering_photos for insert to authenticated
  with check (public.can_access_gathering(gathering_id) and uploaded_by = auth.uid());
create policy photos_delete on public.gathering_photos for delete to authenticated
  using (uploaded_by = auth.uid() or public.can_manage_gathering(gathering_id));

-- Gastos: solo lectura directa; escritura por RPC save_expense/delete_expense.
create policy expenses_select on public.expenses for select to authenticated
  using (public.can_access_gathering(gathering_id));
create policy expense_payers_select on public.expense_payers for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.can_access_gathering(e.gathering_id)));
create policy expense_splits_select on public.expense_splits for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.can_access_gathering(e.gathering_id)));

-- Pagos: solo lectura directa; escritura por RPC.
create policy settlements_select on public.settlements for select to authenticated
  using (public.can_access_gathering(gathering_id));

-- Votación de fechas
create policy date_proposals_select on public.date_proposals for select to authenticated
  using (public.can_access_gathering(gathering_id));
create policy date_proposals_insert on public.date_proposals for insert to authenticated
  with check (public.can_access_gathering(gathering_id) and created_by = auth.uid());
create policy date_proposals_delete on public.date_proposals for delete to authenticated
  using (created_by = auth.uid() or public.can_manage_gathering(gathering_id));

create policy date_votes_select on public.date_votes for select to authenticated
  using (exists (select 1 from public.date_proposals p where p.id = proposal_id and public.can_access_gathering(p.gathering_id)));
create policy date_votes_insert on public.date_votes for insert to authenticated
  with check (user_id = auth.uid() and exists (
    select 1 from public.date_proposals p where p.id = proposal_id and public.can_access_gathering(p.gathering_id)));
create policy date_votes_update on public.date_votes for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (
    select 1 from public.date_proposals p where p.id = proposal_id and public.can_access_gathering(p.gathering_id)));
create policy date_votes_delete on public.date_votes for delete to authenticated
  using (user_id = auth.uid());

-- Votación de menú
create policy menu_proposals_select on public.menu_proposals for select to authenticated
  using (public.can_access_gathering(gathering_id));
create policy menu_proposals_insert on public.menu_proposals for insert to authenticated
  with check (public.can_access_gathering(gathering_id) and created_by = auth.uid());
create policy menu_proposals_delete on public.menu_proposals for delete to authenticated
  using (created_by = auth.uid() or public.can_manage_gathering(gathering_id));

create policy menu_votes_select on public.menu_votes for select to authenticated
  using (public.can_access_gathering(gathering_id));
create policy menu_votes_insert on public.menu_votes for insert to authenticated
  with check (user_id = auth.uid() and public.can_access_gathering(gathering_id) and exists (
    select 1 from public.menu_proposals p where p.id = proposal_id and p.gathering_id = menu_votes.gathering_id));
create policy menu_votes_update on public.menu_votes for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_access_gathering(gathering_id) and exists (
    select 1 from public.menu_proposals p where p.id = proposal_id and p.gathering_id = menu_votes.gathering_id));
create policy menu_votes_delete on public.menu_votes for delete to authenticated
  using (user_id = auth.uid());

-- Votación de lugar
create policy venue_proposals_select on public.venue_proposals for select to authenticated
  using (public.can_access_gathering(gathering_id));
create policy venue_proposals_insert on public.venue_proposals for insert to authenticated
  with check (public.can_access_gathering(gathering_id) and created_by = auth.uid());
create policy venue_proposals_delete on public.venue_proposals for delete to authenticated
  using (created_by = auth.uid() or public.can_manage_gathering(gathering_id));

create policy venue_votes_select on public.venue_votes for select to authenticated
  using (public.can_access_gathering(gathering_id));
create policy venue_votes_insert on public.venue_votes for insert to authenticated
  with check (user_id = auth.uid() and public.can_access_gathering(gathering_id) and exists (
    select 1 from public.venue_proposals p where p.id = proposal_id and p.gathering_id = venue_votes.gathering_id));
create policy venue_votes_update on public.venue_votes for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_access_gathering(gathering_id) and exists (
    select 1 from public.venue_proposals p where p.id = proposal_id and p.gathering_id = venue_votes.gathering_id));
create policy venue_votes_delete on public.venue_votes for delete to authenticated
  using (user_id = auth.uid());

-- Notificaciones: cada uno ve y marca como leídas solo las suyas.
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = auth.uid());

-- Suscripciones push: solo las propias.
create policy push_select on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());
create policy push_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = auth.uid());
create policy push_delete on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());

-- Auditoría: lectura para integrantes del grupo; escritura solo vía triggers/RPC.
create policy audit_select on public.audit_events for select to authenticated
  using (public.is_group_member(group_id));

-- ---------------------------------------------------------------------
-- Privilegios por columna / tabla (defensa en profundidad)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;

grant update (display_name, alias, avatar_url) on public.profiles to authenticated;
grant update (name, description, image_url) on public.groups to authenticated;
grant delete on public.groups to authenticated;
grant update (reminder_days, reminders_enabled) on public.group_settings to authenticated;
grant update (revoked_at) on public.invitations to authenticated;
grant insert on public.gatherings to authenticated;
grant update (title, starts_at, location, description, notes, status) on public.gatherings to authenticated;
grant delete on public.gatherings to authenticated;
grant insert, delete on public.gathering_photos to authenticated;
grant insert, delete on public.date_proposals, public.menu_proposals, public.venue_proposals to authenticated;
grant insert, update, delete on public.date_votes, public.menu_votes, public.venue_votes to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant delete on public.notifications to authenticated;
grant insert, delete on public.push_subscriptions to authenticated;

-- Las funciones auxiliares no deben estar disponibles para anon.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.is_group_member(uuid), public.is_group_admin(uuid),
  public.gathering_group(uuid), public.can_access_gathering(uuid),
  public.can_manage_gathering(uuid), public.shares_context_with(uuid)
  to authenticated;
