import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Transaction } from '@mysten/sui/transactions';
import { addressSchema, authenticate, failure, type AuthConfig } from './auth.js';
import type { Database } from './database.js';
import type { MarketChain } from './market-chain.js';
import type { PackageStore } from './market-package.js';
import { registerNftMarket } from './nft-market.js';

const paramsSchema = z.object({ listingId: addressSchema });
const proofSchema = z.object({ licenseId: addressSchema.optional() }).strict();
export async function requireMarketAccess(chain: MarketChain, actor: string, listingId: string, licenseId?: string) {
  const listing = await chain.listing(listingId);
  if (!listing.published) throw failure(409, 'LISTING_NOT_PUBLISHED');
  // Delisting stops new purchases, not access already purchased.
  if (listing.creator !== actor && !(licenseId && await chain.hasLicense(actor, listingId, licenseId))) throw failure(403, 'LICENSE_REQUIRED');
  return listing;
}
export function registerMarket(app: FastifyInstance, db: Database, auth: AuthConfig, configured?: MarketChain,
  packages?: PackageStore, productMetrics = false, configuredGifts?: MarketChain, externalNftImageOrigins: string[] = []) {
  const chain = () => { if (!configured) throw failure(503, 'MARKET_NOT_CONFIGURED'); return configured; };
  registerNftMarket(app, db, auth, configured, configuredGifts, externalNftImageOrigins);
  app.post('/v1/market/listings', async req => {
    const actor = await authenticate(req, db, auth);
    const { listingId } = paramsSchema.strict().parse(req.body);
    const service = chain();
    const listing = await service.listing(listingId);
    if (listing.creator !== actor) throw failure(403, 'CREATOR_REQUIRED');
    if (!listing.published) throw failure(409, 'LISTING_NOT_PUBLISHED');
    if (!packages) throw failure(503, 'MARKET_RUNTIME_NOT_CONFIGURED');
    const loaded = await packages.load(listing);
    const preview = loaded.preview;
    // Relationship/gender are authored product facets (public detail already shows them); they power community filters.
    await db.query(`WITH registered AS (
      INSERT INTO market_catalog(listing_id,creator,package_id) VALUES($1,$2,$3)
      ON CONFLICT(listing_id) DO UPDATE SET creator=$2,package_id=$3 RETURNING listing_id
    ) INSERT INTO market_previews(listing_id,content_hash,summary,image_url,relationship_type,gender)
      SELECT listing_id,$4,$5,$6,$7,$8 FROM registered
      ON CONFLICT(listing_id) DO UPDATE SET content_hash=$4,summary=$5,image_url=$6,relationship_type=$7,gender=$8`,
      [listingId, actor, service.packageId, listing.package.contentHash, preview.summary ?? preview.personality.slice(0, 200), preview.imageUrl ?? null,
        loaded.character.relationshipType ?? null, loaded.character.gender ?? null]);
    return { listing };
  });
  app.get('/v1/market/listings', async req => {
    const service = chain();
    const query = z.object({ after: addressSchema.optional(), limit: z.coerce.number().int().min(1).max(20).default(10) }).strict().parse(req.query);
    const { rows } = await db.query<{ listing_id: string }>('SELECT listing_id FROM market_catalog WHERE package_id=$1 AND listing_id>$2 ORDER BY listing_id LIMIT $3', [service.packageId, query.after ?? '', query.limit]);
    const ids = rows.map(row => row.listing_id);
    const listings = service.listings ? await service.listings(ids) : await Promise.all(ids.map(id => service.listing(id)));
    const previewRows = await db.query<{ listing_id: string; content_hash: string; summary: string; image_url: string | null;
      relationship_type: string | null; gender: string | null; registered_at: Date | string }>(
      `SELECT p.listing_id,p.content_hash,p.summary,p.image_url,p.relationship_type,p.gender,c.created_at AS registered_at
       FROM market_previews p JOIN market_catalog c ON c.listing_id=p.listing_id WHERE p.listing_id=ANY($1::text[])`, [listings.map(l => l.id)]);
    const previews = Object.fromEntries(previewRows.rows.filter(p => listings.some(l => l.id === p.listing_id && l.package.contentHash === p.content_hash))
      .map(p => [p.listing_id, { summary: p.summary, imageUrl: p.image_url, relationshipType: p.relationship_type, gender: p.gender,
        registeredAt: new Date(p.registered_at).toISOString() }]));
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
  // Community signals for one listing: buyer reviews and how often the character's treasury actually sent a gift.
  const communityOf = async (listingId: string) => {
    const reviews = await db.query<{ owner: string; rating: number; text: string; created_at: Date | string }>(
      'SELECT owner,rating,text,created_at FROM market_reviews WHERE listing_id=$1 ORDER BY created_at DESC LIMIT 50', [listingId]);
    const summary = await db.query<{ count: string; average: string | null }>('SELECT count(*)::text AS count,avg(rating)::text AS average FROM market_reviews WHERE listing_id=$1', [listingId]);
    const gifts = await db.query<{ count: string }>("SELECT count(*)::text AS count FROM agent_gifts WHERE listing_id=$1 AND status='confirmed'", [listingId]);
    const registered = await db.query<{ created_at: Date | string }>('SELECT created_at FROM market_catalog WHERE listing_id=$1', [listingId]);
    return { reviews: reviews.rows.map(r => ({ owner: r.owner, rating: r.rating, text: r.text, createdAt: new Date(r.created_at).toISOString() })),
      averageRating: summary.rows[0]?.average ? Math.round(Number(summary.rows[0].average) * 10) / 10 : null,
      reviewCount: Number(summary.rows[0]?.count ?? 0), giftsSent: Number(gifts.rows[0]?.count ?? 0),
      registeredAt: registered.rows[0] ? new Date(registered.rows[0].created_at).toISOString() : null };
  };
  app.get('/v1/market/listings/:listingId/community', async req => {
    const { listingId } = paramsSchema.parse(req.params);
    return communityOf(listingId);
  });
  const reviewSchema = z.object({ rating: z.number().int().min(1).max(5), text: z.string().trim().min(1).max(100), licenseId: addressSchema }).strict();
  app.post('/v1/market/listings/:listingId/reviews', async req => {
    const actor = await authenticate(req, db, auth);
    const { listingId } = paramsSchema.parse(req.params);
    const input = reviewSchema.parse(req.body);
    // Only current license holders review, and creators cannot review their own character.
    const service = chain();
    const listing = await requireMarketAccess(service, actor, listingId, input.licenseId);
    if (listing.creator === actor) throw failure(403, 'LICENSE_REQUIRED');
    const registered = await db.query('SELECT 1 FROM market_catalog WHERE listing_id=$1 AND package_id=$2', [listingId, service.packageId]);
    if (!registered.rows.length) throw failure(404, 'LISTING_NOT_FOUND');
    await db.query(`INSERT INTO market_reviews(listing_id,owner,rating,text) VALUES($1,$2,$3,$4)
      ON CONFLICT(listing_id,owner) DO UPDATE SET rating=$3,text=$4,created_at=now()`, [listingId, actor, input.rating, input.text]);
    return communityOf(listingId);
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
