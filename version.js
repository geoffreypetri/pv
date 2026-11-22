// Seule source de vérité de la version de l'application.
// Mis à jour par `node scripts/release.mjs <patch|minor|major>`.
// Script classique (pas un module) : chargé par index.html ET par sw.js (importScripts).
self.APP_VERSION = { version: '0.1.0', date: '2026-11-22' };
