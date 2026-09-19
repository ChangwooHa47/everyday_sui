import { bcs } from '@mysten/sui/bcs';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import type { SuiClientTypes } from '@mysten/sui/client';
import type { MarketListing, MarketPreview, MarketCatalog, ProductDraft } from '@everyday/contracts';
import { backend, ensureAuth, getPendingChatRequest, prepareChatRequest, clearChatRequest } from './api';
import { apiUrl, requirePackage } from './web3/config';
import { nftPurchaseError } from './gift-purchase';

export function formatPrice(mist: string) {
  const value = BigInt(mist); const fraction = (value % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return `${value / 1_000_000_000n}${fraction ? `.${fraction}` : ''} SUI`;
}

/** Deterministic text similarity over authored settings; no personal conversations are submitted. */
export function recommendListings(catalog: MarketCatalog, source: ProductDraft) {
  const grams = (text: string) => {
    const value = text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    return new Set(Array.from({ length: Math.max(0, value.length - 1) }, (_, i) => value.slice(i, i + 2)));
  };
  const wanted = grams([source.summary, source.personality, ...source.speechStyles].join(' '));
  return catalog.listings.filter(l => l.active && l.published).map(listing => {
    const actual = grams(catalog.previews[listing.id]?.summary ?? listing.title);
    const intersection = [...actual].filter(part => wanted.has(part)).length;
    return { listing, score: intersection / Math.max(1, wanted.size + actual.size - intersection) };
  }).sort((a, b) => b.score - a.score || a.listing.id.localeCompare(b.listing.id)).map(item => item.listing);
}

export class MarketRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string | undefined, message: string) { super(message); }
}

export async function marketRequest<T>(path: string, body?: unknown, method?: 'DELETE' | 'PUT', retried = false): Promise<T> {
  const token = await ensureAuth();
  const res = await fetch(`${apiUrl}${path}`, { method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (data.error === 'PREVIEW_EXHAUSTED') throw new MarketRequestError(res.status, data.error, '미리보기 대화를 모두 사용했어요. 구매 후 계속 대화할 수 있어요.');
    if (res.status === 401 && !retried) {
      try {
        await (await import('./wallet-auth')).refreshWalletToken();
        return marketRequest<T>(path, body, method, true);
      } catch {
        if (typeof window !== 'undefined' && window.location.pathname !== '/') window.location.replace('/');
        throw Error('다시 로그인해주세요.');
      }
    }
    if (res.status === 401) {
      if (typeof window !== 'undefined' && window.location.pathname !== '/') window.location.replace('/');
      throw Error('다시 로그인해주세요.');
    }
    throw new MarketRequestError(res.status, typeof data.error === 'string' ? data.error : undefined,
      (path.endsWith('/purchase-transaction') ? nftPurchaseError(data.error) : undefined) ?? (data.error === 'MEMORY_RESULT_UNKNOWN_DO_NOT_AUTO_RETRY' ? '기억의 저장 결과를 확인 중이에요. 잠시 후 다시 확인해주세요.'
        : ['TURN_COMPLETED', 'TURN_UNKNOWN', 'PROVIDER_RESULT_UNKNOWN_DO_NOT_AUTO_RETRY'].includes(data.error) ? '이전 메시지의 응답을 확인할 수 없어요.'
          : data.error === 'TURN_RUNNING' ? '이전 메시지를 처리하고 있어요.' : '요청을 처리하지 못했어요. 다시 시도해주세요.'));
  }
  return res.status === 204 ? undefined as T : res.json();
}

export async function loadMarketCatalog(read: (path: string) => Promise<MarketCatalog> = marketRequest) {
  const result: MarketCatalog = { listings: [], previews: {}, engagement: {}, nextCursor: null };
  const cursors = new Set<string>(), listingIds = new Set<string>();
  let after: string | null = null;
  do {
    const page = await read(`/v1/market/listings?limit=20${after ? `&after=${encodeURIComponent(after)}` : ''}`);
    for (const listing of page.listings) {
      if (!listingIds.has(listing.id)) { listingIds.add(listing.id); result.listings.push(listing); }
    }
    Object.assign(result.previews, page.previews);
    Object.assign(result.engagement!, page.engagement);
    after = page.nextCursor;
    if (after && (cursors.has(after) || !/^0x[0-9a-f]{64}$/.test(after))) throw Error('상품 목록을 불러오지 못했어요. 다시 시도해주세요.');
    if (after) cursors.add(after);
  } while (after);
  return result;
}

export async function submitPreviewTurn(id: string, messages: { role: 'user' | 'assistant'; content: string }[],
  request: (path: string, body: unknown) => Promise<{ content: string }> = marketRequest) {
    const context = `preview:${id}`;
    const pending = prepareChatRequest(0, context, JSON.stringify(messages));
    try {
      const response = await request(`/v1/market/listings/${id}/turns`, { requestId: pending.requestId, mode: 'preview', messages });
      clearChatRequest(0, context, pending.requestId);
      return response;
    } catch (e) {
      if (e instanceof MarketRequestError && ([400, 403, 404, 422, 429].includes(e.status) || ['PREVIEW_EXHAUSTED', 'TURN_COMPLETED'].includes(e.code ?? '')))
        clearChatRequest(0, context, pending.requestId);
      throw e;
    }
}

export const market = {
  list: () => loadMarketCatalog(),
  preview: (id: string) => marketRequest<MarketPreview>(`/v1/market/listings/${id}/preview`),
  turn: submitPreviewTurn,
};

export function pendingPreviewMessages(id: string): { role: 'user' | 'assistant'; content: string }[] | null {
  const pending = getPendingChatRequest(0, `preview:${id}`);
  if (!pending) return null;
  const messages = JSON.parse(pending.content);
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 40
    || messages.some(message => !message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string')
    || messages.at(-1).role !== 'user') throw Error('이전 메시지의 전송 요청을 확인할 수 없어요.');
  return messages;
}

const License = bcs.struct('License', { id: bcs.Address, listing: bcs.Address, buyer: bcs.Address });
export async function findLicense(owner: string, listingId: string) {
  const { walletKit } = await import('./wallet-auth');
  const client = walletKit.getClient('testnet'); const type = `${requirePackage()}::market::License`;
  let cursor: string | null = null;
  do {
    const page: SuiClientTypes.ListOwnedObjectsResponse<{ content: true }> = await client.core.listOwnedObjects({ owner, type, cursor, limit: 50, include: { content: true } });
    for (const object of page.objects) {
      if (object.type !== type || object.owner.$kind !== 'AddressOwner' || normalizeSuiAddress(object.owner.AddressOwner) !== owner) continue;
      const license = License.parse(object.content);
      if (license.id === object.objectId && license.buyer === owner && license.listing === listingId) return license.id;
    }
    if (!page.hasNextPage) return null;
    if (!page.cursor || cursor === page.cursor) throw Error('구매 내역을 확인할 수 없어요.');
    cursor = page.cursor;
  } while (true);
}

/** Check existing entitlement first; retrying a completed purchase only imports its personal copy. */
export async function purchaseCharacter(displayed: MarketListing) {
  const { getWalletToken, restoreWalletToken, walletKit } = await import('./wallet-auth');
  await restoreWalletToken();
  const account = walletKit.stores.$connection.get().account;
  if (!account) throw Error('로그인해주세요.');
  const owner = normalizeSuiAddress(account.address);
  let licenseId = await findLicense(owner, displayed.id);
  if (!licenseId) {
    // Confirm the package can still be fetched and decrypted before asking for payment.
    const { listing } = await market.preview(displayed.id);
    if (!listing.active || !listing.published || listing.priceMist !== displayed.priceMist) throw Error('상품 정보가 변경됐어요. 다시 확인해주세요.');
    const tx = new Transaction(); tx.setSender(owner);
    const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(listing.priceMist)]);
    tx.moveCall({ target: `${requirePackage()}::market::purchase`, arguments: [tx.object(listing.id), payment] });
    const { executeWalletTransaction } = await import('./wallet-transaction');
    const result = await executeWalletTransaction(tx, account);
    if (result.$kind !== 'Transaction' || !result.Transaction.status.success) throw Error('구매를 완료하지 못했어요.');
    await walletKit.getClient('testnet').waitForTransaction({ digest: result.Transaction.digest, timeout: 30000 });
    licenseId = await findLicense(owner, listing.id);
  }
  // Account switches invalidate the application session before personal records are created.
  getWalletToken();
  if (walletKit.stores.$connection.get().account?.address !== account.address) throw Error('다시 로그인해주세요.');
  if (!licenseId) throw Error('구매 내역을 확인 중이에요. 잠시 후 다시 시도해주세요.');
  return backend.importLicense(displayed.id, licenseId);
}
