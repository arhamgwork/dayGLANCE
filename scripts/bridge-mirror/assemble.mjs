#!/usr/bin/env node
// Assembles the public mirror of the bridge plugin, glance-apps/dayglance-bridge,
// from this repository. The plugin is developed here, beside the app and the
// shared packages it is tested against; the mirror is what Obsidian's community
// directory and BRAT read: manifest.json at the root, source that builds on its
// own, and GitHub releases.
//
//   node scripts/bridge-mirror/assemble.mjs <out-dir>
//
// The tree it writes:
//   - the plugin (dayglance-obsidian-plugin/) at the root, without its test/
//     (the bridge scenario harness drives the app's own sync hook, so it only
//     runs here) and without build output, installed modules or the lockfile
//     (the workflow regenerates the lockfile for the mirror's paths);
//   - the shared packages it bundles under packages/, so the mirror builds
//     without anything published to npm;
//   - package.json with the file: links pointed at those copies;
//   - the mirror-only files in dayglance-obsidian-plugin/mirror/ (the release
//     workflow, .gitignore) at the root.
// The mirror's LICENSE is its own and is never written from here.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_DIR = 'dayglance-obsidian-plugin';
export const MIRROR_ONLY_DIR = 'mirror';
// Shared packages the plugin bundles; each is copied whole, minus installs.
export const PACKAGES = ['agenda-core', 'obsidian-format'];
// Never copied from the plugin directory into the mirror.
export const PLUGIN_EXCLUDES = new Set(['test', 'node_modules', 'main.js', 'package-lock.json', MIRROR_ONLY_DIR]);

/**
 * The plugin's package.json as the mirror needs it: every `file:../packages/x`
 * dependency points at the copy under ./packages/x instead. Throws on a file:
 * link to anything that is not one of the copied packages, since the mirror
 * could not build with it.
 */
export function mirrorPackageJson(pkg) {
  const out = structuredClone(pkg);
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [name, spec] of Object.entries(out[field] ?? {})) {
      if (typeof spec !== 'string' || !spec.startsWith('file:')) continue;
      const m = /^file:\.\.\/packages\/([^/]+)\/?$/.exec(spec);
      if (!m || !PACKAGES.includes(m[1])) {
        throw new Error(`${name}: ${spec} is a file: link the mirror cannot resolve`);
      }
      out[field][name] = `file:./packages/${m[1]}`;
    }
  }
  return out;
}

const skipInstalls = (src) => !/[\\/]node_modules([\\/]|$)/.test(src);

export function assemble(repoRoot, outDir) {
  const pluginRoot = join(repoRoot, PLUGIN_DIR);
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  for (const entry of readdirSync(pluginRoot)) {
    if (PLUGIN_EXCLUDES.has(entry) || entry.endsWith('.zip')) continue;
    cpSync(join(pluginRoot, entry), join(outDir, entry), { recursive: true, filter: skipInstalls });
  }

  const pkg = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'));
  writeFileSync(join(outDir, 'package.json'), JSON.stringify(mirrorPackageJson(pkg), null, 2) + '\n');

  for (const name of PACKAGES) {
    cpSync(join(repoRoot, 'packages', name), join(outDir, 'packages', name), { recursive: true, filter: skipInstalls });
  }

  cpSync(join(pluginRoot, MIRROR_ONLY_DIR), outDir, { recursive: true });
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error('usage: node scripts/bridge-mirror/assemble.mjs <out-dir>');
    process.exit(2);
  }
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  assemble(repoRoot, resolve(outDir));
  console.log(`Assembled the bridge mirror in ${resolve(outDir)}`);
}
