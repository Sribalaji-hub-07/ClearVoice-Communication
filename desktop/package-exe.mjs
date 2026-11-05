// Produces release/clearvoice-win32-x64/ClearVoice.exe. Run through `npm run package:exe`
// so dist/ is rebuilt first - the packaged app serves exactly what is in dist/.
import { packager } from '@electron/packager';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

// The runtime needs dist/, server/, desktop/main.cjs, README.md, package.json and the production
// node_modules. Everything else is source the build already consumed.
const dropTopLevel = new Set(['docs', 'tools', 'src', 'release', '.git', '.qoder', 'visualizations']);
const dropExact = new Set([
  '/.gitignore',
  '/.env.example',
  '/index.html',
  '/tsconfig.json',
  '/vite.config.ts',
  '/render.yaml',
  '/desktop/package-exe.mjs',
]);

// Packager hands the predicate a POSIX path relative to the project root, with a leading slash,
// and drops the file when this returns true. Supplying a function also disables its default
// ignore list, so package-lock, .git and node_modules/.bin are handled here.
function shouldDrop(relPath) {
  const segments = relPath.split('/').filter(Boolean);
  if (!segments.length) return false;
  if (dropTopLevel.has(segments[0])) return true;
  if (dropExact.has(relPath)) return true;
  if (relPath === '/package-lock.json') return true;
  if (relPath.startsWith('/node_modules/.bin/')) return true;
  return false;
}

const [appDir] = await packager({
  dir: root,
  out: path.join(root, 'release'),
  appName: 'ClearVoice',
  executableName: 'ClearVoice',
  appVersion: '1.0.0',
  platform: 'win32',
  arch: 'x64',
  overwrite: true,
  asar: false,
  prune: true,
  ignore: shouldDrop,
});

console.log(`[clearvoice-desktop] packaged: ${appDir}`);
