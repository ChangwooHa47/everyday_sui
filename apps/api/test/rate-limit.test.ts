import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import type { FastifyRequest } from 'fastify';
import { buildApp } from '../src/app.js';
import { authenticate, hash } from '../src/auth.js';
import { migration, type Database } from '../src/database.js';

const origin = 'https://web.example';
const auth = { origins: [origin, 'https://other.example'], audience: 'https://api.example', network: 'testnet' as const };
const headers = (token = 'a') => ({ origin, authorization: `Bearer ${token.repeat(43)}` });

async function fixture(t: TestContext) {
  const db = new PGlite();
  await db.exec(migration);
  for (const [token, address] of [['a', 'a'], ['b', 'b'], ['c', 'a']]) {
    await db.query("INSERT INTO wallet_sessions VALUES($1,$2,$3,now()+interval '30 minutes')",
      [hash(token.repeat(43)), `0x${address.repeat(64)}`, origin]);
  }
  let sessionReads = 0;
  const observed: Database = {
    async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]) {
      if (sql.startsWith('SELECT address FROM wallet_sessions')) sessionReads++;
      return db.query<T>(sql, params);
    },
  };
  const app = buildApp(false, { db: observed, auth });
  t.after(async () => { await app.close(); await db.close(); });
  return { db, observed, app, reads: () => sessionReads };
}

test('wallet quotas run at 120 requests and share one session lookup with each handler', async t => {
  const { app, reads } = await fixture(t);
  for (let i = 0; i < 120; i++) {
    const response = await app.inject({ url: '/v1/me', headers: headers() });
    assert.equal(response.statusCode, 200);
    assert.equal(Number(response.headers['x-ratelimit-remaining']), 119 - i);
    assert.equal(reads(), i + 1, 'quota identity and route identity must use one successful lookup');
  }
  const limited = await app.inject({ url: '/v1/me', headers: headers() });
  assert.equal(limited.statusCode, 429);
  assert.ok(Number(limited.headers['retry-after']) > 0);
  // A different session for the same wallet does not create a fresh quota.
  assert.equal((await app.inject({ url: '/v1/me/memory-account', headers: headers('c') })).statusCode, 429);
  // Separate authenticated wallets remain independent even behind the same IP.
  assert.equal((await app.inject({ url: '/v1/me', headers: headers('b') })).statusCode, 200);
});

test('unverified tokens share an IP quota and readiness bypasses an exhausted quota', async t => {
  const { app, reads } = await fixture(t);
  for (let i = 0; i < 120; i++) {
    const token = String(i).padStart(43, '0');
    assert.equal((await app.inject({ url: '/v1/me', headers: { origin, authorization: `Bearer ${token}` } })).statusCode, 401);
  }
  assert.equal((await app.inject({ url: '/v1/me', headers: { origin, authorization: `Bearer ${'z'.repeat(43)}` } })).statusCode, 429);
  assert.equal((await app.inject({ url: '/v1/me', headers: { origin } })).statusCode, 429);
  const beforeReady = reads();
  for (let i = 0; i < 125; i++) {
    const response = await app.inject({ url: '/health/ready', headers: headers('z') });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['x-ratelimit-remaining'], undefined);
  }
  assert.equal(reads(), beforeReady, 'readiness must not perform session authentication');
  assert.equal((await app.inject('/health/live')).statusCode, 200);
  assert.equal((await app.inject({ url: '/v1/me', headers: headers() })).statusCode, 200);
});

test('successful request identity is never reused by later requests after logout or expiry', async t => {
  const { app, db, reads } = await fixture(t);
  assert.equal((await app.inject({ url: '/v1/me', headers: headers() })).statusCode, 200);
  assert.equal(reads(), 1);
  assert.equal((await app.inject({ url: '/v1/me', headers: headers() })).statusCode, 200);
  assert.equal(reads(), 2, 'a new request must read its session again');
  assert.equal((await app.inject({ method: 'DELETE', url: '/v1/auth/session', headers: headers() })).statusCode, 204);
  assert.equal(reads(), 3);
  assert.equal((await app.inject({ url: '/v1/me', headers: headers() })).statusCode, 401);
  assert.equal((await app.inject({ url: '/v1/me', headers: headers('b') })).statusCode, 200);
  await db.query("UPDATE wallet_sessions SET expires_at=now()-interval '1 minute' WHERE token_hash=$1", [hash('b'.repeat(43))]);
  assert.equal((await app.inject({ url: '/v1/me', headers: headers('b') })).statusCode, 401);
});

test('authentication happens after body parsing so revocation during body reception is observed', async t => {
  const { app, db, reads } = await fixture(t);
  app.addHook('preValidation', async req => {
    assert.deepEqual(req.body, { pending: true });
    assert.equal(reads(), 0, 'no early authentication result may survive body reception');
    await db.query('DELETE FROM wallet_sessions WHERE token_hash=$1', [hash('a'.repeat(43))]);
  });
  const result = await app.inject({ method: 'POST', url: '/v1/ai/turns', headers: headers(), payload: { pending: true } });
  assert.equal(result.statusCode, 401);
});

test('request identity reuse is bound to the exact database, configuration, token and origin', async t => {
  const { observed, reads } = await fixture(t);
  const req = { headers: headers() } as FastifyRequest;
  assert.equal(await authenticate(req, observed, auth), `0x${'a'.repeat(64)}`);
  assert.equal(await authenticate(req, observed, auth), `0x${'a'.repeat(64)}`);
  assert.equal(reads(), 1);
  req.headers.authorization = headers('b').authorization;
  assert.equal(await authenticate(req, observed, auth), `0x${'b'.repeat(64)}`);
  assert.equal(reads(), 2);
  req.headers.origin = 'https://other.example';
  await assert.rejects(authenticate(req, observed, auth), { statusCode: 401 });
  req.headers.origin = origin;
  await authenticate(req, observed, { ...auth });
  assert.equal(reads(), 4, 'a different auth configuration must revalidate');
  const unavailable: Database = { async query() { throw Error('database unavailable'); } };
  await assert.rejects(authenticate(req, unavailable, auth), /database unavailable/);
  req.headers.authorization = 'Bearer invalid';
  await assert.rejects(authenticate(req, observed, auth), { statusCode: 401 });
  req.headers = headers();
  await assert.rejects(authenticate(req, observed, { ...auth, origins: [] }), { statusCode: 403 });
});
