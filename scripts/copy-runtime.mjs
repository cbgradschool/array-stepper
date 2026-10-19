import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Copy the locked npm runtime, not a CDN version. Vite serves these files
// unchanged in development and copies them into the static build.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'node_modules/pyodide');
const target = resolve(root, 'public/pyodide');
await mkdir(target, { recursive: true });
for (const name of await readdir(source)) {
  if (/\.(mjs|js|wasm|zip|json|map)$/.test(name) && name !== 'package.json') {
    await copyFile(resolve(source, name), resolve(target, name));
  }
}
console.log('Local Python runtime ready in public/pyodide/');
