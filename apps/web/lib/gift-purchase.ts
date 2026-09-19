type Receipt = { state: 'pending' } | { state: 'success'; digest: string };
type Result = { $kind: string; Transaction?: { digest: string; status: { success: boolean } } };
const uncertain = '이전 구매 결과를 확인할 수 없어요. 중복 결제를 막기 위해 새 결제를 중단했어요. 지갑 거래 내역과 내 NFT 선물을 확인해주세요.';

// Call under a cross-tab lock. Persist before handing control to the wallet:
// a lost wallet response must never silently become a second payment.
export async function executeGiftPurchase(options: {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  key: string;
  prepare: () => Promise<() => Promise<Result>>;
  confirmAdditionalPurchase?: () => boolean;
}) {
  const { storage, key, prepare } = options;
  let prior: Receipt | null;
  try { prior = JSON.parse(storage.getItem(key) ?? 'null'); }
  catch { throw Error('구매 기록을 읽을 수 없어 결제를 중단했어요.'); }
  if (prior?.state === 'success' && typeof prior.digest === 'string' && prior.digest) {
    if (!options.confirmAdditionalPurchase?.()) return prior.digest;
  } else if (prior !== null) throw Error(uncertain);
  const execute = await prepare();
  try { storage.setItem(key, JSON.stringify({ state: 'pending' })); }
  catch { throw Error('구매 기록을 저장할 수 없어 결제를 중단했어요. 브라우저 저장소를 확인해주세요.'); }
  let result: Result;
  try { result = await execute(); }
  catch (error) {
    // Only an explicit wallet rejection proves no transaction was submitted.
    if ((error as { code?: unknown })?.code === 4001) {
      storage.removeItem(key);
      throw Error('지갑에서 구매 승인을 취소했어요.');
    }
    throw Error(uncertain);
  }
  if (result.$kind !== 'Transaction' || !result.Transaction) throw Error(uncertain);
  if (!result.Transaction.status.success) {
    storage.removeItem(key);
    throw Error('거래가 실패해 NFT 구매 대금은 이전되지 않았어요. 네트워크 수수료는 발생할 수 있어요. 지갑의 실패 사유를 확인해주세요.');
  }
  // Successful execution effects are authoritative. Do not turn a later RPC
  // timeout or expired API session into a payment failure.
  const digest = result.Transaction.digest;
  try { storage.setItem(key, JSON.stringify({ state: 'success', digest })); }
  catch { /* Keep the pre-submission pending guard if saving the receipt fails. */ }
  return digest;
}

export function nftPurchaseError(code: string | undefined): string | undefined {
  switch (code) {
    case 'NFT_GIFT_NOT_LIVE': case 'EXTERNAL_OFFER_NOT_LIVE': return '판매가 종료되었거나 품절된 NFT예요. 상품 목록을 다시 확인해주세요.';
    case 'NFT_GIFT_NOT_FOUND': case 'EXTERNAL_OFFER_NOT_FOUND': return '구매할 NFT 상품을 찾을 수 없어요. 상품 목록을 다시 확인해주세요.';
    case 'EXTERNAL_COLLECTION_NOT_LIVE': return '현재 판매가 중지된 NFT 컬렉션이에요.';
    case 'NFT_GIFTS_NOT_CONFIGURED': case 'EXTERNAL_NFTS_NOT_CONFIGURED': case 'MARKET_NOT_CONFIGURED': return '현재 NFT 결제 설정을 확인 중이에요. 잠시 후 이용해주세요.';
    case 'CHAIN_UNAVAILABLE': return '블록체인에 연결하지 못했어요. 아직 결제를 요청하지 않았으니 잠시 후 다시 시도해주세요.';
    case 'EXTERNAL_OFFER_MISMATCH': case 'INVALID_CHAIN_OBJECT': return 'NFT 상품 정보 검증에 실패해 결제를 중단했어요.';
    default: return undefined;
  }
}
