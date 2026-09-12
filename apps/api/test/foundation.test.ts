import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';

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
