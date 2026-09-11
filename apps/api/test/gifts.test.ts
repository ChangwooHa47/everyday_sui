import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { normalizeSuiAddress as id } from '@mysten/sui/utils';
import type { MarketListing } from '@everyday/contracts';
import { migration } from '../src/database.js';
import { createGiftService, type GiftTransport } from '../src/gifts.js';

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
