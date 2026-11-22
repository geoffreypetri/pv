// Génère les icônes PNG à partir de icons/icon.svg (outil de développement, nécessite Playwright).
// Usage : node scripts/make-icons.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const svg = readFileSync(new URL('../icons/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();

async function render(size, file, maskable = false) {
  await page.setViewportSize({ width: size, height: size });
  // Icône « maskable » : fond plein et contenu dans la zone sûre (80 %).
  const inner = maskable
    ? `<div style="width:${size}px;height:${size}px;background:#18181b;display:flex;align-items:center;justify-content:center">
         <div style="width:${size * 0.8}px;height:${size * 0.8}px">${svg.replace('rx="112"', 'rx="0"')}</div></div>`
    : svg;
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:100%;height:100%;display:block}</style>
    <div style="width:${size}px;height:${size}px">${inner}</div>`);
  await page.screenshot({ path: new URL(`../icons/${file}`, import.meta.url).pathname, omitBackground: !maskable });
  console.log('icons/' + file);
}

await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'icon-maskable-512.png', true);
await browser.close();
