import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { Transaction } from '@mysten/sui/transactions';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import type { MarketListing } from '@everyday/contracts';
import { buildApp } from '../src/app.js';
import { hash } from '../src/auth.js';
import { migration } from '../src/database.js';
import { packageSchema } from '../src/market-package.js';
import { createMarketChain, listingBcs } from '../src/market-chain.js';

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
  let available = true;
  const app = buildApp(false, { db, auth, market: {
    packageId: id('0x99'), listing: async () => listing,
    hasLicense: async (actor, target, proof) => owned && actor === id('0xb') && target === listing.id && proof === id('0x20'),
  }, runtime: { previewTurns: 2, packages: { operator: listing.operator, publish: async () => listing.package,
    load: async () => {
      if (!available) throw Error('unavailable');
      return packageSchema.parse({ schemaVersion: 1, network: 'testnet', packageId: id('0x99'), listingId: listing.id,
        character: { name: 'Fixture', personality: '' }, preview: { name: 'Fixture', personality: '' } });
    } } } });
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
  available = false;
  assert.equal((await app.inject({ method: 'POST', url: `/v1/market/listings/${listing.id}/purchase-transaction`, headers: headers('b') })).statusCode, 500);
  available = true;
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

test('NFT gift catalog builds exact wallet purchase and exposes only authenticated ownership', async t => {
  const db = new PGlite(); await db.exec(migration);
  const productId = id('0x40'), buyer = id('0xb');
  await db.query("INSERT INTO wallet_sessions VALUES($1,$2,$3,now()+interval '30 minutes')", [hash('b'.repeat(43)), buyer, origin]);
  const gift = { id: productId, title: 'Warm heart', description: 'Test gift', imageUrl: 'https://example.com/gifts/warm-heart.svg',
    imageHash: '00'.repeat(32), merchant: id('0xd'), priceMist: '10000001', maxSupply: '10', minted: '1', active: true };
  const owned = [{ id: id('0x41'), productId, title: gift.title, description: gift.description,
    imageUrl: gift.imageUrl, imageHash: gift.imageHash, edition: '1' }];
  const app = buildApp(false, { db, auth, market: { packageId: id('0x99'), nftGiftProductIds: [productId],
    listing: async () => listing, hasLicense: async () => false, nftGiftProduct: async () => gift,
    nftGiftProducts: async ids => ids.map(() => gift), ownedNftGifts: async actor => actor === buyer ? owned : [] } });
  t.after(async () => { await app.close(); await db.close(); });
  assert.deepEqual((await app.inject('/v1/nft-gifts')).json().gifts, [gift]);
  assert.equal((await app.inject(`/v1/nft-gifts/${id('0x42')}`)).statusCode, 404);
  const headers = { origin, authorization: `Bearer ${'b'.repeat(43)}` };
  const purchase = await app.inject({ method: 'POST', url: `/v1/nft-gifts/${productId}/purchase-transaction`, headers });
  assert.equal(purchase.statusCode, 200);
  const tx = Transaction.from(purchase.json().transaction).getData();
  assert.equal(tx.sender, buyer);
  assert.equal(tx.commands[1].MoveCall?.function, 'purchase_nft_gift');
  assert.equal(purchase.json().priceMist, gift.priceMist);
  assert.equal((await app.inject({ url: '/v1/me/nft-gifts', headers: { origin } })).statusCode, 401);
  assert.deepEqual((await app.inject({ url: '/v1/me/nft-gifts', headers })).json().gifts, owned);
});

test('catalog upgrades retain legacy rows but discover only listings verified for the configured package', async t => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE market_catalog(listing_id text PRIMARY KEY,creator text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());`);
  await db.query('INSERT INTO market_catalog(listing_id,creator) VALUES($1,$2)', [id('0x01'), listing.creator]);
  await db.exec(migration);
  await db.exec(migration); // Additive migration can run on the next deployment too.
  await db.query('INSERT INTO market_catalog(listing_id,creator,package_id) VALUES($1,$2,$3)', [id('0x02'), listing.creator, id('0x98')]);
  await db.query("INSERT INTO wallet_sessions VALUES($1,$2,$3,now()+interval '30 minutes')", [hash('a'.repeat(43)), listing.creator, origin]);
  const loaded: string[] = [];
  const app = buildApp(false, { db, auth, market: { packageId: id('0x99'),
    listing: async target => { loaded.push(target); assert.equal(target, listing.id); return listing; }, hasLicense: async () => false },
  runtime: { previewTurns: 2, packages: { operator: listing.operator, publish: async () => listing.package,
    load: async () => packageSchema.parse({ schemaVersion: 1, network: 'testnet', packageId: id('0x99'), listingId: listing.id,
      character: { name: 'Fixture', personality: '' }, preview: { name: 'Fixture', personality: 'Preview' } }) } } });
  t.after(async () => { await app.close(); await db.close(); });
  const before = await app.inject({ url: '/v1/market/listings' });
  assert.equal(before.statusCode, 200); assert.deepEqual(before.json().listings, []); assert.deepEqual(loaded, []);
  const registered = await app.inject({ method: 'POST', url: '/v1/market/listings', headers: { origin, authorization: `Bearer ${'a'.repeat(43)}` }, payload: { listingId: listing.id } });
  assert.equal(registered.statusCode, 200);
  const first = await app.inject({ url: '/v1/market/listings?limit=1' });
  assert.deepEqual(first.json().listings.map((l: MarketListing) => l.id), [listing.id]);
  assert.equal(first.json().previews[listing.id].summary, 'Preview');
  assert.deepEqual((await app.inject({ url: `/v1/market/listings?after=${first.json().nextCursor}` })).json().listings, []);
  assert.equal((await db.query<{ count: number }>('SELECT count(*)::integer AS count FROM market_catalog')).rows[0].count, 3);
});

test('live catalog uses one native RPC batch for 20 listings, no RPC for empty pages, and no cached chain state', async t => {
  const db = new PGlite(); await db.exec(migration);
  const pkg = id('0x99');
  const ids = Array.from({ length: 20 }, (_, index) => id(`0x${(256 + index).toString(16)}`));
  const client = new SuiGrpcClient({ network: 'testnet', baseUrl: 'https://unused.example' });
  let singles = 0, batches = 0, active = true;
  let incomplete = false;
  client.getObject = async () => { singles++; throw Error('catalog must use native batch'); };
  // Exercise the installed SDK getObjects → ledgerService.batchGetObjects path.
  client.ledgerService.batchGetObjects = (async (request: Parameters<typeof client.ledgerService.batchGetObjects>[0]) => {
    batches++;
    assert.deepEqual(request.requests.map(item => item.objectId), ids);
    assert.ok(request.readMask?.paths.includes('contents'));
    const objects = ids.map(objectId => ({ result: { oneofKind: 'object', object: {
      objectId, objectType: `${pkg}::market::Listing`, owner: { kind: 3, version: 1n }, version: 1n, digest: 'fixture',
      contents: { value: listingBcs.serialize({ id: objectId, creator: listing.creator, operator: listing.operator, title: listing.title,
        price: '18446744073709551615', agent_bps: listing.agentBps, blob_id: listing.package.blobId,
        content_hash: Array(32).fill(0), end_epoch: '18446744073709551615', published: true, active,
        buyers: { id: id('0x30'), size: 0 }, treasury: '9007199254740993', per_gift_limit: '100', daily_limit: '200',
        day: 0, spent: 0, allowed_gifts: [], intents: { id: id('0x31'), size: 0 } }).toBytes() },
    } } }));
    return { response: { objects: incomplete ? objects.slice(0, -1) : objects } };
  }) as unknown as typeof client.ledgerService.batchGetObjects;
  const app = buildApp(false, { db, auth, market: createMarketChain(pkg, client) });
  t.after(async () => { await app.close(); await db.close(); });
  const empty = await app.inject('/v1/market/listings?limit=20');
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.json().listings, []);
  assert.equal(batches, 0); assert.equal(singles, 0);
  for (const listingId of ids) await db.query('INSERT INTO market_catalog(listing_id,creator,package_id) VALUES($1,$2,$3)', [listingId, listing.creator, pkg]);
  const first = await app.inject('/v1/market/listings?limit=20');
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.json().listings.map((item: MarketListing) => item.id), ids);
  assert.equal(first.json().listings[0].priceMist, '18446744073709551615');
  assert.equal(first.json().listings[0].treasuryMist, '9007199254740993');
  assert.equal(first.json().listings[0].package.endEpoch, '18446744073709551615');
  assert.equal(first.json().nextCursor, ids.at(-1));
  assert.equal(batches, 1); assert.equal(singles, 0);
  active = false;
  const changed = await app.inject('/v1/market/listings?limit=20');
  assert.equal(changed.statusCode, 200);
  assert.ok(changed.json().listings.every((item: MarketListing) => item.active === false));
  assert.equal(batches, 2); assert.equal(singles, 0);
  incomplete = true;
  const failed = await app.inject('/v1/market/listings?limit=20');
  assert.equal(failed.statusCode, 503);
  assert.deepEqual(failed.json(), { error: 'SERVICE_UNAVAILABLE' });
  assert.equal(batches, 3); assert.equal(singles, 0);
});
