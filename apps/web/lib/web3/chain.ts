import { bcs } from '@mysten/sui/bcs';
import type { SuiClientTypes } from '@mysten/sui/client';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { fromHex, normalizeSuiAddress, toHex } from '@mysten/sui/utils';
import { network, rpcUrl, requirePackage } from './config';
import { referenceSchema, type Reference } from './schema';

export const client = new SuiGrpcClient({ network, baseUrl: rpcUrl });
const Character = bcs.struct('Character', { id: bcs.Address, schemaVersion: bcs.u64(), revision: bcs.u64(),
  blobId: bcs.string(), contentHash: bcs.vector(bcs.u8()), endEpoch: bcs.u64() });
const Vault = bcs.struct('UserVault', { id: bcs.Address, owner: bcs.Address, schemaVersion: bcs.u64(), revision: bcs.u64(),
  blobId: bcs.string(), contentHash: bcs.vector(bcs.u8()), endEpoch: bcs.u64() });
export interface Asset { id: string; type: 'Character' | 'UserVault'; revision: string; ref: Reference | null; }

export async function discover(owner: string): Promise<Asset[]> {
  const pkg = requirePackage();
  const assets: Asset[] = [];
  for (const [module, type] of [['character','Character'],['vault','UserVault']] as const) {
    let cursor: string | null = null;
    do {
      const page: SuiClientTypes.ListOwnedObjectsResponse<{ content: true }> = await client.core.listOwnedObjects({ owner, type: `${pkg}::${module}::${type}`, cursor, limit: 50, include: { content: true } });
      for (const object of page.objects) {
        if (object.owner.$kind !== 'AddressOwner' || normalizeSuiAddress(object.owner.AddressOwner) !== normalizeSuiAddress(owner)) continue;
        const value = type === 'Character' ? Character.parse(object.content) : Vault.parse(object.content);
        if (value.schemaVersion !== '1') throw Error('지원하지 않는 데이터 형식입니다.');
        assets.push({ id: normalizeSuiAddress(value.id), type, revision: value.revision,
          ref: value.blobId ? referenceSchema.parse({ blobId: value.blobId, contentHash: toHex(Uint8Array.from(value.contentHash)), endEpoch: value.endEpoch }) : null });
      }
      if (!page.hasNextPage) break;
      if (!page.cursor || page.cursor === cursor) throw Error('목록을 불러올 수 없습니다.');
      cursor = page.cursor;
    } while (true);
  }
  return assets;
}
export function createVault() {
  const tx = new Transaction();
  tx.moveCall({ target: `${requirePackage()}::vault::create` });
  return tx;
}
export function publishCharacter(owner: string, ref: Reference, asset?: Asset) {
  const tx = new Transaction();
  const args = [tx.pure.string(ref.blobId), tx.pure.vector('u8', fromHex(ref.contentHash)), tx.pure.u64(ref.endEpoch)];
  if (asset) tx.moveCall({ target: `${requirePackage()}::character::update`, arguments: [tx.object(asset.id), tx.pure.u64(asset.revision), ...args] });
  else {
    const c = tx.moveCall({ target: `${requirePackage()}::character::create`, arguments: args });
    tx.transferObjects([c], owner);
  }
  return tx;
}
export function publishVault(asset: Asset, ref: Reference) {
  const tx = new Transaction();
  tx.moveCall({ target: `${requirePackage()}::vault::update`, arguments: [tx.object(asset.id), tx.pure.u64(asset.revision),
    tx.pure.string(ref.blobId), tx.pure.vector('u8', fromHex(ref.contentHash)), tx.pure.u64(ref.endEpoch)] });
  return tx;
}
export function transferCharacter(asset: Asset, recipient: string) {
  if (asset.type !== 'Character') throw Error('개인 보관함은 이전할 수 없습니다.');
  const tx = new Transaction();
  tx.transferObjects([tx.object(asset.id)], tx.pure.address(recipient));
  return tx;
}
