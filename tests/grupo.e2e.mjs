// Dos celulares en el mismo grupo: crear, invitar por link, ver lo mismo y en vivo.
// Uso: build con VITE_SUPABASE_URL/KEY de prueba → preview en E2E_URL → node tests/grupo.e2e.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(execSync('npm root -g').toString().trim() + '/playwright'); }
const BASE = process.env.E2E_URL || 'http://localhost:4174/';
const SHOTS = process.env.E2E_SHOTS || '/tmp';
const res = [];
const step = async (n, fn) => { try { await fn(); res.push(['✔', n]); } catch (e) { res.push(['✘', n, e.message.split('\n')[0]]); } };
const see = async (p, t, timeout = 8000) => {
  try { await p.getByText(t, { exact: false }).filter({ visible: true }).first().waitFor({ timeout }); }
  catch { throw new Error(`no aparece "${t}"`); }
};
const browser = await pw.chromium.launch();
const nuevo = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-AR', colorScheme: 'dark' });
  const p = await ctx.newPage();
  p.errores = [];
  p.on('pageerror', (e) => p.errores.push(e.message));
  return p;
};
const a = await nuevo();
const b = await nuevo();
let link;

await step('Antes de crear el grupo, guarda una juntada en el celular', async () => {
  await a.goto(BASE);
  await a.getByLabel('Nombre de la persona 1').fill('Jesús');
  await a.getByLabel('Comida de Jesús').fill('40.000');
  await a.getByLabel('Nombre de la persona 2').fill('Pablo');
  await a.getByRole('button', { name: 'Guardar', exact: true }).click();
  await see(a, '$ 40.000');
});
await step('Crear el grupo sube lo que ya estaba y deja al creador como administrador', async () => {
  await a.getByRole('button', { name: 'Ajustes' }).click();
  await a.getByPlaceholder('Nombre del grupo').fill('Los del asado');
  await a.getByRole('button', { name: 'Crear grupo' }).click();
  await see(a, 'Grupo: Los del asado');
  await see(a, 'Sos el administrador');
  const href = await a.getByRole('link', { name: 'Invitar' }).getAttribute('href');
  link = decodeURIComponent(href).match(/https?:\/\/\S+\?g=[a-z0-9]{12}/)[0];
  await a.screenshot({ path: `${SHOTS}/grupo-ajustes.png`, fullPage: true });
});
await step('El amigo abre el link y ve el mismo registro, sin poder editar lo ajeno', async () => {
  await b.goto(link);
  await see(b, '¡Te sumaste al grupo!');
  await b.getByRole('button', { name: 'Registro' }).click();
  await see(b, '$ 40.000');
  await see(b, 'solo el administrador puede editarla');
  if (b.url().includes('?g=')) throw new Error('el código quedó en la barra de direcciones');
});
await step('Lo que carga uno le aparece al otro en vivo, y lo propio se puede editar', async () => {
  await b.getByRole('button', { name: 'Calcular' }).click();
  await b.getByRole('button', { name: 'Jesús', exact: false }).first().click();
  await b.getByRole('button', { name: 'Pablo', exact: false }).first().click();
  await b.getByLabel('Bebida de Pablo').fill('12.000');
  await b.getByRole('button', { name: 'Guardar', exact: true }).click();
  await see(b, '$ 12.000');
  const tarjeta = b.locator('.card').filter({ hasText: '$ 12.000' }).first();
  if (!(await tarjeta.getByRole('button', { name: 'Editar' }).count())) throw new Error('no puede editar la suya');
  await a.getByRole('button', { name: 'Registro' }).click();
  await see(a, '$ 12.000', 10000);
});
await step('Solo el administrador cambia los días del aviso', async () => {
  await b.getByRole('button', { name: 'Ajustes' }).click();
  await see(b, 'Solo el administrador del grupo puede cambiarlo');
  if (!(await b.getByLabel('Días personalizados').isDisabled())) throw new Error('el amigo puede cambiar los días');
  await a.getByRole('button', { name: 'Ajustes' }).click();
  await a.getByRole('radio', { name: '15 días' }).click();
  await a.waitForTimeout(800);
  await b.reload();
  await b.getByRole('button', { name: 'Ajustes' }).click();
  if ((await b.getByRole('radio', { name: '15 días' }).getAttribute('aria-checked')) !== 'true') throw new Error('no se compartió');
});
await step('Varios grupos: crear otro y volver al primero desde arriba', async () => {
  await b.getByRole('button', { name: 'Cambiar de grupo' }).click();
  await b.getByPlaceholder('Ej: Los del fútbol').fill('Los del fútbol');
  await b.getByRole('button', { name: 'Crear', exact: true }).click();
  await see(b, 'Grupo: Los del fútbol');
  await see(b, 'Sos el administrador');
  if ((await b.getByLabel('Días personalizados').inputValue()) !== '30') throw new Error('el grupo nuevo muestra los días del anterior');
  await b.getByRole('button', { name: 'Cambiar de grupo' }).click();
  await b.getByRole('dialog').waitFor();
  await b.waitForTimeout(400);
  await b.screenshot({ path: `${SHOTS}/grupo-selector.png` });
  await b.getByRole('dialog').getByRole('button', { name: /Los del asado/ }).click();
  await see(b, 'Grupo: Los del asado');
  await b.getByRole('button', { name: 'Registro' }).click();
  await see(b, '$ 40.000');
});
await step('Salir de un grupo pasa al otro que queda', async () => {
  await b.getByRole('button', { name: 'Ajustes' }).click();
  await b.getByRole('button', { name: 'Salir del grupo' }).click();
  await b.getByRole('dialog').getByRole('button', { name: 'Salir' }).click();
  await see(b, 'Grupo: Los del fútbol');
});
await step('Sin errores de JavaScript', async () => { const e = [...a.errores, ...b.errores]; if (e.length) throw new Error(e.join(' | ')); });
await browser.close();
for (const r of res) console.log(r.join(' '));
const f = res.filter((r) => r[0] === '✘').length;
console.log(`\n${res.length - f}/${res.length} pasos OK`);
process.exit(f ? 1 : 0);
