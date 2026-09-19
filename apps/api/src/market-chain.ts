import { bcs } from '@mysten/sui/bcs';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { ObjectError, TransactionError, type SuiClientTypes } from '@mysten/sui/client';
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
export const externalCollectionPolicyBcs = bcs.struct('ExternalCollectionPolicy', {
  id: bcs.Address, name: bcs.string(), type_name: bcs.string(), active: bcs.bool(),
});
export const externalNftOfferBcs = bcs.struct('ExternalNftOffer', {
  id: bcs.Address, policy: bcs.Address, seller: bcs.Address, item: bcs.Address,
  type_name: bcs.string(), title: bcs.string(), description: bcs.string(), image_url: bcs.string(),
  image_hash: bcs.vector(bcs.u8()), price: bcs.u64(), active: bcs.bool(),
});
const externalNftSoldBcs = bcs.struct('ExternalNftSold', {
  offer: bcs.Address, policy: bcs.Address, item: bcs.Address, seller: bcs.Address,
  buyer: bcs.Address, price: bcs.u64(),
});
export const externalNftWithdrawnBcs = bcs.struct('ExternalNftWithdrawn', {
  offer: bcs.Address, policy: bcs.Address, item: bcs.Address, seller: bcs.Address,
});
export interface ExternalCollectionPolicy {
  id: string; name: string; objectType: string; rawObjectType: string; active: boolean;
}
export interface ExternalNftOffer {
  id: string; policyId: string; seller: string; objectId: string; objectType: string; rawObjectType: string;
  title: string; description: string; imageUrl: string; imageHash: string; priceMist: string; active: boolean;
}
export interface ExternalOwnedReference { id: string; objectType: string; }
export interface MarketChain {
  readonly packageId: string;
  readonly nftGiftProductIds?: string[];
  readonly externalCollectionPolicyIds?: string[];
  listing(id: string): Promise<MarketListing>;
  listings?(ids: string[]): Promise<MarketListing[]>;
  nftGiftProduct?(id: string): Promise<NftGiftProduct>;
  nftGiftProducts?(ids: string[]): Promise<NftGiftProduct[]>;
  ownedNftGifts?(owner: string): Promise<OwnedNftGift[]>;
  externalCollectionPolicy?(id: string): Promise<ExternalCollectionPolicy>;
  externalNftOffer?(id: string): Promise<ExternalNftOffer>;
  externalNftOffers?(ids: string[]): Promise<ExternalNftOffer[]>;
  ownedExternalNfts?(owner: string, items: ExternalOwnedReference[]): Promise<string[]>;
  hasLicense(actor: string, listingId: string, licenseId: string): Promise<boolean>;
  transactionStatus?(digest: string): Promise<'confirmed' | 'failed' | 'notFound'>;
  verifyExternalNftSale?(digest: string, expected: { offerId: string; objectId: string; buyer: string; priceMist: string }): Promise<boolean>;
  verifyExternalNftWithdrawal?(digest: string, expected: { offerId: string; policyId: string; objectId: string; seller: string }): Promise<boolean>;
}
export function canonicalExternalType(value: string) {
  if (!/^[A-Za-z0-9_:,<> ]+$/.test(value)) throw Error('Invalid external NFT type');
  const withPrefixes = value.replace(/(^|[<,])([0-9a-fA-F]{64})::/g,
    (_match, prefix: string, address: string) => `${prefix}0x${address}::`);
  return normalizeStructTag(withPrefixes);
}
export function createMarketChain(packageId: string, client: Pick<SuiGrpcClient, 'getObject'> & Partial<Pick<SuiGrpcClient, 'getObjects' | 'getTransaction' | 'listOwnedObjects'>>, nftGiftProductIds: string[] = [], externalCollectionPolicyIds: string[] = []): MarketChain {
  const pkg = addressSchema.parse(packageId);
  if (BigInt(pkg) === 0n) throw Error('SUI_MARKET_PACKAGE_ID must be a deployed package');
  const giftIds = nftGiftProductIds.map(value => addressSchema.parse(value));
  if (new Set(giftIds).size !== giftIds.length) throw Error('NFT_GIFT_PRODUCT_IDS must not contain duplicates');
  const policyIds = externalCollectionPolicyIds.map(value => addressSchema.parse(value));
  if (new Set(policyIds).size !== policyIds.length) throw Error('EXTERNAL_NFT_POLICY_IDS must not contain duplicates');
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
      priceMist: data.price, agentBps: Number(data.agent_bps), treasuryMist: data.treasury, buyerCount: data.buyers.size,
      published: data.published, active: data.active,
      package: { blobId: data.blob_id, contentHash: Buffer.from(data.content_hash).toString('hex'), endEpoch: data.end_epoch },
      policy: { perGiftLimitMist: data.per_gift_limit, dailyLimitMist: data.daily_limit, allowedGiftIds: data.allowed_gifts,
        // market.move resets `spent` when the clock day advances; mirror that so stale spend never hides today's budget.
        spentTodayMist: BigInt(data.day) === BigInt(Math.floor(Date.now() / 86400000)) ? data.spent : '0' } };
  }
  function exactObject(id: string, value: SuiClientTypes.Object<{ content: true }> | Error,
    expectedType: string, expectedOwner: 'Shared' | string,
    schema: { parse(bytes: Uint8Array): unknown; serialize(data: never): { toBytes(): Uint8Array } }): unknown {
    if (value instanceof ObjectError && (value.reason === 'notFound' || value.reason === 'deleted'))
      throw failure(404, 'NFT_GIFT_NOT_FOUND');
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
  function externalPolicy(id: string, value: SuiClientTypes.Object<{ content: true }> | Error): ExternalCollectionPolicy {
    const data = exactObject(id, value, 'ExternalCollectionPolicy', 'Shared', externalCollectionPolicyBcs) as {
      id: string; name: string; type_name: string; active: boolean;
    };
    let objectType: string;
    try { objectType = canonicalExternalType(data.type_name); } catch { throw failure(503, 'INVALID_CHAIN_OBJECT'); }
    if (!data.name.length || data.name.length > 240) throw failure(503, 'INVALID_CHAIN_OBJECT');
    return { id: data.id, name: data.name, objectType, rawObjectType: data.type_name, active: data.active };
  }
  function externalOffer(id: string, value: SuiClientTypes.Object<{ content: true }> | Error): ExternalNftOffer {
    const data = exactObject(id, value, 'ExternalNftOffer', 'Shared', externalNftOfferBcs) as {
      id: string; policy: string; seller: string; item: string; type_name: string; title: string;
      description: string; image_url: string; image_hash: number[]; price: string; active: boolean;
    };
    let objectType: string;
    try { objectType = canonicalExternalType(data.type_name); }
    catch { throw failure(503, 'INVALID_CHAIN_OBJECT'); }
    if (!data.title.length || data.title.length > 240 || data.description.length > 2000 || data.image_hash.length !== 32
      || !data.image_url.length || data.image_url.length > 2000 || new URL(data.image_url).protocol !== 'https:'
      || BigInt(data.price) <= 0n) throw failure(503, 'INVALID_CHAIN_OBJECT');
    return { id: data.id, policyId: data.policy, seller: data.seller, objectId: data.item,
      objectType, rawObjectType: data.type_name, title: data.title, description: data.description,
      imageUrl: data.image_url, imageHash: Buffer.from(data.image_hash).toString('hex'),
      priceMist: data.price, active: data.active };
  }
  return {
    packageId: pkg,
    nftGiftProductIds: giftIds,
    externalCollectionPolicyIds: policyIds,
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
    async verifyExternalNftSale(digest, expected) {
      if (!client.getTransaction) throw failure(503, 'CHAIN_UNAVAILABLE');
      let result: SuiClientTypes.TransactionResult<{ events: true }>;
      try { result = await client.getTransaction({ digest, include: { events: true }, signal: AbortSignal.timeout(10_000) }); }
      catch (error) {
        if (error instanceof TransactionError && error.reason === 'notFound') return false;
        throw failure(503, 'CHAIN_UNAVAILABLE');
      }
      if (result.$kind !== 'Transaction' || !result.Transaction.status.success || result.Transaction.digest !== digest) return false;
      return result.Transaction.events.some(event => {
        if (normalizeStructTag(event.eventType) !== `${pkg}::market::ExternalNftSold`) return false;
        try {
          const data = externalNftSoldBcs.parse(event.bcs);
          return data.offer === expected.offerId && data.item === expected.objectId
            && data.buyer === expected.buyer && data.price === expected.priceMist;
        } catch { return false; }
      });
    },
    async verifyExternalNftWithdrawal(digest, expected) {
      if (!client.getTransaction) throw failure(503, 'CHAIN_UNAVAILABLE');
      let result: SuiClientTypes.TransactionResult<{ events: true }>;
      try { result = await client.getTransaction({ digest, include: { events: true }, signal: AbortSignal.timeout(10_000) }); }
      catch (error) {
        if (error instanceof TransactionError && error.reason === 'notFound') return false;
        throw failure(503, 'CHAIN_UNAVAILABLE');
      }
      if (result.$kind !== 'Transaction' || !result.Transaction.status.success || result.Transaction.digest !== digest) return false;
      return result.Transaction.events.some(event => {
        if (normalizeStructTag(event.eventType) !== `${pkg}::market::ExternalNftWithdrawn`) return false;
        try {
          const data = externalNftWithdrawnBcs.parse(event.bcs);
          return data.offer === expected.offerId && data.policy === expected.policyId
            && data.item === expected.objectId && data.seller === expected.seller;
        } catch { return false; }
      });
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
    async externalCollectionPolicy(id) { return externalPolicy(id, await object(id)); },
    async externalNftOffer(id) { return externalOffer(id, await object(id)); },
    async externalNftOffers(ids) {
      if (!ids.length) return [];
      if (!client.getObjects) return Promise.all(ids.map(async id => externalOffer(id, await object(id))));
      let result: SuiClientTypes.GetObjectsResponse<{ content: true }>;
      try { result = await client.getObjects({ objectIds: ids, include: { content: true }, signal: AbortSignal.timeout(10_000) }); }
      catch { throw failure(503, 'CHAIN_UNAVAILABLE'); }
      if (!Array.isArray(result?.objects) || result.objects.length !== ids.length) throw failure(503, 'INVALID_CHAIN_OBJECT');
      return ids.map((id, index) => externalOffer(id, result.objects[index]));
    },
    async ownedExternalNfts(owner, items) {
      if (!items.length) return [];
      const ids = items.map(item => addressSchema.parse(item.id));
      const inspect = (id: string, expectedType: string, value: SuiClientTypes.Object<{ content: true }> | Error) => {
        if (value instanceof ObjectError && (value.reason === 'notFound' || value.reason === 'deleted')) return false;
        if (value instanceof Error) throw failure(503, 'CHAIN_UNAVAILABLE');
        let actualType: string;
        try { actualType = normalizeStructTag(value.type); } catch { throw failure(503, 'INVALID_CHAIN_OBJECT'); }
        if (value.objectId !== id || actualType !== normalizeStructTag(expectedType)) throw failure(503, 'INVALID_CHAIN_OBJECT');
        return value.owner?.$kind === 'AddressOwner' && value.owner.AddressOwner === owner;
      };
      if (!client.getObjects) {
        const owned: string[] = [];
        for (let index = 0; index < ids.length; index++) if (inspect(ids[index], items[index].objectType, await object(ids[index]))) owned.push(ids[index]);
        return owned;
      }
      let result: SuiClientTypes.GetObjectsResponse<{ content: true }>;
      try { result = await client.getObjects({ objectIds: ids, include: { content: true }, signal: AbortSignal.timeout(10_000) }); }
      catch { throw failure(503, 'CHAIN_UNAVAILABLE'); }
      if (!Array.isArray(result?.objects) || result.objects.length !== ids.length) throw failure(503, 'INVALID_CHAIN_OBJECT');
      return ids.filter((id, index) => inspect(id, items[index].objectType, result.objects[index]));
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
  const policyIds = (env.EXTERNAL_NFT_POLICY_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  return createMarketChain(env.SUI_MARKET_PACKAGE_ID, new SuiGrpcClient({ network: 'testnet', baseUrl }), giftIds, policyIds);
}

/** Optional NFT catalog package, kept separate while testnet character listings remain on the prior package. */
export function nftGiftChainFromEnv(env: NodeJS.ProcessEnv = process.env): MarketChain | undefined {
  if (!env.NFT_GIFT_PACKAGE_ID) return undefined;
  const baseUrl = env.SUI_GRPC_URL ?? 'https://fullnode.testnet.sui.io:443';
  if (new URL(baseUrl).protocol !== 'https:') throw Error('SUI_GRPC_URL must use HTTPS');
  const giftIds = (env.NFT_GIFT_PRODUCT_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  const policyIds = (env.EXTERNAL_NFT_POLICY_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  return createMarketChain(env.NFT_GIFT_PACKAGE_ID, new SuiGrpcClient({ network: 'testnet', baseUrl }), giftIds, policyIds);
}
