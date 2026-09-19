import { Transaction } from '@mysten/sui/transactions';
import type { ExternalNftCollection, ExternalNftGiftProduct, ExternalNftOfferDraft, ExternalNftPreferences,
  NftGiftCatalogItem, OwnedNftGiftItem } from '@everyday/contracts';
import { marketRequest } from './market';
import { apiUrl } from './web3/config';

export function nftGiftImageUrl(gift: NftGiftCatalogItem | OwnedNftGiftItem) {
  if (gift.kind !== 'external') return gift.imageUrl;
  const offerId = 'productId' in gift ? gift.productId : gift.id;
  return `${apiUrl.replace(/\/$/, '')}/v1/nft-gifts/${encodeURIComponent(offerId)}/image`;
}

export const nftGifts = {
  list: async () => (await marketRequest<{ gifts: NftGiftCatalogItem[] }>('/v1/nft-gifts')).gifts,
  detail: async (id: string) => (await marketRequest<{ gift: NftGiftCatalogItem }>(`/v1/nft-gifts/${encodeURIComponent(id)}`)).gift,
  owned: async () => (await marketRequest<{ gifts: OwnedNftGiftItem[] }>('/v1/me/nft-gifts')).gifts,
  collections: async () => (await marketRequest<{ collections: ExternalNftCollection[] }>(
    '/v1/external-nft-collections')).collections,
  offers: async () => (await marketRequest<{ offers: ExternalNftGiftProduct[] }>('/v1/me/external-nft-offers')).offers,
  preferences: async () => marketRequest<ExternalNftPreferences>('/v1/me/external-nft-preferences'),
  savePreferences: async (receiveEnabled: boolean, blockedPolicyIds: string[]) =>
    marketRequest<ExternalNftPreferences>('/v1/me/external-nft-preferences',
      { receiveEnabled, blockedPolicyIds }, 'PUT'),
  async purchase(displayed: NftGiftCatalogItem) {
    const { getWalletToken, walletKit } = await import('./wallet-auth');
    getWalletToken();
    const account = walletKit.stores.$connection.get().account;
    if (!account) throw Error('로그인해주세요.');
    const response = await marketRequest<{ transaction: string; priceMist: string }>(
      `/v1/nft-gifts/${encodeURIComponent(displayed.id)}/purchase-transaction`, {});
    if (response.priceMist !== displayed.priceMist) throw Error('상품 가격이 변경됐어요. 다시 확인해주세요.');
    const result = await walletKit.signAndExecuteTransaction({ transaction: Transaction.from(response.transaction), account, network: 'testnet' });
    if (result.$kind !== 'Transaction' || !result.Transaction.status.success) throw Error('구매를 완료하지 못했어요.');
    await walletKit.getClient('testnet').waitForTransaction({ digest: result.Transaction.digest, timeout: 30000 });
    getWalletToken();
    if (walletKit.stores.$connection.get().account?.address !== account.address) throw Error('다시 로그인해주세요.');
    if (displayed.kind === 'external') {
      // The chain transaction is final; catalog confirmation only reconciles the database cache.
      // On failure, chain reads still hide the consumed offer and owned() verifies the received object.
      await marketRequest(`/v1/external-nft-offers/${encodeURIComponent(displayed.id)}/confirm`,
        { digest: result.Transaction.digest }).catch(() => undefined);
    }
    return result.Transaction.digest;
  },
  async createExternalOffer(draft: ExternalNftOfferDraft) {
    const { getWalletToken, walletKit } = await import('./wallet-auth');
    getWalletToken();
    const account = walletKit.stores.$connection.get().account;
    if (!account) throw Error('로그인해주세요.');
    const prepared = await marketRequest<{ transaction: string; packageId: string; objectType: string }>(
      '/v1/external-nft-offers/create-transaction', draft);
    const result = await walletKit.signAndExecuteTransaction({ transaction: Transaction.from(prepared.transaction), account, network: 'testnet' });
    if (result.$kind !== 'Transaction' || !result.Transaction.status.success) throw Error('외부 NFT 등록을 완료하지 못했어요.');
    const confirmed = await walletKit.getClient('testnet').waitForTransaction({ digest: result.Transaction.digest,
      include: { objectTypes: true }, timeout: 30000 });
    if (confirmed.$kind !== 'Transaction' || !confirmed.Transaction.status.success) throw Error('외부 NFT 등록 결과를 확인 중이에요.');
    getWalletToken();
    if (walletKit.stores.$connection.get().account?.address !== account.address) throw Error('다시 로그인해주세요.');
    const offerId = Object.entries(confirmed.Transaction.objectTypes)
      .find(([, type]) => type === `${prepared.packageId}::market::ExternalNftOffer`)?.[0];
    if (!offerId) throw Error('외부 NFT 오퍼를 확인할 수 없어요.');
    await marketRequest('/v1/external-nft-offers', { offerId });
    return offerId;
  },
  async withdrawExternalOffer(offer: ExternalNftGiftProduct) {
    const { getWalletToken, walletKit } = await import('./wallet-auth');
    getWalletToken();
    const account = walletKit.stores.$connection.get().account;
    if (!account) throw Error('로그인해주세요.');
    const prepared = await marketRequest<{ transaction: string; objectId: string }>(
      `/v1/external-nft-offers/${encodeURIComponent(offer.id)}/withdraw-transaction`, {});
    if (prepared.objectId !== offer.objectId) throw Error('판매 등록 정보가 변경됐어요. 다시 확인해주세요.');
    const result = await walletKit.signAndExecuteTransaction({
      transaction: Transaction.from(prepared.transaction), account, network: 'testnet',
    });
    if (result.$kind !== 'Transaction' || !result.Transaction.status.success) throw Error('NFT 회수를 완료하지 못했어요.');
    await walletKit.getClient('testnet').waitForTransaction({ digest: result.Transaction.digest, timeout: 30000 });
    getWalletToken();
    if (walletKit.stores.$connection.get().account?.address !== account.address) throw Error('다시 로그인해주세요.');
    // Withdrawal is already final on chain. A stale cache is filtered by exact offer reads.
    await marketRequest(`/v1/external-nft-offers/${encodeURIComponent(offer.id)}/withdraw-confirm`,
      { digest: result.Transaction.digest }).catch(() => undefined);
    return result.Transaction.digest;
  },
};
