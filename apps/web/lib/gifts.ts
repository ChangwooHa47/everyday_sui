import { Transaction } from '@mysten/sui/transactions';
import type { ExternalNftCollection, ExternalNftGiftProduct, ExternalNftOfferDraft, ExternalNftPreferences,
  NftGiftCatalogItem, OwnedNftGiftItem } from '@everyday/contracts';
import { marketRequest } from './market';
import { apiUrl } from './web3/config';
import { executeGiftPurchase } from './gift-purchase';

// Byte-identical originals of the deployed testnet editions. Never match by title
// or replace an external seller's artwork with an unrelated placeholder.
const bundledGiftImages: Record<string, { hash: string; path: string }> = {
  '0xa7b6eb56b1389c330887ecb532062598b35d222e2f2c9c4491e2ef5382adeadf': {
    hash: '651b718bd3d4d67a3d907fdf9a07e988516a7f8ecc4f148499cc97cb4c92751b', path: '/gifts/warm-cafe-latte.webp',
  },
  '0xe4945d27bef8c3537d2b4e5a04d8dd337a44aa3d866806d1e373f90051221deb': {
    hash: '12436dca5c5571696187fd100dd7055b2e1b3975af0507476930d15fc85b701a', path: '/gifts/yellow-tulip-bouquet.webp',
  },
  '0xda4f1b4ebb8b4878fdc121d3a7be4e8640040ce2b66c36d76ccff0769f0d731c': {
    hash: 'fbe2343acf1e026bdc604a6e360973b409d44456b7cc5cb34ceb6ca6dd80e77a', path: '/gifts/strawberry-birthday-cake.webp',
  },
};

// Bundled art for the three Everyday Gifts products, served ahead of the aggregator.
// NOTE: since 2026-09-19 these are the refreshed Soul renders, so they no longer match
// the image hash recorded on chain. Re-upload and recreate the products to realign them.
const giftImageFallbacks: Readonly<Record<string, string>> = Object.freeze({
  '0xa7b6eb56b1389c330887ecb532062598b35d222e2f2c9c4491e2ef5382adeadf': '/gifts/warm-cafe-latte.jpg',
  '0xe4945d27bef8c3537d2b4e5a04d8dd337a44aa3d866806d1e373f90051221deb': '/gifts/yellow-tulip-bouquet.jpg',
  '0xda4f1b4ebb8b4878fdc121d3a7be4e8640040ce2b66c36d76ccff0769f0d731c': '/gifts/strawberry-birthday-cake.jpg',
});

export function nftGiftImageUrl(gift: NftGiftCatalogItem | OwnedNftGiftItem) {
  const offerId = 'productId' in gift ? gift.productId : gift.id;
  if (gift.kind !== 'external') {
    const bundled = bundledGiftImages[offerId];
    return bundled?.hash === gift.imageHash ? bundled.path : gift.imageUrl;
  }
  return `${apiUrl.replace(/\/$/, '')}/v1/nft-gifts/${encodeURIComponent(offerId)}/image`;
}

/** Candidates in priority order. Walrus answers with no Content-Type and nosniff,
 * so a browser cannot paint its bytes; the bundled copy carries the load. */
export function nftGiftImageSources(gift: NftGiftCatalogItem | OwnedNftGiftItem): string[] {
  const productId = 'productId' in gift ? gift.productId : gift.id;
  const bundled = giftImageFallbacks[productId];
  return [...(bundled ? [bundled] : []), nftGiftImageUrl(gift)];
}

/** Demo policy: every available catalog item is allowed, one gift may cost the priciest item, three of them per day. */
export function giftPolicyFor(products: NftGiftCatalogItem[]) {
  const active = products.filter(p => p.active && (p.kind === 'external' || BigInt(p.minted) < BigInt(p.maxSupply)));
  const perGift = active.reduce((max, p) => BigInt(p.priceMist) > max ? BigInt(p.priceMist) : max, 0n);
  return { perGiftLimitMist: perGift.toString(), dailyLimitMist: (perGift * 3n).toString(), allowedGiftIds: active.map(p => p.id).slice(0, 20) };
}

export function explorerTxUrl(digest: string) { return `https://suiscan.xyz/testnet/tx/${encodeURIComponent(digest)}`; }

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
    const { restoreWalletToken, walletKit } = await import('./wallet-auth');
    await restoreWalletToken();
    const account = walletKit.stores.$connection.get().account;
    if (!account) throw Error('로그인해주세요.');
    const key = `everyday.nft-purchase.v1:${apiUrl}:testnet:${account.address}:${displayed.id}`;
    if (!navigator.locks) throw Error('안전한 결제를 위해 최신 브라우저에서 다시 시도해주세요.');
    const digest = await navigator.locks.request(key, () => executeGiftPurchase({
      storage: localStorage, key,
      confirmAdditionalPurchase: () => window.confirm('이 상품은 이미 구매했어요. 추가 결제하여 한 개 더 구매할까요? 취소하면 내 NFT 선물로 이동해요.'),
      prepare: async () => {
        const response = await marketRequest<{ transaction: string; priceMist: string }>(
          `/v1/nft-gifts/${encodeURIComponent(displayed.id)}/purchase-transaction`, {});
        if (response.priceMist !== displayed.priceMist) throw Error('상품 가격이 변경됐어요. 다시 확인해주세요.');
        const transaction = Transaction.from(response.transaction);
        if (walletKit.stores.$connection.get().account?.address !== account.address || transaction.getData().sender !== account.address)
          throw Error('지갑 계정이 변경됐어요. 다시 로그인해주세요.');
        return () => walletKit.signAndExecuteTransaction({ transaction, account, network: 'testnet' });
      },
    }));
    if (displayed.kind === 'external') {
      // The chain transaction is final; catalog confirmation only reconciles the database cache.
      // On failure, chain reads still hide the consumed offer and owned() verifies the received object.
      await marketRequest(`/v1/external-nft-offers/${encodeURIComponent(displayed.id)}/confirm`,
        { digest }).catch(() => undefined);
    }
    return digest;
  },
  async createExternalOffer(draft: ExternalNftOfferDraft) {
    const { getWalletToken, restoreWalletToken, walletKit } = await import('./wallet-auth');
    await restoreWalletToken();
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
    const { getWalletToken, restoreWalletToken, walletKit } = await import('./wallet-auth');
    await restoreWalletToken();
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
