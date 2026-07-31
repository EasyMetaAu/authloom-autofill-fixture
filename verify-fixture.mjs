import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = path.dirname(new URL(import.meta.url).pathname);
const html = fs.readFileSync(path.join(root, 'index.html'));
assert(!html.includes('authloom-synthetic-password'));

let server;
let fixtureURL = process.env.AUTHLOOM_FIXTURE_URL;
if (!fixtureURL) {
  server = http.createServer((request, response) => {
    const fixturePath = new URL(request.url, 'http://127.0.0.1').pathname;
    response.writeHead(fixturePath === '/' ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(fixturePath === '/' ? html : 'not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  fixtureURL = `http://127.0.0.1:${server.address().port}/`;
}

const browser = await chromium.launch({
  executablePath: process.env.AUTHLOOM_CHROMIUM_EXECUTABLE ?? '/Applications/Chromium.app/Contents/MacOS/Chromium',
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.goto(fixtureURL);
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

  const requestedRunID = '00112233-4455-6677-8899-aabbccddeeff';
  const requestedURL = new URL(fixtureURL);
  requestedURL.searchParams.set('run', requestedRunID);
  await page.goto(requestedURL.href);
  assert.equal(await page.locator('#run-id').textContent(), requestedRunID);
  const requestedDigest = crypto.createHash('sha256').update(`authloom-f0i:${requestedRunID}`).digest('base64url');
  await page.locator('#username').fill(`authloom+${requestedRunID}@example.test`);
  await page.locator('#password').fill(`A1!${requestedDigest.slice(0, 24)}`);
  await page.locator('#login button').click();
  await page.locator('#result').filter({ hasText: `AUTHLOOM_AUTOFILL_OK:${requestedRunID}` }).waitFor();
  await page.locator('#result').filter({ hasText: 'AUTHLOOM_AUTOFILL_SCRUBBED' }).waitFor();
  assert.equal(await page.locator('#username').inputValue(), '');
  assert.equal(await page.locator('#password').inputValue(), '');
  assert.equal(page.url(), requestedURL.href);
} finally {
  await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
