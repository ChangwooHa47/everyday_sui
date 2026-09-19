import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { createMarketChain, externalCollectionPolicyBcs, externalNftOfferBcs, externalNftWithdrawnBcs,
  giftNftBcs, licenseBcs, listingBcs, nftGiftProductBcs } from '../src/market-chain.js';

const id = normalizeSuiAddress;
const pkg = id('0x99'), actor = id('0xb'), listingId = id('0x10'), licenseId = id('0x20');
const listingData = (listingId: string) => ({ id: listingId, creator: id('0xa'), operator: id('0xc'), title: 'Fixture',
  price: '18446744073709551615', agent_bps: 2000, blob_id: 'a'.repeat(43), content_hash: Array(32).fill(0),
  end_epoch: 100, published: true, active: true, buyers: { id: id('0x30'), size: 1 }, treasury: '9007199254740993',
  per_gift_limit: 100, daily_limit: 200, day: 0, spent: 0, allowed_gifts: [], intents: { id: id('0x31'), size: 0 } });
const listingObject = (listingId: string) => ({ objectId: listingId, type: `${pkg}::market::Listing`,
  owner: { $kind: 'Shared' }, content: listingBcs.serialize(listingData(listingId)).toBytes() });
test('license verification rejects spoofed package, owner, buyer, listing and object identity', async () => {
  const valid = { objectId: licenseId, type: `${pkg}::market::License`, owner: { $kind: 'AddressOwner', AddressOwner: actor },
    content: licenseBcs.serialize({ id: licenseId, listing: listingId, buyer: actor }).toBytes() };
  let object = valid;
  const client = { getObject: async () => ({ object }) } as unknown as Pick<SuiGrpcClient, 'getObject'>;
  const chain = createMarketChain(pkg, client);
  assert.equal(await chain.hasLicense(actor, listingId, licenseId), true);
  for (const change of [
    { type: `${id('0x98')}::market::License` },
    { owner: { $kind: 'AddressOwner', AddressOwner: id('0xe') } },
    { objectId: id('0x21') },
    ...[{ buyer: id('0xe') }, { listing: id('0x11') }, { id: id('0x21') }].map(fields => ({
      content: licenseBcs.serialize({ id: licenseId, listing: listingId, buyer: actor, ...fields }).toBytes(),
    })),
  ]) {
    object = { ...valid, ...change };
    assert.equal(await chain.hasLicense(actor, listingId, licenseId), false);
  }
});
test('BCS listing parser preserves u64 prices and treasury without floating point loss', async () => {
  const data = listingData(listingId);
  const client = { getObject: async () => ({ object: { objectId: listingId, type: `${pkg}::market::Listing`,
    owner: { $kind: 'Shared' }, content: listingBcs.serialize(data).toBytes() } }) } as unknown as Pick<SuiGrpcClient, 'getObject'>;
  const result = await createMarketChain(pkg, client).listing(listingId);
  assert.equal(result.priceMist, data.price);
  assert.equal(result.treasuryMist, data.treasury);
});
test('RPC errors fail closed', async () => {
  const client = { getObject: async () => { throw Error('rpc offline'); } } as unknown as Pick<SuiGrpcClient, 'getObject'>;
  await assert.rejects(createMarketChain(pkg, client).hasLicense(actor, listingId, licenseId), { statusCode: 503 });
});

test('single and batch listings share exact package, owner, identity and canonical BCS validation', async () => {
  const valid = listingObject(listingId);
  let object: unknown = valid;
  const client = {
    getObject: async () => ({ object }),
    getObjects: async () => ({ objects: [listingObject(id('0x11')), object] }),
  } as unknown as Pick<SuiGrpcClient, 'getObject' | 'getObjects'>;
  const chain = createMarketChain(pkg, client);
  const validBatch = await chain.listings!([id('0x11'), listingId]);
  assert.equal(validBatch[1].priceMist, '18446744073709551615');
  assert.equal(validBatch[1].treasuryMist, '9007199254740993');
  assert.equal(validBatch[1].package.endEpoch, '100');
  for (const [change, statusCode] of [
    [{ type: `${id('0x98')}::market::Listing` }, 404],
    [{ type: `${pkg}::market::License` }, 404],
    [{ owner: { $kind: 'AddressOwner', AddressOwner: actor } }, 404],
    [{ objectId: id('0x12') }, 503],
    [{ content: listingBcs.serialize(listingData(id('0x12'))).toBytes() }, 503],
    [{ content: valid.content.slice(0, -1) }, 503],
    [{ content: Uint8Array.from([...valid.content, 0]) }, 503],
    [{ content: undefined }, 503],
  ] as const) {
    object = { ...valid, ...change };
    await assert.rejects(chain.listing(listingId), { statusCode });
    await assert.rejects(chain.listings!([id('0x11'), listingId]), { statusCode });
  }
});

test('batch listing reads reject partial, duplicated, reordered, failed and malformed object results', async () => {
  const ids = [listingId, id('0x11')];
  const valid = ids.map(listingObject);
  let objects: unknown = valid;
  let singles = 0;
  let batches = 0;
  const client = {
    getObject: async () => { singles++; throw Error('single read must not replace a failed batch'); },
    getObjects: async () => { batches++; return { objects }; },
  } as unknown as Pick<SuiGrpcClient, 'getObject' | 'getObjects'>;
  const chain = createMarketChain(pkg, client);
  assert.deepEqual(await chain.listings!([]), []);
  assert.equal(batches, 0);
  for (objects of [
    [], [valid[0]], [...valid, valid[0]], [valid[0], valid[0]], [...valid].reverse(),
    [valid[0], Error('private provider failure')], [valid[0], null], [valid[0], {}], undefined,
  ]) {
    await assert.rejects(chain.listings!(ids), { statusCode: 503 });
  }
  client.getObjects = async () => { throw Error('private RPC failure'); };
  await assert.rejects(chain.listings!(ids), { statusCode: 503, message: 'CHAIN_UNAVAILABLE' });
  assert.equal(singles, 0);
});

test('NFT gift products and wallet collection require exact package, ownership and BCS identity', async () => {
  const productId = id('0x40'), nftId = id('0x41');
  const productData = { id: productId, title: 'Warm heart', description: 'Test gift', image_url: 'https://example.com/heart.svg',
    image_hash: Array(32).fill(7), merchant: id('0xd'), price: '9007199254740993', max_supply: '10', minted: '2', active: true };
  const nftData = { id: nftId, product: productId, title: productData.title, description: productData.description,
    image_url: productData.image_url, image_hash: productData.image_hash, edition: '2' };
  let productObject: Record<string, any> = { objectId: productId, type: `${pkg}::market::NftGiftProduct`, owner: { $kind: 'Shared' },
    content: nftGiftProductBcs.serialize(productData).toBytes() };
  let ownedObject = { objectId: nftId, type: `${pkg}::market::GiftNft`, owner: { $kind: 'AddressOwner', AddressOwner: actor },
    content: giftNftBcs.serialize(nftData).toBytes() };
  const client = { getObject: async () => ({ object: productObject }), getObjects: async () => ({ objects: [productObject] }),
    listOwnedObjects: async () => ({ objects: [ownedObject], cursor: null, hasNextPage: false }) } as unknown as Pick<SuiGrpcClient, 'getObject' | 'getObjects' | 'listOwnedObjects'>;
  const chain = createMarketChain(pkg, client, [productId]);
  assert.equal((await chain.nftGiftProduct!(productId)).priceMist, '9007199254740993');
  assert.deepEqual((await chain.nftGiftProducts!([productId])).map(gift => gift.id), [productId]);
  assert.deepEqual(await chain.ownedNftGifts!(actor), [{ id: nftId, productId, title: 'Warm heart', description: 'Test gift',
    imageUrl: productData.image_url, imageHash: '07'.repeat(32), edition: '2' }]);
  productObject = { ...productObject, owner: { $kind: 'AddressOwner', AddressOwner: actor } };
  await assert.rejects(chain.nftGiftProduct!(productId), { statusCode: 404 });
  ownedObject = { ...ownedObject, owner: { $kind: 'AddressOwner', AddressOwner: id('0xe') } };
  await assert.rejects(chain.ownedNftGifts!(actor), { statusCode: 404 });
});

test('external NFT policies, deposited offers and current wallet ownership require exact types and identities', async () => {
  const policyId = id('0x50'), offerId = id('0x51'), objectId = id('0x52');
  const externalPackage = id('0x77');
  const rawType = `${externalPackage.slice(2)}::collectibles::Star`;
  const objectType = `${externalPackage}::collectibles::Star`;
  const policyData = { id: policyId, name: 'Verified stars', type_name: rawType, active: true };
  const offerData = { id: offerId, policy: policyId, seller: id('0xd'), item: objectId, type_name: rawType,
    title: 'External star', description: 'Deposited NFT', image_url: 'https://example.com/star.png',
    image_hash: Array(32).fill(9), price: '9007199254740993', active: true };
  const objects: Record<string, Record<string, any>> = {
    [policyId]: { objectId: policyId, type: `${pkg}::market::ExternalCollectionPolicy`, owner: { $kind: 'Shared' },
      content: externalCollectionPolicyBcs.serialize(policyData).toBytes() },
    [offerId]: { objectId: offerId, type: `${pkg}::market::ExternalNftOffer`, owner: { $kind: 'Shared' },
      content: externalNftOfferBcs.serialize(offerData).toBytes() },
    [objectId]: { objectId, type: objectType, owner: { $kind: 'AddressOwner', AddressOwner: actor }, content: new Uint8Array() },
  };
  const client = { getObject: async ({ objectId: target }: { objectId: string }) => ({ object: objects[target] }),
    getObjects: async ({ objectIds }: { objectIds: string[] }) => ({ objects: objectIds.map(target => objects[target]) })
  } as unknown as Pick<SuiGrpcClient, 'getObject' | 'getObjects'>;
  const chain = createMarketChain(pkg, client, [], [policyId]);
  assert.deepEqual(await chain.externalCollectionPolicy!(policyId), {
    id: policyId, name: 'Verified stars', objectType, rawObjectType: rawType, active: true,
  });
  const offer = await chain.externalNftOffer!(offerId);
  assert.equal(offer.objectType, objectType); assert.equal(offer.objectId, objectId);
  assert.deepEqual((await chain.externalNftOffers!([offerId])).map(item => item.id), [offerId]);
  assert.deepEqual(await chain.ownedExternalNfts!(actor, [{ id: objectId, objectType }]), [objectId]);
  objects[objectId] = { ...objects[objectId], owner: { $kind: 'AddressOwner', AddressOwner: id('0xe') } };
  assert.deepEqual(await chain.ownedExternalNfts!(actor, [{ id: objectId, objectType }]), []);
  objects[objectId] = Error('provider failure') as unknown as Record<string, any>;
  await assert.rejects(chain.ownedExternalNfts!(actor, [{ id: objectId, objectType }]), { statusCode: 503 });
  objects[offerId] = { ...objects[offerId], content: externalNftOfferBcs.serialize({ ...offerData, item: id('0x53') }).toBytes() };
  const changed = await chain.externalNftOffer!(offerId);
  assert.equal(changed.objectId, id('0x53'));
});

test('external NFT withdrawal confirmation requires the exact successful event', async () => {
  const policyId = id('0x50'), offerId = id('0x51'), objectId = id('0x52'), seller = id('0xd');
  let data = { offer: offerId, policy: policyId, item: objectId, seller };
  let success = true;
  const client = {
    getObject: async () => { throw Error('unused'); },
    getTransaction: async ({ digest }: { digest: string }) => ({ $kind: 'Transaction', Transaction: {
      digest, status: { success }, events: [{ eventType: `${pkg}::market::ExternalNftWithdrawn`,
        bcs: externalNftWithdrawnBcs.serialize(data).toBytes() }],
    } }),
  } as unknown as Pick<SuiGrpcClient, 'getObject' | 'getTransaction'>;
  const verify = createMarketChain(pkg, client).verifyExternalNftWithdrawal!;
  const expected = { offerId, policyId, objectId, seller };
  assert.equal(await verify('withdraw-digest', expected), true);
  data = { ...data, item: id('0x53') };
  assert.equal(await verify('withdraw-digest', expected), false);
  data = { offer: offerId, policy: policyId, item: objectId, seller };
  success = false;
  assert.equal(await verify('withdraw-digest', expected), false);
});
