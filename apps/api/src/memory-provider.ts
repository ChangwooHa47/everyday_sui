import { createHmac } from 'node:crypto';
import { MemWal, type RememberJobStatus, type RecallResult } from '@mysten-incubation/memwal';
import { bcs } from '@mysten/sui/bcs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeStructTag } from '@mysten/sui/utils';
import { failure, hash } from './auth.js';
import { z } from 'zod';

// Current MemWal V2 struct: pinned deployment, fail closed on incompatible BCS.
export const memoryAccountBcs = bcs.struct('MemWalAccount', { id: bcs.Address, owner: bcs.Address,
  delegate_keys: bcs.vector(bcs.struct('DelegateKey', { public_key: bcs.vector(bcs.u8()), sui_address: bcs.Address, label: bcs.string(), created_at: bcs.u64() })),
  created_at: bcs.u64(), active: bcs.bool(), admin_quarantined: bcs.bool(),
  legacy_account_id: bcs.option(bcs.Address), access_counter_version: bcs.u64(),
});
export interface MemoryProvider {
  setup(owner: string, accountId?: string, revoke?: boolean): Promise<{ transaction: string; publicKey: string }>;
  verify(owner: string, accountId: string): Promise<void>;
  remember(owner: string, accountId: string, listingId: string, text: string, requestId: string): Promise<{ job_id: string; status: string }>;
  status(owner: string, accountId: string, listingId: string, jobId: string): Promise<RememberJobStatus>;
  recall(owner: string, accountId: string, listingId: string, query: string): Promise<RecallResult>;
}
export function createMemoryProvider(config: { masterKey: string; packageId: string; registryId: string; marketPackageId: string; rpcUrl: string; serverUrl: string },
  chain: Pick<SuiGrpcClient, 'getObject'> = new SuiGrpcClient({ network: 'testnet', baseUrl: config.rpcUrl })): MemoryProvider {
  const namespace = (listing: string) => `everyday-${hash(`${config.marketPackageId}:${listing}`)}`;
  const key = (owner: string) => createHmac('sha256', Buffer.from(config.masterKey, 'hex')).update(`everyday-memwal-v1:${owner}`).digest();
  const delegate = (owner: string) => Ed25519Keypair.fromSecretKey(key(owner));
  async function deployment() {
    const response = await fetch(`${config.serverUrl}/config`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw failure(503, 'MEMORY_DEPLOYMENT_UNAVAILABLE');
    const data = await response.json() as { packageId?: string; network?: string };
    if (data.packageId !== config.packageId || data.network !== 'testnet') throw failure(503, 'MEMORY_DEPLOYMENT_MISMATCH');
  }
  const account = async (owner: string, accountId: string, requireDelegate: boolean) => {
    const { object } = await chain.getObject({ objectId: accountId, include: { content: true }, signal: AbortSignal.timeout(10000) });
    if (normalizeStructTag(object.type) !== `${config.packageId}::account::MemWalAccount` || object.owner.$kind !== 'Shared') throw failure(403, 'MEMORY_ACCOUNT_REQUIRED');
    const value = memoryAccountBcs.parse(object.content);
    if (value.id !== accountId || object.objectId !== accountId || value.owner !== owner) throw failure(403, 'MEMORY_OWNER_MISMATCH');
    if (requireDelegate) {
      if (!value.active || value.admin_quarantined) throw failure(403, 'MEMORY_ACCOUNT_FROZEN');
      const d = delegate(owner); const publicKey = Buffer.from(d.getPublicKey().toRawBytes()).toString('hex');
      if (!value.delegate_keys.some(k => k.sui_address === d.toSuiAddress() && Buffer.from(k.public_key).toString('hex') === publicKey)) throw failure(403, 'MEMORY_DELEGATE_REQUIRED');
    }
  };
  async function use<T>(owner: string, accountId: string, listingId: string, fn: (sdk: MemWal) => Promise<T>) {
    await deployment();
    await account(owner, accountId, true); // Recheck before every call, including jobs and recall.
    const secret = key(owner);
    const sdk = MemWal.create({ key: secret, accountId, serverUrl: config.serverUrl, namespace: namespace(listingId) });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([fn(sdk), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(failure(504, 'MEMORY_TIMEOUT_RESULT_UNKNOWN')), 45000);
    })]); } finally { if (timer) clearTimeout(timer); sdk.destroy(); secret.fill(0); }
  }
  return {
    verify: (owner, accountId) => account(owner, accountId, true),
    async setup(owner, accountId, revoke = false) {
      await deployment();
      const registry = await chain.getObject({ objectId: config.registryId, signal: AbortSignal.timeout(10000) });
      if (normalizeStructTag(registry.object.type) !== `${config.packageId}::account::AccountRegistry` || registry.object.owner.$kind !== 'Shared') throw failure(503, 'MEMORY_REGISTRY_MISMATCH');
      const publicKey = delegate(owner).getPublicKey().toRawBytes();
      const tx = new Transaction(); tx.setSender(owner);
      if (!accountId) {
        if (revoke) throw failure(400, 'MEMORY_ACCOUNT_REQUIRED');
        tx.moveCall({ target: `${config.packageId}::account::create_account`, arguments: [tx.object(config.registryId), tx.object('0x6')] });
      } else {
        await account(owner, accountId, false);
        tx.moveCall({ target: `${config.packageId}::account::${revoke ? 'remove_delegate_key' : 'add_delegate_key'}`,
          arguments: [tx.object(accountId), tx.object(config.registryId), tx.pure.vector('u8', publicKey),
            ...(revoke ? [] : [tx.pure.string('everyday API'), tx.object('0x6')])] });
      }
      return { transaction: await tx.toJSON(), publicKey: Buffer.from(publicKey).toString('hex') };
    },
    remember: (owner, accountId, listingId, text, requestId) => use(owner, accountId, listingId, async sdk =>
      z.object({ job_id: z.string().min(1).max(256), status: z.string().min(1).max(30) }).parse(await sdk.remember(text, undefined, { idempotencyKey: requestId }))),
    status: (owner, accountId, listingId, jobId) => use(owner, accountId, listingId, async sdk => {
      const result = await sdk.getRememberStatus(jobId);
      if ((result.owner && result.owner !== owner) || (result.namespace && result.namespace !== namespace(listingId))) throw failure(403, 'MEMORY_CONTEXT_MISMATCH');
      // Do not expose provider errors, which may contain submitted plaintext.
      if (result.status === 'done' && !/^[A-Za-z0-9_-]{43}$/.test(result.blob_id ?? '')) throw failure(502, 'MEMORY_RECEIPT_INVALID');
      return { job_id: result.job_id, status: result.status, blob_id: result.blob_id };
    }),
    recall: (owner, accountId, listingId, query) => use(owner, accountId, listingId, sdk => sdk.recall({ query, limit: 5, maxTokens: 1500 })),
  };
}
