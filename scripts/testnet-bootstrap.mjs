// Dedicated demo wallet only. Keys never enter tracked artifacts or stdout.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64 } from '@mysten/sui/utils';

if (!process.argv.includes('--execute')) throw Error('Use --execute to fund a dedicated testnet wallet and publish. No mainnet option exists.');
const root = fileURLToPath(new URL('../', import.meta.url));
const dir = fileURLToPath(new URL('../.local-tools/market-testnet/', import.meta.url));
mkdirSync(dir, { recursive: true });
const keyPath = `${dir}/creator.key`;
if (!existsSync(keyPath)) writeFileSync(keyPath, Ed25519Keypair.generate().getSecretKey(), { flag: 'wx', mode: 0o600 });
const key = Ed25519Keypair.fromSecretKey(readFileSync(keyPath, 'utf8'));
const address = key.toSuiAddress();
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: 'https://fullnode.testnet.sui.io:443' });
const { balance } = await client.getBalance({ owner: address });
console.log(JSON.stringify({ network: 'testnet', address, balanceMist: balance.balance }));
if (BigInt(balance.balance) < 200000000n) {
  const response = await fetch('https://faucet.testnet.sui.io/v2/gas', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ FixedAmountRequest: { recipient: address } }), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(`Testnet faucet returned HTTP ${response.status}; fund ${address} and rerun.`);
  const data = await response.json();
  if (data.status !== 'Success') throw Error('Testnet faucet did not confirm funding');
  console.log('Dedicated testnet wallet funded.');
}
const statePath = `${dir}/publish.json`;
let state;
if (existsSync(statePath)) state = JSON.parse(readFileSync(statePath, 'utf8'));
else {
  const local = fileURLToPath(new URL('../.local-tools/sui-1.79.0/sui.exe', import.meta.url));
  const sui = process.env.SUI_BIN || (process.platform === 'win32' && existsSync(local) ? local : 'sui');
  const output = execFileSync(sui, ['move', 'build', '--path', 'contracts/everyday', '--dump-bytecode-as-base64'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const built = JSON.parse(output.slice(output.indexOf('{')));
  const tx = new Transaction(); tx.setSender(address); tx.setGasBudget(200000000);
  const cap = tx.publish({ modules: built.modules, dependencies: built.dependencies }); tx.transferObjects([cap], address);
  const signed = await key.signTransaction(await tx.build({ client }));
  state = { ...signed, digest: await Transaction.from(signed.bytes).getDigest({ client }) };
  writeFileSync(statePath, JSON.stringify(state, null, 2), { flag: 'wx', mode: 0o600 });
}
let result;
try { result = await client.getTransaction({ digest: state.digest, include: { effects: true, objectTypes: true } }); }
catch {
  result = await client.executeTransaction({ transaction: fromBase64(state.bytes), signatures: [state.signature], include: { effects: true, objectTypes: true }, signal: AbortSignal.timeout(20000) });
}
if (!result.Transaction) throw Error('Publish transaction failed; inspect the saved digest before creating another transaction.');
const confirmed = await client.waitForTransaction({ digest: state.digest, include: { effects: true, objectTypes: true }, timeout: 30000 });
if (!confirmed.Transaction) throw Error('Publish transaction failed');
const admin = Object.entries(confirmed.Transaction.objectTypes).find(([, type]) => type.endsWith('::market::Admin'));
if (!admin) throw Error('Admin object missing from publication result');
const deployment = { network: 'testnet', packageId: admin[1].split('::')[0], adminId: admin[0], creator: address, publishDigest: state.digest };
writeFileSync(`${dir}/deployment.json`, JSON.stringify(deployment, null, 2));
console.log(JSON.stringify(deployment, null, 2));
