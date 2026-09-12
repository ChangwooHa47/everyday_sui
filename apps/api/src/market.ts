import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Transaction } from '@mysten/sui/transactions';
import { addressSchema, authenticate, failure, type AuthConfig } from './auth.js';
import type { Database } from './database.js';
import type { MarketChain } from './market-chain.js';
import type { PackageStore } from './market-package.js';

const paramsSchema = z.object({ listingId: addressSchema });
const proofSchema = z.object({ licenseId: addressSchema.optional() }).strict();
const giftParamsSchema = z.object({ productId: addressSchema });
export async function requireMarketAccess(chain: MarketChain, actor: string, listingId: string, licenseId?: string) {
  const listing = await chain.listing(listingId);
  if (!listing.published) throw failure(409, 'LISTING_NOT_PUBLISHED');
  // Delisting stops new purchases, not access already purchased.
  if (listing.creator !== actor && !(licenseId && await chain.hasLicense(actor, listingId, licenseId))) throw failure(403, 'LICENSE_REQUIRED');
  return listing;
}
export function registerMarket(app: FastifyInstance, db: Database, auth: AuthConfig, configured?: MarketChain, packages?: PackageStore, productMetrics = false, configuredGifts?: MarketChain) {
  const chain = () => { if (!configured) throw failure(503, 'MARKET_NOT_CONFIGURED'); return configured; };
  const giftChain = () => { const service = configuredGifts ?? configured; if (!service) throw failure(503, 'NFT_GIFTS_NOT_CONFIGURED'); return service; };
  app.post('/v1/market/listings', async req => {
    const actor = await authenticate(req, db, auth);
    const { listingId } = paramsSchema.strict().parse(req.body);
    const service = chain();
    const listing = await service.listing(listingId);
    if (listing.creator !== actor) throw failure(403, 'CREATOR_REQUIRED');
    if (!listing.published) throw failure(409, 'LISTING_NOT_PUBLISHED');
    if (!packages) throw failure(503, 'MARKET_RUNTIME_NOT_CONFIGURED');
    const preview = (await packages.load(listing)).preview;
    await db.query(`WITH registered AS (
      INSERT INTO market_catalog(listing_id,creator,package_id) VALUES($1,$2,$3)
      ON CONFLICT(listing_id) DO UPDATE SET creator=$2,package_id=$3 RETURNING listing_id
    ) INSERT INTO market_previews(listing_id,content_hash,summary,image_url)
      SELECT listing_id,$4,$5,$6 FROM registered
      ON CONFLICT(listing_id) DO UPDATE SET content_hash=$4,summary=$5,image_url=$6`,
      [listingId, actor, service.packageId, listing.package.contentHash, preview.summary ?? preview.personality.slice(0, 200), preview.imageUrl ?? null]);
    return { listing };
  });
  app.get('/v1/market/listings', async req => {
    const service = chain();
    const query = z.object({ after: addressSchema.optional(), limit: z.coerce.number().int().min(1).max(20).default(10) }).strict().parse(req.query);
    const { rows } = await db.query<{ listing_id: string }>('SELECT listing_id FROM market_catalog WHERE package_id=$1 AND listing_id>$2 ORDER BY listing_id LIMIT $3', [service.packageId, query.after ?? '', query.limit]);
    const ids = rows.map(row => row.listing_id);
    const listings = service.listings ? await service.listings(ids) : await Promise.all(ids.map(id => service.listing(id)));
    const previewRows = await db.query<{ listing_id: string; content_hash: string; summary: string; image_url: string | null }>(
      'SELECT listing_id,content_hash,summary,image_url FROM market_previews WHERE listing_id=ANY($1::text[])', [listings.map(l => l.id)]);
    const previews = Object.fromEntries(previewRows.rows.filter(p => listings.some(l => l.id === p.listing_id && l.package.contentHash === p.content_hash))
      .map(p => [p.listing_id, { summary: p.summary, imageUrl: p.image_url }]));
    const metrics = productMetrics ? await db.query<{ listing_id: string; turns: string; readers: string; returning_readers: string }>(
      'SELECT * FROM everyday.market_engagement WHERE listing_id=ANY($1::text[])', [listings.map(l => l.id)]) : { rows: [] };
    const engagement = Object.fromEntries(metrics.rows.map(row => [row.listing_id, { turns: row.turns,
      revisitPercent: Number(BigInt(row.returning_readers) * 100n / BigInt(row.readers)) }]));
    return { listings, previews, engagement, nextCursor: rows.length === query.limit ? rows.at(-1)!.listing_id : null };
  });
  app.get('/v1/market/listings/:listingId', async req => {
    const { listingId } = paramsSchema.parse(req.params);
    return { listing: await chain().listing(listingId) };
  });
  app.get('/v1/nft-gifts', async () => {
    const service = giftChain();
    const ids = service.nftGiftProductIds ?? [];
    if (!service.nftGiftProducts) throw failure(503, 'NFT_GIFTS_NOT_CONFIGURED');
    return { gifts: await service.nftGiftProducts(ids) };
  });
  app.get('/v1/nft-gifts/:productId', async req => {
    const { productId } = giftParamsSchema.parse(req.params);
    const service = giftChain();
    if (!(service.nftGiftProductIds ?? []).includes(productId)) throw failure(404, 'NFT_GIFT_NOT_FOUND');
    if (!service.nftGiftProduct) throw failure(503, 'NFT_GIFTS_NOT_CONFIGURED');
    return { gift: await service.nftGiftProduct(productId) };
  });
  app.post('/v1/nft-gifts/:productId/purchase-transaction', async req => {
    const actor = await authenticate(req, db, auth);
    const { productId } = giftParamsSchema.parse(req.params);
    z.object({}).strict().parse(req.body ?? {});
    const service = giftChain();
    if (!(service.nftGiftProductIds ?? []).includes(productId)) throw failure(404, 'NFT_GIFT_NOT_FOUND');
    if (!service.nftGiftProduct) throw failure(503, 'NFT_GIFTS_NOT_CONFIGURED');
    const gift = await service.nftGiftProduct(productId);
    if (!gift.active || BigInt(gift.minted) >= BigInt(gift.maxSupply)) throw failure(409, 'NFT_GIFT_NOT_LIVE');
    const tx = new Transaction();
    tx.setSender(actor);
    const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(gift.priceMist)]);
    tx.moveCall({ target: `${service.packageId}::market::purchase_nft_gift`, arguments: [tx.object(productId), payment] });
    return { network: 'testnet', transaction: await tx.toJSON(), priceMist: gift.priceMist };
  });
  app.get('/v1/me/nft-gifts', async req => {
    const actor = await authenticate(req, db, auth);
    const service = giftChain();
    if (!service.ownedNftGifts) throw failure(503, 'NFT_GIFTS_NOT_CONFIGURED');
    return { gifts: await service.ownedNftGifts(actor) };
  });
  app.get('/v1/market/listings/:listingId/access', async req => {
    const actor = await authenticate(req, db, auth);
    const { listingId } = paramsSchema.parse(req.params);
    const { licenseId } = proofSchema.parse(req.query);
    const listing = await requireMarketAccess(chain(), actor, listingId, licenseId);
    return { address: actor, listingId, package: listing.package, sealIdentity: listingId, network: 'testnet' };
  });
  app.post('/v1/market/listings/:listingId/purchase-transaction', async req => {
    const actor = await authenticate(req, db, auth);
    const { listingId } = paramsSchema.parse(req.params);
    z.object({}).strict().parse(req.body ?? {});
    const service = chain();
    const listing = await service.listing(listingId);
    if (!listing.published || !listing.active) throw failure(409, 'LISTING_NOT_LIVE');
    if (!packages) throw failure(503, 'MARKET_RUNTIME_NOT_CONFIGURED');
    await packages.load(listing);
    const tx = new Transaction();
    tx.setSender(actor);
    const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(listing.priceMist)]);
    tx.moveCall({ target: `${service.packageId}::market::purchase`, arguments: [tx.object(listingId), payment] });
    // Unresolved transaction JSON for Transaction.from(). Only the user's wallet
    // signs and executes it; the API never marks this request as a purchase.
    return { network: 'testnet', transaction: await tx.toJSON(), priceMist: listing.priceMist };
  });
  // Private pointer registry only. Encryption and delegation are provider/client responsibilities.
  const memorySchema = z.object({
    provider: z.enum(['seal-walrus', 'memwal']), spaceId: z.string().min(1).max(256),
    expectedRevision: z.number().int().min(0).max(2147483646), consent: z.literal(true),
    licenseId: addressSchema.optional(),
  }).strict();
  app.post('/v1/me/relationships/:listingId/memory', async req => {
    const actor = await authenticate(req, db, auth);
    const { listingId } = paramsSchema.parse(req.params);
    const input = memorySchema.parse(req.body);
    if (input.expectedRevision === 0) await requireMarketAccess(chain(), actor, listingId, input.licenseId);
    const args = [actor, listingId, input.provider, input.spaceId, input.expectedRevision];
    const result = input.expectedRevision === 0
      ? await db.query(`INSERT INTO relationship_memory(owner,listing_id,provider,space_id,revision,consented_at)
          VALUES($1,$2,$3,$4,1,now()) ON CONFLICT DO NOTHING RETURNING revision`, args.slice(0,4))
      : await db.query(`UPDATE relationship_memory SET provider=$3,space_id=$4,revision=revision+1,consented_at=now()
          WHERE owner=$1 AND listing_id=$2 AND revision=$5 RETURNING revision`, args);
    if (!result.rows[0]) throw failure(409, 'MEMORY_REVISION_CONFLICT');
    return result.rows[0];
  });
  app.get('/v1/me/relationships/:listingId/memory', async req => {
    const actor = await authenticate(req, db, auth);
    const { listingId } = paramsSchema.parse(req.params);
    const { rows } = await db.query('SELECT provider,space_id AS "spaceId",revision,consented_at AS "consentedAt" FROM relationship_memory WHERE owner=$1 AND listing_id=$2', [actor, listingId]);
    return { memory: rows[0] ?? null };
  });
}
