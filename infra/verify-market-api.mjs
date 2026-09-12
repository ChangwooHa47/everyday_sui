// Read-only real provider verification through the API. Uses an isolated PGlite database.
// No browser, new chain transactions, uploads, or real user data.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { buildApp } from '../apps/api/dist/app.js';
import { migration } from '../apps/api/dist/database.js';
import { createMarketChain } from '../apps/api/dist/market-chain.js';
import { runtimeFromEnv } from '../apps/api/dist/runtime-config.js';

const root = resolve(import.meta.dirname, '..');
const state = resolve(root, '.local-tools/market-testnet-v2');
const evidence = name => JSON.parse(readFileSync(resolve(root, 'contracts/everyday/deployments', name), 'utf8'));
const deployed = evidence('testnet.json'), purchase = evidence('testnet-verification.json');
const savedMemory = evidence('memory-verification.json'), seeds = evidence('market-seed.json');
assert.equal(deployed.network, 'testnet');
assert.equal(purchase.packageId, deployed.packageId);
assert.equal(seeds.packageId, deployed.packageId);
assert.equal(seeds.listings.length, 10);
const key = name => Ed25519Keypair.fromSecretKey(readFileSync(resolve(state, `${name}.key`), 'utf8'));
const creator = key('creator'), buyer = key('buyer'), stranger = key('operator');
const rpcUrl = 'https://fullnode.testnet.sui.io:443';
const chain = createMarketChain(deployed.packageId, new SuiGrpcClient({ network: 'testnet', baseUrl: rpcUrl }));
const db = new PGlite();
await db.exec(migration);
const providers = runtimeFromEnv(chain, {
  SUI_OPERATOR_KEY: stranger.getSecretKey(), SUI_GRPC_URL: rpcUrl,
  SEAL_SERVERS_JSON: JSON.stringify([
    { objectId: '0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98', aggregatorUrl: 'https://seal-aggregator-testnet.mystenlabs.com', weight: 1 },
    { objectId: '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75', weight: 1 },
  ]),
  WALRUS_PUBLISHER: 'https://publisher.walrus-testnet.walrus.space',
  WALRUS_AGGREGATOR: 'https://aggregator.walrus-testnet.walrus.space',
  MEMWAL_DELEGATE_MASTER_KEY: readFileSync(resolve(state, 'memwal-master.key'), 'utf8'),
  MEMWAL_PACKAGE_ID: savedMemory.packageId, MEMWAL_REGISTRY_ID: savedMemory.registryId,
});
const origins = ['http://127.0.0.1:3000', 'http://127.0.0.1:3002'];
const app = buildApp(false, { db, auth: { origins, audience: 'everyday-api-verification', network: 'testnet' }, market: chain, ...providers });
async function request(method, url, headers, payload, status = 200) {
  const response = await app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });
  assert.equal(response.statusCode, status, `${method} ${url}: ${response.statusCode}`);
  return response.statusCode === 204 ? undefined : response.json();
}
async function login(signer, origin) {
  const challenge = await request('POST', '/v1/auth/challenges', { origin }, { address: signer.toSuiAddress(), network: 'testnet' });
  const signed = await signer.signPersonalMessage(new TextEncoder().encode(challenge.message));
  const session = await request('POST', '/v1/auth/sessions', { origin }, { challengeId: challenge.id, signature: signed.signature });
  assert.equal(session.address, signer.toSuiAddress());
  return { origin, authorization: `Bearer ${session.token}` };
}
try {
  const owner = await login(creator, origins[0]), first = await login(buyer, origins[0]);
  const second = await login(buyer, origins[1]), unrelated = await login(stranger, origins[1]);
  for (const item of seeds.listings) {
    await request('POST', '/v1/market/listings', owner, { listingId: item.listingId });
    console.log(JSON.stringify({ verifiedCatalog: item.listingId }));
  }
  const catalog = await request('GET', '/v1/market/listings?limit=20');
  assert.equal(catalog.listings.length, 10);
  assert.equal(Object.keys(catalog.previews).length, 10);
  for (const item of seeds.listings) {
    assert.equal(catalog.listings.find(listing => listing.id === item.listingId).title, item.name);
    assert.ok(catalog.previews[item.listingId].imageUrl.includes(item.image.blobId));
  }
  const path = `/v1/market/listings/${purchase.listingId}/character?licenseId=${purchase.licenseId}`;
  const a = await request('GET', path, first), b = await request('GET', path, second);
  assert.deepEqual(a, b);
  assert.equal(a.characterPackage.character.name, 'Haru');
  await request('GET', path, unrelated, undefined, 403);
  await request('GET', '/v1/me', { ...first, origin: origins[1] }, undefined, 401);
  await request('POST', '/v1/me/memory-account', first, { accountId: savedMemory.accountId, consent: true });
  await request('POST', '/v1/me/memory-account', unrelated, { accountId: savedMemory.accountId, consent: true }, 403);
  for (const headers of [first, second]) {
    const recall = await request('POST', `/v1/me/relationships/${purchase.listingId}/recall`, headers, { query: 'What kind of tea do I like?' });
    assert.ok(recall.results.some(item => /mint/i.test(item.text)));
  }
  const isolated = await request('POST', `/v1/me/relationships/${seeds.listings[0].listingId}/recall`, second, { query: 'What kind of tea do I like?' });
  assert.deepEqual(isolated.results, []);
  await request('DELETE', '/v1/me/memory-account', first, undefined, 204);
  await request('POST', `/v1/me/relationships/${purchase.listingId}/recall`, second, { query: 'tea' }, 409);
  const report = { network: 'testnet', packageId: deployed.packageId, verifiedAt: new Date().toISOString(),
    database: 'isolated PGlite; not the deployed production database',
    catalogCount: 10, authenticatedOrigins: origins, realWalletSignatures: true, exactLicenseAccess: true,
    sealPackageEqualAcrossOrigins: true, memoryRecalledAcrossOrigins: true, otherOwnerDenied: true,
    otherCharacterMemoryEmpty: true, disabledMemoryDenied: true,
    note: 'Actual Sui, Walrus, Seal and MemWal adapters through Fastify HTTP injection. No browser/UI or paid AI/image calls. Catalog registration was isolated to this verification database.' };
  writeFileSync(resolve(root, 'contracts/everyday/deployments/api-verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', ...report }, null, 2));
} finally { await app.close(); await db.close(); }
