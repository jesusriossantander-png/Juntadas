// Prueba de punta a punta de la interfaz conectada a un Supabase real (local o de staging).
// Uso: build con VITE_SUPABASE_* → preview en E2E_URL → node tests/e2e/supabase.e2e.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(execSync('npm root -g').toString().trim() + '/playwright'); }

const BASE = process.env.E2E_URL || 'http://localhost:4174/';
const stamp = Date.now();
const results = [];
const step = async (name, fn) => { try { await fn(); results.push(['✔', name]); } catch (e) { results.push(['✘', name, e.message.split('\n')[0]]); } };
const see = async (page, text, timeout = 8000) => {
  try { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ timeout }); }
  catch { throw new Error(`no aparece "${text}" en ${page.url()}`); }
};
const browser = await pw.chromium.launch();
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires', colorScheme: 'dark' });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  return p;
};
const signup = async (p, name) => {
  await p.goto(BASE);
  await p.getByRole('button', { name: 'Crear cuenta' }).click();
  await p.getByPlaceholder('Ej: Jesús').fill(name);
  await p.getByPlaceholder('vos@email.com').fill(`${name.toLowerCase()}.${stamp}@e2e.lajuntada.app`);
  await p.getByPlaceholder('••••••••').fill('clave-segura-123');
  await p.getByRole('button', { name: 'Crear cuenta' }).click();
  await see(p, 'creá un grupo');
};

const a = await mk();
const b = await mk();
let gatheringUrl;
await step('Registro de dos usuarios reales', async () => { await signup(a, 'Jesus'); await signup(b, 'Pablo'); });
await step('Crear grupo e invitar', async () => {
  await a.getByRole('link', { name: /Crear un grupo/ }).click();
  await a.getByPlaceholder('Ej: Los del Asado').fill('Asado E2E');
  await a.getByRole('button', { name: 'Crear grupo' }).last().click();
  await a.getByRole('button', { name: 'Generar enlace' }).click();
  await see(a, 'Vence el');
});
await step('El segundo usuario acepta la invitación', async () => {
  const code = (await a.locator('.amount-lg').first().textContent()).trim();
  await b.goto(`${BASE}#/unirse/${code}`);
  await see(b, 'Asado E2E');
  await b.getByRole('button', { name: 'Sumarme al grupo' }).click();
  await see(b, 'Asado E2E');
});
await step('Crear juntada confirmada', async () => {
  await a.goto(BASE + '#/juntadas/nueva');
  await a.getByRole('radio', { name: /Ya hay fecha/ }).click();
  await a.locator('input[type="datetime-local"]').fill('2026-10-30T13:00');
  await a.getByRole('button', { name: 'Crear juntada' }).click();
  await a.waitForURL(/juntadas\/[0-9a-f-]+$/);
  gatheringUrl = a.url();
  await see(a, 'Asistentes');
});
await step('Cargar gasto y ver la deuda en el otro celular en tiempo real', async () => {
  await b.goto(gatheringUrl + '/cuentas');
  await see(b, 'Todavía no hay cuentas');
  await a.goto(gatheringUrl.replace(/$/, '/gastos/nuevo'));
  await a.getByLabel('Importe').fill('30.000');
  await a.getByPlaceholder('Ej: Vacío y chorizos').fill('Carne');
  await a.getByRole('button', { name: /Cargar gasto/ }).click();
  await a.waitForURL(/\/gastos$/);
  await see(b, '$ 15.000', 10000); // sin recargar: llega por Realtime
});
await step('Pablo informa el pago y Jesús lo confirma', async () => {
  await b.getByRole('link', { name: /Ya pagué/ }).click();
  await b.getByRole('button', { name: 'Registrar pago' }).click();
  await see(b, 'Pago informado');
  await a.goto(gatheringUrl + '/cuentas');
  await a.getByRole('button', { name: 'Lo recibí', exact: true }).click();
  await see(a, '¡Cuentas saldadas!');
});
await step('Notificación in-app al otro usuario', async () => {
  await b.goto(BASE + '#/notificaciones');
  await see(b, 'Confirmaron tu pago');
});
await step('Cerrar sesión y volver a entrar', async () => {
  await b.goto(BASE + '#/ajustes');
  await b.getByRole('button', { name: 'Cerrar sesión' }).click();
  await b.getByPlaceholder('vos@email.com').fill(`pablo.${stamp}@e2e.lajuntada.app`);
  await b.getByPlaceholder('••••••••').fill('clave-segura-123');
  await b.getByRole('button', { name: 'Entrar' }).click();
  await see(b, 'Cerrar sesión');
  await b.goto(BASE + '#/');
  await see(b, '¡Hola, Pablo!');
});
await step('Sin errores de JavaScript', async () => {
  const errs = [...a.errors, ...b.errors];
  if (errs.length) throw new Error(errs.slice(0, 3).join(' | '));
});
await browser.close();
for (const r of results) console.log(r.join(' '));
const failed = results.filter((r) => r[0] === '✘').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
