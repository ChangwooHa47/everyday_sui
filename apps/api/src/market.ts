import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Transaction } from '@mysten/sui/transactions';
import { addressSchema, authenticate, failure, type AuthConfig } from './auth.js';
import type { Database } from './database.js';
import type { MarketChain } from './market-chain.js';

const paramsSchema = z.object({ listingId: addressSchema });
const proofSchema = z.object({ licenseId: addressSchema.optional() }).strict();
export async function requireMarketAccess(chain: MarketChain, actor: string, listingId: string, licenseId?: string) {
  const listing = await chain.listing(listingId);
  if (!listing.published) throw failure(409, 'LISTING_NOT_PUBLISHED');
  // Delisting stops new purchases, not access already purchased.
  if (listing.creator !== actor && !(licenseId && await chain.hasLicense(actor, listingId, licenseId))) throw failure(403, 'LICENSE_REQUIRED');
  return listing;
}
export function registerMarket(app: FastifyInstance, db: Database, auth: AuthConfig, configured?: MarketChain) {
  const chain = () => { if (!configured) throw failure(503, 'MARKET_NOT_CONFIGURED'); return configured; };
  app.post('/v1/market/listings', async req => {
    const actor = await authenticate(req, db, auth);
    const { listingId } = paramsSchema.strict().parse(req.body);
    const listing = await chain().listing(listingId);
    if (listing.creator !== actor) throw failure(403, 'CREATOR_REQUIRED');
    if (!listing.published) throw failure(409, 'LISTING_NOT_PUBLISHED');
    await db.query('INSERT INTO market_catalog(listing_id,creator) VALUES($1,$2) ON CONFLICT DO NOTHING', [listingId, actor]);
    return { listing };
  });
  app.get('/v1/market/listings', async req => {
    const service = chain();
    const query = z.object({ after: addressSchema.optional(), limit: z.coerce.number().int().min(1).max(20).default(10) }).strict().parse(req.query);
    const { rows } = await db.query<{ listing_id: string }>('SELECT listing_id FROM market_catalog WHERE listing_id>$1 ORDER BY listing_id LIMIT $2', [query.after ?? '', query.limit]);
    const listings = await Promise.all(rows.map(row => service.listing(row.listing_id)));
    return { listings, nextCursor: rows.length === query.limit ? rows.at(-1)!.listing_id : null };
  });
  app.get('/v1/market/listings/:listingId', async req => {
    const { listingId } = paramsSchema.parse(req.params);
    return { listing: await chain().listing(listingId) };
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
