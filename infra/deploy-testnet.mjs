// Reviewed testnet-only publication. Never log keys, signatures or transaction bytes.
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { TransactionError } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64, normalizeSuiAddress } from '@mysten/sui/utils';

if (!process.argv.includes('--execute')) throw Error('Pass --execute to publish the reviewed package to testnet.');
const root = fileURLToPath(new URL('../', import.meta.url));
const stateArgument = process.argv.indexOf('--deployment-state');
const stateName = stateArgument < 0 ? 'market-testnet' : process.argv[stateArgument + 1];
if (!stateName || !/^market-testnet(?:-[a-z0-9]+)*$/.test(stateName)) throw Error('Invalid dedicated testnet state directory');
const dir = `${root}/.local-tools/${stateName}`;
const statePath = `${dir}/publish.json`;
const keyPath = `${dir}/creator.key`;
if (!existsSync(keyPath)) throw Error('Dedicated testnet creator.key is required; no automatic replacement wallet is created.');
const key = Ed25519Keypair.fromSecretKey(readFileSync(keyPath, 'utf8'));
const creator = key.toSuiAddress();
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: 'https://fullnode.testnet.sui.io:443' });
const include = { effects: true, objectTypes: true };
const files = ['Move.toml', ...readdirSync(`${root}/contracts/everyday/sources`).filter(f => f.endsWith('.move')).sort().map(f => `sources/${f}`)];
const hash = createHash('sha256');
for (const file of files) hash.update(file).update('\0').update(readFileSync(`${root}/contracts/everyday/${file}`, 'utf8').replaceAll('\r\n', '\n'));
const sourceSha256 = hash.digest('hex');
let state;
if (existsSync(statePath)) {
  state = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(state.network, 'testnet', 'Saved transaction must have reviewed testnet metadata');
  assert.equal(state.creator, creator, 'Saved transaction belongs to a different wallet');
  assert.equal(state.sourceSha256, sourceSha256, 'Sources differ from saved publication; do not publish again automatically');
  const saved = Transaction.from(state.bytes);
  assert.equal(saved.getData().sender, creator, 'Saved sender mismatch');
  assert.equal(await saved.getDigest(), state.digest, 'Saved digest mismatch');
} else {
  if (existsSync(`${dir}/deployment.json`)) throw Error('Deployment exists without saved transaction; inspect it before any new publication.');
  const { balance } = await client.getBalance({ owner: creator });
  console.log(JSON.stringify({ network: 'testnet', creator, balanceMist: balance.balance, sourceSha256 }));
  if (BigInt(balance.balance) < 200000000n) throw Error(`Testnet gas required for ${creator}; no transaction signed.`);
  const local = `${root}/.local-tools/sui-1.79.0/sui.exe`;
  const sui = process.env.SUI_BIN || (process.platform === 'win32' && existsSync(local) ? local : 'sui');
  const output = execFileSync(sui, ['move', 'build', '--path', 'contracts/everyday', '--dump-bytecode-as-base64'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const built = JSON.parse(output.slice(output.indexOf('{')));
  const tx = new Transaction();
  tx.setSender(creator);
  tx.setGasBudget('200000000');
  const cap = tx.publish({ modules: built.modules, dependencies: built.dependencies });
  tx.transferObjects([cap], creator);
  const bytes = await tx.build({ client });
  const simulated = await client.simulateTransaction({ transaction: bytes, include, signal: AbortSignal.timeout(30000) });
  assert.equal(simulated.$kind, 'Transaction', 'Publish simulation failed; no transaction signed');
  const signed = await key.signTransaction(bytes);
  state = { network: 'testnet', creator, sourceSha256, ...signed, digest: await Transaction.from(bytes).getDigest() };
  writeFileSync(statePath, JSON.stringify(state, null, 2), { flag: 'wx', mode: 0o600 });
}
let result;
try {
  result = await client.getTransaction({ digest: state.digest, include, signal: AbortSignal.timeout(20000) });
} catch (error) {
  // Provider failures must not be interpreted as proof that a transaction is absent.
  if (!(error instanceof TransactionError) || error.reason !== 'notFound') throw error;
  result = await client.executeTransaction({ transaction: fromBase64(state.bytes), signatures: [state.signature], include, signal: AbortSignal.timeout(30000) });
}
assert.equal(result.$kind, 'Transaction', 'Publish failed; retain the saved transaction and inspect its digest');
const confirmed = await client.waitForTransaction({ digest: state.digest, include, timeout: 30000 });
assert.equal(confirmed.$kind, 'Transaction', 'Publication did not confirm successfully');
assert.equal(confirmed.Transaction.status.success, true);
const types = Object.entries(confirmed.Transaction.objectTypes);
const admins = types.filter(([, type]) => type.endsWith('::market::Admin'));
assert.equal(admins.length, 1, 'Expected exactly one market Admin');
const [adminId, adminType] = admins[0];
const packageId = normalizeSuiAddress(adminType.split('::')[0]);
const upgrades = types.filter(([, type]) => type.endsWith('::package::UpgradeCap'));
assert.equal(upgrades.length, 1, 'Expected exactly one UpgradeCap');
const upgradeCapId = upgrades[0][0];
const { object: admin } = await client.getObject({ objectId: adminId });
assert.equal(admin.type, `${packageId}::market::Admin`);
assert.equal(admin.owner.AddressOwner, creator, 'Admin ownership mismatch');
const { object: upgrade } = await client.getObject({ objectId: upgradeCapId, include: { json: true } });
assert.equal(upgrade.owner.AddressOwner, creator, 'UpgradeCap ownership mismatch');
assert.equal(normalizeSuiAddress(upgrade.json.package), packageId, 'UpgradeCap points to another package');
const { object: pkg } = await client.getObject({ objectId: packageId });
assert.equal(pkg.owner.$kind, 'Immutable', 'Published package must be immutable');
const deployment = { network: 'testnet', packageId, adminId, upgradeCapId, creator, publishDigest: state.digest, sourceSha256 };
writeFileSync(`${dir}/deployment.json`, JSON.stringify(deployment, null, 2));
console.log(JSON.stringify(deployment, null, 2));
