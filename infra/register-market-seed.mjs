// Register already-published fictional seed packages after deployment. No new payments or uploads.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

if (!process.argv.includes('--execute')) throw Error('Use --execute with --api and --origin for the deployed testnet catalog.');
function originArgument(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0 || !process.argv[index + 1]) throw Error(`Missing ${flag}`);
  const value = process.argv[index + 1], url = new URL(value);
  assert.equal(url.protocol, 'https:'); assert.equal(url.origin, value);
  return value;
}
const api = originArgument('--api'), origin = originArgument('--origin');
const root = resolve(import.meta.dirname, '..');
const seeds = JSON.parse(readFileSync(resolve(root, 'contracts/everyday/deployments/market-seed.json'), 'utf8'));
assert.equal(seeds.network, 'testnet'); assert.equal(seeds.listings.length, 10);
const creator = Ed25519Keypair.fromSecretKey(readFileSync(resolve(root, '.local-tools/market-testnet-v2/creator.key'), 'utf8'));
let token;
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(api + path, { method, redirect: 'error', signal: AbortSignal.timeout(120000),
    headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.ok(response.ok, `${method} ${path}: ${response.status}`);
  return response.status === 204 ? undefined : response.json();
}
const config = await request('/v1/market/config');
assert.equal(config.network, 'testnet'); assert.equal(config.packageId, seeds.packageId); assert.ok(config.operator);
const challenge = await request('/v1/auth/challenges', { network: 'testnet', address: creator.toSuiAddress() });
const signed = await creator.signPersonalMessage(new TextEncoder().encode(challenge.message));
const session = await request('/v1/auth/sessions', { challengeId: challenge.id, signature: signed.signature });
token = session.token;
try {
  for (const seed of seeds.listings) {
    const result = await request('/v1/market/listings', { listingId: seed.listingId });
    assert.equal(result.listing.creator, creator.toSuiAddress());
    assert.equal(result.listing.package.contentHash, seed.package.contentHash);
    console.log(JSON.stringify({ registered: seed.listingId }));
  }
  const found = new Set(); let cursor;
  do {
    const page = await request(`/v1/market/listings?limit=20${cursor ? `&after=${cursor}` : ''}`);
    for (const listing of page.listings) found.add(listing.id);
    assert.notEqual(page.nextCursor, cursor); cursor = page.nextCursor;
  } while (cursor);
  assert.ok(seeds.listings.every(seed => found.has(seed.listingId)));
  console.log(JSON.stringify({ status: 'passed', api, seedCount: seeds.listings.length, packageId: seeds.packageId }));
} finally { await request('/v1/auth/session', undefined, 'DELETE'); }
