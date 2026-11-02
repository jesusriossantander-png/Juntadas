// Prueba de punta a punta con Playwright en pantalla de celular.
// Uso: npm run build && npx vite preview --port 4173 &  →  npm run test:e2e
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(execSync('npm root -g').toString().trim() + '/playwright'); }

const BASE = process.env.E2E_URL || 'http://localhost:4173/';
const SHOTS = process.env.E2E_SHOTS || '/tmp';
const results = [];
const step = async (n, fn) => { try { await fn(); results.push(['✔', n]); } catch (e) { results.push(['✘', n, e.message.split('\n')[0]]); } };
const see = async (p, t, timeout = 4000) => {
  try { await p.getByText(t, { exact: false }).filter({ visible: true }).first().waitFor({ timeout }); }
  catch { throw new Error(`no aparece "${t}"`); }
};

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-AR', colorScheme: 'dark' });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));

await step('Abre la calculadora', async () => {
  await p.goto(BASE);
  await see(p, '¿Quién puso cuánto?');
});
await step('Compraron tres, se divide entre cuatro', async () => {
  const nombres = ['Jesús', 'Pablo', 'Ricardo'];
  const montos = ['50.000', '30000', '20.000'];
  for (let i = 0; i < 3; i++) {
    await p.getByLabel(`Nombre de la persona ${i + 1}`).fill(nombres[i]);
    await p.getByLabel(`Comida de ${nombres[i]}`).fill(montos[i]);
  }
  await p.getByRole('button', { name: 'Agregar', exact: true }).click();
  await p.getByLabel('Nombre de la persona 4').fill('Nico');
  await see(p, '$ 100.000');
  await see(p, '$ 25.000 c/u');
  const txt = await p.getByLabel('Resultado').innerText();
  if (!/Nico\s*Jesús\s*\$ 25\.000/.test(txt.replace(/\n/g, ' ').replace(/\s+/g, ' ').replace(/ → /g, ' '))) {
    if (!(txt.includes('Nico') && txt.includes('$ 25.000') && txt.includes('Ricardo') && txt.includes('$ 5.000'))) throw new Error('transferencias incorrectas: ' + txt);
  }
  await p.screenshot({ path: `${SHOTS}/calc.png`, fullPage: true });
});
await step('Alguien que compró y no entra recupera lo suyo', async () => {
  await p.getByLabel('Cuánto estuvo Ricardo').selectOption('0'); // Ricardo no entra
  await see(p, '$ 33.333,33'); // sus $20.000 siguen en el total: 100.000 / 3 (Jesús, Pablo y Nico)
  await p.getByLabel('Cuánto estuvo Ricardo').selectOption('100');
  await see(p, '$ 25.000 c/u');
});
await step('Compartir por WhatsApp arma el mensaje', async () => {
  const href = await p.getByRole('link', { name: /Mandar cuentas por WhatsApp/ }).getAttribute('href');
  const t = decodeURIComponent(href.split('text=')[1]);
  if (!t.includes('Nico le pasa $ 25.000 a Jesús')) throw new Error(t);
});
await step('Guardar en el registro y persistir al recargar', async () => {
  await p.getByRole('button', { name: 'Guardar', exact: true }).click();
  await see(p, '¡Juntada guardada');
  await see(p, 'Registro');
  await p.reload();
  await p.getByRole('button', { name: 'Registro' }).click();
  await see(p, '$ 100.000');
  await p.screenshot({ path: `${SHOTS}/registro.png`, fullPage: true });
});
await step('Los amigos quedan para cargarlos rápido', async () => {
  await p.getByRole('button', { name: 'Calcular' }).click();
  await p.getByRole('button', { name: 'Todos' }).click();
  if ((await p.getByLabel(/Nombre de la persona/).count()) !== 4) throw new Error('no se agregaron los 4 amigos');
  await p.getByRole('button', { name: 'Limpiar' }).click();
  await p.getByRole('button', { name: 'Sí', exact: true }).click();
});
await step('Editar una juntada guardada', async () => {
  await p.getByRole('button', { name: 'Registro' }).click();
  await p.getByRole('button', { name: 'Editar' }).click();
  await see(p, 'Editar juntada');
  await p.getByLabel('Comida de Nico').fill('4.000');
  await p.getByRole('button', { name: 'Guardar cambios' }).click();
  await see(p, '$ 104.000');
});
await step('Aviso si hace mucho que no se juntan', async () => {
  await p.evaluate(() => {
    const k = 'la-juntada:datos:v1';
    const d = JSON.parse(localStorage.getItem(k));
    d.juntadas.forEach((j) => (j.fecha = '2026-01-10'));
    localStorage.setItem(k, JSON.stringify(d));
  });
  await p.reload();
  await see(p, 'que no se juntan');
  await p.screenshot({ path: `${SHOTS}/aviso.png` });
});
await step('Cambiar la frecuencia del aviso', async () => {
  await p.getByRole('button', { name: 'Ajustes' }).click();
  await p.getByLabel('Días personalizados').fill('365');
  await p.getByRole('button', { name: 'Calcular' }).click();
  if (await p.getByText('que no se juntan').count()) throw new Error('el aviso no respeta la frecuencia');
});
await step('Editar no muestra Compartir ni Borrar en el registro', async () => {
  await p.getByRole('button', { name: 'Registro' }).click();
  if (await p.getByRole('button', { name: 'Borrar', exact: true }).count()) throw new Error('sigue el botón Borrar');
  if (await p.getByRole('link', { name: 'Compartir' }).count()) throw new Error('sigue el botón Compartir');
});
await step('El que no toma no paga el alcohol y el que estuvo un rato paga menos', async () => {
  await p.getByRole('button', { name: 'Calcular' }).click();
  if (await p.getByLabel(/Nombre de la persona/).count()) { await p.getByRole('button', { name: 'Limpiar' }).click(); await p.getByRole('button', { name: 'Sí', exact: true }).click(); }
  for (const n of ['Jesús', 'Pablo', 'Nico']) await p.getByRole('button', { name: n, exact: false }).first().click();
  await p.getByLabel('Comida de Jesús').fill('60.000');
  await p.getByLabel('Bebida de Pablo').fill('20.000');
  await p.getByLabel('Nico toma').uncheck();
  // comida 60.000 / 3 = 20.000 · alcohol 20.000 entre Jesús y Pablo
  const tag = async (n) => { const t = p.locator('.tag-persona').filter({ has: p.locator(`input[value="${n}"]`) }); return (await t.innerText()); };
  if (!(await tag('Nico')).includes('Debe $ 20.000')) throw new Error('Nico: ' + (await tag('Nico')));
  await p.getByLabel('Cuánto estuvo Nico').selectOption('50');
  // comida 60.000 en 100+100+50 → Nico 12.000
  if (!(await tag('Nico')).includes('Debe $ 12.000')) throw new Error('Nico 50%: ' + (await tag('Nico')));
  const href = await p.getByRole('link', { name: /Mandar cuentas por WhatsApp/ }).getAttribute('href');
  const t = decodeURIComponent(href.split('text=')[1]);
  if (!t.includes('No toman (no pagan bebida): Nico') || !t.includes('Nico (50%)') || t.includes('A cada uno le toca')) throw new Error(t);
  await p.screenshot({ path: `${SHOTS}/alcohol.png`, fullPage: true });
});
await step('Funciona sin internet (instalable)', async () => {
  await p.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 8000 });
  await p.reload();
  await ctx.setOffline(true);
  await p.reload();
  await see(p, 'La Juntada');
  await ctx.setOffline(false);
});
await step('Sin errores de JavaScript', async () => { if (errors.length) throw new Error(errors.join(' | ')); });
await browser.close();
for (const r of results) console.log(r.join(' '));
const f = results.filter((r) => r[0] === '✘').length;
console.log(`\n${results.length - f}/${results.length} pasos OK`);
process.exit(f ? 1 : 0);
