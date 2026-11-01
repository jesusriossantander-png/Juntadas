-- =====================================================================
-- Pruebas de autorización (RLS + RPC) y reglas de negocio en Postgres real.
-- Cada bloque falla con una excepción si una regla no se cumple.
-- Usuarios: A=Jesús (admin) B=Pablo C=Ricardo D=Nico E=Intruso (ajeno)
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create schema test;
create table test.state (k text primary key, v uuid);
create or replace function test.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALLÓ: %', msg; end if;
  raise notice 'ok - %', msg;
end $$;
create or replace function test.fails(stmt text, msg text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok - % (%)', msg, sqlerrm;
    return;
  end;
  raise exception 'FALLÓ (debía dar error): %', msg;
end $$;
create or replace function test.v(key text) returns uuid language sql as $$ select v from test.state where k = key $$;
create or replace function test.login(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u::text, false);
$$;
create or replace function test.code(k text) returns text language sql security definer as $$
  select code from public.invitations where id = test.v(k) $$;
create or replace function test.pid(u uuid) returns uuid language sql security definer as $$
  select id from public.gathering_participants where gathering_id = test.v('g') and user_id = u $$;
create or replace function test.opt(n int) returns uuid language sql security definer as $$
  select id from public.date_proposals where gathering_id = test.v('prop') order by starts_at offset n - 1 limit 1 $$;
create or replace function test.equal4(payer text, amount bigint, descr text) returns jsonb language sql as $$
  select jsonb_build_object('gathering_id', test.v('g'), 'description', descr, 'category', 'carne',
    'amount_cents', amount, 'split_method', 'equal',
    'payers', jsonb_build_array(jsonb_build_object('participant_id', test.v(payer), 'amount_cents', amount)),
    'splits', jsonb_build_array(
      jsonb_build_object('participant_id', test.v('pa'), 'share', 1, 'amount_cents', amount / 4),
      jsonb_build_object('participant_id', test.v('pb'), 'share', 1, 'amount_cents', amount / 4),
      jsonb_build_object('participant_id', test.v('pc'), 'share', 1, 'amount_cents', amount / 4),
      jsonb_build_object('participant_id', test.v('pd'), 'share', 1, 'amount_cents', amount - 3 * (amount / 4))))
$$;
grant usage on schema test to authenticated, anon;
grant all on test.state to authenticated, anon;
grant execute on all functions in schema test to authenticated, anon;
set client_min_messages = notice;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'jesus@demo.test', '{"display_name":"Jesús"}'),
  ('22222222-2222-2222-2222-222222222222', 'pablo@demo.test', '{"display_name":"Pablo"}'),
  ('33333333-3333-3333-3333-333333333333', 'ricardo@demo.test', '{"display_name":"Ricardo"}'),
  ('44444444-4444-4444-4444-444444444444', 'nico@demo.test', '{}'),
  ('55555555-5555-5555-5555-555555555555', 'intruso@demo.test', '{"display_name":"Intruso"}');

select test.ok((select count(*) from public.profiles) = 5, 'se crea un perfil por cada usuario registrado');
select test.ok((select display_name from public.profiles where id = '44444444-4444-4444-4444-444444444444') = 'nico',
               'el nombre por defecto sale del email');

-- ---------------------------------------------------------------------
-- anon no ve nada
-- ---------------------------------------------------------------------
set role anon;
select test.fails('select * from public.groups', 'anon no puede leer grupos');
select test.fails('select public.create_group(''x'')', 'anon no puede ejecutar RPCs');
reset role;

-- ---------------------------------------------------------------------
-- Grupos e invitaciones
-- ---------------------------------------------------------------------
set role authenticated;
select test.login('11111111-1111-1111-1111-111111111111');
insert into test.state values ('group', public.create_group('Los del Asado', 'Amigos de siempre'));
select test.ok((select role from public.group_members where group_id = test.v('group')
                and user_id = auth.uid()) = 'admin', 'quien crea el grupo queda como admin');
select test.ok((select reminder_days from public.group_settings where group_id = test.v('group')) = 30,
               'el grupo nace con recordatorio cada 30 días');
select test.fails($$insert into public.groups (name) values ('hack')$$, 'no se pueden insertar grupos directamente');
select test.fails($$insert into public.group_members (group_id, user_id, role)
                    values (test.v('group'), '55555555-5555-5555-5555-555555555555', 'admin')$$,
                  'no se pueden insertar membresías directamente');

do $$ declare c text; begin
  select code into c from public.create_invitation(test.v('group'), 7, null);
  insert into test.state values ('inv', (select id from public.invitations where code = c));
end $$;
do $$ declare c text; begin
  select code into c from public.create_invitation(test.v('group'), 1, 1);
  insert into test.state values ('inv1', (select id from public.invitations where code = c));
end $$;

-- B, C y D se suman con el código; E es ajeno y no lo usa.


select test.login('55555555-5555-5555-5555-555555555555');
select test.ok((select count(*) from public.groups) = 0, 'un ajeno no ve el grupo');
select test.ok((select count(*) from public.invitations) = 0, 'un ajeno no ve los códigos de invitación');
select test.ok((select group_name from public.invitation_preview('ZZZZZZZZ')) is null, 'un código inexistente no revela nada');
select test.fails($$select public.accept_invitation('ZZZZZZZZ')$$, 'un código inválido no da acceso');
select test.fails($$select public.create_invitation(test.v('group'))$$, 'un ajeno no puede generar invitaciones');

select test.login('22222222-2222-2222-2222-222222222222');
select test.ok((select is_valid and not already_member from public.invitation_preview(test.code('inv'))), 'la vista previa de invitación funciona');
select test.ok(public.accept_invitation(test.code('inv')) = test.v('group'), 'Pablo acepta la invitación');
select test.ok(public.accept_invitation(test.code('inv')) = test.v('group'), 'aceptar dos veces no falla ni duplica');
select test.login('33333333-3333-3333-3333-333333333333');
select public.accept_invitation(test.code('inv1'));
select test.login('44444444-4444-4444-4444-444444444444');
select test.fails($$select public.accept_invitation(test.code('inv1'))$$, 'una invitación de 1 uso no se puede reutilizar');
select public.accept_invitation(lower(test.code('inv')));
reset role;
select test.ok((select uses from public.invitations where id = test.v('inv')) = 2, 'el contador de usos no se duplica');
update public.invitations set expires_at = now() - interval '1 minute' where id = test.v('inv');
set role authenticated;
select test.login('55555555-5555-5555-5555-555555555555');
select test.fails($$select public.accept_invitation(test.code('inv'))$$, 'una invitación vencida no da acceso');

-- Miembro común no administra el grupo
select test.login('22222222-2222-2222-2222-222222222222');
update public.groups set name = 'Hackeado' where id = test.v('group');
select test.ok((select name from public.groups where id = test.v('group')) = 'Los del Asado', 'un miembro común no puede renombrar el grupo');
update public.group_settings set reminder_days = 7 where group_id = test.v('group');
select test.ok((select reminder_days from public.group_settings where group_id = test.v('group')) = 30, 'un miembro común no cambia la configuración');
select test.fails($$select public.set_member_role(test.v('group'), auth.uid(), 'admin')$$, 'un miembro no puede autopromoverse a admin');
select test.fails($$select public.remove_member(test.v('group'), '11111111-1111-1111-1111-111111111111')$$, 'un miembro no puede echar a otro');
select test.fails($$update public.group_members set role = 'admin' where user_id = auth.uid()$$, 'no se puede cambiar el rol por UPDATE directo');

select test.login('11111111-1111-1111-1111-111111111111');
update public.group_settings set reminder_days = 45 where group_id = test.v('group');
select test.ok((select reminder_days from public.group_settings where group_id = test.v('group')) = 45, 'el admin cambia la frecuencia de recordatorios');
select test.ok((select count(*) from public.profiles) = 4, 'el admin ve perfiles de su grupo pero no del ajeno');

-- ---------------------------------------------------------------------
-- Juntada, asistentes y gastos (ejemplo del enunciado)
-- ---------------------------------------------------------------------
insert into test.state values ('g', public.create_gathering(test.v('group'), 'Asado de prueba',
  now() - interval '2 days', 'Quincho de Pablo', null, null, 'confirmed', true, null));
select test.ok((select count(*) from public.gathering_participants where gathering_id = test.v('g')) = 4,
               'se invita a todos los integrantes');

insert into test.state values
  ('pa', test.pid('11111111-1111-1111-1111-111111111111')),
  ('pb', test.pid('22222222-2222-2222-2222-222222222222')),
  ('pc', test.pid('33333333-3333-3333-3333-333333333333')),
  ('pd', test.pid('44444444-4444-4444-4444-444444444444'));

-- Jesús 50.000 · Pablo 30.000 · Ricardo 20.000 · Nico 0 → 25.000 c/u

insert into test.state values ('e1', public.save_expense(test.equal4('pa', 5000000, 'Carne')));
select test.login('22222222-2222-2222-2222-222222222222');
insert into test.state values ('e2', public.save_expense(test.equal4('pb', 3000000, 'Bebidas')));
select test.login('33333333-3333-3333-3333-333333333333');
insert into test.state values ('e3', public.save_expense(test.equal4('pc', 2000000, 'Carbón y pan')));

select test.ok((select string_agg(net::text, ',' order by participant_id) from public.gathering_balances(test.v('g')))
               = (select string_agg(x, ',' order by pid) from (values
                   (test.v('pa'), '2500000'), (test.v('pb'), '500000'), (test.v('pc'), '-500000'), (test.v('pd'), '-2500000')) t(pid, x)),
               'saldos del ejemplo: Jesús +25.000, Pablo +5.000, Ricardo -5.000, Nico -25.000');

select test.fails($$select public.save_expense(jsonb_set(test.equal4('pc', 1000, 'mal'), '{amount_cents}', '999'))$$,
                  'se rechaza un gasto cuyo reparto no suma el total');
select test.fails($$select public.save_expense(jsonb_set(test.equal4('pc', 1000, 'mal'), '{payers,0,amount_cents}', '500'))$$,
                  'se rechaza un gasto cuyo pago no suma el total');
select test.fails($$insert into public.expenses (gathering_id, description, amount_cents) values (test.v('g'), 'x', 1)$$,
                  'no se pueden insertar gastos por fuera de la RPC');
select test.fails($$update public.expense_splits set amount_cents = 0 where participant_id = test.v('pc')$$,
                  'no se pueden alterar repartos directamente');

-- Ricardo no puede editar el gasto de Pablo; el admin sí.
select test.fails($$select public.save_expense(test.equal4('pb', 3000000, 'Bebidas') || jsonb_build_object('id', test.v('e2')))$$,
                  'un miembro no puede editar el gasto de otro');
select test.fails($$select public.delete_expense(test.v('e2'))$$, 'un miembro no puede borrar el gasto de otro');

-- Gasto parcial: la cerveza la pagan solo Jesús y Pablo (Ricardo y Nico no toman).
select test.login('11111111-1111-1111-1111-111111111111');
insert into test.state values ('beer', public.save_expense(jsonb_build_object(
  'gathering_id', test.v('g'), 'description', 'Cerveza', 'category', 'bebidas', 'amount_cents', 1000001,
  'split_method', 'equal',
  'payers', jsonb_build_array(jsonb_build_object('participant_id', test.v('pb'), 'amount_cents', 1000001)),
  'splits', jsonb_build_array(
    jsonb_build_object('participant_id', test.v('pa'), 'share', 1, 'amount_cents', 500001),
    jsonb_build_object('participant_id', test.v('pb'), 'share', 1, 'amount_cents', 500000)))));
select test.ok((select net from public.gathering_balances(test.v('g')) where participant_id = test.v('pc')) = -500000,
               'quien no participó de un gasto no lo paga');
select public.delete_expense(test.v('beer'));
select test.ok((select deleted_at is not null from public.expenses where id = test.v('beer')), 'el borrado es lógico (queda historial)');
select test.ok((select count(*) from public.audit_events where entity = 'expense' and entity_id = test.v('beer')) = 2,
               'alta y baja quedan auditadas');

-- ---------------------------------------------------------------------
-- Pagos / liquidación
-- ---------------------------------------------------------------------
select test.login('44444444-4444-4444-4444-444444444444');
insert into test.state values ('s1', public.report_settlement(test.v('g'), test.v('pd'), test.v('pa'), 1000000,
  'transferencia', null, 'Primera parte', null, 'aaaaaaaa-0000-0000-0000-000000000001'));
select test.ok((select status from public.settlements where id = test.v('s1')) = 'reported', 'el pago informado por el deudor queda pendiente');
select test.ok(public.report_settlement(test.v('g'), test.v('pd'), test.v('pa'), 1000000, 'transferencia', null, null, null,
               'aaaaaaaa-0000-0000-0000-000000000001') = test.v('s1'), 'reintentar el mismo pago no lo duplica');
select test.ok((select count(*) from public.settlements) = 1, 'sigue habiendo un solo pago');
select test.fails($$select public.report_settlement(test.v('g'), test.v('pd'), test.v('pa'), 1600000)$$,
                  'no se puede informar más de lo que se debe (contando lo pendiente)');
select test.fails($$select public.review_settlement(test.v('s1'), true)$$, 'el deudor no puede confirmar su propio pago');
select test.fails($$select public.report_settlement(test.v('g'), test.v('pb'), test.v('pa'), 100)$$,
                  'quien tiene saldo a favor no puede figurar pagando');
select test.fails($$select public.report_settlement(test.v('g'), test.v('pc'), test.v('pb'), 100)$$,
                  'un tercero no puede registrar pagos entre otros');

select test.login('22222222-2222-2222-2222-222222222222');
select test.fails($$select public.review_settlement(test.v('s1'), true)$$, 'un tercero no puede confirmar el pago');

select test.login('11111111-1111-1111-1111-111111111111');
select test.ok((select net from public.gathering_balances(test.v('g')) where participant_id = test.v('pd')) = -2500000,
               'un pago pendiente no altera los saldos');
select public.review_settlement(test.v('s1'), true);
select test.ok((select net from public.gathering_balances(test.v('g')) where participant_id = test.v('pd')) = -1500000,
               'confirmado el pago, Nico debe 15.000 (pago parcial)');
select test.fails($$select public.review_settlement(test.v('s1'), true)$$, 'un pago no se puede confirmar dos veces');

-- El acreedor registra lo recibido: queda confirmado de una.
select public.report_settlement(test.v('g'), test.v('pd'), test.v('pa'), 1500000, 'efectivo');
-- El admin registra un pago entre otros dos (Ricardo → Pablo): queda pendiente hasta que Pablo lo confirme.
insert into test.state values ('s3', public.report_settlement(test.v('g'), test.v('pc'), test.v('pb'), 500000, 'mercadopago'));
select test.ok((select status from public.settlements where id = test.v('s3')) = 'reported', 'un pago cargado por el admin entre otros dos espera confirmación');
select test.fails($$select public.report_settlement(test.v('g'), test.v('pc'), test.v('pb'), 1)$$, 'no se puede cobrar dos veces');
select test.login('22222222-2222-2222-2222-222222222222');
select public.review_settlement(test.v('s3'), true);
select test.ok((select bool_and(net = 0) from public.gathering_balances(test.v('g'))), 'todas las cuentas quedan saldadas');
select test.fails($$update public.settlements set amount_cents = 1 where id = test.v('s1')$$, 'los pagos no se editan directamente');

-- ---------------------------------------------------------------------
-- Ajeno: no accede por ID
-- ---------------------------------------------------------------------
select test.login('55555555-5555-5555-5555-555555555555');
select test.ok((select count(*) from public.gatherings where id = test.v('g')) = 0, 'un ajeno no ve la juntada aunque sepa el ID');
select test.ok((select count(*) from public.expenses) = 0, 'un ajeno no ve gastos');
select test.ok((select count(*) from public.settlements) = 0, 'un ajeno no ve pagos');
select test.ok((select count(*) from public.audit_events) = 0, 'un ajeno no ve la auditoría');
select test.fails($$select * from public.gathering_balances(test.v('g'))$$, 'un ajeno no puede pedir saldos');
select test.fails($$select public.save_expense(test.equal4('pa', 100, 'x'))$$, 'un ajeno no puede cargar gastos');
select test.fails($$select public.set_rsvp(test.v('g'), 'yes')$$, 'un ajeno no puede confirmar asistencia');
select test.fails($$insert into public.gatherings (group_id, title, created_by) values (test.v('group'), 'x', auth.uid())$$,
                  'un ajeno no puede crear juntadas en el grupo');

-- ---------------------------------------------------------------------
-- Invitado externo y votaciones
-- ---------------------------------------------------------------------
select test.login('11111111-1111-1111-1111-111111111111');
insert into test.state values ('prop', public.create_gathering(test.v('group'), 'Próximo asado', null, null, null, null,
  'proposed', true, array['2026-11-13 21:00-03'::timestamptz, '2026-11-14 13:30-03', '2026-11-15 13:00-03']));
insert into test.state values ('guest', public.add_participant(test.v('prop'), null, 'Primo de Pablo'));
select test.login('22222222-2222-2222-2222-222222222222');
select test.fails($$select public.add_participant(test.v('prop'), null, 'Colado')$$, 'un miembro común no suma invitados');


insert into public.date_votes (proposal_id, user_id, vote) values (test.opt(2), auth.uid(), 'yes');
select test.fails($$insert into public.date_votes (proposal_id, user_id, vote)
                    values (test.opt(2), '33333333-3333-3333-3333-333333333333', 'no')$$, 'no se puede votar en nombre de otro');
insert into public.date_votes (proposal_id, user_id, vote) values (test.opt(2), auth.uid(), 'no')
  on conflict (proposal_id, user_id) do update set vote = excluded.vote;
select test.ok((select vote from public.date_votes where proposal_id = test.opt(2) and user_id = auth.uid()) = 'no', 'se puede cambiar el voto propio');
select test.fails($$select public.confirm_date(test.opt(2))$$, 'un miembro común no confirma la fecha');

insert into public.menu_proposals (gathering_id, kind, label, created_by) values (test.v('prop'), 'asado', 'Asado', auth.uid());
insert into public.menu_votes (gathering_id, user_id, proposal_id)
  values (test.v('prop'), auth.uid(), (select id from public.menu_proposals limit 1));
select test.fails($$insert into public.menu_votes (gathering_id, user_id, proposal_id)
                    values (test.v('prop'), auth.uid(), (select id from public.menu_proposals limit 1))$$,
                  'un voto de menú por persona');
select test.fails($$insert into public.menu_votes (gathering_id, user_id, proposal_id)
                    values (test.v('g'), auth.uid(), (select id from public.menu_proposals limit 1))$$,
                  'no se puede usar una opción de otra juntada');

select test.login('55555555-5555-5555-5555-555555555555');
select test.fails($$insert into public.date_votes (proposal_id, user_id, vote) values (test.opt(1), auth.uid(), 'yes')$$,
                  'un ajeno no puede votar');

select test.login('11111111-1111-1111-1111-111111111111');
select public.confirm_date(test.opt(2));
select test.ok((select status = 'confirmed' and starts_at = '2026-11-14 13:30-03' from public.gatherings where id = test.v('prop')),
               'el organizador confirma la fecha y se genera la juntada definitiva');

-- ---------------------------------------------------------------------
-- Notificaciones
-- ---------------------------------------------------------------------
select test.login('22222222-2222-2222-2222-222222222222');
select test.ok((select count(*) from public.notifications where kind = 'gathering_confirmed') >= 1, 'los integrantes reciben aviso de confirmación');
select test.fails($$update public.notifications set title = 'x'$$, 'no se puede cambiar el texto de una notificación');
update public.notifications set read_at = now();
select test.ok((select bool_and(read_at is not null) from public.notifications), 'se pueden marcar como leídas');
select test.fails($$insert into public.notifications (user_id, kind, title, dedupe_key) values (auth.uid(), 'x', 'x', 'x')$$,
                  'el cliente no crea notificaciones');
select test.fails($$insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
                    values ('11111111-1111-1111-1111-111111111111', 'https://x', 'k', 'a')$$,
                  'no se puede suscribir a otra persona a push');
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (auth.uid(), 'https://push.example/1', 'k', 'a');

-- ---------------------------------------------------------------------
-- Recordatorios
-- ---------------------------------------------------------------------
select test.fails($$select public.generate_due_reminders()$$, 'un cliente no puede disparar recordatorios');
select test.fails($$select * from public.claim_pending_pushes()$$, 'un cliente no puede reclamar la cola push');
reset role;
-- Simulamos que la próxima juntada ya pasó y que hace 50 días que no se juntan.
update public.gatherings set starts_at = now() - interval '50 days', status = 'done' where group_id = test.v('group');
select test.ok(public.generate_due_reminders() = 4, 'con 50 días (frecuencia 45) se avisa a los 4 integrantes');
select test.ok(public.generate_due_reminders() = 0, 'no se envían recordatorios duplicados');
select test.ok(public.generate_due_reminders(now() + interval '45 days') = 4, 'al vencer el siguiente ciclo se vuelve a avisar');
select test.ok((select count(*) from public.claim_pending_pushes()) >= 1, 'la cola push entrega lo pendiente a quien está suscripto');
select test.ok((select count(*) from public.claim_pending_pushes()) = 0, 'la cola push no reenvía lo ya enviado');
select test.ok(not exists (select 1 from public.notifications n where n.push_sent_at is not null
               and n.user_id <> '22222222-2222-2222-2222-222222222222'), 'no se envía push a quien no dio permiso');
insert into test.state values ('prop2', gen_random_uuid());
insert into public.gatherings (group_id, title, status, created_by) values (test.v('group'), 'En marcha', 'proposed', '11111111-1111-1111-1111-111111111111');
select test.ok(public.generate_due_reminders(now() + interval '200 days') = 0, 'si hay una propuesta en marcha no se recuerda');

-- ---------------------------------------------------------------------
-- Abandonar el grupo
-- ---------------------------------------------------------------------
set role authenticated;
select test.login('11111111-1111-1111-1111-111111111111');
select public.leave_group(test.v('group'));
select test.ok((select count(*) from public.groups) = 0, 'quien abandona deja de ver el grupo');
select test.login('22222222-2222-2222-2222-222222222222');
select test.ok((select count(*) from public.group_members where group_id = test.v('group') and role = 'admin') = 1,
               'si se va el último admin, se promueve a otro integrante');
reset role;
\echo 'RLS y reglas de negocio: OK'
