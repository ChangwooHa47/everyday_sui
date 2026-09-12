import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import { once } from 'node:events';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';

async function springProbe(t: TestContext, handler: RequestListener) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

function productApp(springUrl?: string) {
  return buildApp(false, {
    db: { async query() { return { rows: [] }; } },
    auth: { origins: ['https://web.example'], audience: 'https://api.example', network: 'testnet' },
    springUrl,
  });
}

test('foundation exposes liveness but does not impersonate a ready product API', async t => {
  const app = buildApp();
  t.after(() => app.close());
  const health = await app.inject('/health/live');
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().stage, 'foundation');
  assert.equal((await app.inject('/api/characters')).statusCode, 404);
  assert.equal((await app.inject('/health/ready')).statusCode, 404);
});

test('invalid listener configuration fails before starting a server', () => {
  for (const value of ['', '0', '65536', '3001.5', 'abc', ' 3001 ', '3e3']) {
    assert.throws(() => readConfig({ API_PORT: value }), /API_PORT/);
    assert.throws(() => readConfig({ PORT: value, API_PORT: '3001' }), /PORT/);
  }
});

test('platform PORT takes precedence and production listens on all interfaces', () => {
  assert.deepEqual(readConfig({ PORT: '8080', API_PORT: '3001' }), { port: 8080, host: '0.0.0.0' });
  assert.deepEqual(readConfig({ NODE_ENV: 'production' }), { port: 3001, host: '0.0.0.0' });
  assert.deepEqual(readConfig({ API_PORT: '4001' }), { port: 4001, host: '127.0.0.1' });
  assert.deepEqual(readConfig({}), { port: 3001, host: '127.0.0.1' });
});

test('readiness bypasses request quotas but fails closed when the database fails', async t => {
  let available = true;
  const app = buildApp(false, {
    db: { async query() { if (!available) throw Error('private database details'); return { rows: [] }; } },
    auth: { origins: ['https://web.example'], audience: 'https://api.example', network: 'testnet' },
  });
  t.after(() => app.close());
  for (let i = 0; i < 65; i++) assert.equal((await app.inject('/health/ready')).statusCode, 200);
  available = false;
  const response = await app.inject('/health/ready');
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { status: 'unavailable' });
  assert.equal((await app.inject('/health/live')).statusCode, 200);
  available = true;
  assert.equal((await app.inject('/health/ready')).statusCode, 200);
});

test('product readiness follows Spring availability and recovery while liveness stays local', async t => {
  let available = false;
  let probes = 0;
  const springUrl = await springProbe(t, (request, response) => {
    probes++;
    assert.equal(request.url, '/health/ready');
    if (!available) { request.socket.destroy(); return; }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
  });
  const app = productApp(springUrl);
  t.after(() => app.close());
  assert.equal((await app.inject('/health/live')).statusCode, 200);
  assert.equal(probes, 0);
  const unavailable = await app.inject('/health/ready');
  assert.equal(unavailable.statusCode, 503);
  assert.deepEqual(unavailable.json(), { status: 'unavailable' });
  available = true;
  const recovered = await app.inject('/health/ready');
  assert.equal(recovered.statusCode, 200);
  assert.deepEqual(recovered.json(), { status: 'ok' });
  available = false;
  assert.equal((await app.inject('/health/ready')).statusCode, 503);
  const probesBeforeLiveness = probes;
  assert.equal((await app.inject('/health/live')).statusCode, 200);
  assert.equal(probes, probesBeforeLiveness);
});

test('Spring readiness rejects invalid responses and does not follow redirects or leak response bodies', async t => {
  const cases = [
    { status: 503, body: '{"status":"ok","details":"private provider details"}' },
    { status: 200, body: 'private invalid JSON' },
    { status: 200, body: 'null' },
    { status: 200, body: '[]' },
    { status: 200, body: '{}' },
    { status: 200, body: '{"status":"unavailable"}' },
    { status: 200, body: '{"status":"ok"}', contentType: 'text/html' },
    { status: 302, body: '{"status":"ok"}' },
    { status: 200, body: JSON.stringify({ status: 'ok', details: 'x'.repeat(2048) }) },
  ];
  let fixture = cases[0];
  let redirects = 0;
  const springUrl = await springProbe(t, (request, response) => {
    if (request.url !== '/health/ready') redirects++;
    response.writeHead(fixture.status, { 'Content-Type': fixture.contentType ?? 'application/json', Location: '/redirected' });
    response.end(fixture.body);
  });
  const app = productApp(springUrl);
  t.after(() => app.close());
  for (fixture of cases) {
    const result = await app.inject('/health/ready');
    assert.equal(result.statusCode, 503, JSON.stringify(fixture));
    assert.deepEqual(result.json(), { status: 'unavailable' });
  }
  assert.equal(redirects, 0);
});

test('Spring readiness bounds a stalled response body and recovers on the next probe', async t => {
  let stalled = true;
  const springUrl = await springProbe(t, (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    if (stalled) response.write('{"status":');
    else response.end('{"status":"ok"}');
  });
  const app = productApp(springUrl);
  t.after(() => app.close());
  const start = performance.now();
  const unavailable = await app.inject('/health/ready');
  assert.equal(unavailable.statusCode, 503);
  assert.deepEqual(unavailable.json(), { status: 'unavailable' });
  assert.ok(performance.now() - start < 2500, 'stalled probe must time out within the readiness budget');
  stalled = false;
  assert.equal((await app.inject('/health/ready')).statusCode, 200);
});
