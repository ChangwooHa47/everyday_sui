import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bcs } from '@mysten/sui/bcs';
import { normalizeSuiAddress as id } from '@mysten/sui/utils';
import { verifyStorageReceipt, WALRUS_TESTNET_TYPE_ORIGIN as origin } from '../src/market-package.js';

const blobId = Buffer.from(bcs.u256().serialize('123').toBytes()).toString('base64url');
const receipt = { newlyCreated: { blobObject: { id: id('0xb'), blobId, deletable: false, storage: { endEpoch: 525 } } } };
const object = { objectId: id('0xb'), type: `${origin}::blob::Blob`, owner: { $kind: 'AddressOwner', AddressOwner: id('0xa') },
  json: { blob_id: '123', certified_epoch: 518, deletable: false, storage: { end_epoch: 525 } } };
type Chain = Parameters<typeof verifyStorageReceipt>[1];
const client = (value: unknown): Chain => ({ getObject: async () => ({ object: value }) }) as unknown as Chain;

test('Walrus receipts require the actual canonical permanent certified object and matching content/owner/retention', async () => {
  assert.deepEqual(await verifyStorageReceipt(receipt, client(object), id('0xa')), { blobId, endEpoch: '525' });
  for (const changed of [
    { ...object, type: `${id('0xf')}::blob::Blob` }, { ...object, objectId: id('0xc') },
    { ...object, owner: { $kind: 'AddressOwner', AddressOwner: id('0xd') } },
    { ...object, json: { ...object.json, deletable: true } },
    { ...object, json: { ...object.json, blob_id: '124' } },
    { ...object, json: { ...object.json, storage: { end_epoch: 524 } } },
  ]) await assert.rejects(verifyStorageReceipt(receipt, client(changed), id('0xa')));
  await assert.rejects(verifyStorageReceipt({ newlyCreated: { blobObject: { ...receipt.newlyCreated.blobObject, deletable: true } } }, client(object), id('0xa')));
  // The HTTP publisher can return a pre-certification snapshot. The actual object is authoritative.
  let calls = 0;
  const pending = { getObject: async () => ({ object: ++calls === 1 ? { ...object, json: { ...object.json, certified_epoch: null } } : object }) } as unknown as Chain;
  await verifyStorageReceipt(receipt, pending, id('0xa')); assert.equal(calls, 2);
});

test('already-certified receipts require a successful canonical non-deletable BlobCertified event', async () => {
  const schema = bcs.struct('BlobCertified', { epoch: bcs.u32(), blob_id: bcs.u256(), end_epoch: bcs.u32(), deletable: bcs.bool(), object_id: bcs.Address, is_extension: bcs.bool() });
  const claimed = { alreadyCertified: { blobId, endEpoch: 525, event: { txDigest: 'fixture-digest' } } };
  const event = { epoch: 518, blob_id: '123', end_epoch: 525, deletable: false, object_id: id('0xb'), is_extension: false };
  const make = (data = event, type = `${origin}::events::BlobCertified`, success = true): Chain => ({
    getTransaction: async () => ({ $kind: 'Transaction', Transaction: { status: { success }, events: [{ eventType: type, bcs: schema.serialize(data).toBytes() }] } }),
  }) as unknown as Chain;
  assert.deepEqual(await verifyStorageReceipt(claimed, make(), id('0xa')), { blobId, endEpoch: '525' });
  for (const invalid of [make({ ...event, deletable: true }), make({ ...event, blob_id: '999' }),
    make({ ...event, end_epoch: 524 }), make(event, `${id('0xf')}::events::BlobCertified`), make(event, undefined, false)])
    await assert.rejects(verifyStorageReceipt(claimed, invalid, id('0xa')));
});
