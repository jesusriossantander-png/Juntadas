// Genera los íconos PNG de la PWA a partir de un SVG, usando Chromium (Playwright).
// Uso: npm run icons
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('node:child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
import { writeFileSync, mkdirSync } from 'node:fs';

const flame = (stroke) => `
  <g fill="none" stroke="${stroke}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2c1.5 2.6 4.5 4.3 4.5 8a4.5 4.5 0 0 1-9 0c0-1.9.9-3.1 1.8-4.1.3 1.4 1 2.3 2 2.7C11 6.6 11.2 4.2 12 2Z"/>
    <path d="M5 21h14"/><path d="M7 17.5h10"/>
  </g>`;
const icon = (pad, radius) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7a3d"/><stop offset="1" stop-color="#ffbf47"/></linearGradient></defs>
  <rect width="512" height="512" rx="${radius}" fill="url(#g)"/>
  <g transform="translate(${pad} ${pad}) scale(${(512 - 2 * pad) / 24})">${flame('#1b0f08')}</g>
</svg>`;

const svgAny = icon(96, 112);
const svgMaskable = icon(150, 0);
const svgBadge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${flame('#ffffff')}</svg>`;

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/favicon.svg', svgAny);
writeFileSync('public/icons/icon.svg', svgAny);

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(svg, size, out, bg = 'transparent') {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:${bg}"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}"/></body></html>`);
  await page.screenshot({ path: out, omitBackground: bg === 'transparent' });
}
await render(svgAny, 192, 'public/icons/icon-192.png');
await render(svgAny, 512, 'public/icons/icon-512.png');
await render(svgMaskable, 512, 'public/icons/maskable-512.png');
await render(svgMaskable, 180, 'public/icons/apple-touch-icon.png');
await render(svgBadge, 72, 'public/icons/badge-72.png');
await browser.close();
console.log('Íconos generados en public/icons');
