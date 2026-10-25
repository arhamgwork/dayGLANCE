import esbuild from 'esbuild';
import process from 'node:process';

const prod = process.argv[2] === 'production';
// The build time is stamped into dev builds (watch mode) and into a production
// build only on request (`npm run build:stamped`). A release build carries no
// stamp, so the same source always produces the same main.js, which is what
// lets Obsidian's directory verify a release against its source.
const stamp = !prod || process.argv.includes('--stamp');

// One self-contained main.js next to manifest.json — the shape Obsidian
// loads. `obsidian` (and Electron/CodeMirror internals) stay external: the
// app provides them at runtime.
const ctx = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  format: 'cjs',
  target: 'es2020',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
  // Build stamp, shown in the settings tab so a hand-copied build is
  // identifiable ("which main.js is this vault actually loading?"). Stamped
  // at BUNDLE time; in watch mode this is the watcher's start time, which is
  // close enough for dev.
  define: stamp ? { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) } : {},
});

if (prod) {
  await ctx.rebuild();
  process.exit(0);
} else {
  await ctx.watch();
}
