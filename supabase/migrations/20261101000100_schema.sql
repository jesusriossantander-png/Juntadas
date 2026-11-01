-- =====================================================================
-- La Juntada — 0001 · Esquema base
-- ---------------------------------------------------------------------
-- Convenciones:
--   * Los importes se guardan SIEMPRE en centavos (bigint). Nunca float.
--   * Los gastos y pagos referencian a "gathering_participants" (no a
--     usuarios) para poder incluir invitados sin cuenta.
--   * Las escrituras sensibles (gastos, pagos, membresías) se hacen solo
--     mediante funciones RPC que validan permisos (ver 0003).
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.member_role       as enum ('admin', 'member');
create type public.gathering_status  as enum ('proposed', 'confirmed', 'done', 'cancelled');
create type public.rsvp_status       as enum ('pending', 'yes', 'maybe', 'no');
create type public.split_method      as enum ('equal', 'percent', 'amount', 'weight');
create type public.vote_value        as enum ('yes', 'maybe', 'no');
create type public.settlement_status as enum ('reported', 'confirmed', 'rejected');

-- ---------------------------------------------------------------------
-- Perfiles (1:1 con auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null default '' check (char_length(display_name) <= 60),
  alias         text check (char_length(alias) <= 30),
  avatar_url    text check (char_length(avatar_url) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.profiles is 'Datos públicos (para el grupo) de cada usuario.';

-- ---------------------------------------------------------------------
-- Grupos
-- ---------------------------------------------------------------------
create table public.groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(trim(name)) between 1 and 80),
  description  text check (char_length(description) <= 500),
  image_url    text check (char_length(image_url) <= 500),
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
comment on table public.groups is 'Grupos de amigos.';

create table public.group_members (
  group_id   uuid not null references public.groups (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       public.member_role not null default 'member',
  joined_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id);
comment on table public.group_members is 'Integrantes de cada grupo y su rol.';

create table public.group_settings (
  group_id           uuid primary key references public.groups (id) on delete cascade,
  reminder_days      integer not null default 30 check (reminder_days between 1 and 365),
  reminders_enabled  boolean not null default true,
  last_reminder_at   timestamptz,
  updated_at         timestamptz not null default now()
);
comment on table public.group_settings is 'Configuración por grupo (frecuencia de recordatorios).';

create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups (id) on delete cascade,
  code        text not null unique check (code ~ '^[A-Z0-9]{8}$'),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '14 days'),
  max_uses    integer check (max_uses is null or max_uses > 0),
  uses        integer not null default 0,
  revoked_at  timestamptz
);
create index invitations_group_idx on public.invitations (group_id);
comment on table public.invitations is 'Códigos de invitación con vencimiento y cupo.';

-- ---------------------------------------------------------------------
-- Juntadas
-- ---------------------------------------------------------------------
create table public.gatherings (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups (id) on delete cascade,
  title         text not null check (char_length(trim(title)) between 1 and 100),
  starts_at     timestamptz,                         -- null mientras se vota la fecha
  location      text check (char_length(location) <= 200),
  description   text check (char_length(description) <= 1000),
  notes         text check (char_length(notes) <= 2000),
  status        public.gathering_status not null default 'proposed',
  currency      char(3) not null default 'ARS',
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  confirmed_at  timestamptz
);
create index gatherings_group_idx on public.gatherings (group_id, starts_at desc);
comment on table public.gatherings is 'Encuentros (asados, cenas, festejos). Nunca se borran al finalizar: forman el historial.';

create table public.gathering_participants (
  id            uuid primary key default gen_random_uuid(),
  gathering_id  uuid not null references public.gatherings (id) on delete cascade,
  user_id       uuid references public.profiles (id) on delete set null,
  guest_name    text check (char_length(trim(guest_name)) between 1 and 60),
  rsvp          public.rsvp_status not null default 'pending',
  added_by      uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint participant_identity check ((user_id is not null) or (guest_name is not null)),
  constraint participant_unique_user unique (gathering_id, user_id)
);
create index gathering_participants_user_idx on public.gathering_participants (user_id);
comment on table public.gathering_participants is 'Asistentes de una juntada: integrantes o invitados externos (guest_name).';

create table public.gathering_photos (
  id            uuid primary key default gen_random_uuid(),
  gathering_id  uuid not null references public.gatherings (id) on delete cascade,
  storage_path  text not null,
  caption       text check (char_length(caption) <= 200),
  uploaded_by   uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index gathering_photos_gathering_idx on public.gathering_photos (gathering_id);

-- ---------------------------------------------------------------------
-- Gastos
-- ---------------------------------------------------------------------
create table public.expenses (
  id            uuid primary key default gen_random_uuid(),
  gathering_id  uuid not null references public.gatherings (id) on delete cascade,
  description   text not null check (char_length(trim(description)) between 1 and 120),
  category      text not null default 'otros'
                check (category in ('carne','bebidas','pan','carbon','hielo','verduras','postre','salon','descartables','otros')),
  amount_cents  bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  currency      char(3) not null default 'ARS',
  split_method  public.split_method not null default 'equal',
  spent_on      date not null default current_date,
  receipt_path  text,
  notes         text check (char_length(notes) <= 1000),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz                          -- borrado lógico: conserva el historial
);
create index expenses_gathering_idx on public.expenses (gathering_id) where deleted_at is null;
comment on column public.expenses.amount_cents is 'Importe total en centavos.';

create table public.expense_payers (
  expense_id      uuid not null references public.expenses (id) on delete cascade,
  participant_id  uuid not null references public.gathering_participants (id) on delete restrict,
  amount_cents    bigint not null check (amount_cents > 0),
  primary key (expense_id, participant_id)
);
comment on table public.expense_payers is 'Quién pagó cada gasto (admite varios pagadores).';

create table public.expense_splits (
  expense_id      uuid not null references public.expenses (id) on delete cascade,
  participant_id  uuid not null references public.gathering_participants (id) on delete restrict,
  share           numeric(14, 4) not null default 1 check (share >= 0),
  amount_cents    bigint not null check (amount_cents >= 0),
  primary key (expense_id, participant_id)
);
comment on column public.expense_splits.share is 'Valor según el método: 1 (iguales), % (porcentaje), centavos (monto) o peso.';

-- ---------------------------------------------------------------------
-- Pagos entre amigos (liquidación)
-- ---------------------------------------------------------------------
create table public.settlements (
  id                uuid primary key default gen_random_uuid(),
  gathering_id      uuid not null references public.gatherings (id) on delete cascade,
  from_participant  uuid not null references public.gathering_participants (id) on delete restrict,
  to_participant    uuid not null references public.gathering_participants (id) on delete restrict,
  amount_cents      bigint not null check (amount_cents > 0),
  method            text not null default 'transferencia'
                    check (method in ('transferencia','efectivo','mercadopago','otro')),
  paid_on           date not null default current_date,
  receipt_path      text,
  notes             text check (char_length(notes) <= 500),
  status            public.settlement_status not null default 'reported',
  client_ref        uuid unique,                      -- idempotencia: evita pagos duplicados por doble toque
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  confirmed_by      uuid references public.profiles (id) on delete set null,
  confirmed_at      timestamptz,
  constraint settlement_distinct check (from_participant <> to_participant)
);
create index settlements_gathering_idx on public.settlements (gathering_id);
comment on table public.settlements is 'Transferencias registradas. Solo las confirmadas afectan los saldos.';

-- ---------------------------------------------------------------------
-- Votaciones
-- ---------------------------------------------------------------------
create table public.date_proposals (
  id            uuid primary key default gen_random_uuid(),
  gathering_id  uuid not null references public.gatherings (id) on delete cascade,
  starts_at     timestamptz not null,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (gathering_id, starts_at)
);

create table public.date_votes (
  proposal_id  uuid not null references public.date_proposals (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  vote         public.vote_value not null,
  updated_at   timestamptz not null default now(),
  primary key (proposal_id, user_id)
);

create table public.menu_proposals (
  id            uuid primary key default gen_random_uuid(),
  gathering_id  uuid not null references public.gatherings (id) on delete cascade,
  kind          text not null default 'otro'
                check (kind in ('asado','pizza','hamburguesas','empanadas','picada','otro')),
  label         text not null check (char_length(trim(label)) between 1 and 60),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create table public.menu_votes (
  gathering_id  uuid not null references public.gatherings (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  proposal_id   uuid not null references public.menu_proposals (id) on delete cascade,
  updated_at    timestamptz not null default now(),
  primary key (gathering_id, user_id)                 -- un voto por persona por juntada
);

create table public.venue_proposals (
  id            uuid primary key default gen_random_uuid(),
  gathering_id  uuid not null references public.gatherings (id) on delete cascade,
  kind          text not null default 'otro'
                check (kind in ('casa','quincho','restaurante','otro')),
  label         text not null check (char_length(trim(label)) between 1 and 80),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create table public.venue_votes (
  gathering_id  uuid not null references public.gatherings (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  proposal_id   uuid not null references public.venue_proposals (id) on delete cascade,
  updated_at    timestamptz not null default now(),
  primary key (gathering_id, user_id)
);

-- ---------------------------------------------------------------------
-- Notificaciones y Web Push
-- ---------------------------------------------------------------------
create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  group_id      uuid references public.groups (id) on delete cascade,
  gathering_id  uuid references public.gatherings (id) on delete cascade,
  kind          text not null,
  title         text not null,
  body          text,
  link          text,
  dedupe_key    text not null,
  read_at       timestamptz,
  push_sent_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (user_id, dedupe_key)                        -- evita notificaciones duplicadas
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_push_pending_idx on public.notifications (created_at) where push_sent_at is null;

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------
create table public.audit_events (
  id          bigint generated always as identity primary key,
  group_id    uuid references public.groups (id) on delete cascade,
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  entity      text not null,
  entity_id   uuid,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index audit_events_group_idx on public.audit_events (group_id, created_at desc);
comment on table public.audit_events is 'Registro inmutable de cambios en gastos, pagos y membresías.';
