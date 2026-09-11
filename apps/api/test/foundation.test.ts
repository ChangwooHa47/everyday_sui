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
  for (const value of ['', '0', '65536', '3001.5', 'abc']) {
    assert.throws(() => readConfig({ API_PORT: value }), /API_PORT/);
  }
});
