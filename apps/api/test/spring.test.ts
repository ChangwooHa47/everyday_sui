import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import { buildApp } from '../src/app.js';
import { hash } from '../src/auth.js';
import { migration } from '../src/database.js';

const headers = { origin: 'https://web.example', authorization: `Bearer ${'a'.repeat(43)}` };

async function fixture(t: TestContext) {
  const upstream = { status: 429, body: '{"error":"RATE_LIMITED"}', retryAfter: '17' as string | undefined,
    contentType: 'application/json', disconnect: false };
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, headers.authorization);
    assert.equal(request.headers.origin, headers.origin);
    if (upstream.disconnect) { request.socket.destroy(); return; }
    response.statusCode = upstream.status;
    response.setHeader('Content-Type', upstream.contentType);
    if (upstream.retryAfter !== undefined) response.setHeader('Retry-After', upstream.retryAfter);
    response.end(upstream.body);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const db = new PGlite();
  await db.exec(migration);
  await db.query("INSERT INTO wallet_sessions VALUES($1,$2,$3,now()+interval '30 minutes')",
    [hash('a'.repeat(43)), `0x${'a'.repeat(64)}`, headers.origin]);
  const app = buildApp(false, { db,
    auth: { origins: [headers.origin], audience: 'https://api.example', network: 'testnet' },
    springUrl: `http://127.0.0.1:${address.port}` });
  t.after(async () => {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.close();
  });
  return { app, upstream };
}

test('gateway preserves JSON auth-quota errors and only bounded canonical Retry-After seconds', async t => {
  const { app, upstream } = await fixture(t);
  for (const retryAfter of ['1', '17', '60', undefined, '0', '61', '01', '-1', '1.5', '9999999999', '1, 2', 'Fri, 01 Jan 2038 00:00:00 GMT']) {
    upstream.retryAfter = retryAfter;
    const response = await app.inject({ url: '/api/me', headers });
    assert.equal(response.statusCode, 429);
    assert.deepEqual(response.json(), { error: 'RATE_LIMITED' });
    assert.equal(response.headers['retry-after'], ['1', '17', '60'].includes(retryAfter ?? '') ? retryAfter : undefined);
  }
});

test('gateway does not advertise retry delays for ordinary responses or hide upstream failures', async t => {
  const { app, upstream } = await fixture(t);
  for (const status of [200, 401, 503]) {
    upstream.status = status;
    upstream.body = status === 200 ? '{"success":true}' : '{"error":"AUTH_SERVICE_UNAVAILABLE"}';
    const response = await app.inject({ url: '/api/me', headers });
    assert.equal(response.statusCode, status);
    assert.deepEqual(response.json(), JSON.parse(upstream.body));
    assert.equal(response.headers['retry-after'], undefined);
  }
  upstream.status = 429;
  upstream.contentType = 'text/html';
  upstream.body = '<html>PRIVATE_PROVIDER_DETAILS</html>';
  const malformed = await app.inject({ url: '/api/me', headers });
  assert.equal(malformed.statusCode, 502);
  assert.deepEqual(malformed.json(), { error: 'SERVICE_UNAVAILABLE' });
  assert.equal(malformed.headers['retry-after'], undefined);
  upstream.disconnect = true;
  const disconnected = await app.inject({ url: '/api/me', headers });
  assert.equal(disconnected.statusCode, 503);
  assert.deepEqual(disconnected.json(), { error: 'SERVICE_UNAVAILABLE' });
  assert.equal(disconnected.headers['retry-after'], undefined);
});
