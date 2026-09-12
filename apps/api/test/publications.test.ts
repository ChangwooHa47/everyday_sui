import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeSuiAddress as id } from '@mysten/sui/utils';
import { buildApp } from '../src/app.js';
import { migration } from '../src/database.js';
import { failure, hash } from '../src/auth.js';

test('publication identity and signed steps survive another session and serialize concurrent tabs', async t => {
  const db = new PGlite(); await db.exec(migration);
  const ownerKey = new Ed25519Keypair(), owner = ownerKey.toSuiAddress(), otherKey = new Ed25519Keypair();
  const origin = 'http://127.0.0.1:3000', pkg = id('0x99');
  for (const [token, actor] of [['a', owner], ['b', owner], ['c', otherKey.toSuiAddress()]]) {
    await db.query("INSERT INTO wallet_sessions VALUES($1,$2,$3,now()+interval '30 minutes')", [hash(token.repeat(43)), actor, origin]);
  }
  const statuses = new Map<string, 'confirmed' | 'failed' | 'notFound'>();
  let unavailable = false;
  const app = buildApp(false, { db, auth: { origins: [origin], audience: 'test', network: 'testnet' }, market: {
    packageId: pkg, listing: async () => { throw Error('not used'); }, hasLicense: async () => false,
    transactionStatus: async digest => { if (unavailable) throw failure(503, 'CHAIN_UNAVAILABLE'); return statuses.get(digest) ?? 'notFound'; },
  } });
  t.after(async () => { await app.close(); await db.close(); });
  const headers = (token = 'a') => ({ origin, authorization: `Bearer ${token.repeat(43)}` });
  const identity = { characterId: 42, fingerprint: 'ab'.repeat(32) };
  const claim = async (payload = identity, token = 'a') => app.inject({ method: 'POST', url: '/v1/me/publications', headers: headers(token), payload });
  const first = await claim(); assert.equal(first.statusCode, 200);
  const publicationId = first.json().publicationId;
  assert.equal((await claim(identity, 'b')).json().publicationId, publicationId);
  assert.notEqual((await claim({ ...identity, fingerprint: 'cd'.repeat(32) })).json().publicationId, publicationId);
  assert.notEqual((await claim(identity, 'c')).json().publicationId, publicationId);
  const url = `/v1/me/publications/${publicationId}/steps/creator`;
  assert.deepEqual((await app.inject({ url, headers: headers('b') })).json(), { step: null });
  assert.equal((await app.inject({ url, headers: headers('c') })).statusCode, 404);
  const signed = async (version: string, packageId = pkg, signer = ownerKey, functionName = 'register_creator') => {
    const tx = new Transaction(); tx.setSender(signer.toSuiAddress()); tx.setGasPrice(1000); tx.setGasBudget(1000000);
    tx.setGasPayment([{ objectId: id('0xaabb'), version, digest: '11111111111111111111111111111111' }]);
    tx.moveCall({ target: `${packageId}::market::${functionName}` });
    const result = await signer.signTransaction(await tx.build());
    return { ...result, digest: await Transaction.from(result.bytes).getDigest() };
  };
  const one = await signed('1'), two = await signed('2');
  const posts = await Promise.all([one, two].map(payload => app.inject({ method: 'POST', url, headers: headers(), payload })));
  posts.forEach(result => assert.equal(result.statusCode, 200));
  const winner = posts[0].json(); assert.deepEqual(posts[1].json(), winner);
  assert.deepEqual((await app.inject({ url, headers: headers('b') })).json().step, winner);
  for (const payload of [await signed('3', id('0x98')), await signed('3', pkg, otherKey), await signed('3', pkg, ownerKey, 'purchase'), { ...one, digest: '11111111111111111111111111111111' }]) {
    assert.equal((await app.inject({ method: 'POST', url, headers: headers(), payload })).statusCode, 400);
  }
  const replacement = await signed('4');
  statuses.set(winner.digest, 'confirmed');
  assert.deepEqual((await app.inject({ method: 'POST', url, headers: headers(), payload: replacement })).json(), winner);
  unavailable = true;
  assert.equal((await app.inject({ method: 'POST', url, headers: headers(), payload: replacement })).statusCode, 503);
  assert.deepEqual((await app.inject({ url, headers: headers() })).json().step, winner);
  unavailable = false; statuses.set(winner.digest, 'failed');
  assert.deepEqual((await app.inject({ method: 'POST', url, headers: headers(), payload: replacement })).json(), replacement);
});
