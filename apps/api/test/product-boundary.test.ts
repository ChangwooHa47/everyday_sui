import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { buildApp } from '../src/app.js';
import { hash } from '../src/auth.js';
import { migration } from '../src/database.js';
import { migrateProduct } from '../src/product/migrations.js';

test('direct product endpoints retain authentication, canonical paths, safe errors, and the HTTP request cap', async t => {
  const db = new PGlite(); await db.exec(migration); await migrateProduct(db);
  const origin = 'https://web.example';
  const headers = (token: string) => ({ origin, authorization: `Bearer ${token.repeat(43)}` });
  for (const token of ['a', 'b']) await db.query("INSERT INTO wallet_sessions VALUES($1,$2,$3,now()+interval '30 minutes')", [hash(token.repeat(43)), `0x${token.repeat(64)}`, origin]);
  let providerCalls = 0;
  const app = buildApp(false, { db, auth: { origins: [origin], audience: 'https://api.example', network: 'testnet' }, product: {
    workers: false,
    llm: { requireConfigured() {}, async chat() { providerCalls++; throw Error('PRIVATE_PROVIDER_DETAILS'); } },
    image: { requireConfigured() {}, async generateImages() { throw Error('unused'); }, async trainSoul() { throw Error('unused'); }, async soulReady() { return false; } },
  } });
  t.after(async () => { await app.close(); await db.close(); });
  assert.equal((await app.inject({ url: '/api/me', headers: { origin } })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/me', headers: { ...headers('a'), origin: 'https://other.example' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', headers: headers('a'), payload: {} })).statusCode, 404);
  assert.equal((await app.inject({ url: '/api/characters/%31', headers: headers('a') })).statusCode, 400);
  assert.equal(providerCalls, 0);
  const failed = await app.inject({ method: 'POST', url: '/api/characters/interview', headers: headers('a'), payload: { relationshipType: '친구', gender: '기타' } });
  assert.equal(failed.statusCode, 500);
  assert.equal(failed.body.includes('PRIVATE_PROVIDER_DETAILS'), false);
  assert.deepEqual(failed.json(), { success: false, data: null, message: '요청을 처리하지 못했어요. 다시 시도해주세요.' });
  for (let i = 0; i < 120; i++) assert.equal((await app.inject({ url: '/api/me', headers: headers('b') })).statusCode, 200);
  const limited = await app.inject({ url: '/api/me', headers: headers('b') });
  assert.equal(limited.statusCode, 429);
  assert.ok(Number(limited.headers['retry-after']) >= 1 && Number(limited.headers['retry-after']) <= 60);
  assert.equal((await app.inject('/health/ready')).statusCode, 200);
  assert.equal((await app.inject('/health/live')).statusCode, 200);
});
