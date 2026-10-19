import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

// No SPA fallback or cross-origin isolation headers: this is a static project
// site under an arbitrary repository prefix, like GitHub Pages.
test('the production site and Python worker work under a GitHub Pages repository path', async ({ page }) => {
  const prefix = '/repository-name-test/';
  const root = fileURLToPath(new URL('../../dist/', import.meta.url));
  const mime: Record<string, string> = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json',
    '.svg': 'image/svg+xml', '.zip': 'application/zip',
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
      const path = resolve(root, pathname.slice(prefix.length) || 'index.html');
      if (!path.startsWith(resolve(root) + sep)) { response.writeHead(404).end(); return; }
      const content = await readFile(path);
      response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream' });
      response.end(content);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const url = origin + prefix;
    const requests: string[] = [];
    const errors: string[] = [];
    page.on('request', request => requests.push(request.url()));
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });

    await page.goto(url);
    await page.getByRole('button', { name: 'Record run', exact: true }).click();
    await page.getByRole('button', { name: 'Last step', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Returned 2');
    await expect(page.getByTestId('array-cell')).toHaveText(['5', '6', '7', '1', '2', '3', '4']);
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
    expect(requests.some(request => request.endsWith('/pyodide/pyodide.asm.wasm'))).toBe(true);
    expect(requests.every(request => request.startsWith(url))).toBe(true);

    await page.getByRole('link', { name: 'Array Stepper home' }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('button', { name: 'Record run', exact: true })).toBeEnabled();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Record run', exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
});
