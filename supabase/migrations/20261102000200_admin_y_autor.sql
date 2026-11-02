-- =====================================================================
-- La Juntada · administrador del grupo y autor de cada juntada
-- ---------------------------------------------------------------------
-- * Quien crea el grupo recibe una CLAVE DE ADMINISTRADOR (secreta).
--   Solo con esa clave se cambian los días del aviso y el nombre, y se
--   editan o borran juntadas que cargó otro celular.
-- * Cada celular tiene un identificador propio: puede editar las juntadas
--   que cargó él mismo.
-- * Grupos creados antes no tienen administrador: el primero que toque
--   "Hacerme administrador" lo será.
-- Se puede correr más de una vez sin problema.
-- =====================================================================

alter table public.grupos   add column if not exists admin_token text;
alter table public.juntadas add column if not exists autor text;

-- Las funciones cambian de parámetros: se reemplazan.
drop function if exists public.crear_grupo(text);
drop function if exists public.grupo_datos(text);
drop function if exists public.guardar_juntada(text, jsonb);
drop function if exists public.borrar_juntada(text, uuid);
drop function if exists public.actualizar_grupo(text, text, integer, jsonb);

create or replace function public._token()
returns text language sql volatile set search_path = '' as $$
  select string_agg(substr('abcdefghijkmnpqrstuvwxyz23456789', (get_byte(b, k) % 32) + 1, 1), '')
  from (select extensions.gen_random_bytes(24) as b) r, generate_series(0, 23) k;
$$;

create or replace function public._es_admin(p_grupo uuid, p_admin text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.grupos g
                 where g.id = p_grupo and g.admin_token is not null and g.admin_token = p_admin);
$$;

create or replace function public.crear_grupo(p_nombre text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_codigo text; v_admin text := public._token(); i int := 0;
begin
  loop
    v_codigo := left(public._token(), 12);
    begin
      insert into public.grupos (codigo, nombre, admin_token)
      values (v_codigo, coalesce(nullif(trim(p_nombre), ''), 'La Juntada'), v_admin);
      return jsonb_build_object('codigo', v_codigo, 'admin', v_admin);
    exception when unique_violation then
      i := i + 1;
      if i > 5 then raise; end if;
    end;
  end loop;
end;
$$;

create or replace function public.reclamar_admin(p_codigo text)
returns text language plpgsql security definer set search_path = '' as $$
declare v uuid := public._grupo(p_codigo); v_admin text := public._token();
begin
  update public.grupos set admin_token = v_admin where id = v and admin_token is null;
  if not found then raise exception 'Este grupo ya tiene administrador'; end if;
  return v_admin;
end;
$$;

create or replace function public.grupo_datos(p_codigo text, p_dispositivo text default null, p_admin text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v uuid := public._grupo(p_codigo); g public.grupos; v_admin boolean;
begin
  select * into g from public.grupos where id = v;
  v_admin := public._es_admin(v, p_admin);
  return jsonb_build_object(
    'nombre', g.nombre,
    'avisoDias', g.aviso_dias,
    'amigos', g.amigos,
    'tieneAdmin', g.admin_token is not null,
    'esAdmin', v_admin,
    'juntadas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', j.id, 'fecha', j.fecha, 'titulo', j.titulo, 'personas', j.personas,
               'separarAlcohol', j.separar_alcohol, 'creada', j.creada, 'saldada', false,
               'editable', v_admin or (j.autor is not null and j.autor = p_dispositivo))
             order by j.fecha desc, j.creada desc)
      from public.juntadas j where j.grupo_id = v), '[]'::jsonb)
  );
end;
$$;

create or replace function public.guardar_juntada(p_codigo text, p jsonb, p_dispositivo text default null, p_admin text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v uuid := public._grupo(p_codigo); e public.juntadas;
begin
  if jsonb_typeof(p -> 'personas') <> 'array' or jsonb_array_length(p -> 'personas') > 60 then
    raise exception 'La juntada tiene un formato inválido';
  end if;
  if pg_column_size(p) > 60000 then raise exception 'La juntada es demasiado grande'; end if;

  select * into e from public.juntadas where id = (p ->> 'id')::uuid;
  if found then
    if e.grupo_id <> v then return; end if;   -- nunca pisa juntadas de otro grupo
    if not (public._es_admin(v, p_admin) or (e.autor is not null and e.autor = p_dispositivo)) then
      raise exception 'Solo el administrador puede editar una juntada que cargó otro celular';
    end if;
    update public.juntadas set fecha = (p ->> 'fecha')::date, titulo = left(coalesce(p ->> 'titulo', ''), 80),
      personas = p -> 'personas', separar_alcohol = coalesce((p ->> 'separarAlcohol')::boolean, true), actualizada = now()
    where id = e.id;
  else
    insert into public.juntadas (id, grupo_id, fecha, titulo, personas, separar_alcohol, creada, actualizada, autor)
    values ((p ->> 'id')::uuid, v, (p ->> 'fecha')::date, left(coalesce(p ->> 'titulo', ''), 80),
            p -> 'personas', coalesce((p ->> 'separarAlcohol')::boolean, true),
            coalesce((p ->> 'creada')::timestamptz, now()), now(), nullif(left(p_dispositivo, 64), ''));
  end if;
end;
$$;

create or replace function public.borrar_juntada(p_codigo text, p_id uuid, p_admin text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v uuid := public._grupo(p_codigo);
begin
  if not public._es_admin(v, p_admin) then raise exception 'Solo el administrador puede borrar juntadas'; end if;
  delete from public.juntadas where id = p_id and grupo_id = v;
end;
$$;

create or replace function public.actualizar_grupo(p_codigo text, p_nombre text default null,
  p_aviso_dias integer default null, p_amigos jsonb default null, p_admin text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v uuid := public._grupo(p_codigo);
begin
  if (p_nombre is not null or p_aviso_dias is not null) and not public._es_admin(v, p_admin) then
    raise exception 'Solo el administrador puede cambiar los días del aviso y el nombre del grupo';
  end if;
  if p_amigos is not null and (jsonb_typeof(p_amigos) <> 'array' or jsonb_array_length(p_amigos) > 200) then
    raise exception 'Lista de amigos inválida';
  end if;
  update public.grupos set
    nombre = coalesce(nullif(trim(p_nombre), ''), nombre),
    aviso_dias = coalesce(p_aviso_dias, aviso_dias),
    amigos = coalesce(p_amigos, amigos)
  where id = v;
end;
$$;

-- Un celular puede recibir avisos de varios grupos.
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'suscripciones_pkey'
             and pg_get_constraintdef(oid) = 'PRIMARY KEY (endpoint)') then
    alter table public.suscripciones drop constraint suscripciones_pkey;
    alter table public.suscripciones add primary key (endpoint, grupo_id);
  end if;
end $$;

create or replace function public.suscribir_avisos(p_codigo text, p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = '' as $$
declare v uuid := public._grupo(p_codigo);
begin
  if p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000 then raise exception 'Suscripción inválida'; end if;
  insert into public.suscripciones (endpoint, grupo_id, p256dh, auth) values (p_endpoint, v, p_p256dh, p_auth)
  on conflict (endpoint, grupo_id) do update set p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;

drop function if exists public.cancelar_avisos(text);
create or replace function public.cancelar_avisos(p_endpoint text, p_codigo text default null)
returns void language sql security definer set search_path = '' as $$
  delete from public.suscripciones
  where endpoint = p_endpoint
    and (p_codigo is null or grupo_id = (select id from public.grupos where codigo = lower(trim(p_codigo))));
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.crear_grupo(text), public.reclamar_admin(text),
  public.grupo_datos(text, text, text), public.guardar_juntada(text, jsonb, text, text),
  public.borrar_juntada(text, uuid, text), public.actualizar_grupo(text, text, integer, jsonb, text),
  public.suscribir_avisos(text, text, text, text), public.cancelar_avisos(text, text), public.clave_publica_avisos()
to anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.tomar_avisos() to service_role;
  end if;
end $$;
