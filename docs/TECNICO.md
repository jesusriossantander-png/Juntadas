# Documentación técnica — La Juntada

## 1. Arquitectura

```
 Celular / navegador (PWA)
 ┌──────────────────────────────────────────────┐
 │ React 18 + Vite + TypeScript (HashRouter)     │
 │  ├─ lib/       lógica pura y testeada         │
 │  ├─ data/      Backend (interfaz común)       │
 │  │    ├─ SupabaseBackend  → nube              │
 │  │    └─ DemoBackend      → localStorage      │
 │  └─ sw.ts      precache + Web Push            │
 └──────────────┬───────────────────────────────┘
                │ HTTPS (anon key + JWT del usuario)
 ┌──────────────▼───────────────────────────────┐
 │ Supabase                                      │
 │  Auth · PostgREST · Realtime · Storage        │
 │  PostgreSQL: tablas con RLS + RPC validadas   │
 │  pg_cron → generate_due_reminders()           │
 │  pg_cron → Edge Function send-reminders → Push│
 └───────────────────────────────────────────────┘
```

**Por qué así**: no hace falta un backend propio. Las reglas sensibles (dinero, membresías, pagos) viven en PostgreSQL como funciones `SECURITY DEFINER` que validan `auth.uid()` explícitamente, y todo lo que el cliente puede leer está filtrado por RLS. Costo: el plan gratuito de Supabase + hosting estático gratuito (GitHub Pages o Cloudflare Pages).

`HashRouter` permite publicar en cualquier subcarpeta (GitHub Pages) sin reglas de reescritura.

## 2. Modelo de datos

Todas las tablas están en `supabase/migrations/20261101000100_schema.sql` con comentarios.

| Tabla | Propósito |
|---|---|
| `profiles` | 1:1 con `auth.users`: nombre, alias de transferencia, avatar. Se crea por trigger al registrarse. |
| `groups`, `group_members`, `group_settings` | Grupos, integrantes con rol (`admin`/`member`), frecuencia de recordatorios. |
| `invitations` | Código de 8 caracteres (sin 0/O/1/I), vencimiento, cupo, anulación, contador de usos. |
| `gatherings` | Juntadas con estado `proposed/confirmed/done/cancelled`. Nunca se borran al terminar: son el historial. |
| `gathering_participants` | Asistentes: integrante (`user_id`) o invitado externo (`guest_name`), con RSVP. |
| `expenses`, `expense_payers`, `expense_splits` | Gasto, quién pagó (N pagadores) y cuánto le toca a cada uno (`share` + `amount_cents`). Borrado lógico. |
| `settlements` | Transferencias entre participantes: `reported → confirmed/rejected`, `client_ref` único para idempotencia. |
| `date_proposals/date_votes`, `menu_*`, `venue_*` | Votaciones. Un voto de menú/lugar por persona y juntada. |
| `gathering_photos` | Fotos (rutas en Storage). |
| `notifications`, `push_subscriptions` | Avisos in-app con `unique(user_id, dedupe_key)` y suscripciones Web Push. |
| `audit_events` | Registro de altas/bajas/cambios de gastos, pagos y membresías. |

**Dinero**: siempre `bigint` en centavos. El cliente reparte con BigInt y el método del mayor resto (`src/lib/money.ts`), y el servidor rechaza cualquier gasto cuyos pagadores o repartos no sumen *exactamente* el total.

**Saldos**: `net = pagado − consumido + enviado − recibido`. Solo los pagos **confirmados** mueven el saldo. Misma fórmula en SQL (`gathering_balances`) y en TS (`computeBalances`). Las transferencias sugeridas se calculan con un algoritmo voraz determinístico (primero coincidencias exactas, luego mayor deudor ↔ mayor acreedor), que usa como máximo n−1 transferencias.

## 3. Seguridad (RLS y RPC)

Migración `0002_security.sql`:

- RLS habilitado en **todas** las tablas. `anon` no tiene ningún privilegio.
- Funciones auxiliares `is_group_member`, `is_group_admin`, `can_access_gathering`, `can_manage_gathering` (security definer, `search_path=''`).
- Privilegios por columna: por ejemplo, de `notifications` solo se puede actualizar `read_at`; de `profiles` solo nombre/alias/avatar; `group_members`, `expenses*` y `settlements` **no admiten escritura directa**.
- Un trigger impide mover una juntada de grupo o cambiar su autor.

RPC (`0003_rpc.sql`), todas validan permisos de forma explícita:

| RPC | Regla |
|---|---|
| `create_group` | Crea grupo + admin + configuración. |
| `create_invitation` / `accept_invitation` / `invitation_preview` | Cualquier integrante invita; aceptar valida vencimiento, anulación y cupo con `FOR UPDATE`; aceptar dos veces no consume cupo. La vista previa solo revela nombre y cantidad de integrantes. |
| `leave_group`, `remove_member`, `set_member_role` | Si se va el último admin se promueve al integrante más antiguo; siempre queda al menos un admin. |
| `create_gathering`, `add_participant`, `remove_participant`, `set_rsvp`, `confirm_date` | Invitados externos solo los suma el organizador o un admin. No se puede quitar a alguien con gastos o pagos. |
| `save_expense`, `delete_expense` | Valida que pagadores/repartos pertenezcan a la juntada y sumen exacto. Edita/borra solo quien lo cargó, el organizador o un admin. Todo auditado. |
| `report_settlement`, `review_settlement` | Registra quien paga, quien cobra o un admin. Lo informado por el deudor queda pendiente hasta que el acreedor (o un admin que no sea el deudor) lo confirme. No se puede pagar más de lo adeudado ni cobrar más de lo que corresponde (contando pendientes). Bloqueo consultivo por juntada contra carreras. `client_ref` evita duplicados por doble toque. |
| `generate_due_reminders`, `claim_pending_pushes` | Solo `service_role`/cron. |

Storage (`0004`): buckets privados `receipts` y `photos` con rutas `group_id/...`, acceso solo para integrantes del grupo; `avatars` de lectura pública y escritura solo en la carpeta propia.

## 4. Tiempo real y offline

- Cada pantalla se alimenta de un *snapshot* del grupo (`getSnapshot`), suscripto a `postgres_changes` de las tablas del grupo (Realtime respeta RLS). Ante cualquier cambio se recarga con *debounce*.
- El snapshot se guarda en `localStorage` (por usuario) para consulta **sin conexión, en solo lectura**. No hay cola de escritura offline: para cargar algo hace falta internet, y la app lo dice.
- En modo demo, la sincronización entre pestañas usa `BroadcastChannel`.

## 5. Recordatorios y notificaciones

1. `generate_due_reminders()` (SQL) recorre los grupos con recordatorio activo, sin propuesta abierta ni juntada futura, cuya última juntada (o creación) supera `reminder_days`. Inserta un aviso por integrante con `dedupe_key = reminder:<grupo>:<última juntada>:<ciclo>` ⇒ uno por ciclo vencido, nunca duplicado.
2. `pg_cron` lo ejecuta todos los días (migración 0005).
3. La Edge Function `send-reminders` (cada 15 min vía `cron_push.sql`) además toma con `UPDATE … FOR UPDATE SKIP LOCKED` las notificaciones sin enviar de usuarios **suscriptos** y las manda por Web Push (VAPID); borra suscripciones vencidas (404/410).
4. El cliente solo se suscribe si la persona activa el interruptor y concede permiso; puede desactivarlo en cualquier momento.

Limitaciones reales: en iOS el push solo funciona con la app instalada en la pantalla de inicio (iOS 16.4+). Si el permiso fue bloqueado, hay que habilitarlo desde el navegador.

## 6. PWA

`vite-plugin-pwa` en modo `injectManifest` con `src/sw.ts`: precache de los estáticos, navegación offline a `index.html`, actualización **con aviso** (`registerType: 'prompt'`) para no recargar a alguien que está cargando un gasto, y manejadores `push`/`notificationclick`.

## 7. Modo demo

`DemoBackend` implementa la misma interfaz y **las mismas reglas de autorización** que las RPC, sobre `localStorage` (claves `la-juntada:demo:*`). Los datos (`src/data/demoSeed.ts`) son ficticios, están marcados como "(DEMO)", con un cartel permanente en la interfaz, y nunca se envían a ningún servidor.

## 8. Variables de entorno

| Variable | Dónde | Pública |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Frontend | Sí |
| `VITE_VAPID_PUBLIC_KEY` | Frontend | Sí |
| `VITE_PUBLIC_APP_URL` | Frontend (enlaces de WhatsApp) | Sí |
| `VAPID_PRIVATE_KEY`, `CRON_SECRET` | Secrets de la Edge Function | **No** |
| `SUPABASE_SERVICE_ROLE_KEY` | Inyectada por Supabase en la Edge Function | **No** — nunca en el frontend |
