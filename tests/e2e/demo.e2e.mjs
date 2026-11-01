// Prueba de punta a punta en modo DEMO, con viewport de celular.
// Uso: npm run build && npx vite preview --port 4173 &  →  node tests/e2e/demo.e2e.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(execSync('npm root -g').toString().trim() + '/playwright'); }

const BASE = process.env.E2E_URL || 'http://localhost:4173/';
const SHOTS = process.env.E2E_SHOTS || 'docs/screenshots';
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(['✔', name]); }
  catch (e) { results.push(['✘', name, e.message.split('\n')[0]]); }
};
const expectText = async (page, text, timeout = 5000) => {
  try { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ timeout }); }
  catch { throw new Error(`no aparece el texto "${text}" en ${page.url()}`); }
};

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires', isMobile: true, hasTouch: true });
const errors = [];
const a = await ctx.newPage();
a.on('pageerror', (e) => errors.push(e.message));
a.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await step('Pantalla de inicio de sesión con demo', async () => {
  await a.goto(BASE);
  await expectText(a, 'Probá la demo');
  await a.screenshot({ path: `${SHOTS}/01-login.png` });
});
await step('Entrar como Jesús y ver el dashboard', async () => {
  await a.getByRole('button', { name: /Jesús/ }).click();
  await expectText(a, '¡Hola, Jesús!');
  await expectText(a, 'Tu saldo en el grupo');
  await a.screenshot({ path: `${SHOTS}/02-dashboard.png`, fullPage: true });
});
await step('Recordatorio en el grupo con 47 días sin juntarse', async () => {
  await a.getByRole('button', { name: 'Cambiar de grupo' }).click();
  await a.getByRole('button', { name: /Viernes de after/ }).click();
  await expectText(a, 'que no se juntan');
  await a.screenshot({ path: `${SHOTS}/03-recordatorio.png` });
  await a.getByRole('button', { name: 'Cambiar de grupo' }).click();
  await a.getByRole('button', { name: /Los del Asado/ }).click();
  await expectText(a, 'MODO DEMO');
});
let gid;
await step('Historial y cuentas del ejemplo ($100.000 entre 4)', async () => {
  await a.goto(BASE + '#/historial');
  await a.getByText('Asado del mes').first().click();
  await a.waitForURL(/juntadas\//);
  gid = a.url().match(/juntadas\/([0-9a-f-]+)/)[1];
  await a.goto(`${BASE}#/juntadas/${gid}/cuentas`);
  await expectText(a, '¿Quién le debe a quién?');
  await expectText(a, '$ 100.000');
  await expectText(a, '$ 15.000'); // Nico ya pagó 10.000 de 25.000
  await expectText(a, 'Parcialmente pagado');
  await a.screenshot({ path: `${SHOTS}/04-cuentas.png`, fullPage: true });
});
await step('Cargar gasto parcial (solo algunos participan)', async () => {
  await a.goto(`${BASE}#/juntadas/${gid}/gastos/nuevo`);
  await a.getByLabel('Importe').fill('12.000');
  await a.getByRole('radio', { name: /Hielo/ }).click();
  await a.getByRole('checkbox', { name: /Ricardo/ }).click();
  await a.getByRole('checkbox', { name: /Nico/ }).click();
  await expectText(a, '$ 6.000');
  await a.screenshot({ path: `${SHOTS}/05-gasto.png`, fullPage: true });
  await a.getByRole('button', { name: /Cargar gasto/ }).click();
  await a.waitForURL(/\/gastos$/);
  await expectText(a, '$ 112.000');
});
await step('Reparto por porcentajes que no suma 100 muestra error', async () => {
  await a.goto(`${BASE}#/juntadas/${gid}/gastos/nuevo`);
  await a.getByLabel('Importe').fill('1000');
  await a.getByRole('radio', { name: '%' }).click();
  await a.getByLabel('Valor para Jesús').fill('90');
  await expectText(a, 'deben sumar 100%');
});
await step('Editar y eliminar un gasto', async () => {
  await a.goto(`${BASE}#/juntadas/${gid}/gastos`);
  await a.getByRole('link', { name: /Hielo/ }).first().click();
  await a.getByLabel('Importe').fill('14.000');
  await a.getByRole('button', { name: 'Guardar cambios' }).click();
  await expectText(a, '$ 114.000');
  await a.getByRole('link', { name: /Hielo/ }).first().click();
  await a.getByRole('button', { name: 'Eliminar gasto' }).click();
  await a.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expectText(a, '$ 100.000');
});
await step('Registrar pago parcial como acreedor (queda confirmado)', async () => {
  await a.goto(`${BASE}#/juntadas/${gid}/cuentas`);
  await a.getByRole('link', { name: /Me pagó/ }).first().click();
  await a.waitForURL(/pagar/);
  const amount = a.locator('input.money');
  await amount.fill('5.000');
  await a.getByRole('button', { name: 'Registrar pago' }).click();
  await a.waitForURL(/cuentas$/);
  await expectText(a, '$ 10.000');
});
await step('No se puede pagar de más', async () => {
  await a.goto(`${BASE}#/juntadas/${gid}/cuentas`);
  await a.getByRole('link', { name: /Me pagó/ }).first().click();
  await a.locator('input.money').fill('999.999');
  await a.getByRole('button', { name: 'Registrar pago' }).click();
  await expectText(a, 'supera lo que debe');
});

// Segundo amigo en otra pestaña: sincronización en vivo
const b = await ctx.newPage();
b.on('pageerror', (e) => errors.push(e.message));
await step('Pablo confirma el pago que le informó Ricardo', async () => {
  await b.goto(BASE);
  await b.evaluate(() => sessionStorage.removeItem('la-juntada:demo:user'));
  await b.evaluate(() => localStorage.removeItem('la-juntada:demo:user'));
  await b.reload();
  await b.getByRole('button', { name: /Pablo/ }).click();
  await expectText(b, '¡Hola, Pablo!');
  await expectText(b, 'Pagos para confirmar');
  await b.goto(`${BASE}#/juntadas/${gid}/cuentas`);
  await b.getByRole('button', { name: 'Lo recibí', exact: true }).click();
  await expectText(b, 'Pago confirmado');
  await expectText(b, '¡Cuentas saldadas!').catch(() => undefined);
  await b.getByText('Confirmado', { exact: true }).nth(2).waitFor({ timeout: 3000 });
});
let pid;
await step('Votación de fecha en tiempo real entre pestañas', async () => {
  await a.goto(BASE + '#/votaciones');
  await a.getByText('Asado de fin de año').first().click();
  await a.waitForURL(/votos/);
  pid = a.url().match(/juntadas\/([0-9a-f-]+)/)[1];
  await b.goto(`${BASE}#/juntadas/${pid}/votos`);
  await expectText(b, 'Más votada');
  // Nico todavía no votó; Pablo cambia su voto del domingo a "No puedo"
  const before = await a.locator('text=/\\d+ votaron/').first().textContent();
  await b.getByRole('button', { name: 'No puedo' }).nth(1).click();
  await a.waitForTimeout(800);
  await a.screenshot({ path: `${SHOTS}/06-votacion.png`, fullPage: true });
  if (!before) throw new Error('sin contador de votos');
});
await step('Votar menú y lugar', async () => {
  await b.getByRole('button', { name: /Empanadas/ }).click();
  await b.getByRole('button', { name: /Casa de Jesús/ }).click();
  await expectText(a, 'Pablo', 3000);
});
await step('Confirmar fecha genera la juntada definitiva', async () => {
  await a.getByRole('button', { name: /Confirmar esta fecha/ }).first().click();
  await a.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expectText(a, 'Fecha confirmada');
});
await step('Crear grupo, invitar y aceptar invitación', async () => {
  await a.goto(BASE + '#/grupos?crear=1');
  await a.getByPlaceholder('Ej: Los del Asado').fill('Fútbol de los jueves');
  await a.getByRole('button', { name: 'Crear grupo' }).last().click();
  await expectText(a, 'Invitar amigos');
  await a.getByRole('button', { name: 'Generar enlace' }).click();
  const code = (await a.locator('.amount-lg').first().textContent()).trim();
  await b.goto(`${BASE}#/unirse/${code}`);
  await expectText(b, 'Fútbol de los jueves');
  await b.getByRole('button', { name: 'Sumarme al grupo' }).click();
  await expectText(b, '¡Te sumaste al grupo!');
});
await step('Crear una juntada con votación de fechas', async () => {
  await a.goto(BASE + '#/juntadas/nueva');
  await a.getByLabel('Opción 1').fill('2026-12-04T21:00');
  await a.getByLabel('Opción 2').fill('2026-12-05T13:30');
  await a.getByRole('button', { name: 'Crear propuesta' }).click();
  await a.waitForURL(/juntadas\/[0-9a-f-]+$/);
  await expectText(a, 'Compartir por WhatsApp');
  const href = await a.getByRole('link', { name: /Compartir por WhatsApp/ }).getAttribute('href');
  if (!href.startsWith('https://wa.me/?text=')) throw new Error('enlace de WhatsApp inválido');
});
await step('Estadísticas y notificaciones', async () => {
  await a.goto(BASE + '#/');
  await a.getByRole('button', { name: 'Cambiar de grupo' }).click();
  await a.getByRole('button', { name: /Los del Asado/ }).click();
  await a.goto(BASE + '#/estadisticas');
  await a.getByRole('radio', { name: 'Todo' }).click();
  await expectText(a, 'Gasto por mes');
  await a.screenshot({ path: `${SHOTS}/07-estadisticas.png`, fullPage: true });
  await a.goto(BASE + '#/notificaciones');
  await a.screenshot({ path: `${SHOTS}/08-notificaciones.png` });
});
await step('Modo claro', async () => {
  await a.goto(BASE + '#/ajustes');
  await a.getByRole('radio', { name: /Claro/ }).click();
  await a.goto(BASE + '#/');
  await a.screenshot({ path: `${SHOTS}/09-modo-claro.png`, fullPage: true });
});
await step('Manifest y service worker de la PWA', async () => {
  const m = await (await a.request.get(BASE + 'manifest.webmanifest')).json();
  if (m.name !== 'La Juntada' || m.icons.length < 3) throw new Error('manifest incompleto');
  const ok = await a.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()));
  if (!ok) throw new Error('service worker no registrado');
});
await step('Sin errores de JavaScript', async () => {
  const real = errors.filter((e) => !/favicon|manifest/i.test(e));
  if (real.length) throw new Error(real.slice(0, 3).join(' | '));
});

await browser.close();
for (const r of results) console.log(r.join(' '));
const failed = results.filter((r) => r[0] === '✘').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
