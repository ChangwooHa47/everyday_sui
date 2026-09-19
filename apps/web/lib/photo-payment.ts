import { Transaction } from '@mysten/sui/transactions';
import { backend } from './api';

export async function payForPhoto(characterId: number) {
  const { getWalletToken, restoreWalletToken, walletKit } = await import('./wallet-auth');
  await restoreWalletToken();
  const account = walletKit.stores.$connection.get().account;
  if (!account) throw Error('로그인해주세요.');
  const payment = await backend.photoPaymentTransaction(characterId);
  if (payment.network !== 'testnet' || payment.priceMist !== '10000000') throw Error('사진 가격이 변경됐어요. 다시 확인해주세요.');
  const result = await walletKit.signAndExecuteTransaction({ transaction: Transaction.from(payment.transaction), account, network: 'testnet' });
  if (result.$kind !== 'Transaction' || !result.Transaction.status.success) throw Error('SUI 결제를 완료하지 못했어요.');
  await walletKit.getClient('testnet').waitForTransaction({ digest: result.Transaction.digest, timeout: 30000 });
  getWalletToken();
  if (walletKit.stores.$connection.get().account?.address !== account.address) throw Error('다시 로그인해주세요.');
  return result.Transaction.digest;
}
