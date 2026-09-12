import assert from 'node:assert/strict';
import test from 'node:test';
import { bcs } from '@mysten/sui/bcs';
import { toBase64 } from '@mysten/sui/utils';
import { createPhotoPaymentProvider } from '../src/product/photo-payment.js';

const sender = `0x${'1'.repeat(64)}`;
const recipient = `0x${'2'.repeat(64)}`;
const pure = (bytes: Uint8Array) => ({ $kind: 'Pure', Pure: { bytes: toBase64(bytes) } });
const receipt = (amount = '10000000', target = recipient, owner = sender) => ({
  $kind: 'Transaction', Transaction: { digest: 'fixture', status: { success: true }, transaction: {
    sender: owner,
    inputs: [pure(bcs.u64().serialize(amount).toBytes()), pure(bcs.Address.serialize(target).toBytes())],
    commands: [
      { $kind: 'SplitCoins', SplitCoins: { coin: { $kind: 'GasCoin' }, amounts: [{ $kind: 'Input', Input: 0 }] } },
      { $kind: 'TransferObjects', TransferObjects: { objects: [{ $kind: 'NestedResult', NestedResult: [0, 0] }], address: { $kind: 'Input', Input: 1 } } },
    ],
  } },
});

test('photo payment accepts only the exact sender, recipient, amount and command shape', async () => {
  let value = receipt();
  const client = { async getTransaction() { return value; } };
  const provider = createPhotoPaymentProvider(recipient, '10000000', client as never);
  await provider.verify('fixture', sender);
  for (const invalid of [receipt('9999999'), receipt('10000000', `0x${'3'.repeat(64)}`), receipt('10000000', recipient, `0x${'4'.repeat(64)}`)]) {
    value = invalid;
    await assert.rejects(provider.verify('fixture', sender), (error: Error & { statusCode?: number }) => error.statusCode === 402);
  }
  value = receipt();
  value.Transaction.transaction.commands.push({ $kind: 'MoveCall' } as never);
  await assert.rejects(provider.verify('fixture', sender), (error: Error & { statusCode?: number }) => error.statusCode === 402);
});
