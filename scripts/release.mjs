// Prépare une nouvelle version : incrémente version.js et ajoute l'entrée au CHANGELOG.md.
//
// Usage :
//   node scripts/release.mjs patch "Correction de …" "Autre note"
//   node scripts/release.mjs minor            (utilise les puces de « ## [Non publié] »)
//   node scripts/release.mjs 1.4.0 "Note"     (version explicite)
//
// Puis : git commit -am "Version X.Y.Z" && git push   (le déploiement est automatique sur main)
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');
const write = (f, s) => writeFileSync(new URL(f, root), s);

const [kind, ...notes] = process.argv.slice(2);
if (!kind) {
  console.error('Usage : node scripts/release.mjs <patch|minor|major|X.Y.Z> ["note" …]');
  process.exit(1);
}

const versionJs = read('version.js');
const m = versionJs.match(/version:\s*'(\d+)\.(\d+)\.(\d+)'/);
if (!m) throw new Error('Version introuvable dans version.js');
let [maj, min, pat] = m.slice(1).map(Number);
let next;
if (kind === 'major') next = `${maj + 1}.0.0`;
else if (kind === 'minor') next = `${maj}.${min + 1}.0`;
else if (kind === 'patch') next = `${maj}.${min}.${pat + 1}`;
else if (/^\d+\.\d+\.\d+$/.test(kind)) next = kind;
else throw new Error(`Type de version inconnu : ${kind}`);

const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// CHANGELOG : reprend les puces « Non publié » + celles passées en argument.
let changelog = read('CHANGELOG.md');
if (new RegExp(`^## \\[${next.replace(/\./g, '\\.')}\\]`, 'm').test(changelog)) {
  throw new Error(`La version ${next} existe déjà dans CHANGELOG.md`);
}
const unreleased = changelog.match(/^## \[Non publié\]\s*\n([\s\S]*?)(?=^## )/m);
const pending = unreleased ? unreleased[1].split('\n').filter((l) => /^\s*[-*]\s+\S/.test(l)) : [];
const bullets = [...pending, ...notes.map((n) => `- ${n}`)];
if (!bullets.length) {
  console.error('Aucune note : ajoutez des puces sous « ## [Non publié] » ou passez-les en argument.');
  process.exit(1);
}
const entry = `## [Non publié]\n\n## [${next}] - ${today}\n${bullets.join('\n')}\n\n`;
if (unreleased) changelog = changelog.replace(unreleased[0], entry);
else changelog = changelog.replace(/^## /m, `${entry}## `);
write('CHANGELOG.md', changelog);

write('version.js', versionJs
  .replace(/version:\s*'[^']*'/, `version: '${next}'`)
  .replace(/date:\s*'[^']*'/, `date: '${today}'`));

console.log(`Version ${m.slice(1).join('.')} → ${next} (${today})`);
console.log(bullets.join('\n'));
console.log('\nÉtapes suivantes : vérifier, puis');
console.log(`  git commit -am "Version ${next}" && git push`);
