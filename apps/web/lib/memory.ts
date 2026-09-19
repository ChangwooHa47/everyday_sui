import { Transaction } from '@mysten/sui/transactions';
import { TransactionError } from '@mysten/sui/client';
import { fromBase64, fromHex, normalizeSuiAddress } from '@mysten/sui/utils';
import type { LicenseBinding, MemoryAccountBinding, MemorySearchResult } from '@everyday/contracts';
import { marketRequest, MarketRequestError } from './market';

export async function connectMemory() {
  const { walletKit, getWalletToken, restoreWalletToken } = await import('./wallet-auth');
  await restoreWalletToken();
  const connected = walletKit.stores.$connection.get().account;
  if (!connected) throw Error('로그인해주세요.');
  const account = connected, owner = normalizeSuiAddress(account.address), client = walletKit.getClient('testnet');
  const config = await marketRequest<{ memoryPackageId: string | null; memoryRegistryId: string | null }>('/v1/market/config');
  if (!config.memoryPackageId || !config.memoryRegistryId) throw Error('지금은 기억을 저장할 수 없어요.');
  const pkg = normalizeSuiAddress(config.memoryPackageId), registry = normalizeSuiAddress(config.memoryRegistryId);
  const saved = await marketRequest<MemoryAccountBinding>('/v1/me/memory-account');
  const prefix = `everyday.memory:${pkg}:${owner}`;
  if (saved.account) {
    try {
      await marketRequest('/v1/me/memory-account', { accountId: saved.account.accountId, consent: true });
      return saved.account.accountId;
    } catch (e) {
      // A revoked/rotated delegate needs a fresh approval; other failures remain closed.
      if (!(e instanceof MarketRequestError) || e.status !== 403 || e.code !== 'MEMORY_DELEGATE_REQUIRED') throw e;
      sessionStorage.removeItem(`${prefix}:delegate`);
    }
  }
  sessionStorage.setItem(`${prefix}:check`, '1'); sessionStorage.removeItem(`${prefix}:check`);
  const check = () => {
    getWalletToken();
    if (walletKit.stores.$connection.get().account?.address !== account.address) throw Error('다시 로그인해주세요.');
  };
  async function execute(name: string, tx: Transaction, target: string) {
    check();
    const old = sessionStorage.getItem(`${prefix}:${name}`);
    let pending: { bytes: string; signature: string; digest: string };
    if (old) pending = JSON.parse(old);
    else {
      tx.setSender(owner);
      const { signWalletTransaction } = await import('./wallet-transaction');
      const signed = await signWalletTransaction(tx, account); check();
      pending = { ...signed, digest: await Transaction.from(signed.bytes).getDigest() };
      sessionStorage.setItem(`${prefix}:${name}`, JSON.stringify(pending));
    }
    const restored = Transaction.from(pending.bytes), data = restored.getData(), call = data.commands[0]?.MoveCall;
    if (data.sender !== owner || data.commands.length !== 1 || !call || call.package !== pkg || call.module !== 'account'
      || call.function !== target || await restored.getDigest() !== pending.digest) throw Error('저장 요청을 확인할 수 없어요.');
    const include = { objectTypes: true } as const;
    let result;
    try { result = await client.getTransaction({ digest: pending.digest, include }); }
    catch (e) {
      if (!(e instanceof TransactionError) || e.reason !== 'notFound') throw e;
      result = await client.executeTransaction({ transaction: fromBase64(pending.bytes), signatures: [pending.signature], include });
    }
    if (result.$kind !== 'Transaction' || !result.Transaction.status.success) {
      sessionStorage.removeItem(`${prefix}:${name}`);
      throw Error('저장을 완료하지 못했어요. 다시 시도해주세요.');
    }
    const confirmed = await client.waitForTransaction({ digest: pending.digest, include, timeout: 30000 }); check();
    if (confirmed.$kind !== 'Transaction' || !confirmed.Transaction.status.success) throw Error('저장 결과를 확인 중이에요.');
    return confirmed.Transaction;
  }
  let accountId = saved.account?.accountId ?? sessionStorage.getItem(`${prefix}:account`);
  if (!accountId) {
    // Ask the adapter to validate current deployment before any wallet request.
    await marketRequest('/v1/me/memory-account/transaction', {});
    const create = new Transaction();
    create.moveCall({ target: `${pkg}::account::create_account`, arguments: [create.object(registry), create.object('0x6')] });
    const result = await execute('create', create, 'create_account');
    accountId = Object.entries(result.objectTypes).find(([, type]) => type === `${pkg}::account::MemWalAccount`)?.[0] ?? null;
    if (!accountId) throw Error('저장 공간을 확인할 수 없어요.');
    sessionStorage.setItem(`${prefix}:account`, accountId);
  }
  const setup = await marketRequest<{ publicKey: string }>('/v1/me/memory-account/transaction', { accountId });
  if (!/^[0-9a-f]{64}$/.test(setup.publicKey)) throw Error('저장 권한을 확인할 수 없어요.');
  const grant = new Transaction();
  grant.moveCall({ target: `${pkg}::account::add_delegate_key`, arguments: [grant.object(accountId), grant.object(registry),
    grant.pure.vector('u8', fromHex(setup.publicKey)), grant.pure.string('everyday API'), grant.object('0x6')] });
  await execute('delegate', grant, 'add_delegate_key');
  await marketRequest('/v1/me/memory-account', { accountId, consent: true });
  return accountId;
}

export async function pendingMemoryText(listingId: string) {
  const { walletKit, restoreWalletToken } = await import('./wallet-auth');
  await restoreWalletToken();
  const owner = walletKit.stores.$connection.get().account?.address;
  const stored = sessionStorage.getItem(`everyday.remember:${owner}:${listingId}`);
  if (!stored) return null;
  const pending = JSON.parse(stored) as { requestId: string; text: string };
  if (typeof pending.text !== 'string' || pending.text.length > 2000 || !/^[0-9a-f-]{36}$/.test(pending.requestId))
    throw Error('이전 기억의 저장 요청을 확인할 수 없어요.');
  return pending.text;
}

export async function rememberApproved(binding: LicenseBinding, text: string) {
  await connectMemory();
  const { walletKit } = await import('./wallet-auth');
  const owner = walletKit.stores.$connection.get().account?.address;
  const key = `everyday.remember:${owner}:${binding.listingId}`;
  const stored = sessionStorage.getItem(key);
  const pending: { requestId: string; text: string } = stored ? JSON.parse(stored) : { requestId: crypto.randomUUID(), text };
  if (pending.text !== text) throw Error('이전 기억의 저장 결과를 먼저 확인해주세요.');
  sessionStorage.setItem(key, JSON.stringify(pending));
  await marketRequest(`/v1/me/relationships/${binding.listingId}/remember`, { ...pending, consent: true, licenseId: binding.licenseId });
  for (let i = 0; i < 60; i++) {
    const job = await marketRequest<{ status: string }>(`/v1/me/memory-jobs/${pending.requestId}`);
    if (job.status === 'done') { sessionStorage.removeItem(key); return; }
    if (['failed', 'error'].includes(job.status)) { sessionStorage.removeItem(key); throw Error('기억을 저장하지 못했어요.'); }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw Error('기억을 저장하고 있어요. 같은 내용으로 다시 확인해주세요.');
}

export const recallMemory = (listingId: string, query: string) =>
  marketRequest<MemorySearchResult>(`/v1/me/relationships/${listingId}/recall`, { query });

// Stops all service-side reads/writes immediately. It does not claim to delete distributed copies.
export const disableMemory = () => marketRequest<void>('/v1/me/memory-account', undefined, 'DELETE');
