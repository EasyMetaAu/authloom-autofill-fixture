import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const nodeModules = process.env.AUTHLOOM_NODE_MODULES;
assert(nodeModules, 'AUTHLOOM_NODE_MODULES must point to a node_modules directory containing playwright');
const { chromium } = require(path.join(nodeModules, 'playwright'));

const root = path.dirname(new URL(import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, 'index.html'));
assert(!html.includes('authloom-synthetic-password'));

const server = http.createServer((request, response) => {
  response.writeHead(request.url === '/' ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(request.url === '/' ? html : 'not found');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

const browser = await chromium.launch({
  executablePath: process.env.AUTHLOOM_CHROMIUM_EXECUTABLE ?? '/Applications/Chromium.app/Contents/MacOS/Chromium',
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(await page.locator('meta[name="authloom-fixture-version"]').getAttribute('content'), '1');

  const runID = await page.locator('#run-id').textContent();
  assert.match(runID, /^[0-9a-f-]{36}$/);
  const digest = crypto.createHash('sha256').update(`authloom-f0i:${runID}`).digest('base64url');
  await page.locator('#username').fill(`authloom+${runID}@example.test`);
  await page.locator('#password').fill(`A1!${digest.slice(0, 24)}`);
  await page.locator('#login button').click();
  await page.locator('#result').filter({ hasText: `AUTHLOOM_AUTOFILL_OK:${runID}` }).waitFor();
  await page.locator('#result').filter({ hasText: 'AUTHLOOM_AUTOFILL_SCRUBBED' }).waitFor();
  assert.equal(await page.locator('#username').inputValue(), '');
  assert.equal(await page.locator('#password').inputValue(), '');

  await page.locator('#reset').click();
  assert.notEqual(await page.locator('#run-id').textContent(), runID);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
