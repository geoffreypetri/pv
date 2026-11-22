// Vérifie que la liste des fichiers mis en cache par le service worker est complète et valide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sw = readFileSync(new URL('sw.js', root), 'utf8');
const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('chaque fichier de SHELL existe', () => {
  for (const f of shell) if (f !== './') assert.ok(existsSync(new URL(f, root)), `manquant : ${f}`);
});

test('tous les fichiers js/ et css/ sont dans SHELL', () => {
  for (const dir of ['js', 'css']) {
    for (const f of readdirSync(new URL(dir + '/', root))) assert.ok(shell.includes(`${dir}/${f}`), `${dir}/${f} absent de SHELL dans sw.js`);
  }
});

test('les icônes du manifeste sont dans SHELL', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', root), 'utf8'));
  for (const i of manifest.icons) assert.ok(shell.includes(i.src), i.src);
});

test('version.js : semver et date valides, présente dans le CHANGELOG', () => {
  const v = readFileSync(new URL('version.js', root), 'utf8');
  const version = v.match(/version:\s*'(\d+\.\d+\.\d+)'/)?.[1];
  const date = v.match(/date:\s*'(\d{4}-\d{2}-\d{2})'/)?.[1];
  assert.ok(version && date);
  const changelog = readFileSync(new URL('CHANGELOG.md', root), 'utf8');
  assert.match(changelog, new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\] - `, 'm'), 'version absente du CHANGELOG');
});
