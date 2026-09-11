import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { createMarketChain, licenseBcs, listingBcs } from '../src/market-chain.js';

const id = normalizeSuiAddress;
const pkg = id('0x99'), actor = id('0xb'), listingId = id('0x10'), licenseId = id('0x20');
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
  const data = { id: listingId, creator: id('0xa'), operator: id('0xc'), title: 'Fixture',
    price: '18446744073709551615', agent_bps: 2000, blob_id: 'a'.repeat(43), content_hash: Array(32).fill(0),
    end_epoch: 100, published: true, active: true, buyers: { id: id('0x30'), size: 1 }, treasury: '9007199254740993',
    per_gift_limit: 100, daily_limit: 200, day: 0, spent: 0, allowed_gifts: [], intents: { id: id('0x31'), size: 0 } };
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
