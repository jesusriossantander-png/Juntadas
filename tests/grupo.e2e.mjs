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
await step('Crear el grupo sube lo que ya estaba', async () => {
  await a.getByRole('button', { name: 'Ajustes' }).click();
  await a.getByPlaceholder('Nombre del grupo').fill('Los del asado');
  await a.getByRole('button', { name: 'Crear grupo' }).click();
  await see(a, 'Grupo: Los del asado');
  const href = await a.getByRole('link', { name: 'Invitar' }).getAttribute('href');
  link = decodeURIComponent(href).match(/https?:\/\/\S+\?g=[a-z0-9]{12}/)[0];
  await a.screenshot({ path: `${SHOTS}/grupo-ajustes.png`, fullPage: true });
});
await step('El amigo abre el link y ve el mismo registro', async () => {
  await b.goto(link);
  await see(b, '¡Te sumaste al grupo!');
  await b.getByRole('button', { name: 'Registro' }).click();
  await see(b, '$ 40.000');
  if (b.url().includes('?g=')) throw new Error('el código quedó en la barra de direcciones');
});
await step('Lo que carga uno le aparece al otro en vivo', async () => {
  await b.getByRole('button', { name: 'Calcular' }).click();
  await b.getByRole('button', { name: 'Jesús', exact: false }).first().click();
  await b.getByRole('button', { name: 'Pablo', exact: false }).first().click();
  await b.getByLabel('Bebida de Pablo').fill('12.000');
  await b.getByRole('button', { name: 'Guardar', exact: true }).click();
  await see(b, '$ 12.000');
  await a.getByRole('button', { name: 'Registro' }).click();
  await see(a, '$ 12.000', 10000);
});
await step('Los días de aviso son los mismos para todos', async () => {
  await a.getByRole('button', { name: 'Ajustes' }).click();
  await a.getByRole('radio', { name: '15 días' }).click();
  await a.waitForTimeout(800);
  await b.reload();
  await b.getByRole('button', { name: 'Ajustes' }).click();
  const on = await b.getByRole('radio', { name: '15 días' }).getAttribute('aria-checked');
  if (on !== 'true') throw new Error('no se compartió');
});
await step('Borrar en un celular lo borra para todos', async () => {
  await b.getByRole('button', { name: 'Registro' }).click();
  await b.getByRole('button', { name: /\$ 12\.000/ }).first().click().catch(() => {});
  const cards = b.locator('.card').filter({ hasText: '$ 12.000' });
  await cards.first().getByRole('button', { name: 'Borrar', exact: true }).click().catch(async () => {
    await cards.first().locator('button[aria-expanded]').click();
    await cards.first().getByRole('button', { name: 'Borrar', exact: true }).click();
  });
  await b.getByRole('dialog').getByRole('button', { name: 'Borrar' }).click();
  await a.getByRole('button', { name: 'Registro' }).click();
  await a.waitForTimeout(2500);
  if (await a.getByText('$ 12.000').filter({ visible: true }).count()) throw new Error('sigue apareciendo');
  await a.screenshot({ path: `${SHOTS}/grupo-registro.png`, fullPage: true });
});
await step('Salir del grupo vuelve a lo del celular', async () => {
  await b.getByRole('button', { name: 'Ajustes' }).click();
  await b.getByRole('button', { name: 'Salir del grupo' }).click();
  await b.getByRole('dialog').getByRole('button', { name: 'Salir' }).click();
  await see(b, 'Compartir con los amigos');
});
await step('Sin errores de JavaScript', async () => { const e = [...a.errores, ...b.errores]; if (e.length) throw new Error(e.join(' | ')); });
await browser.close();
for (const r of res) console.log(r.join(' '));
const f = res.filter((r) => r[0] === '✘').length;
console.log(`\n${res.length - f}/${res.length} pasos OK`);
process.exit(f ? 1 : 0);
