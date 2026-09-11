import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { normalizeSuiAddress as id } from '@mysten/sui/utils';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { createMemoryProvider, memoryAccountBcs } from '../src/memory-provider.js';

test('MemWal binding validates exact type, owner, frozen state and current delegate authorization', async () => {
  const masterKey = 'ab'.repeat(32), owner = id('0xb'), accountId = id('0xbb'), packageId = id('0x99');
  const secret = createHmac('sha256', Buffer.from(masterKey, 'hex')).update(`everyday-memwal-v1:${owner}`).digest();
  const key = Ed25519Keypair.fromSecretKey(secret);
  const valid = { id: accountId, owner, active: true, admin_quarantined: false, created_at: 0, legacy_account_id: null, access_counter_version: 0,
    delegate_keys: [{ public_key: Array.from(key.getPublicKey().toRawBytes()), sui_address: key.toSuiAddress(), label: 'everyday', created_at: 0 }] };
  let data = valid; let type = `${packageId}::account::MemWalAccount`;
  const chain = { getObject: async () => ({ object: { objectId: accountId, type, owner: { $kind: 'Shared' }, content: memoryAccountBcs.serialize(data).toBytes() } }) } as unknown as Pick<SuiGrpcClient, 'getObject'>;
  const memory = createMemoryProvider({ masterKey, packageId, registryId: id('0x9'), marketPackageId: id('0x98'), rpcUrl: 'https://invalid.example', serverUrl: 'https://invalid.example' }, chain);
  await memory.verify(owner, accountId);
  for (const change of [{ owner: id('0xe') }, { active: false }, { admin_quarantined: true }, { delegate_keys: [] }, { id: id('0xbc') }]) {
    data = { ...valid, ...change }; await assert.rejects(memory.verify(owner, accountId), { statusCode: 403 });
  }
  data = valid; type = `${id('0x98')}::account::MemWalAccount`;
  await assert.rejects(memory.verify(owner, accountId), { statusCode: 403 });
});
