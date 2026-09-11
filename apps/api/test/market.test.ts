import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { Transaction } from '@mysten/sui/transactions';
import type { MarketListing } from '@everyday/contracts';
import { buildApp } from '../src/app.js';
import { hash } from '../src/auth.js';
import { migration } from '../src/database.js';

const id = normalizeSuiAddress;
const origin = 'http://127.0.0.1:3000';
const auth = { origins: [origin], audience: 'test', network: 'testnet' as const };
const listing: MarketListing = {
  id: id('0x10'), creator: id('0xa'), operator: id('0xc'), title: 'Fictional character',
  priceMist: '1000000001', agentBps: 2000, treasuryMist: '0', published: true, active: true,
  package: { blobId: 'a'.repeat(43), contentHash: '0'.repeat(64), endEpoch: '100' },
  policy: { perGiftLimitMist: '100', dailyLimitMist: '200', allowedGiftIds: [] },
};
test('market checks chain permissions, builds exact payment, isolates memory and rejects concurrent overwrites', async t => {
  const db = new PGlite(); await db.exec(migration);
  for (const [token, actor] of [['a', '0xa'], ['b', '0xb'], ['e', '0xe']]) {
    await db.query("INSERT INTO wallet_sessions VALUES($1,$2,$3,now()+interval '30 minutes')", [hash(token.repeat(43)), id(actor), origin]);
  }
  let owned = false;
  const app = buildApp(false, { db, auth, market: {
    packageId: id('0x99'), listing: async () => listing,
    hasLicense: async (actor, target, proof) => owned && actor === id('0xb') && target === listing.id && proof === id('0x20'),
  } });
  t.after(async () => { await app.close(); await db.close(); });
  const headers = (token: string) => ({ origin, authorization: `Bearer ${token.repeat(43)}` });
  const access = `/v1/market/listings/${listing.id}/access?licenseId=${id('0x20')}`;
  assert.equal((await app.inject({ url: access })).statusCode, 403);
  assert.equal((await app.inject({ url: access, headers: headers('b') })).statusCode, 403);
  owned = true;
  assert.equal((await app.inject({ url: access, headers: headers('b') })).statusCode, 200);
  assert.equal((await app.inject({ url: access, headers: headers('e') })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/market/listings', headers: headers('b'), payload: { listingId: listing.id } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/market/listings', headers: headers('a'), payload: { listingId: listing.id } })).statusCode, 200);
  assert.equal((await app.inject({ url: '/v1/market/listings' })).json().listings.length, 1);
  const purchase = await app.inject({ method: 'POST', url: `/v1/market/listings/${listing.id}/purchase-transaction`, headers: headers('b') });
  assert.equal(purchase.statusCode, 200);
  const tx = Transaction.from(purchase.json().transaction).getData();
  assert.equal(tx.sender, id('0xb'));
  assert.equal(tx.commands[1].MoveCall?.function, 'purchase');
  assert.equal(purchase.json().priceMist, '1000000001');
  const memory = `/v1/me/relationships/${listing.id}/memory`;
  const body = { provider: 'memwal', spaceId: 'private-space-b', expectedRevision: 0, consent: true, licenseId: id('0x20') };
  assert.equal((await app.inject({ method: 'POST', url: memory, headers: headers('e'), payload: body })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: memory, headers: headers('b'), payload: { ...body, consent: false } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: memory, headers: headers('b'), payload: { ...body, owner: id('0xe') } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: memory, headers: headers('b'), payload: body })).statusCode, 200);
  assert.equal((await app.inject({ url: memory, headers: headers('e') })).json().memory, null);
  assert.equal((await app.inject({ url: memory, headers: headers('a') })).json().memory, null);
  assert.equal((await app.inject({ url: memory, headers: headers('b') })).json().memory.spaceId, 'private-space-b');
  const updates = await Promise.all(['new-space-1', 'new-space-2'].map(spaceId => app.inject({ method: 'POST', url: memory, headers: headers('b'), payload: { ...body, spaceId, expectedRevision: 1 } })));
  assert.deepEqual(updates.map(r => r.statusCode).sort(), [200, 409]);
  // Catalog responses never join private relationship tables.
  assert.ok(!(await app.inject({ url: '/v1/market/listings' })).body.includes('space'));
});

test('missing market configuration is unavailable, never simulated ownership', async t => {
  const db = new PGlite(); await db.exec(migration);
  const app = buildApp(false, { db, auth });
  t.after(async () => { await app.close(); await db.close(); });
  const response = await app.inject({ url: '/v1/market/listings' });
  assert.equal(response.statusCode, 503);
});
