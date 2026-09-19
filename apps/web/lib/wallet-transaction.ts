import type { Transaction } from '@mysten/sui/transactions';
import { walletKit, getWalletToken } from './wallet-auth';
import { assertTestnetWallet, resolveWalletTransaction } from './wallet-preflight';

type Account = NonNullable<Parameters<typeof walletKit.signAndExecuteTransaction>[0]['account']>;

async function prepare(transaction: Transaction, account: Account) {
  const initial = walletKit.stores.$connection.get();
  assertTestnetWallet(initial.wallet, account);
  const isCurrent = () => {
    const current = walletKit.stores.$connection.get();
    return current.wallet === initial.wallet && current.account?.address === account.address;
  };
  const client = walletKit.getClient('testnet');
  const resolved = await resolveWalletTransaction(transaction, account.address,
    tx => tx.build({ client }), isCurrent);
  const check = () => {
    getWalletToken();
    if (!isCurrent()) throw Error('지갑 계정이 변경됐어요. 다시 로그인해주세요.');
  };
  check();
  return { resolved, check };
}

// Preparing happens before the NFT purchase's durable pending guard. Failures
// here are known not to have reached a wallet and must not poison future retries.
export async function prepareWalletExecution(transaction: Transaction, account: Account) {
  const { resolved, check } = await prepare(transaction, account);
  return () => {
    check();
    return walletKit.signAndExecuteTransaction({ transaction: resolved, account, network: 'testnet' });
  };
}

export async function executeWalletTransaction(transaction: Transaction, account: Account) {
  return (await prepareWalletExecution(transaction, account))();
}

export async function signWalletTransaction(transaction: Transaction, account: Account) {
  const { resolved, check } = await prepare(transaction, account);
  check();
  return walletKit.signTransaction({ transaction: resolved, account, network: 'testnet' });
}
