import { bcs } from '@mysten/sui/bcs';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { TransactionError, type SuiClientTypes } from '@mysten/sui/client';
import { normalizeStructTag } from '@mysten/sui/utils';
import { addressSchema, failure } from './auth.js';
import type { MarketListing, NftGiftProduct, OwnedNftGift } from '@everyday/contracts';

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
export const nftGiftProductBcs = bcs.struct('NftGiftProduct', {
  id: bcs.Address, title: bcs.string(), description: bcs.string(), image_url: bcs.string(),
  image_hash: bcs.vector(bcs.u8()), merchant: bcs.Address, price: bcs.u64(), max_supply: bcs.u64(),
  minted: bcs.u64(), active: bcs.bool(),
});
export const giftNftBcs = bcs.struct('GiftNft', {
  id: bcs.Address, product: bcs.Address, title: bcs.string(), description: bcs.string(),
  image_url: bcs.string(), image_hash: bcs.vector(bcs.u8()), edition: bcs.u64(),
});
export interface MarketChain {
  readonly packageId: string;
  readonly nftGiftProductIds?: string[];
  listing(id: string): Promise<MarketListing>;
  listings?(ids: string[]): Promise<MarketListing[]>;
  nftGiftProduct?(id: string): Promise<NftGiftProduct>;
  nftGiftProducts?(ids: string[]): Promise<NftGiftProduct[]>;
  ownedNftGifts?(owner: string): Promise<OwnedNftGift[]>;
  hasLicense(actor: string, listingId: string, licenseId: string): Promise<boolean>;
  transactionStatus?(digest: string): Promise<'confirmed' | 'failed' | 'notFound'>;
}
export function createMarketChain(packageId: string, client: Pick<SuiGrpcClient, 'getObject'> & Partial<Pick<SuiGrpcClient, 'getObjects' | 'getTransaction' | 'listOwnedObjects'>>, nftGiftProductIds: string[] = []): MarketChain {
  const pkg = addressSchema.parse(packageId);
  if (BigInt(pkg) === 0n) throw Error('SUI_MARKET_PACKAGE_ID must be a deployed package');
  const giftIds = nftGiftProductIds.map(value => addressSchema.parse(value));
  if (new Set(giftIds).size !== giftIds.length) throw Error('NFT_GIFT_PRODUCT_IDS must not contain duplicates');
  async function object(id: string) {
    try { return (await client.getObject({ objectId: id, include: { content: true }, signal: AbortSignal.timeout(10_000) })).object; }
    catch { throw failure(503, 'CHAIN_UNAVAILABLE'); }
  }
  function listing(id: string, value: SuiClientTypes.Object<{ content: true }> | Error): MarketListing {
    if (value instanceof Error) throw failure(503, 'CHAIN_UNAVAILABLE');
    let type: string;
    try { type = normalizeStructTag(value.type); }
    catch { throw failure(503, 'INVALID_CHAIN_OBJECT'); }
    if (type !== `${pkg}::market::Listing` || value.owner?.$kind !== 'Shared') throw failure(404, 'LISTING_NOT_FOUND');
    let data: ReturnType<typeof listingBcs.parse>;
    try {
      data = listingBcs.parse(value.content);
      // Reject inconsistent identity, trailing bytes and noncanonical BCS in both read paths.
      if (data.id !== id || value.objectId !== id
        || !Buffer.from(listingBcs.serialize(data).toBytes()).equals(Buffer.from(value.content))) throw Error('Invalid listing');
    } catch { throw failure(503, 'INVALID_CHAIN_OBJECT'); }
    return { id: data.id, creator: data.creator, operator: data.operator, title: data.title,
      priceMist: data.price, agentBps: Number(data.agent_bps), treasuryMist: data.treasury,
      published: data.published, active: data.active,
      package: { blobId: data.blob_id, contentHash: Buffer.from(data.content_hash).toString('hex'), endEpoch: data.end_epoch },
      policy: { perGiftLimitMist: data.per_gift_limit, dailyLimitMist: data.daily_limit, allowedGiftIds: data.allowed_gifts,
        // market.move resets `spent` when the clock day advances; mirror that so stale spend never hides today's budget.
        spentTodayMist: BigInt(data.day) === BigInt(Math.floor(Date.now() / 86400000)) ? data.spent : '0' } };
  }
  function exactObject(id: string, value: SuiClientTypes.Object<{ content: true }> | Error,
    expectedType: string, expectedOwner: 'Shared' | string,
    schema: { parse(bytes: Uint8Array): unknown; serialize(data: never): { toBytes(): Uint8Array } }): unknown {
    if (value instanceof Error) throw failure(503, 'CHAIN_UNAVAILABLE');
    let type: string;
    try { type = normalizeStructTag(value.type); } catch { throw failure(503, 'INVALID_CHAIN_OBJECT'); }
    const ownerMatches = expectedOwner === 'Shared' ? value.owner?.$kind === 'Shared'
      : value.owner?.$kind === 'AddressOwner' && value.owner.AddressOwner === expectedOwner;
    if (type !== `${pkg}::market::${expectedType}` || !ownerMatches) throw failure(404, 'NFT_GIFT_NOT_FOUND');
    try {
      const data = schema.parse(value.content) as { id?: string };
      const objectId = (data as { id?: string }).id;
      if (objectId !== id || value.objectId !== id
        || !Buffer.from(schema.serialize(data as never).toBytes()).equals(Buffer.from(value.content))) throw Error('Invalid object');
      return data;
    } catch { throw failure(503, 'INVALID_CHAIN_OBJECT'); }
  }
  function nftProduct(id: string, value: SuiClientTypes.Object<{ content: true }> | Error): NftGiftProduct {
    const data = exactObject(id, value, 'NftGiftProduct', 'Shared', nftGiftProductBcs) as {
      id: string; title: string; description: string; image_url: string; image_hash: number[];
      merchant: string; price: string; max_supply: string; minted: string; active: boolean;
    };
    if (data.image_hash.length !== 32 || new URL(data.image_url).protocol !== 'https:'
      || !data.title.length || BigInt(data.price) <= 0n || BigInt(data.minted) > BigInt(data.max_supply))
      throw failure(503, 'INVALID_CHAIN_OBJECT');
    return { id: data.id, title: data.title, description: data.description, imageUrl: data.image_url,
      imageHash: Buffer.from(data.image_hash).toString('hex'), merchant: data.merchant, priceMist: data.price,
      maxSupply: data.max_supply, minted: data.minted, active: data.active };
  }
  function ownedGift(value: SuiClientTypes.Object<{ content: true }>, owner: string): OwnedNftGift {
    const data = exactObject(value.objectId, value, 'GiftNft', owner, giftNftBcs) as {
      id: string; product: string; title: string; description: string; image_url: string;
      image_hash: number[]; edition: string;
    };
    if (data.image_hash.length !== 32 || new URL(data.image_url).protocol !== 'https:' || !data.title.length)
      throw failure(503, 'INVALID_CHAIN_OBJECT');
    return { id: data.id, productId: data.product, title: data.title, description: data.description,
      imageUrl: data.image_url, imageHash: Buffer.from(data.image_hash).toString('hex'), edition: data.edition };
  }
  return {
    packageId: pkg,
    nftGiftProductIds: giftIds,
    async transactionStatus(digest) {
      if (!client.getTransaction) throw failure(503, 'CHAIN_UNAVAILABLE');
      try {
        const result = await client.getTransaction({ digest, signal: AbortSignal.timeout(10000) });
        return result.$kind === 'Transaction' ? 'confirmed' : 'failed';
      } catch (error) {
        if (error instanceof TransactionError && error.reason === 'notFound') return 'notFound';
        throw failure(503, 'CHAIN_UNAVAILABLE');
      }
    },
    async listing(id) {
      return listing(id, await object(id));
    },
    async listings(ids) {
      if (!ids.length) return [];
      // Older fixture clients only expose getObject; production uses the native gRPC batch.
      if (!client.getObjects) return Promise.all(ids.map(async id => listing(id, await object(id))));
      let result: SuiClientTypes.GetObjectsResponse<{ content: true }>;
      try {
        result = await client.getObjects({ objectIds: ids, include: { content: true }, signal: AbortSignal.timeout(10_000) });
      } catch { throw failure(503, 'CHAIN_UNAVAILABLE'); }
      if (!Array.isArray(result?.objects) || result.objects.length !== ids.length) throw failure(503, 'INVALID_CHAIN_OBJECT');
      // SDK results correspond positionally to requested IDs. Never omit or accept a substituted object.
      return ids.map((id, index) => listing(id, result.objects[index]));
    },
    async nftGiftProduct(id) { return nftProduct(id, await object(id)); },
    async nftGiftProducts(ids) {
      if (!ids.length) return [];
      if (!client.getObjects) return Promise.all(ids.map(async id => nftProduct(id, await object(id))));
      let result: SuiClientTypes.GetObjectsResponse<{ content: true }>;
      try { result = await client.getObjects({ objectIds: ids, include: { content: true }, signal: AbortSignal.timeout(10_000) }); }
      catch { throw failure(503, 'CHAIN_UNAVAILABLE'); }
      if (!Array.isArray(result?.objects) || result.objects.length !== ids.length) throw failure(503, 'INVALID_CHAIN_OBJECT');
      return ids.map((id, index) => nftProduct(id, result.objects[index]));
    },
    async ownedNftGifts(owner) {
      if (!client.listOwnedObjects) throw failure(503, 'CHAIN_UNAVAILABLE');
      try {
        const gifts: OwnedNftGift[] = [];
        let cursor: string | null | undefined;
        do {
          const page = await client.listOwnedObjects({ owner, type: `${pkg}::market::GiftNft`, cursor,
            limit: 50, include: { content: true }, signal: AbortSignal.timeout(10_000) });
          gifts.push(...page.objects.map(value => ownedGift(value, owner)));
          cursor = page.hasNextPage ? page.cursor : null;
        } while (cursor);
        return gifts;
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode) throw error;
        throw failure(503, 'CHAIN_UNAVAILABLE');
      }
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
  const giftIds = (env.NFT_GIFT_PRODUCT_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  return createMarketChain(env.SUI_MARKET_PACKAGE_ID, new SuiGrpcClient({ network: 'testnet', baseUrl }), giftIds);
}

/** Optional NFT catalog package, kept separate while testnet character listings remain on the prior package. */
export function nftGiftChainFromEnv(env: NodeJS.ProcessEnv = process.env): MarketChain | undefined {
  if (!env.NFT_GIFT_PACKAGE_ID) return undefined;
  const baseUrl = env.SUI_GRPC_URL ?? 'https://fullnode.testnet.sui.io:443';
  if (new URL(baseUrl).protocol !== 'https:') throw Error('SUI_GRPC_URL must use HTTPS');
  const giftIds = (env.NFT_GIFT_PRODUCT_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  return createMarketChain(env.NFT_GIFT_PACKAGE_ID, new SuiGrpcClient({ network: 'testnet', baseUrl }), giftIds);
}
