# Informe de pruebas — La Juntada

Fecha: 1 de noviembre de 2026. Todas las pruebas de abajo se **ejecutaron** en el entorno de desarrollo; los resultados son reales.

## Resumen

| Suite | Cómo se corre | Resultado |
|---|---|---|
| Unitarias: dinero, repartos, saldos, liquidación, votos, recordatorios, estadísticas | `npm test` | **28/28** ✔ |
| Base de datos: migraciones + RLS + RPC en PostgreSQL 16 real | `npm run test:db` | **84/84** verificaciones ✔ |
| Migraciones sobre el stack completo de Supabase (CLI 2.122, `supabase start`) | `npx supabase start` | 5/5 migraciones aplicadas, Storage + Realtime + `pg_cron` configurados ✔ |
| Integración del `SupabaseBackend` real contra Supabase local (Auth, PostgREST, RLS, Realtime, Storage) | `SUPABASE_TEST_URL=… SUPABASE_TEST_ANON_KEY=… npx vitest run src/data/supabase.integration.test.ts` | **1/1** (flujo completo) ✔ |
| E2E de la interfaz conectada a Supabase (2 usuarios, 2 navegadores) | `node tests/e2e/supabase.e2e.mjs` | **9/9** ✔ |
| E2E de la interfaz en modo demo (celular 390×844) | `node tests/e2e/demo.e2e.mjs` | **19/19** ✔ |
| Edge Function `send-reminders` con Web Push real (VAPID, cifrado aes128gcm) | Deno 2.9 + endpoint HTTPS de prueba | ✔ (ver abajo) |
| Tipos (TypeScript estricto, app + service worker + Edge Function) | `npm run typecheck`, `deno check` | ✔ |
| Build de producción + service worker | `npm run build` | ✔ (precache de 43 archivos) |

## Lista obligatoria

| Ítem | Verificado en | Estado |
|---|---|---|
| Registro e inicio de sesión | E2E Supabase (registro de 2 usuarios, cerrar sesión y volver a entrar); integración | ✔ |
| Recuperación de contraseña | Implementada (`resetPasswordForEmail` + pantalla "Nueva contraseña"). No se probó el clic en el email | ⚠️ parcial |
| Invitación y aceptación | SQL (código inválido, vencido, de un uso, doble aceptación), integración, E2E en ambos modos | ✔ |
| Creación de grupos | SQL, integración, E2E | ✔ |
| Creación de encuentros | SQL, integración, E2E (con fecha fija y con votación) | ✔ |
| Registro de gastos | SQL, integración, E2E | ✔ |
| División parcial (no todos participan) | Unitaria "la cerveza", SQL, E2E | ✔ |
| Repartos por porcentaje (incluso periódicos) | Unitarias, E2E (error si no suman 100%) | ✔ |
| Montos y proporciones personalizadas, varios pagadores | Unitarias | ✔ |
| Redondeo de importes | Unitarias: prueba masiva (≈3.000 totales × 9 tamaños de grupo) y aleatoria (300 casos): nunca se pierde ni se inventa un centavo; el servidor rechaza repartos que no suman exacto | ✔ |
| Liquidación de deudas (ejemplo $100.000 entre 4) | Unitaria, SQL, integración, E2E | ✔ |
| Pagos parciales y estados pendiente/parcial/saldado | Unitarias, SQL, integración, E2E | ✔ |
| Pagos duplicados / excesivos | SQL (`client_ref` idempotente, tope por saldo con pendientes), integración, E2E "no se puede pagar de más" | ✔ |
| Confirmación de pagos según autorización | SQL (deudor no confirma su pago, tercero no confirma), integración, E2E | ✔ |
| Edición y eliminación de gastos | SQL (permisos y borrado lógico auditado), E2E | ✔ |
| Sincronización entre usuarios | Integración (evento Realtime), E2E Supabase (la deuda aparece en el otro navegador sin recargar), E2E demo entre pestañas | ✔ |
| Votación de fechas | Unitarias (desempate), SQL, integración, E2E | ✔ |
| Votación de menú y lugar | SQL (un voto por persona, opción de otra juntada rechazada), integración, E2E | ✔ |
| Historial | E2E (historial con búsqueda/filtro) | ✔ |
| Permisos y RLS | 50+ verificaciones SQL: anon sin acceso, ajeno no ve nada aunque sepa el ID, escritura directa bloqueada, columnas protegidas; integración (ajeno no accede a snapshot ni a comprobantes) | ✔ |
| Recordatorios | Unitarias, SQL (sin duplicados, nuevo ciclo, se suspende si hay propuesta), Edge Function contra Supabase real | ✔ |
| Web Push | Edge Function: rechaza llamadas sin `CRON_SECRET` (401); envía push cifrado con VAPID a la suscripción válida (201); borra la suscripción vencida (410); la segunda corrida no reenvía nada; no se envía a quien no se suscribió | ✔ (endpoint de prueba; no se probó con un celular físico) |
| Funcionamiento móvil | Todas las pruebas E2E con viewport 390×844 y capturas revisadas (oscuro y claro) | ✔ |
| Instalación PWA | Manifest válido (nombre, íconos 192/512/maskable), service worker registrado | ✔ técnico — la instalación en un celular físico no se pudo probar desde este entorno |
| Compilación de producción | `npm run build` | ✔ |

## Errores encontrados y corregidos durante las pruebas

1. **Navegación después de eliminar** un gasto/juntada o abandonar un grupo: la acción se completaba pero la pantalla no volvía (la acción no devolvía valor). Corregido.
2. **URL `http://` de Supabase** (desarrollo local) hacía caer la app en modo demo. Corregido.
3. El nombre mostrado usaba el alias de transferencia en lugar del nombre. Corregido.
4. En la demo, la sesión se compartía entre pestañas e impedía probar con dos amigos a la vez. Ahora la sesión de la demo es por pestaña.
5. URLs de retorno de Auth incompatibles con el ruteo por `#`. Ahora vuelven sin `#` y la app detecta `?reset=1`.

## Pendiente / limitaciones conocidas

- **No hay cuentas de Supabase ni Cloudflare conectadas a esta sesión**, así que no se creó el proyecto en la nube ni se publicó con Supabase real. Todo está listo para hacerlo (ver README). Sin Supabase, la app publicada funciona en modo demo.
- **Publicación**: el workflow de GitHub Pages corre al hacer merge a `main`; requiere activar *Settings → Pages → Source: GitHub Actions* una vez.
- Recuperación de contraseña y confirmación por email: dependen del servidor de email de Supabase (en el plan gratuito hay un límite de envíos por hora; conviene configurar SMTP propio para uso real).
- Sin cola de escritura offline: sin internet solo se puede consultar.
- Moneda: se guarda por gasto (ARS por defecto); no hay conversión entre monedas.
- Un push que falla por un error transitorio no se reintenta (se prioriza no duplicar avisos); el aviso igual queda en la app.
- En iPhone, el push requiere iOS 16.4+ con la app instalada.
