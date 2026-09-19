// Read-only testnet check: never signs or submits a transaction.
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import assert from 'node:assert/strict';
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: 'https://fullnode.testnet.sui.io:443' });
const listingId = '0xdd868558e50779d0e3b8ad41847a176838e0c7a42dc4a60a4a27775e8d6128dc';
const sender = '0x941030e118d68d322be6050e2c5f300587194ed847d59c474dda3af12d36f007';
const table = bcs.struct('Table', { id: bcs.Address, size: bcs.u64() });
const listingBcs = bcs.struct('Listing', {
  id: bcs.Address, creator: bcs.Address, operator: bcs.Address, title: bcs.string(),
  price: bcs.u64(), agent_bps: bcs.u64(), blob_id: bcs.string(), content_hash: bcs.vector(bcs.u8()),
  end_epoch: bcs.u64(), published: bcs.bool(), active: bcs.bool(), buyers: table, treasury: bcs.u64(),
  per_gift_limit: bcs.u64(), daily_limit: bcs.u64(), day: bcs.u64(), spent: bcs.u64(),
  allowed_gifts: bcs.vector(bcs.Address), intents: table,
});
const { object } = await client.getObject({ objectId: listingId, include: { content: true } });
const listing = listingBcs.parse(object.content);
const transaction = new Transaction(); transaction.setSender(sender);
const [payment] = transaction.splitCoins(transaction.gas, [transaction.pure.u64(listing.price)]);
transaction.moveCall({ target: object.type.replace('::Listing', '::purchase'), arguments: [transaction.object(listingId), payment] });
const result = await client.simulateTransaction({ transaction, doGasSelection: true });
console.log(JSON.stringify({ listingId, type: object.type, priceMist: listing.price,
  published: listing.published, active: listing.active,
  status: (result.Transaction ?? result.FailedTransaction)?.status }, null, 2));
assert.equal(result.Transaction?.status.success, true, 'Testnet purchase simulation failed');
const built = Transaction.from(await transaction.build({ client }));
assert.equal(built.isFullyResolved(), true);
console.log(JSON.stringify({ fullyResolved: built.isFullyResolved(), gas: built.getData().gasData }, null, 2));
