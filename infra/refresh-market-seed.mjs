// Re-publish the fictional seed market with a new creator and fresh Walrus retention.
// Run through `railway run` so the existing production operator/Seal configuration is reused
// without copying secrets into the repository or command output.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getFaucetHost, requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { TransactionError } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64, fromHex } from '@mysten/sui/utils';
import { createMarketChain } from '../apps/api/dist/market-chain.js';
import { createPackageStore, verifyStorageReceipt } from '../apps/api/dist/market-package.js';

if (!process.argv.includes('--execute')) throw Error('Use --execute for the authorized testnet refresh.');
function argument(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index < 0 ? fallback : process.argv[index + 1];
}
function exactHttps(value, name) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value) throw Error(`${name} must be an exact HTTPS origin`);
  return value;
}
function httpsEndpoint(value, name) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error(`${name} must be an HTTPS endpoint`);
  return value.replace(/\/$/, '');
}
const api = exactHttps(argument('--api'), '--api');
const origin = exactHttps(argument('--origin'), '--origin');
const epochs = Number(argument('--epochs', '53'));
if (!Number.isInteger(epochs) || epochs < 1 || epochs > 53) throw Error('--epochs must be between 1 and 53');
const stateName = argument('--state-name', 'market-seed-refresh-2026-09-19');
if (!/^[a-z0-9-]{1,80}$/.test(stateName)) throw Error('--state-name must be a safe local directory name');
const giftIds = (argument('--gift-ids', '') || '').split(',').filter(Boolean);
const perGiftLimitMist = argument('--per-gift-limit-mist', giftIds.length ? '500000' : '0');
const dailyLimitMist = argument('--daily-limit-mist', giftIds.length ? '1000000' : '0');
if (giftIds.length > 20 || giftIds.some(id => !/^0x[0-9a-f]{64}$/.test(id))
  || !/^(0|[1-9][0-9]{0,19})$/.test(perGiftLimitMist) || !/^(0|[1-9][0-9]{0,19})$/.test(dailyLimitMist)
  || BigInt(perGiftLimitMist) > BigInt(dailyLimitMist)
  || (giftIds.length === 0) !== (BigInt(perGiftLimitMist) === 0n && BigInt(dailyLimitMist) === 0n))
  throw Error('Gift IDs and limits must define one complete bounded policy');

const root = resolve(import.meta.dirname, '..');
const stateDir = resolve(root, '.local-tools', stateName);
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const packageId = process.env.SUI_MARKET_PACKAGE_ID;
const operatorKey = process.env.SUI_OPERATOR_KEY;
const rpcUrl = httpsEndpoint(process.env.SUI_GRPC_URL ?? 'https://fullnode.testnet.sui.io:443', 'SUI_GRPC_URL');
const publisher = httpsEndpoint(process.env.WALRUS_PUBLISHER, 'WALRUS_PUBLISHER');
const aggregator = httpsEndpoint(process.env.WALRUS_AGGREGATOR, 'WALRUS_AGGREGATOR');
const servers = JSON.parse(process.env.SEAL_SERVERS_JSON ?? 'null');
const threshold = Number(process.env.SEAL_THRESHOLD ?? '2');
if (!/^0x[0-9a-f]{64}$/.test(packageId ?? '') || !operatorKey || !Array.isArray(servers) || servers.length < 2) {
  throw Error('Production market, operator, and Seal configuration are required');
}

const creatorKeyPath = resolve(stateDir, 'creator.key');
if (!existsSync(creatorKeyPath)) {
  writeFileSync(creatorKeyPath, new Ed25519Keypair().getSecretKey(), { flag: 'wx', mode: 0o600 });
}
const creator = Ed25519Keypair.fromSecretKey(readFileSync(creatorKeyPath, 'utf8'));
const operator = Ed25519Keypair.fromSecretKey(operatorKey);
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: rpcUrl });
const chain = createMarketChain(packageId, client);
const store = createPackageStore({ packageId, rpcUrl, operatorKey, servers, threshold, publisher, aggregator, epochs,
  walrusTypeOrigin: process.env.WALRUS_TYPE_ORIGIN });
assert.equal(store.operator, operator.toSuiAddress());

const configResponse = await fetch(`${api}/v1/market/config`, { signal: AbortSignal.timeout(15000) });
assert.equal(configResponse.ok, true, 'Production market config is unavailable');
const production = await configResponse.json();
assert.equal(production.network, 'testnet');
assert.equal(production.packageId, packageId);
assert.equal(production.operator, operator.toSuiAddress());

const seeds = JSON.parse(readFileSync(resolve(root, 'infra/market-seed.json'), 'utf8'));
assert.equal(seeds.length, 10);
const evidencePath = resolve(root, 'contracts/everyday/deployments/market-seed.json');
const previousPath = resolve(stateDir, 'previous-market-seed.json');
if (!existsSync(previousPath)) {
  const previous = JSON.parse(readFileSync(evidencePath, 'utf8'));
  assert.equal(previous.packageId, packageId);
  assert.equal(previous.listings.length, 10);
  writeFileSync(previousPath, JSON.stringify(previous, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}

async function balance() {
  return BigInt((await client.getBalance({ owner: creator.toSuiAddress() })).balance.balance);
}
async function executeWithKey(name, key, tx) {
  const path = resolve(stateDir, `tx-${name}.json`);
  let pending;
  if (existsSync(path)) pending = JSON.parse(readFileSync(path, 'utf8'));
  else {
    tx.setSender(key.toSuiAddress());
    tx.setGasBudget('20000000');
    const bytes = await tx.build({ client });
    const simulation = await client.simulateTransaction({ transaction: bytes, signal: AbortSignal.timeout(30000) });
    assert.equal(simulation.$kind, 'Transaction', `${name}: simulation failed`);
    pending = { ...(await key.signTransaction(bytes)), digest: await Transaction.from(bytes).getDigest() };
    writeFileSync(path, JSON.stringify(pending), { flag: 'wx', mode: 0o600 });
  }
  assert.equal(Transaction.from(pending.bytes).getData().sender, key.toSuiAddress());
  assert.equal(await Transaction.from(pending.bytes).getDigest(), pending.digest);
  const include = { objectTypes: true, effects: true, events: true };
  let result;
  try { result = await client.getTransaction({ digest: pending.digest, include, signal: AbortSignal.timeout(20000) }); }
  catch (error) {
    if (!(error instanceof TransactionError) || error.reason !== 'notFound') throw error;
    result = await client.executeTransaction({ transaction: fromBase64(pending.bytes), signatures: [pending.signature], include,
      signal: AbortSignal.timeout(30000) });
  }
  assert.equal(result.$kind, 'Transaction', `${name}: execution failed`);
  const confirmed = await client.waitForTransaction({ digest: pending.digest, include, timeout: 30000 });
  assert.equal(confirmed.$kind, 'Transaction');
  assert.equal(confirmed.Transaction.status.success, true);
  console.log(JSON.stringify({ step: name, digest: pending.digest, status: 'confirmed' }));
  return confirmed.Transaction;
}
const execute = (name, tx) => executeWithKey(name, creator, tx);
function createdObject(result, type) {
  const match = Object.entries(result.objectTypes).find(([, value]) => value === `${packageId}::market::${type}`);
  assert.ok(match, `${type} object not found`);
  return match[0];
}

if (await balance() < 500_000_000n) {
  let requested = false;
  try {
    await requestSuiFromFaucetV2({ host: getFaucetHost('testnet'), recipient: creator.toSuiAddress() });
    requested = true;
  } catch (error) {
    console.log(JSON.stringify({ step: 'faucet', status: 'unavailable', error: error?.name ?? 'Error' }));
  }
  for (let attempt = 0; requested && attempt < 30 && await balance() < 500_000_000n; attempt++) {
    await new Promise(resolveWait => setTimeout(resolveWait, 1000));
  }
}
if (await balance() < 500_000_000n) {
  const fundingPath = argument('--funding-key');
  if (!fundingPath) throw Error('The faucet is unavailable; provide an approved testnet --funding-key');
  const funding = Ed25519Keypair.fromSecretKey(readFileSync(resolve(root, fundingPath), 'utf8'));
  assert.notEqual(funding.toSuiAddress(), creator.toSuiAddress());
  const fundingBalance = BigInt((await client.getBalance({ owner: funding.toSuiAddress() })).balance.balance);
  assert.ok(fundingBalance >= 700_000_000n, 'The testnet funding account does not have enough gas');
  const transfer = new Transaction();
  const [coin] = transfer.splitCoins(transfer.gas, [transfer.pure.u64('600000000')]);
  transfer.transferObjects([coin], creator.toSuiAddress());
  await executeWithKey('funding', funding, transfer);
}
assert.ok(await balance() >= 500_000_000n, 'The new seed creator needs at least 0.5 testnet SUI');

const creators = await client.listOwnedObjects({ owner: creator.toSuiAddress(), type: `${packageId}::market::Creator`, limit: 10 });
let creatorId = creators.objects.find(item => item.owner.$kind === 'AddressOwner' && item.owner.AddressOwner === creator.toSuiAddress())?.objectId;
if (!creatorId) {
  const tx = new Transaction();
  tx.moveCall({ target: `${packageId}::market::register_creator` });
  creatorId = createdObject(await execute('creator', tx), 'Creator');
}

async function uploadImage(index, seed) {
  const statePath = resolve(stateDir, `seed-${index}-image.json`);
  const bytes = readFileSync(resolve(root, 'apps/web/public/portraits', seed.image));
  const inputHash = createHash('sha256').update(bytes).digest('hex');
  let state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
  if (state?.reference) {
    const response = await fetch(`${aggregator}/v1/blobs/${state.reference.blobId}`, { signal: AbortSignal.timeout(30000) });
    assert.equal(response.ok, true, `seed-${index}: saved image is unavailable`);
    assert.equal(createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex'), inputHash);
    return state.reference;
  }
  if (state?.receipt) {
    const reference = await verifyStorageReceipt(state.receipt, client, creator.toSuiAddress(), process.env.WALRUS_TYPE_ORIGIN);
    writeFileSync(statePath, JSON.stringify({ inputHash, reference }));
    return reference;
  }
  if (state) throw Error(`seed-${index}: earlier image upload is uncertain; inspect it before retrying`);
  writeFileSync(statePath, JSON.stringify({ status: 'started', inputHash }), { flag: 'wx', mode: 0o600 });
  const url = new URL(`${publisher}/v1/blobs`);
  url.searchParams.set('epochs', String(epochs));
  url.searchParams.set('permanent', 'true');
  url.searchParams.set('send_object_to', creator.toSuiAddress());
  const response = await fetch(url, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'image/png' },
    signal: AbortSignal.timeout(120000) });
  assert.equal(response.ok, true, `seed-${index}: image upload failed (${response.status})`);
  const receipt = await response.json();
  writeFileSync(statePath, JSON.stringify({ inputHash, receipt }));
  const reference = await verifyStorageReceipt(receipt, client, creator.toSuiAddress(), process.env.WALRUS_TYPE_ORIGIN);
  const downloaded = await fetch(`${aggregator}/v1/blobs/${reference.blobId}`, { signal: AbortSignal.timeout(30000) });
  assert.equal(downloaded.ok, true);
  assert.equal(createHash('sha256').update(new Uint8Array(await downloaded.arrayBuffer())).digest('hex'), inputHash);
  writeFileSync(statePath, JSON.stringify({ inputHash, reference }));
  return reference;
}

const published = [];
for (let index = 0; index < seeds.length; index++) {
  const seed = seeds[index];
  assert.match(seed.image, /^[a-z0-9-]+\.png$/);
  const image = await uploadImage(index, seed);
  const create = new Transaction();
  create.moveCall({ target: `${packageId}::market::create_listing`, arguments: [create.object(creatorId),
    create.pure.address(operator.toSuiAddress()), create.pure.string(seed.name), create.pure.u64('10000000'), create.pure.u64(2000),
    create.pure.u64(perGiftLimitMist), create.pure.u64(dailyLimitMist), create.pure.vector('address', giftIds)] });
  const listingId = createdObject(await execute(`seed-${index}-listing`, create), 'Listing');
  const imageUrl = `${aggregator}/v1/blobs/${image.blobId}`;
  const data = { schemaVersion: 1, network: 'testnet', packageId, listingId,
    character: { name: seed.name, personality: seed.personality, summary: seed.summary,
      relationshipType: seed.relationshipType, speechStyles: [seed.style], imageUrl,
      background: `관심사: ${seed.interest}.` },
    preview: { name: seed.name, personality: seed.summary, summary: seed.summary, imageUrl },
    giftPersona: seed.giftPersona,
    examples: [{ role: 'user', content: '오늘 조금 지쳤어.' }, { role: 'assistant', content: '많이 애썼겠다. 무슨 일이 있었는지 천천히 말해줘.' },
      { role: 'user', content: '좋아하는 게 있어?' }, { role: 'assistant', content: `${seed.interest}에 관심이 있어. 너는 어떤 걸 좋아해?` }],
    episodes: [{ id: 'night-walk', title: '밤 산책', setting: '조용한 강변을 걸으며 하루를 이야기한다.' }],
  };
  const packagePath = resolve(stateDir, `seed-${index}-package.json`);
  let packageRef;
  if (existsSync(packagePath)) {
    const state = JSON.parse(readFileSync(packagePath, 'utf8'));
    if (!state.reference) throw Error(`seed-${index}: earlier package upload is uncertain; inspect it before retrying`);
    packageRef = state.reference;
  } else {
    writeFileSync(packagePath, JSON.stringify({ status: 'started', inputHash: createHash('sha256').update(JSON.stringify(data)).digest('hex') }),
      { flag: 'wx', mode: 0o600 });
    packageRef = await store.publish(await chain.listing(listingId), data);
    writeFileSync(packagePath, JSON.stringify({ reference: packageRef }));
  }
  const current = await chain.listing(listingId);
  if (!current.published) {
    const publish = new Transaction();
    publish.moveCall({ target: `${packageId}::market::publish`, arguments: [publish.object(listingId),
      publish.pure.string(packageRef.blobId), publish.pure.vector('u8', fromHex(packageRef.contentHash)), publish.pure.u64(packageRef.endEpoch)] });
    await execute(`seed-${index}-publish`, publish);
  }
  assert.deepEqual(await store.load(await chain.listing(listingId)), data);
  published.push({ listingId, name: seed.name, image, package: packageRef,
    publishDigest: JSON.parse(readFileSync(resolve(stateDir, `tx-seed-${index}-publish.json`), 'utf8')).digest });
  writeFileSync(evidencePath, JSON.stringify({ network: 'testnet', packageId, creator: creator.toSuiAddress(), operator: operator.toSuiAddress(),
    retentionEpochs: epochs, refreshedAt: new Date().toISOString(),
    note: 'Fictional seed characters using original image assets. Fresh Walrus retention and onchain publications; API catalog replacement is separate.',
    listings: published }, null, 2) + '\n');
}

let token;
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(api + path, { method, redirect: 'error', signal: AbortSignal.timeout(120000),
    headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? undefined : response.json();
}
const challenge = await request('/v1/auth/challenges', { network: 'testnet', address: creator.toSuiAddress() });
assert.ok(challenge.message.split('\n').includes(`Origin: ${origin}`));
assert.ok(challenge.message.split('\n').includes(`Audience: ${api}`));
const signed = await creator.signPersonalMessage(new TextEncoder().encode(challenge.message));
const session = await request('/v1/auth/sessions', { challengeId: challenge.id, signature: signed.signature });
assert.equal(session.address, creator.toSuiAddress());
token = session.token;
try {
  for (const item of published) {
    const registered = await request('/v1/market/listings', { listingId: item.listingId });
    assert.equal(registered.listing.creator, creator.toSuiAddress());
    assert.equal(registered.listing.package.contentHash, item.package.contentHash);
    console.log(JSON.stringify({ registered: item.listingId, name: item.name }));
  }
} finally {
  if (token) await request('/v1/auth/session', undefined, 'DELETE');
}
console.log(JSON.stringify({ status: 'passed', packageId, creator: creator.toSuiAddress(), operator: operator.toSuiAddress(),
  epochs, listings: published.length, giftPolicy: { allowedGiftIds: giftIds, perGiftLimitMist, dailyLimitMist },
  previousEvidence: previousPath, evidence: evidencePath }, null, 2));
