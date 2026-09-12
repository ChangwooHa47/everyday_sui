import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { normalizeSuiAddress as id } from '@mysten/sui/utils';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { TransactionError } from '@mysten/sui/client';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { MarketListing } from '@everyday/contracts';
import { migration } from '../src/database.js';
import { createGiftService, createGiftTransport, type GiftTransport } from '../src/gifts.js';

const listing: MarketListing = { id: id('0x10'), creator: id('0xa'), operator: id('0xc'), title: 'Gift fixture', priceMist: '1000', agentBps: 2000, treasuryMist: '200',
  active: true, published: true, package: { blobId: 'a'.repeat(43), contentHash: '0'.repeat(64), endEpoch: '2000' },
  policy: { perGiftLimitMist: '100', dailyLimitMist: '200', allowedGiftIds: [id('0xd')] } };
test('agent gifts claim one intent and recover ambiguous execution with identical signed bytes', async t => {
  const db = new PGlite(); await db.exec(migration); t.after(() => db.close());
  let decisions = 0, preparations = 0, sends = 0; const observed: string[] = [];
  const transport: GiftTransport = {
    products: async () => [{ id: id('0xd'), title: 'Photo booth', priceMist: '100' }],
    prepare: async (_listing, _product, recipient) => { preparations++; assert.equal(recipient, id('0xb')); return { bytes: 'same-signed-bytes', signature: 'same-signature', digest: 'same-digest' }; },
    execute: async bytes => { sends++; observed.push(bytes); if (sends === 1) throw Error('timeout after submission'); return 'confirmed'; },
  };
  const service = createGiftService(db, transport, async () => { decisions++; return id('0xd'); });
  const results = await Promise.all([1, 2].map(() => service.propose(id('0xb'), listing, 'turn-one', [{ role: 'user', content: 'PRIVATE_BIRTHDAY' }])));
  assert.ok(results.some(r => r.status === 'unknown')); assert.equal(decisions, 1); assert.equal(preparations, 1);
  await service.recover();
  assert.equal((await service.propose(id('0xb'), listing, 'turn-one', [])).status, 'confirmed');
  assert.deepEqual(observed, ['same-signed-bytes', 'same-signed-bytes']);
  assert.equal(decisions, 1); assert.equal(preparations, 1);
  assert.ok(!JSON.stringify((await db.query('SELECT * FROM agent_gifts')).rows).includes('PRIVATE_BIRTHDAY'));
});
test('invalid LLM product and declined proposals never reach signing', async t => {
  const db = new PGlite(); await db.exec(migration); t.after(() => db.close());
  let preparations = 0;
  const transport: GiftTransport = { products: async () => [{ id: id('0xd'), title: 'Allowed', priceMist: '100' }],
    prepare: async () => { preparations++; throw Error('must not sign'); }, execute: async () => 'confirmed' };
  assert.equal((await createGiftService(db, transport, async () => id('0xe')).propose(id('0xb'), listing, 'bad', [])).status, 'unknown');
  assert.equal((await createGiftService(db, transport, async () => null).propose(id('0xb'), listing, 'no', [])).status, 'declined');
  assert.equal(preparations, 0);
});

test('gift transport submits only after explicit notFound and never confirms a failed or mismatched receipt', async () => {
  const key = new Ed25519Keypair(), tx = new Transaction(); tx.setSender(key.toSuiAddress()); tx.setGasBudget(1000000); tx.setGasPrice(1000);
  tx.setGasPayment([{ objectId: id('0xaa'), version: '1', digest: '11111111111111111111111111111111' }]);
  tx.moveCall({ target: `${id('0x99')}::market::send_gift` });
  const signed = await key.signTransaction(await tx.build()), digest = await Transaction.from(signed.bytes).getDigest();
  let state: 'unavailable' | 'notFound' | 'confirmed' | 'failed' | 'mismatch' = 'unavailable', sends = 0;
  const receipt = (failed = false, receiptDigest = digest) => failed
    ? { $kind: 'FailedTransaction', FailedTransaction: { digest: receiptDigest, status: { success: false } } }
    : { $kind: 'Transaction', Transaction: { digest: receiptDigest, status: { success: true } } };
  const client = { getTransaction: async () => {
    if (state === 'unavailable') throw Error('RPC unavailable');
    if (state === 'notFound') throw new TransactionError('notFound', digest);
    return receipt(state === 'failed', state === 'mismatch' ? 'wrong-digest' : digest);
  }, executeTransaction: async (input: { transaction: Uint8Array; signatures: string[] }) => {
    sends++; assert.equal(Buffer.from(input.transaction).toString('base64'), signed.bytes); assert.deepEqual(input.signatures, [signed.signature]); return receipt();
  }, waitForTransaction: async () => receipt() } as unknown as SuiGrpcClient;
  const transport = createGiftTransport(id('0x99'), 'https://invalid.example', key.getSecretKey(), client);
  const execute = () => transport.execute(signed.bytes, signed.signature, digest);
  await assert.rejects(execute, /RPC unavailable/); assert.equal(sends, 0);
  state = 'failed'; assert.equal(await execute(), 'failed'); assert.equal(sends, 0);
  state = 'mismatch'; await assert.rejects(execute, { statusCode: 503 }); assert.equal(sends, 0);
  state = 'confirmed'; assert.equal(await execute(), 'confirmed'); assert.equal(sends, 0);
  state = 'notFound'; assert.equal(await execute(), 'confirmed'); assert.equal(sends, 1);
});
