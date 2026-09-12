import { bcs } from '@mysten/sui/bcs';
import { TransactionError } from '@mysten/sui/client';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64, normalizeSuiAddress } from '@mysten/sui/utils';
import { productError, type PhotoPaymentProvider } from './core.js';

const addressPattern = /^0x[0-9a-f]{64}$/;

export function createPhotoPaymentProvider(recipient: string | undefined, priceMist = '10000000',
  client = new SuiGrpcClient({ network: 'testnet', baseUrl: 'https://fullnode.testnet.sui.io:443' })): PhotoPaymentProvider {
  if (!recipient || !addressPattern.test(normalizeSuiAddress(recipient)) || !/^[1-9][0-9]*$/.test(priceMist)) {
    return { priceMist, async transaction() { throw productError(503); }, async verify() { throw productError(503); } };
  }
  const target = normalizeSuiAddress(recipient);
  return {
    priceMist,
    async transaction(sender) {
      const tx = new Transaction();
      tx.setSender(normalizeSuiAddress(sender));
      const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(priceMist)]);
      tx.transferObjects([coin], tx.pure.address(target));
      return tx.toJSON();
    },
    async verify(digest, sender) {
      let result: Awaited<ReturnType<typeof client.getTransaction>>;
      try { result = await client.getTransaction({ digest, include: { transaction: true, effects: true }, signal: AbortSignal.timeout(10000) }); }
      catch (error) {
        if (error instanceof TransactionError && error.reason === 'notFound') throw productError('PAYMENT_REQUIRED', 'SUI 결제가 아직 확인되지 않았습니다.');
        throw productError(503);
      }
      if (result.$kind !== 'Transaction' || result.Transaction.digest !== digest || !result.Transaction.status.success)
        throw productError('PAYMENT_REQUIRED', '완료된 SUI 결제를 확인할 수 없습니다.');
      const data = result.Transaction.transaction as unknown as { sender: string; inputs: Array<{ $kind: string; Pure?: { bytes: string } }>; commands: Array<Record<string, unknown>> };
      const split = data.commands?.[0] as { $kind?: string; SplitCoins?: { coin?: { $kind?: string }; amounts?: Array<{ $kind?: string; Input?: number }> } };
      const transfer = data.commands?.[1] as { $kind?: string; TransferObjects?: { objects?: Array<{ $kind?: string; NestedResult?: [number, number] }>; address?: { $kind?: string; Input?: number } } };
      const amountInput = split.SplitCoins?.amounts?.[0]?.Input;
      const addressInput = transfer.TransferObjects?.address?.Input;
      const amountBytes = amountInput === undefined ? undefined : data.inputs?.[amountInput]?.Pure?.bytes;
      const addressBytes = addressInput === undefined ? undefined : data.inputs?.[addressInput]?.Pure?.bytes;
      const amount = amountBytes ? String(bcs.u64().parse(fromBase64(amountBytes))) : '';
      const paidTo = addressBytes ? normalizeSuiAddress(bcs.Address.parse(fromBase64(addressBytes))) : '';
      if (normalizeSuiAddress(data.sender) !== normalizeSuiAddress(sender) || data.commands.length !== 2
        || split.$kind !== 'SplitCoins' || split.SplitCoins?.coin?.$kind !== 'GasCoin'
        || split.SplitCoins?.amounts?.length !== 1 || transfer.$kind !== 'TransferObjects'
        || transfer.TransferObjects?.objects?.length !== 1
        || transfer.TransferObjects.objects[0]?.$kind !== 'NestedResult'
        || transfer.TransferObjects.objects[0]?.NestedResult?.[0] !== 0 || transfer.TransferObjects.objects[0]?.NestedResult?.[1] !== 0
        || amount !== priceMist || paidTo !== target) throw productError('PAYMENT_REQUIRED', '사진 결제 내역이 요청과 일치하지 않습니다.');
    },
  };
}
