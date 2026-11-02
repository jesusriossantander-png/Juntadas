-- =====================================================================
-- La Juntada · grupo compartido
-- ---------------------------------------------------------------------
-- Sin usuarios ni contraseñas: cada grupo tiene un CÓDIGO SECRETO que va
-- en el link de invitación. Quien tiene el código puede ver y cargar.
-- Las tablas no son accesibles directamente desde la app (RLS sin
-- políticas): todo pasa por funciones que exigen el código del grupo.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.grupos (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique check (codigo ~ '^[a-z0-9]{12}$'),
  nombre      text not null default 'La Juntada' check (char_length(nombre) between 1 and 60),
  aviso_dias  integer not null default 30 check (aviso_dias between 1 and 365),
  amigos      jsonb not null default '[]'::jsonb,
  creado      timestamptz not null default now()
);

create table if not exists public.juntadas (
  id               uuid primary key,
  grupo_id         uuid not null references public.grupos (id) on delete cascade,
  fecha            date not null,
  titulo           text not null default '' check (char_length(titulo) <= 80),
  personas         jsonb not null default '[]'::jsonb,
  separar_alcohol  boolean not null default true,
  creada           timestamptz not null default now(),
  actualizada      timestamptz not null default now()
);
create index if not exists juntadas_grupo_fecha on public.juntadas (grupo_id, fecha desc);

-- Celulares que aceptaron recibir avisos (Web Push)
create table if not exists public.suscripciones (
  endpoint  text primary key,
  grupo_id  uuid not null references public.grupos (id) on delete cascade,
  p256dh    text not null,
  auth      text not null,
  creada    timestamptz not null default now()
);

-- Avisos ya enviados (para no repetir el mismo aviso)
create table if not exists public.avisos_enviados (
  grupo_id  uuid not null references public.grupos (id) on delete cascade,
  clave     text not null,
  enviado   timestamptz not null default now(),
  primary key (grupo_id, clave)
);

-- Configuración privada (clave para firmar los avisos). Solo la lee el servidor.
create table if not exists public.config (
  clave  text primary key,
  valor  text not null
);

alter table public.grupos          enable row level security;
alter table public.juntadas        enable row level security;
alter table public.suscripciones   enable row level security;
alter table public.avisos_enviados enable row level security;
alter table public.config          enable row level security;
revoke all on public.grupos, public.juntadas, public.suscripciones, public.avisos_enviados, public.config from anon, authenticated;

-- ---------------------------------------------------------------------
-- Funciones que usa la app
-- ---------------------------------------------------------------------
create or replace function public._grupo(p_codigo text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  select id into v from public.grupos where codigo = lower(trim(p_codigo));
  if v is null then raise exception 'No encontramos ese grupo. Pedí el link de nuevo.'; end if;
  return v;
end;
$$;

create or replace function public.crear_grupo(p_nombre text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_codigo text; i int := 0;
begin
  loop
    select string_agg(substr('abcdefghijkmnpqrstuvwxyz23456789', (get_byte(b, k) % 32) + 1, 1), '')
      into v_codigo
      from (select extensions.gen_random_bytes(12) as b) r, generate_series(0, 11) k;
    begin
      insert into public.grupos (codigo, nombre) values (v_codigo, coalesce(nullif(trim(p_nombre), ''), 'La Juntada'));
      return v_codigo;
    exception when unique_violation then
      i := i + 1;
      if i > 5 then raise; end if;
    end;
  end loop;
end;
$$;

create or replace function public.grupo_datos(p_codigo text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v uuid := public._grupo(p_codigo); g public.grupos;
begin
  select * into g from public.grupos where id = v;
  return jsonb_build_object(
    'nombre', g.nombre,
    'avisoDias', g.aviso_dias,
    'amigos', g.amigos,
    'juntadas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', j.id, 'fecha', j.fecha, 'titulo', j.titulo, 'personas', j.personas,
               'separarAlcohol', j.separar_alcohol, 'creada', j.creada, 'saldada', false)
             order by j.fecha desc, j.creada desc)
      from public.juntadas j where j.grupo_id = v), '[]'::jsonb)
  );
end;
$$;

create or replace function public.guardar_juntada(p_codigo text, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v uuid := public._grupo(p_codigo);
begin
  if jsonb_typeof(p -> 'personas') <> 'array' or jsonb_array_length(p -> 'personas') > 60 then
    raise exception 'La juntada tiene un formato inválido';
  end if;
  if pg_column_size(p) > 60000 then raise exception 'La juntada es demasiado grande'; end if;
  insert into public.juntadas as j (id, grupo_id, fecha, titulo, personas, separar_alcohol, creada, actualizada)
  values ((p ->> 'id')::uuid, v, (p ->> 'fecha')::date, left(coalesce(p ->> 'titulo', ''), 80),
          p -> 'personas', coalesce((p ->> 'separarAlcohol')::boolean, true),
          coalesce((p ->> 'creada')::timestamptz, now()), now())
  on conflict (id) do update
    set fecha = excluded.fecha, titulo = excluded.titulo, personas = excluded.personas,
        separar_alcohol = excluded.separar_alcohol, actualizada = now()
    where j.grupo_id = v;   -- nunca pisa juntadas de otro grupo
end;
$$;

create or replace function public.borrar_juntada(p_codigo text, p_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.juntadas where id = p_id and grupo_id = public._grupo(p_codigo);
$$;

create or replace function public.actualizar_grupo(p_codigo text, p_nombre text default null,
  p_aviso_dias integer default null, p_amigos jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v uuid := public._grupo(p_codigo);
begin
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

create or replace function public.suscribir_avisos(p_codigo text, p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = '' as $$
declare v uuid := public._grupo(p_codigo);
begin
  if p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000 then raise exception 'Suscripción inválida'; end if;
  insert into public.suscripciones (endpoint, grupo_id, p256dh, auth) values (p_endpoint, v, p_p256dh, p_auth)
  on conflict (endpoint) do update set grupo_id = excluded.grupo_id, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;

create or replace function public.cancelar_avisos(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from public.suscripciones where endpoint = p_endpoint;
$$;

-- ---------------------------------------------------------------------
-- Para el envío diario de avisos (solo el servidor, con la clave secreta)
-- Devuelve y marca como enviados los grupos que superaron sus días sin juntarse.
-- Un aviso por "ciclo": a los 30, 60, 90... días (si eligieron 30).
-- ---------------------------------------------------------------------
create or replace function public.tomar_avisos()
returns table (grupo_id uuid, nombre text, dias integer, suscripciones jsonb)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  return query
  with ult as (
    select g.id, g.nombre, g.aviso_dias, max(j.fecha) as ultima
    from public.grupos g join public.juntadas j on j.grupo_id = g.id
    group by g.id
  ), vencidos as (
    select u.id, u.nombre, (hoy - u.ultima)::int as d,
           u.ultima::text || ':' || ((hoy - u.ultima) / u.aviso_dias)::text as clave
    from ult u where hoy - u.ultima >= u.aviso_dias
  ), nuevos as (
    insert into public.avisos_enviados (grupo_id, clave)
    select v.id, v.clave from vencidos v
    on conflict do nothing
    returning avisos_enviados.grupo_id
  )
  select v.id, v.nombre, v.d,
         coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                   from public.suscripciones s where s.grupo_id = v.id), '[]'::jsonb)
  from vencidos v where v.id in (select n.grupo_id from nuevos n);
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.crear_grupo(text), public.grupo_datos(text), public.guardar_juntada(text, jsonb),
  public.borrar_juntada(text, uuid), public.actualizar_grupo(text, text, integer, jsonb),
  public.suscribir_avisos(text, text, text, text), public.cancelar_avisos(text)
to anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.tomar_avisos() to service_role;
    grant select on public.config to service_role;
    grant delete on public.suscripciones to service_role;
  end if;
end $$;
