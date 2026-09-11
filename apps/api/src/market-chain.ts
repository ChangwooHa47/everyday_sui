import { bcs } from '@mysten/sui/bcs';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { normalizeStructTag } from '@mysten/sui/utils';
import { addressSchema, failure } from './auth.js';
import type { MarketListing } from '@everyday/contracts';

// Field order matches market.move. BCS avoids transport-dependent JSON shapes.
const table = bcs.struct('Table', { id: bcs.Address, size: bcs.u64() });
export const listingBcs = bcs.struct('Listing', {
  id: bcs.Address, creator: bcs.Address, operator: bcs.Address, title: bcs.string(),
  price: bcs.u64(), agent_bps: bcs.u64(), blob_id: bcs.string(),
  content_hash: bcs.vector(bcs.u8()), end_epoch: bcs.u64(), published: bcs.bool(), active: bcs.bool(),
  buyers: table, treasury: bcs.u64(), per_gift_limit: bcs.u64(), daily_limit: bcs.u64(),
  day: bcs.u64(), spent: bcs.u64(), allowed_gifts: bcs.vector(bcs.Address), intents: table,
});
export const licenseBcs = bcs.struct('License', { id: bcs.Address, listing: bcs.Address, buyer: bcs.Address });
export interface MarketChain {
  readonly packageId: string;
  listing(id: string): Promise<MarketListing>;
  hasLicense(actor: string, listingId: string, licenseId: string): Promise<boolean>;
}
export function createMarketChain(packageId: string, client: Pick<SuiGrpcClient, 'getObject'>): MarketChain {
  const pkg = addressSchema.parse(packageId);
  if (BigInt(pkg) === 0n) throw Error('SUI_MARKET_PACKAGE_ID must be a deployed package');
  async function object(id: string) {
    try { return (await client.getObject({ objectId: id, include: { content: true }, signal: AbortSignal.timeout(10_000) })).object; }
    catch { throw failure(503, 'CHAIN_UNAVAILABLE'); }
  }
  return {
    packageId: pkg,
    async listing(id) {
      const value = await object(id);
      if (normalizeStructTag(value.type) !== `${pkg}::market::Listing` || value.owner.$kind !== 'Shared') throw failure(404, 'LISTING_NOT_FOUND');
      const data = listingBcs.parse(value.content);
      if (data.id !== id || value.objectId !== id) throw failure(503, 'INVALID_CHAIN_OBJECT');
      return { id: data.id, creator: data.creator, operator: data.operator, title: data.title,
        priceMist: data.price, agentBps: Number(data.agent_bps), treasuryMist: data.treasury,
        published: data.published, active: data.active,
        package: { blobId: data.blob_id, contentHash: Buffer.from(data.content_hash).toString('hex'), endEpoch: data.end_epoch },
        policy: { perGiftLimitMist: data.per_gift_limit, dailyLimitMist: data.daily_limit, allowedGiftIds: data.allowed_gifts } };
    },
    async hasLicense(actor, listingId, licenseId) {
      const value = await object(licenseId);
      if (normalizeStructTag(value.type) !== `${pkg}::market::License` || value.owner.$kind !== 'AddressOwner' || value.owner.AddressOwner !== actor) return false;
      const data = licenseBcs.parse(value.content);
      return data.id === licenseId && value.objectId === licenseId && data.buyer === actor && data.listing === listingId;
    },
  };
}
export function marketChainFromEnv(env: NodeJS.ProcessEnv = process.env): MarketChain | undefined {
  if (!env.SUI_MARKET_PACKAGE_ID) return undefined;
  const baseUrl = env.SUI_GRPC_URL ?? 'https://fullnode.testnet.sui.io:443';
  if (new URL(baseUrl).protocol !== 'https:') throw Error('SUI_GRPC_URL must use HTTPS');
  return createMarketChain(env.SUI_MARKET_PACKAGE_ID, new SuiGrpcClient({ network: 'testnet', baseUrl }));
}
