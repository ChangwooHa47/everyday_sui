import { Transaction } from '@mysten/sui/transactions';
import type { NftGiftProduct, OwnedNftGift } from '@everyday/contracts';
import { marketRequest } from './market';

/** Demo policy: every active catalog product is allowed, one gift may cost the priciest product, three of them per day. */
export function giftPolicyFor(products: NftGiftProduct[]) {
  const active = products.filter(p => p.active && BigInt(p.minted) < BigInt(p.maxSupply));
  const perGift = active.reduce((max, p) => BigInt(p.priceMist) > max ? BigInt(p.priceMist) : max, 0n);
  return { perGiftLimitMist: perGift.toString(), dailyLimitMist: (perGift * 3n).toString(), allowedGiftIds: active.map(p => p.id).slice(0, 20) };
}

export function explorerTxUrl(digest: string) { return `https://suiscan.xyz/testnet/tx/${encodeURIComponent(digest)}`; }

export const nftGifts = {
  list: async () => (await marketRequest<{ gifts: NftGiftProduct[] }>('/v1/nft-gifts')).gifts,
  detail: async (id: string) => (await marketRequest<{ gift: NftGiftProduct }>(`/v1/nft-gifts/${encodeURIComponent(id)}`)).gift,
  owned: async () => (await marketRequest<{ gifts: OwnedNftGift[] }>('/v1/me/nft-gifts')).gifts,
  async purchase(displayed: NftGiftProduct) {
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
    return result.Transaction.digest;
  },
};
