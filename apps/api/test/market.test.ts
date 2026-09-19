import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  const giftPackage = id('0x97');
  const app = buildApp(false, { db, auth, market: { packageId: id('0x99'), listing: async () => listing, hasLicense: async () => false },
    giftMarket: { packageId: giftPackage, nftGiftProductIds: [productId], listing: async () => { throw Error('gift package has no character catalog'); }, hasLicense: async () => false, nftGiftProduct: async () => gift,
    nftGiftProducts: async ids => ids.map(() => gift), ownedNftGifts: async actor => actor === buyer ? owned : [] } });
  t.after(async () => { await app.close(); await db.close(); });
  assert.deepEqual((await app.inject('/v1/nft-gifts')).json().gifts, [gift]);
  assert.equal((await app.inject(`/v1/nft-gifts/${id('0x42')}`)).statusCode, 404);
  const headers = { origin, authorization: `Bearer ${'b'.repeat(43)}` };
  const purchase = await app.inject({ method: 'POST', url: `/v1/nft-gifts/${productId}/purchase-transaction`, headers });
  assert.equal(purchase.statusCode, 200);
  const tx = Transaction.from(purchase.json().transaction).getData();
  assert.equal(tx.sender, buyer);
  assert.equal(tx.commands[1].MoveCall?.package, giftPackage);
  assert.equal(tx.commands[1].MoveCall?.function, 'purchase_nft_gift');
  assert.equal(purchase.json().priceMist, gift.priceMist);
  assert.equal((await app.inject({ url: '/v1/me/nft-gifts', headers: { origin } })).statusCode, 401);
  assert.deepEqual((await app.inject({ url: '/v1/me/nft-gifts', headers })).json().gifts, owned);
});

test('verified external NFT offers use SUI, exact ownership, opt-in preferences and atomic Move calls', async t => {
  const db = new PGlite(); await db.exec(migration);
  const seller = id('0xd'), buyer = id('0xb'), policyId = id('0x50'), offerId = id('0x51'), objectId = id('0x52');
  const objectType = `${id('0x77')}::collectibles::Star`, rawObjectType = `${id('0x77').slice(2)}::collectibles::Star`;
  for (const [token, address] of [['d', seller], ['b', buyer]]) await db.query(
    "INSERT INTO wallet_sessions VALUES($1,$2,$3,now()+interval '30 minutes')", [hash(token.repeat(43)), address, origin]);
  const policy = { id: policyId, name: 'Verified stars', objectType, rawObjectType, active: true };
  const image = Buffer.from('verified external NFT image');
  const offer = { id: offerId, policyId, seller, objectId, objectType, rawObjectType, title: 'External star',
    description: 'Deposited collectible', imageUrl: 'https://example.com/star.png',
    imageHash: createHash('sha256').update(image).digest('hex'),
    priceMist: '1000000', active: true };
  let bought = false, offerExists = true;
  const externalMarket = { packageId: id('0x99'), externalCollectionPolicyIds: [policyId], nftGiftProductIds: [],
    listing: async () => listing, hasLicense: async () => false,
    nftGiftProducts: async () => [], ownedNftGifts: async () => [],
    externalCollectionPolicy: async (target: string) => { assert.equal(target, policyId); return policy; },
    externalNftOffer: async (target: string) => {
      assert.equal(target, offerId);
      if (!offerExists) throw Object.assign(Error('deleted offer'), { statusCode: 404 });
      return offer;
    },
    externalNftOffers: async (ids: string[]) => ids.map(() => offer),
    ownedExternalNfts: async (owner: string, refs: { id: string; objectType: string }[]) => {
      assert.ok(refs.every(ref => ref.id === objectId && ref.objectType === objectType));
      return owner === seller && !bought || owner === buyer && bought ? [objectId] : [];
    },
    verifyExternalNftSale: async (_digest: string, expected: { offerId: string; objectId: string; buyer: string; priceMist: string }) =>
      bought && expected.offerId === offerId && expected.objectId === objectId && expected.buyer === buyer && expected.priceMist === offer.priceMist,
  };
  const app = buildApp(false, { db, auth, market: externalMarket,
    externalNftImageOrigins: ['https://example.com'] });
  t.after(async () => { await app.close(); await db.close(); });
  const sellerHeaders = { origin, authorization: `Bearer ${'d'.repeat(43)}` };
  const buyerHeaders = { origin, authorization: `Bearer ${'b'.repeat(43)}` };
  const draft = { policyId, objectId, title: offer.title, description: offer.description,
    imageUrl: offer.imageUrl, imageHash: offer.imageHash, priceMist: offer.priceMist };
  assert.equal((await app.inject({ method: 'POST', url: '/v1/external-nft-offers/create-transaction', headers: sellerHeaders,
    payload: { ...draft, imageUrl: 'https://unapproved.example/star.png' } })).statusCode, 400);
  const prepared = await app.inject({ method: 'POST', url: '/v1/external-nft-offers/create-transaction', headers: sellerHeaders, payload: draft });
  assert.equal(prepared.statusCode, 200, prepared.body);
  const create = Transaction.from(prepared.json().transaction).getData().commands[0].MoveCall!;
  assert.equal(create.function, 'create_external_nft_offer'); assert.deepEqual(create.typeArguments, [objectType]);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/external-nft-offers', headers: buyerHeaders, payload: { offerId } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/external-nft-offers', headers: sellerHeaders, payload: { offerId } })).statusCode, 200);
  assert.equal((await app.inject({ url: '/v1/me/external-nft-offers', headers: buyerHeaders })).json().offers.length, 0);
  assert.equal((await app.inject({ url: '/v1/me/external-nft-offers', headers: sellerHeaders })).json().offers.length, 1);
  const withdrawal = await app.inject({ method: 'POST', url: `/v1/external-nft-offers/${offerId}/withdraw-transaction`,
    headers: sellerHeaders });
  assert.equal(withdrawal.statusCode, 200, withdrawal.body);
  assert.equal(Transaction.from(withdrawal.json().transaction).getData().commands[0].MoveCall?.function,
    'withdraw_external_nft_offer');
  policy.active = false;
  assert.equal((await app.inject('/v1/external-nft-collections')).json().collections[0].active, false);
  assert.equal((await app.inject({ method: 'POST', url: `/v1/external-nft-offers/${offerId}/withdraw-transaction`,
    headers: sellerHeaders })).statusCode, 200);
  assert.equal((await app.inject('/v1/nft-gifts')).json().gifts.length, 0);
  policy.active = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(image, { status: 200, headers: { 'content-type': 'image/png' } });
  try {
    const imageResponse = await app.inject(`/v1/nft-gifts/${offerId}/image`);
    assert.equal(imageResponse.statusCode, 200, imageResponse.body);
    assert.deepEqual(imageResponse.rawPayload, image);
    assert.equal(imageResponse.headers['x-content-type-options'], 'nosniff');
    globalThis.fetch = async () => new Response('changed image', { status: 200, headers: { 'content-type': 'image/png' } });
    assert.equal((await app.inject(`/v1/nft-gifts/${offerId}/image`)).statusCode, 503);
  } finally { globalThis.fetch = originalFetch; }
  offerExists = false;
  const staleCatalog = await app.inject('/v1/nft-gifts');
  assert.equal(staleCatalog.statusCode, 200); assert.equal(staleCatalog.json().gifts.length, 0);
  offerExists = true;
  const catalog = await app.inject('/v1/nft-gifts');
  assert.equal(catalog.statusCode, 200, catalog.body); assert.equal(catalog.json().gifts[0].kind, 'external');
  const purchase = await app.inject({ method: 'POST', url: `/v1/nft-gifts/${offerId}/purchase-transaction`, headers: buyerHeaders });
  assert.equal(purchase.statusCode, 200, purchase.body);
  const call = Transaction.from(purchase.json().transaction).getData().commands[1].MoveCall!;
  assert.equal(call.function, 'purchase_external_nft'); assert.deepEqual(call.typeArguments, [objectType]);
  assert.deepEqual((await app.inject({ url: '/v1/me/external-nft-preferences', headers: buyerHeaders })).json(),
    { receiveEnabled: false, blockedPolicyIds: [] });
  const preference = await app.inject({ method: 'PUT', url: '/v1/me/external-nft-preferences', headers: buyerHeaders,
    payload: { receiveEnabled: true, blockedPolicyIds: [policyId] } });
  assert.equal(preference.statusCode, 200); assert.deepEqual(preference.json(), { receiveEnabled: true, blockedPolicyIds: [policyId] });
  bought = true;
  assert.equal((await app.inject({ method: 'POST', url: `/v1/external-nft-offers/${offerId}/confirm`, headers: sellerHeaders,
    payload: { digest: 'confirmed-external-purchase-digest' } })).statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: `/v1/external-nft-offers/${offerId}/confirm`, headers: buyerHeaders,
    payload: { digest: 'confirmed-external-purchase-digest' } })).statusCode, 200);
  const owned = (await app.inject({ url: '/v1/me/nft-gifts', headers: buyerHeaders })).json().gifts;
  assert.equal(owned.length, 1); assert.equal(owned[0].kind, 'external'); assert.equal(owned[0].id, objectId);
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

test('buyer reviews require a verified license, one per wallet, and community stats stay public and conversation-free', async t => {
  const db = new PGlite(); await db.exec(migration);
  for (const [token, actor] of [['a', '0xa'], ['b', '0xb'], ['e', '0xe']]) {
    await db.query("INSERT INTO wallet_sessions VALUES($1,$2,$3,now()+interval '30 minutes')", [hash(token.repeat(43)), id(actor), origin]);
  }
  const app = buildApp(false, { db, auth, market: {
    packageId: id('0x99'), listing: async () => listing,
    hasLicense: async (actor, target, proof) => actor === id('0xb') && target === listing.id && proof === id('0x20'),
  }, runtime: { previewTurns: 2, packages: { operator: listing.operator, publish: async () => listing.package,
    load: async () => packageSchema.parse({ schemaVersion: 1, network: 'testnet', packageId: id('0x99'), listingId: listing.id,
      character: { name: 'Fixture', personality: '', relationshipType: '연인', gender: '여성' }, preview: { name: 'Fixture', personality: '' } }) } } });
  t.after(async () => { await app.close(); await db.close(); });
  const headers = (token: string) => ({ origin, authorization: `Bearer ${token.repeat(43)}` });
  const reviews = `/v1/market/listings/${listing.id}/reviews`, community = `/v1/market/listings/${listing.id}/community`;
  const review = { rating: 5, text: '말투가 진짜 사람 같아요.', licenseId: id('0x20') };
  // Unregistered listings have no community page to review.
  assert.equal((await app.inject({ method: 'POST', url: reviews, headers: headers('b'), payload: review })).statusCode, 404);
  await db.query('INSERT INTO market_catalog(listing_id,creator,package_id) VALUES($1,$2,$3)', [listing.id, listing.creator, id('0x98')]);
  assert.equal((await app.inject({ method: 'POST', url: reviews, headers: headers('b'), payload: review })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/market/listings', headers: headers('a'), payload: { listingId: listing.id } })).statusCode, 200);
  const catalog = (await app.inject({ url: '/v1/market/listings' })).json();
  assert.equal(catalog.previews[listing.id].relationshipType, '연인');
  assert.equal(catalog.previews[listing.id].gender, '여성');
  assert.match(catalog.previews[listing.id].registeredAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal((await app.inject({ method: 'POST', url: reviews, payload: review })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: reviews, headers: headers('e'), payload: review })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: reviews, headers: headers('a'), payload: review })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: reviews, headers: headers('b'), payload: { ...review, rating: 6 } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: reviews, headers: headers('b'), payload: { ...review, text: 'x'.repeat(101) } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: reviews, headers: headers('b'), payload: { ...review, conversation: 'PRIVATE' } })).statusCode, 400);
  const first = await app.inject({ method: 'POST', url: reviews, headers: headers('b'), payload: review });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().reviewCount, 1); assert.equal(first.json().averageRating, 5);
  const second = await app.inject({ method: 'POST', url: reviews, headers: headers('b'), payload: { ...review, rating: 3, text: '다시 써봐도 괜찮아요.' } });
  assert.equal(second.json().reviewCount, 1); assert.equal(second.json().averageRating, 3);
  const page = await app.inject({ url: community });
  assert.equal(page.statusCode, 200);
  assert.deepEqual(page.json().reviews.map((r: { owner: string; text: string }) => [r.owner, r.text]), [[id('0xb'), '다시 써봐도 괜찮아요.']]);
  assert.equal(page.json().giftsSent, 0);
  assert.match(page.json().registeredAt, /^\d{4}-/);
  await db.query("INSERT INTO agent_gifts(intent,owner,listing_id,status) VALUES('g1',$1,$2,'confirmed'),('g2',$1,$2,'declined')", [id('0xb'), listing.id]);
  assert.equal((await app.inject({ url: community })).json().giftsSent, 1);
});
