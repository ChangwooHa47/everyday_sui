import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { buildApp } from '../src/app.js';
import { migration } from '../src/database.js';
import { hash } from '../src/auth.js';
import { reserveAiBudget } from '../src/ai-budget.js';
import { createGiftService, type GiftTransport } from '../src/gifts.js';
import type { MarketListing } from '@everyday/contracts';
import { migrateProduct } from '../src/product/migrations.js';

test('one atomic daily cap covers different wallets, AI turns, product generation and gift decisions', async t => {
  const db = new PGlite(); await db.exec(migration); await migrateProduct(db);
  const origin = 'http://127.0.0.1:3000';
  const address = (token: string) => `0x${token.repeat(64)}`;
  for (const token of ['a', 'b', 'c', 'd']) await db.query("INSERT INTO wallet_sessions VALUES($1,$2,$3,now()+interval '30 minutes')", [hash(token.repeat(43)), address(token), origin]);
  const owner = (await db.query<{ id: string }>('INSERT INTO everyday.users(wallet_address,points) VALUES($1,1200) RETURNING id', [address('c')])).rows[0].id;
  await db.query("INSERT INTO everyday.characters(id,user_id,name,relationship_type,gender,system_prompt) VALUES(42,$1,'Fixture','FRIEND','OTHER','Fictional companion')", [owner]);
  let generations = 0;
  const provider = createServer((req, res) => {
    req.resume(); if (req.method === 'POST') generations++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/completion' ? { choices: [{ message: { content: 'Fixture' } }] } : []));
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(provider.address() as { port: number }).port}`;
  const app = buildApp(false, { db, auth: { origins: [origin], audience: 'test', network: 'testnet' },
    product: { workers: false, llm: { requireConfigured() {}, async chat(system) {
      generations++;
      return system.includes('imagePrompt') ? JSON.stringify({ summary: 'Fixture', appearance: '', personality: '', speechStyles: [], imagePrompt: 'Fictional portrait' }) : 'Fictional greeting';
    } }, image: { requireConfigured() {}, async generateImages() { throw Error('must not generate images'); }, async trainSoul() { throw Error('must not train'); }, async soulReady() { return false; } } },
    ai: { apiKey: 'fixture', endpoint: `${base}/completion`, model: 'fixture', dailyLimit: 2, globalDailyLimit: 3 } });
  t.after(async () => { await app.close(); await db.close(); await new Promise<void>(resolve => provider.close(() => resolve())); });
  const headers = (token: string) => ({ origin, authorization: `Bearer ${token.repeat(43)}` });
  const body = () => ({ requestId: randomUUID(), character: { name: 'Fixture', personality: '', callName: '' }, messages: [{ role: 'user', content: 'Fictional greeting' }] });
  const nodeTurn = (actor: string, payload = body()) => app.inject({ method: 'POST', url: '/v1/ai/turns', headers: headers(actor), payload });
  assert.equal((await nodeTurn('a')).statusCode, 200); assert.equal((await nodeTurn('a')).statusCode, 200);
  const rejectedPayload = body(); assert.equal((await nodeTurn('a', rejectedPayload)).statusCode, 429);
  assert.equal((await db.query<{ used: number }>('SELECT used FROM ai_global_daily_budget')).rows[0].used, 2);
  assert.equal((await db.query('SELECT * FROM ai_requests WHERE request_id=$1', [rejectedPayload.requestId])).rows.length, 0);
  const race = await Promise.all([nodeTurn('b'), app.inject({ method: 'POST', url: '/api/characters/42/greeting', headers: headers('c'), payload: {} }),
    app.inject({ method: 'POST', url: '/api/characters/compile', headers: headers('d'), payload: { requestId: randomUUID(), name: 'Fixture', gender: '기타', relationshipType: '친구', deferPortraitGeneration: true } })]);
  assert.deepEqual(race.map(result => result.statusCode).sort(), [200, 429, 429]);
  assert.equal(generations, 3);
  assert.equal((await app.inject({ url: '/api/characters/42/messages', headers: headers('c') })).statusCode, 200);
  let giftDecisions = 0, giftSignatures = 0;
  const transport: GiftTransport = { products: async () => [{ id: 'gift', title: 'Gift', priceMist: '1' }],
    prepare: async () => { giftSignatures++; throw Error('must not sign'); }, execute: async () => 'confirmed' };
  const gifts = createGiftService(db, transport, async () => { giftDecisions++; return { productId: 'gift' }; }, owner => reserveAiBudget(db, owner, 2, 3));
  await gifts.propose(address('b'), { id: 'listing' } as MarketListing, 'turn', []);
  assert.equal(giftDecisions, 0); assert.equal(giftSignatures, 0);
  assert.equal((await db.query<{ used: number }>('SELECT used FROM ai_global_daily_budget')).rows[0].used, 3);
});

test('rejected preview reservation consumes neither per-wallet nor global daily budget', async t => {
  const db = new PGlite(); await db.exec(migration); t.after(() => db.close());
  const requests = await Promise.allSettled(Array.from({ length: 8 }, () => reserveAiBudget(db, 'owner', 10, 20, { listingId: 'listing', limit: 2 })));
  assert.equal(requests.filter(result => result.status === 'fulfilled').length, 2);
  for (const result of requests) if (result.status === 'rejected') assert.equal(result.reason.statusCode, 403);
  assert.equal((await db.query<{ used: number }>('SELECT used FROM ai_daily_budget')).rows[0].used, 2);
  assert.equal((await db.query<{ used: number }>('SELECT used FROM ai_global_daily_budget')).rows[0].used, 2);
  assert.equal((await db.query<{ used: number }>('SELECT used FROM market_preview_budget')).rows[0].used, 2);
});
