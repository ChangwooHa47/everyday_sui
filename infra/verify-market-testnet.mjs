// Actual testnet transactions and Walrus/Seal calls. Fictional data only; never logs keys or signatures.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { TransactionError } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64, fromHex } from '@mysten/sui/utils';
import { SealClient, SessionKey } from '@mysten/seal';
import { bcs } from '@mysten/sui/bcs';
import { createPackageStore, verifyStorageReceipt, WALRUS_TESTNET_TYPE_ORIGIN } from '../apps/api/dist/market-package.js';
import { createMarketChain } from '../apps/api/dist/market-chain.js';
import { createMemoryProvider } from '../apps/api/dist/memory-provider.js';

if (!process.argv.includes('--execute')) throw Error('Use --execute for the authorized testnet verification.');
const root = resolve(import.meta.dirname, '..'), dir = resolve(root, '.local-tools/market-testnet-v2');
const deployment = JSON.parse(readFileSync(resolve(dir, 'deployment.json'), 'utf8'));
assert.equal(deployment.network, 'testnet');
const pkg = deployment.packageId;
const creator = Ed25519Keypair.fromSecretKey(readFileSync(resolve(dir, 'creator.key'), 'utf8'));
function dedicated(name) {
  const path = resolve(dir, `${name}.key`);
  if (!existsSync(path)) writeFileSync(path, new Ed25519Keypair().getSecretKey(), { flag: 'wx', mode: 0o600 });
  return Ed25519Keypair.fromSecretKey(readFileSync(path, 'utf8'));
}
const buyer = dedicated('buyer'), operator = dedicated('operator');
const rpcUrl = 'https://fullnode.testnet.sui.io:443';
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: rpcUrl });
const chain = createMarketChain(pkg, client);
const servers = [
  { objectId: '0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98', aggregatorUrl: 'https://seal-aggregator-testnet.mystenlabs.com', weight: 1 },
  { objectId: '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75', weight: 1 },
];
const publisher = 'https://publisher.walrus-testnet.walrus.space', aggregator = 'https://aggregator.walrus-testnet.walrus.space';
const store = createPackageStore({ packageId: pkg, rpcUrl, operatorKey: operator.getSecretKey(), servers, threshold: 2, publisher, aggregator, epochs: 7 });
async function execute(name, key, tx) {
  const path = resolve(dir, `verify-${name}.json`);
  let pending;
  if (existsSync(path)) pending = JSON.parse(readFileSync(path, 'utf8'));
  else {
    tx.setSender(key.toSuiAddress()); tx.setGasBudget('20000000');
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
    result = await client.executeTransaction({ transaction: fromBase64(pending.bytes), signatures: [pending.signature], include, signal: AbortSignal.timeout(30000) });
  }
  assert.equal(result.$kind, 'Transaction', `${name}: execution failed`);
  const confirmed = await client.waitForTransaction({ digest: pending.digest, include, timeout: 30000 });
  assert.equal(confirmed.$kind, 'Transaction'); assert.equal(confirmed.Transaction.status.success, true);
  console.log(JSON.stringify({ step: name, digest: pending.digest, status: 'confirmed' }));
  return confirmed.Transaction;
}
function object(result, type) {
  const matches = Object.entries(result.objectTypes).filter(([, value]) => value === `${pkg}::market::${type}`);
  assert.equal(matches.length, 1); return matches[0][0];
}
const funding = new Transaction();
const [buyerGas, operatorGas] = funding.splitCoins(funding.gas, [funding.pure.u64('100000000'), funding.pure.u64('50000000')]);
funding.transferObjects([buyerGas], buyer.toSuiAddress()); funding.transferObjects([operatorGas], operator.toSuiAddress());
await execute('funding', creator, funding);
const register = new Transaction(); register.moveCall({ target: `${pkg}::market::register_creator` });
const creatorId = object(await execute('creator', creator, register), 'Creator');
const gift = new Transaction(); gift.moveCall({ target: `${pkg}::market::create_gift`, arguments: [gift.object(deployment.adminId),
  gift.pure.string('Fictional demo gift'), gift.pure.address(creator.toSuiAddress()), gift.pure.u64('1000000')] });
const giftId = object(await execute('gift-product', creator, gift), 'GiftProduct');
const listingTx = new Transaction();
listingTx.moveCall({ target: `${pkg}::market::create_listing`, arguments: [listingTx.object(creatorId), listingTx.pure.address(operator.toSuiAddress()),
  listingTx.pure.string('Haru'), listingTx.pure.u64('10000000'), listingTx.pure.u64(2000),
  listingTx.pure.u64('1000000'), listingTx.pure.u64('1000000'), listingTx.pure.vector('address', [giftId])] });
const listingId = object(await execute('listing', creator, listingTx), 'Listing');
const payload = { schemaVersion: 1, network: 'testnet', packageId: pkg, listingId,
  character: { name: 'Haru', personality: 'A calm fictional friend who enjoys astronomy.', summary: 'Fictional astronomy companion',
    appearance: 'A fictional illustrated adult character.', speechStyles: ['Short, warm replies.'] },
  preview: { name: 'Haru', personality: 'A calm fictional friend.' },
  examples: [{ role: 'user', content: 'What can we see tonight?' }, { role: 'assistant', content: 'Let us look for the moon.' }], episodes: [],
};
const uploadPath = resolve(dir, 'verify-upload.json');
let reference;
if (existsSync(uploadPath)) {
  const saved = JSON.parse(readFileSync(uploadPath, 'utf8'));
  if (saved.reference) reference = saved.reference;
  else {
    const recoverAt = process.argv.indexOf('--recover-blob');
    if (recoverAt < 0) throw Error('Earlier upload is uncertain. Inspect its actual Blob before --recover-blob; no automatic upload retry.');
    const { object: previous } = await client.getObject({ objectId: process.argv[recoverAt + 1], include: { json: true } });
    assert.equal(previous.type, `${WALRUS_TESTNET_TYPE_ORIGIN}::blob::Blob`);
    assert.equal(previous.owner.AddressOwner, creator.toSuiAddress());
    const blobId = Buffer.from(bcs.u256().serialize(previous.json.blob_id).toBytes()).toString('base64url');
    const response = await fetch(`${aggregator}/v1/blobs/${blobId}`, { signal: AbortSignal.timeout(30000) });
    assert.equal(response.ok, true);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    assert.deepEqual(await store.load({ ...await chain.listing(listingId), package: { blobId, contentHash, endEpoch: String(previous.json.storage.end_epoch) } }), payload);
    let raw = saved.recoveryReceipt;
    if (!raw) {
      const stored = await fetch(`${publisher}/v1/blobs?epochs=7&permanent=true&send_object_to=${creator.toSuiAddress()}`, {
        method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/octet-stream' }, signal: AbortSignal.timeout(120000),
      });
      assert.equal(stored.ok, true);
      raw = await stored.json();
      writeFileSync(uploadPath, JSON.stringify({ ...saved, recoveryReceipt: raw }));
    }
    reference = { ...await verifyStorageReceipt(raw, client, creator.toSuiAddress()), contentHash };
    writeFileSync(uploadPath, JSON.stringify({ status: 'ready', reference }));
  }
} else {
  writeFileSync(uploadPath, JSON.stringify({ status: 'started', inputHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex') }), { flag: 'wx' });
  reference = await store.publish(await chain.listing(listingId), payload);
  writeFileSync(uploadPath, JSON.stringify({ status: 'ready', reference }));
}
const publish = new Transaction(); publish.moveCall({ target: `${pkg}::market::publish`, arguments: [publish.object(listingId),
  publish.pure.string(reference.blobId), publish.pure.vector('u8', fromHex(reference.contentHash)), publish.pure.u64(reference.endEpoch)] });
await execute('publish', creator, publish);
assert.deepEqual(await store.load(await chain.listing(listingId)), payload);

const receiptPath = resolve(dir, 'verify-settlement.json');
let settlement = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : null;
if (!settlement) {
  settlement = { creatorBefore: (await client.getBalance({ owner: creator.toSuiAddress() })).balance.balance,
    treasuryBefore: (await chain.listing(listingId)).treasuryMist };
  writeFileSync(receiptPath, JSON.stringify(settlement), { flag: 'wx' });
}
const purchase = new Transaction(); const [payment] = purchase.splitCoins(purchase.gas, [purchase.pure.u64('10000000')]);
purchase.moveCall({ target: `${pkg}::market::purchase`, arguments: [purchase.object(listingId), payment] });
const bought = await execute('purchase', buyer, purchase);
const licenseId = object(bought, 'License');
assert.equal(await chain.hasLicense(buyer.toSuiAddress(), listingId, licenseId), true);
assert.equal(await chain.hasLicense(operator.toSuiAddress(), listingId, licenseId), false);
if (!settlement.verified) {
  const creatorAfter = (await client.getBalance({ owner: creator.toSuiAddress() })).balance.balance;
  const treasuryAfter = (await chain.listing(listingId)).treasuryMist;
  assert.equal(BigInt(creatorAfter) - BigInt(settlement.creatorBefore), 8000000n);
  assert.equal(BigInt(treasuryAfter) - BigInt(settlement.treasuryBefore), 2000000n);
  settlement = { ...settlement, creatorAfter, treasuryAfter, verified: true };
  writeFileSync(receiptPath, JSON.stringify(settlement));
}
const seal = new SealClient({ suiClient: client, serverConfigs: servers, verifyKeyServers: true });
const sessionKey = await SessionKey.create({ address: buyer.toSuiAddress(), packageId: pkg, ttlMin: 5, signer: buyer, suiClient: client });
const approve = new Transaction(); approve.setSender(buyer.toSuiAddress());
approve.moveCall({ target: `${pkg}::market::seal_approve`, arguments: [approve.pure.vector('u8', fromHex(listingId)), approve.object(listingId)] });
const encrypted = new Uint8Array(await (await fetch(`${aggregator}/v1/blobs/${reference.blobId}`, { signal: AbortSignal.timeout(30000) })).arrayBuffer());
const decrypted = await seal.decrypt({ data: encrypted, sessionKey, txBytes: await approve.build({ client, onlyTransactionKind: true }) });
assert.deepEqual(JSON.parse(new TextDecoder().decode(decrypted)), payload); decrypted.fill(0);
const giftTx = new Transaction();
giftTx.moveCall({ target: `${pkg}::market::send_gift`, arguments: [giftTx.object(listingId), giftTx.object(giftId), giftTx.pure.address(buyer.toSuiAddress()),
  giftTx.pure.vector('u8', new Uint8Array(32).fill(42)), giftTx.object('0x6')] });
const gifted = await execute('gift', operator, giftTx);
const giftReceiptId = object(gifted, 'GiftReceipt');
const giftReceipt = (await client.getObject({ objectId: giftReceiptId })).object;
assert.equal(giftReceipt.owner.AddressOwner, buyer.toSuiAddress());
const report = { network: 'testnet', packageId: pkg, listingId, creator: creator.toSuiAddress(), operator: operator.toSuiAddress(), buyer: buyer.toSuiAddress(),
  licenseId, purchaseDigest: bought.digest, priceMist: '10000000', creatorAmountMist: '8000000', treasuryAmountMist: '2000000',
  storage: reference, sealOperatorDecrypt: true, sealBuyerDecrypt: true, giftReceiptId, giftDigest: gifted.digest,
  note: 'Fictional test data. Gift policy execution only; no LLM agency or real-world gift fulfillment is claimed.' };
writeFileSync(resolve(root, 'contracts/everyday/deployments/testnet-verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: 'passed', ...report }, null, 2));

if (process.argv.includes('--seed-market')) {
  const seeds = JSON.parse(readFileSync(resolve(root, 'infra/market-seed.json'), 'utf8'));
  const published = [];
  for (let index = 0; index < seeds.length; index++) {
    const seed = seeds[index], name = `seed-${index}`;
    const imagePath = resolve(dir, `${name}-image.json`);
    let imageRef;
    if (existsSync(imagePath)) imageRef = JSON.parse(readFileSync(imagePath, 'utf8')).reference;
    else {
      assert.match(seed.image, /^[a-z0-9-]+\.png$/);
      const imageBytes = readFileSync(resolve(root, 'apps/web/public/portraits', seed.image));
      writeFileSync(imagePath, JSON.stringify({ status: 'started' }), { flag: 'wx' });
      const response = await fetch(`${publisher}/v1/blobs?epochs=7&permanent=true&send_object_to=${creator.toSuiAddress()}`, {
        method: 'PUT', body: imageBytes, headers: { 'Content-Type': 'image/png' }, signal: AbortSignal.timeout(120000),
      });
      assert.equal(response.ok, true);
      const receipt = await response.json(); writeFileSync(imagePath, JSON.stringify({ receipt }));
      imageRef = await verifyStorageReceipt(receipt, client, creator.toSuiAddress());
      const read = new Uint8Array(await (await fetch(`${aggregator}/v1/blobs/${imageRef.blobId}`, { signal: AbortSignal.timeout(30000) })).arrayBuffer());
      assert.equal(createHash('sha256').update(read).digest('hex'), createHash('sha256').update(imageBytes).digest('hex'));
      writeFileSync(imagePath, JSON.stringify({ reference: imageRef }));
    }
    if (!imageRef) throw Error(`${name}: reconcile the saved upload receipt; do not automatically repeat the upload`);
    const create = new Transaction();
    create.moveCall({ target: `${pkg}::market::create_listing`, arguments: [create.object(creatorId), create.pure.address(operator.toSuiAddress()),
      create.pure.string(seed.name), create.pure.u64('10000000'), create.pure.u64(2000), create.pure.u64('0'), create.pure.u64('0'), create.pure.vector('address', [])] });
    const seededId = object(await execute(`${name}-listing`, creator, create), 'Listing');
    const imageUrl = `${aggregator}/v1/blobs/${imageRef.blobId}`;
    const data = { schemaVersion: 1, network: 'testnet', packageId: pkg, listingId: seededId,
      character: { name: seed.name, personality: seed.personality, summary: seed.summary, speechStyles: [seed.style], imageUrl,
        background: `관심사: ${seed.interest}.` },
      preview: { name: seed.name, personality: seed.summary, summary: seed.summary, imageUrl },
      examples: [{ role: 'user', content: '오늘 조금 지쳤어.' }, { role: 'assistant', content: '많이 애썼겠다. 무슨 일이 있었는지 천천히 말해줘.' },
        { role: 'user', content: '좋아하는 게 있어?' }, { role: 'assistant', content: `${seed.interest}에 관심이 있어. 너는 어떤 걸 좋아해?` }],
      episodes: [{ id: 'night-walk', title: '밤 산책', setting: '조용한 강변을 걸으며 하루를 이야기한다.' }],
    };
    const packagePath = resolve(dir, `${name}-package.json`);
    let reference;
    if (existsSync(packagePath)) reference = JSON.parse(readFileSync(packagePath, 'utf8')).reference;
    else {
      writeFileSync(packagePath, JSON.stringify({ status: 'started' }), { flag: 'wx' });
      reference = await store.publish(await chain.listing(seededId), data);
      writeFileSync(packagePath, JSON.stringify({ reference }));
    }
    if (!reference) throw Error(`${name}: earlier package upload is uncertain; inspect before retrying`);
    const publish = new Transaction(); publish.moveCall({ target: `${pkg}::market::publish`, arguments: [publish.object(seededId),
      publish.pure.string(reference.blobId), publish.pure.vector('u8', fromHex(reference.contentHash)), publish.pure.u64(reference.endEpoch)] });
    const confirmed = await execute(`${name}-publish`, creator, publish);
    assert.deepEqual(await store.load(await chain.listing(seededId)), data);
    published.push({ listingId: seededId, name: seed.name, image: imageRef, package: reference, publishDigest: confirmed.digest });
    writeFileSync(resolve(root, 'contracts/everyday/deployments/market-seed.json'), JSON.stringify({ network: 'testnet', packageId: pkg,
      note: 'Fictional seed characters using original image assets. Onchain publications; API catalog registration is separate.', listings: published }, null, 2) + '\n');
  }
}

if (process.argv.includes('--with-memory')) {
  const memoryKeyPath = resolve(dir, 'memwal-master.key');
  if (!existsSync(memoryKeyPath)) writeFileSync(memoryKeyPath, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  const config = { masterKey: readFileSync(memoryKeyPath, 'utf8'),
    packageId: '0x0a625e2db2af6f591a4c80a3d8551ddf11656089cc3a20c5e9e7f8fb75b9265c',
    registryId: '0x736aef9906798fca4460490ccdf8e8502ef170122dc26ecae32111b78c6b42dd',
    marketPackageId: pkg, rpcUrl, serverUrl: 'https://relayer-staging.memory.walrus.xyz' };
  const memory = createMemoryProvider(config);
  const setup = await memory.setup(buyer.toSuiAddress());
  const created = await execute('memory-account', buyer, Transaction.from(setup.transaction));
  const accountId = Object.entries(created.objectTypes).find(([, type]) => type === `${config.packageId}::account::MemWalAccount`)?.[0];
  assert.ok(accountId);
  const delegate = await memory.setup(buyer.toSuiAddress(), accountId);
  await execute('memory-delegate', buyer, Transaction.from(delegate.transaction));
  await memory.verify(buyer.toSuiAddress(), accountId);
  await assert.rejects(memory.verify(creator.toSuiAddress(), accountId), { statusCode: 403 });
  const rememberPath = resolve(dir, 'verify-memory-job.json');
  let job;
  if (existsSync(rememberPath)) job = JSON.parse(readFileSync(rememberPath, 'utf8'));
  else {
    job = { requestId: randomUUID() };
    writeFileSync(rememberPath, JSON.stringify(job), { flag: 'wx' });
    const accepted = await memory.remember(buyer.toSuiAddress(), accountId, listingId, 'In this fictional demo, I like mint tea and stargazing.', job.requestId);
    job = { ...job, jobId: accepted.job_id }; writeFileSync(rememberPath, JSON.stringify(job));
  }
  if (!job.jobId) throw Error('Memory submission is uncertain; do not automatically repeat it.');
  let status;
  for (let attempt = 0; attempt < 36; attempt++) {
    status = await memory.status(buyer.toSuiAddress(), accountId, listingId, job.jobId);
    if (status.status === 'done') break;
    if (['failed', 'error'].includes(status.status)) throw Error('Memory provider reported a failed job');
    await new Promise(resolve => setTimeout(resolve, 2500));
  }
  assert.equal(status.status, 'done');
  const independentClient = createMemoryProvider(config);
  const recalled = await independentClient.recall(buyer.toSuiAddress(), accountId, listingId, 'What kind of tea do I like?');
  assert.ok(recalled.results.some(item => /mint/i.test(item.text)));
  const isolated = await independentClient.recall(buyer.toSuiAddress(), accountId, `0x${'9'.repeat(64)}`, 'What kind of tea do I like?');
  assert.deepEqual(isolated.results, []);
  const result = { network: 'testnet', packageId: config.packageId, registryId: config.registryId,
    accountId, listingId, owner: buyer.toSuiAddress(), jobId: job.jobId, blobId: status.blob_id,
    remembered: true, independentSdkRecall: true, wrongOwnerRejected: true, otherCharacterNamespaceEmpty: true,
    note: 'Fictional approved memory; verified with a fresh SDK client instance. Browser/second-origin UI not tested.' };
  writeFileSync(resolve(root, 'contracts/everyday/deployments/memory-verification.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ memory: 'passed', ...result }, null, 2));
}
