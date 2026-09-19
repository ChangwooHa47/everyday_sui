import { Transaction } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';

export const testnetWalletMessage = 'Phantom으로 로그인과 대화는 가능하지만 현재 테스트넷 구매·전송은 지원하지 않아요. 거래에는 Sui 테스트넷 지원 지갑이 필요해요.';

export function supportsSuiLogin(wallet: { chains: readonly string[] }) {
  return wallet.chains.includes('sui:testnet') || wallet.chains.includes('sui:mainnet');
}

/** Personal-message authentication does not spend funds or change the app chain. */
export function loginSigningNetwork(wallet: { name: string; chains: readonly string[] } | null,
  account: { chains: readonly string[] } | null): 'testnet' | 'mainnet' {
  if (!wallet || !account) throw Error('로그인해주세요.');
  const networks = /^phantom$/i.test(wallet.name.trim()) ? ['mainnet', 'testnet'] as const : ['testnet', 'mainnet'] as const;
  for (const network of networks) {
    if (wallet.chains.includes(`sui:${network}`) && account.chains.includes(`sui:${network}`)) return network;
  }
  throw Error('Sui 메시지 서명을 지원하는 지갑으로 연결해주세요.');
}

// Phantom's extension lists no Sui testnet in its supported test networks.
// Do not rely on a provider accepting chain: sui:testnet as proof it uses it.
export function supportsTestnet(wallet: { name: string; chains: readonly string[] }) {
  return !/^phantom$/i.test(wallet.name.trim()) && wallet.chains.includes('sui:testnet');
}

export function assertTestnetWallet(wallet: { name: string; chains: readonly string[] } | null,
  account: { chains: readonly string[] } | null) {
  if (!wallet || !account) throw Error('로그인해주세요.');
  if (/^phantom$/i.test(wallet.name.trim())) throw Error(testnetWalletMessage);
  if (!supportsTestnet(wallet) || !account.chains.includes('sui:testnet'))
    throw Error('연결된 지갑 계정이 Sui 테스트넷을 지원하지 않아요. 테스트넷 지원 지갑으로 연결해주세요.');
}

export function preflightError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/MoveAbort|move abort/i.test(message))
    return Error('컨트랙트가 거래를 거절했어요. 이미 구매했거나 상품 상태가 변경됐을 수 있어요. 새로고침 후 보유 내역을 확인해주세요.');
  if (/insufficient.*(gas|balance|fund)|no valid gas|not enough.*(gas|coin|balance)|gas.*(insufficient|not enough)|GasBalanceTooLow/i.test(message))
    return Error('테스트넷 SUI가 부족해 거래를 준비하지 못했어요. 연결된 주소에 구매 금액과 가스비를 충전해주세요. 메인넷 SUI 잔액은 사용할 수 없어요.');
  return Error('테스트넷에서 거래와 가스비를 확인하지 못했어요. 아직 지갑 승인을 요청하지 않았어요. 잠시 후 다시 시도해주세요.');
}

/** Complete object resolution, gas selection and dry-run before wallet handoff. */
export async function resolveWalletTransaction(transaction: Transaction, owner: string,
  build: (transaction: Transaction) => Promise<Uint8Array>, isCurrent: () => boolean): Promise<Transaction> {
  const check = () => { if (!isCurrent()) throw Error('지갑 계정이 변경됐어요. 다시 로그인해주세요.'); };
  check();
  const sender = transaction.getData().sender;
  if (sender && normalizeSuiAddress(sender) !== normalizeSuiAddress(owner)) throw Error('거래 요청의 지갑 주소가 일치하지 않아요.');
  transaction.setSender(owner);
  let bytes: Uint8Array;
  try { bytes = await build(transaction); }
  catch (error) { throw preflightError(error); }
  check();
  const resolved = Transaction.from(bytes);
  if (!resolved.isFullyResolved() || resolved.getData().sender !== normalizeSuiAddress(owner))
    throw Error('거래 요청을 완성하지 못해 지갑 승인을 중단했어요.');
  return resolved;
}
