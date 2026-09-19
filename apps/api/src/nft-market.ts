import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Transaction } from '@mysten/sui/transactions';
import { fromHex } from '@mysten/sui/utils';
import type { ExternalNftGiftProduct, OwnedExternalNftGift } from '@everyday/contracts';
import { z } from 'zod';
import { addressSchema, authenticate, failure, type AuthConfig } from './auth.js';
import type { Database } from './database.js';
import type { MarketChain } from './market-chain.js';

const giftParamsSchema = z.object({ productId: addressSchema });
const offerParamsSchema = z.object({ offerId: addressSchema });
const mistSchema = z.string().regex(/^[1-9][0-9]{0,19}$/)
  .refine(value => BigInt(value) <= 18_446_744_073_709_551_615n);
const externalOfferInputSchema = z.object({
  policyId: addressSchema,
  objectId: addressSchema,
  title: z.string().min(1).max(240),
  description: z.string().max(2000),
  imageUrl: z.url().max(2000).refine(value => new URL(value).protocol === 'https:'),
  imageHash: z.string().regex(/^[0-9a-f]{64}$/),
  priceMist: mistSchema,
}).strict();
const externalPreferenceSchema = z.object({
  receiveEnabled: z.boolean(),
  blockedPolicyIds: z.array(addressSchema).max(100)
    .refine(values => new Set(values).size === values.length),
}).strict();
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const maxImageBytes = 5 * 1024 * 1024;

interface ExternalOfferRow extends Record<string, unknown> {
  offer_id: string;
  package_id: string;
  policy_id: string;
  seller: string;
  object_id: string;
  object_type: string;
  collection_name: string;
  title: string;
  description: string;
  image_url: string;
  image_hash: string;
  price_mist: string;
  status: 'active' | 'sold' | 'withdrawn';
  buyer: string | null;
  digest: string | null;
}

async function readImage(response: Response) {
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (declaredLength > maxImageBytes || !response.body) throw failure(503, 'EXTERNAL_IMAGE_UNAVAILABLE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxImageBytes) {
      await reader.cancel();
      throw failure(413, 'EXTERNAL_IMAGE_TOO_LARGE');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

export function registerNftMarket(app: FastifyInstance, db: Database, auth: AuthConfig,
  configured?: MarketChain, configuredGifts?: MarketChain, allowedImageOrigins: string[] = []) {
  const chain = () => {
    if (!configured) throw failure(503, 'MARKET_NOT_CONFIGURED');
    return configured;
  };
  const giftChain = () => {
    const service = configuredGifts ?? configured;
    if (!service) throw failure(503, 'NFT_GIFTS_NOT_CONFIGURED');
    return service;
  };
  const imageOrigins = new Set(allowedImageOrigins);
  const requireAllowedImage = (imageUrl: string) => {
    if (!imageOrigins.has(new URL(imageUrl).origin)) throw failure(400, 'EXTERNAL_IMAGE_ORIGIN_NOT_ALLOWED');
  };
  const externalPolicy = async (policyId: string) => {
    const service = chain();
    if (!(service.externalCollectionPolicyIds ?? []).includes(policyId)) throw failure(404, 'EXTERNAL_COLLECTION_NOT_FOUND');
    if (!service.externalCollectionPolicy) throw failure(503, 'EXTERNAL_NFTS_NOT_CONFIGURED');
    return service.externalCollectionPolicy(policyId);
  };
  const liveExternalPolicy = async (policyId: string) => {
    const policy = await externalPolicy(policyId);
    if (!policy.active) throw failure(409, 'EXTERNAL_COLLECTION_NOT_LIVE');
    return policy;
  };
  const externalItem = (row: ExternalOfferRow): ExternalNftGiftProduct => ({
    kind: 'external', id: row.offer_id, collectionId: row.policy_id, collectionName: row.collection_name,
    objectId: row.object_id, objectType: row.object_type, title: row.title, description: row.description,
    imageUrl: row.image_url, imageHash: row.image_hash, merchant: row.seller, priceMist: row.price_mist,
    active: row.status === 'active', verified: true,
  });
  const exactExternalOffer = async (row: ExternalOfferRow) => {
    const service = chain();
    if (!service.externalNftOffer) throw failure(503, 'EXTERNAL_NFTS_NOT_CONFIGURED');
    const [offer, policy] = await Promise.all([
      service.externalNftOffer(row.offer_id), externalPolicy(row.policy_id),
    ]);
    if (offer.policyId !== policy.id || offer.objectType !== policy.objectType
      || offer.rawObjectType !== policy.rawObjectType || offer.seller !== row.seller
      || offer.objectId !== row.object_id || offer.objectType !== row.object_type
      || offer.title !== row.title || offer.description !== row.description
      || offer.imageUrl !== row.image_url || offer.imageHash !== row.image_hash
      || offer.priceMist !== row.price_mist) throw failure(503, 'EXTERNAL_OFFER_MISMATCH');
    return { offer, policy };
  };

  app.get('/v1/external-nft-collections', async () => {
    const service = chain();
    return { collections: await Promise.all((service.externalCollectionPolicyIds ?? []).map(externalPolicy)) };
  });

  app.post('/v1/external-nft-offers/create-transaction', async req => {
    const actor = await authenticate(req, db, auth);
    const input = externalOfferInputSchema.parse(req.body);
    requireAllowedImage(input.imageUrl);
    const service = chain();
    const policy = await liveExternalPolicy(input.policyId);
    if (!service.ownedExternalNfts) throw failure(503, 'EXTERNAL_NFTS_NOT_CONFIGURED');
    if (!(await service.ownedExternalNfts(actor, [{ id: input.objectId, objectType: policy.objectType }])).length)
      throw failure(403, 'EXTERNAL_NFT_OWNERSHIP_REQUIRED');
    const tx = new Transaction();
    tx.setSender(actor);
    tx.moveCall({
      target: `${service.packageId}::market::create_external_nft_offer`,
      typeArguments: [policy.objectType],
      arguments: [tx.object(policy.id), tx.object(input.objectId), tx.pure.string(input.title),
        tx.pure.string(input.description), tx.pure.string(input.imageUrl),
        tx.pure.vector('u8', fromHex(input.imageHash)), tx.pure.u64(input.priceMist)],
    });
    return { network: 'testnet', transaction: await tx.toJSON(), packageId: service.packageId,
      policyId: policy.id, objectType: policy.objectType, priceMist: input.priceMist };
  });

  app.post('/v1/external-nft-offers', async req => {
    const actor = await authenticate(req, db, auth);
    const { offerId } = offerParamsSchema.strict().parse(req.body);
    const service = chain();
    if (!service.externalNftOffer) throw failure(503, 'EXTERNAL_NFTS_NOT_CONFIGURED');
    const offer = await service.externalNftOffer(offerId);
    requireAllowedImage(offer.imageUrl);
    const policy = await externalPolicy(offer.policyId);
    if (offer.seller !== actor) throw failure(403, 'EXTERNAL_NFT_SELLER_REQUIRED');
    if (!offer.active || offer.objectType !== policy.objectType || offer.rawObjectType !== policy.rawObjectType)
      throw failure(409, 'EXTERNAL_OFFER_NOT_LIVE');
    await db.query(`INSERT INTO external_nft_offers(offer_id,package_id,policy_id,seller,object_id,object_type,
      collection_name,title,description,image_url,image_hash,price_mist) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT(offer_id) DO NOTHING`, [offer.id, service.packageId, policy.id, offer.seller, offer.objectId,
      offer.objectType, policy.name, offer.title, offer.description, offer.imageUrl, offer.imageHash, offer.priceMist]);
    const { rows } = await db.query<ExternalOfferRow>('SELECT * FROM external_nft_offers WHERE offer_id=$1', [offer.id]);
    const row = rows[0];
    if (!row || row.package_id !== service.packageId || row.policy_id !== policy.id || row.seller !== actor
      || row.object_id !== offer.objectId || row.object_type !== offer.objectType || row.collection_name !== policy.name
      || row.title !== offer.title || row.description !== offer.description || row.image_url !== offer.imageUrl
      || row.image_hash !== offer.imageHash || row.price_mist !== offer.priceMist || row.status !== 'active')
      throw failure(409, 'EXTERNAL_OFFER_CONFLICT');
    return { gift: externalItem(row) };
  });

  app.get('/v1/me/external-nft-offers', async req => {
    const actor = await authenticate(req, db, auth);
    const { rows } = await db.query<ExternalOfferRow>(
      "SELECT * FROM external_nft_offers WHERE package_id=$1 AND seller=$2 AND status='active' ORDER BY created_at DESC LIMIT 100",
      [chain().packageId, actor]);
    const snapshots = await Promise.allSettled(rows.map(exactExternalOffer));
    const offers: ExternalNftGiftProduct[] = [];
    for (let index = 0; index < rows.length; index++) {
      const snapshot = snapshots[index];
      if (snapshot.status === 'rejected') {
        if ((snapshot.reason as { statusCode?: number }).statusCode === 404) continue;
        throw snapshot.reason;
      }
      if (snapshot.value.offer.active) offers.push(externalItem(rows[index]));
    }
    return { offers };
  });

  app.post('/v1/external-nft-offers/:offerId/withdraw-transaction', async req => {
    const actor = await authenticate(req, db, auth);
    const { offerId } = offerParamsSchema.parse(req.params);
    z.object({}).strict().parse(req.body ?? {});
    const service = chain();
    const { rows } = await db.query<ExternalOfferRow>(
      "SELECT * FROM external_nft_offers WHERE offer_id=$1 AND package_id=$2 AND status='active'",
      [offerId, service.packageId]);
    const row = rows[0];
    if (!row) throw failure(404, 'EXTERNAL_OFFER_NOT_FOUND');
    if (row.seller !== actor) throw failure(403, 'EXTERNAL_NFT_SELLER_REQUIRED');
    const { offer, policy } = await exactExternalOffer(row);
    if (!offer.active) throw failure(409, 'EXTERNAL_OFFER_NOT_LIVE');
    const tx = new Transaction();
    tx.setSender(actor);
    tx.moveCall({ target: `${service.packageId}::market::withdraw_external_nft_offer`,
      typeArguments: [offer.objectType], arguments: [tx.object(offer.id), tx.object(policy.id)] });
    return { network: 'testnet', transaction: await tx.toJSON(), objectId: offer.objectId };
  });

  app.post('/v1/external-nft-offers/:offerId/withdraw-confirm', async req => {
    const actor = await authenticate(req, db, auth);
    const { offerId } = offerParamsSchema.parse(req.params);
    const { digest } = z.object({ digest: z.string().min(20).max(100) }).strict().parse(req.body);
    const service = chain();
    if (!service.verifyExternalNftWithdrawal || !service.ownedExternalNfts)
      throw failure(503, 'EXTERNAL_NFTS_NOT_CONFIGURED');
    const { rows } = await db.query<ExternalOfferRow>(
      'SELECT * FROM external_nft_offers WHERE offer_id=$1 AND package_id=$2', [offerId, service.packageId]);
    const row = rows[0];
    if (!row) throw failure(404, 'EXTERNAL_OFFER_NOT_FOUND');
    if (row.seller !== actor) throw failure(403, 'EXTERNAL_NFT_SELLER_REQUIRED');
    if (!await service.verifyExternalNftWithdrawal(digest, { offerId, policyId: row.policy_id,
      objectId: row.object_id, seller: actor })) throw failure(409, 'TRANSACTION_NOT_CONFIRMED');
    const owned = await service.ownedExternalNfts(actor, [{ id: row.object_id, objectType: row.object_type }]);
    if (!owned.includes(row.object_id)) throw failure(422, 'EXTERNAL_NFT_RECEIPT_MISMATCH');
    await db.query("UPDATE external_nft_offers SET status='withdrawn',digest=$2 WHERE offer_id=$1 AND status IN ('active','withdrawn')",
      [offerId, digest]);
    return { status: 'withdrawn', digest, objectId: row.object_id };
  });

  app.get('/v1/nft-gifts', async () => {
    const service = giftChain();
    if (!service.nftGiftProducts) throw failure(503, 'NFT_GIFTS_NOT_CONFIGURED');
    const internal = await service.nftGiftProducts(service.nftGiftProductIds ?? []);
    if (!configured?.externalNftOffer) return { gifts: internal };
    const { rows } = await db.query<ExternalOfferRow>(
      "SELECT * FROM external_nft_offers WHERE package_id=$1 AND status='active' ORDER BY offer_id LIMIT 100",
      [configured.packageId]);
    if (!rows.length) return { gifts: internal };
    const snapshots = await Promise.allSettled(rows.map(exactExternalOffer));
    const external: ExternalNftGiftProduct[] = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index], snapshot = snapshots[index];
      if (snapshot.status === 'rejected') {
        if ((snapshot.reason as { statusCode?: number }).statusCode === 404) continue;
        throw snapshot.reason;
      }
      const { offer, policy } = snapshot.value;
      if (!offer.active || !policy.active) continue;
      if (offer.policyId !== policy.id || offer.objectType !== policy.objectType
        || offer.seller !== row.seller || offer.objectId !== row.object_id || offer.priceMist !== row.price_mist)
        throw failure(503, 'EXTERNAL_OFFER_MISMATCH');
      external.push(externalItem(row));
    }
    return { gifts: [...internal, ...external] };
  });

  app.get('/v1/nft-gifts/:productId', async req => {
    const { productId } = giftParamsSchema.parse(req.params);
    const service = giftChain();
    if ((service.nftGiftProductIds ?? []).includes(productId)) {
      if (!service.nftGiftProduct) throw failure(503, 'NFT_GIFTS_NOT_CONFIGURED');
      return { gift: await service.nftGiftProduct(productId) };
    }
    const { rows } = await db.query<ExternalOfferRow>(
      "SELECT * FROM external_nft_offers WHERE offer_id=$1 AND package_id=$2 AND status IN ('active','sold')",
      [productId, chain().packageId]);
    if (!rows[0]) throw failure(404, 'NFT_GIFT_NOT_FOUND');
    // A settled offer is an immutable display receipt, not a live/purchasable offer.
    if (rows[0].status === 'sold') return { gift: externalItem(rows[0]) };
    const { offer, policy } = await exactExternalOffer(rows[0]);
    if (!offer.active || !policy.active) throw failure(409, 'EXTERNAL_OFFER_NOT_LIVE');
    return { gift: externalItem(rows[0]) };
  });

  app.get('/v1/nft-gifts/:productId/image', async (req, reply) => {
    const { productId } = giftParamsSchema.parse(req.params);
    const { rows } = await db.query<ExternalOfferRow>(
      'SELECT * FROM external_nft_offers WHERE offer_id=$1 AND package_id=$2', [productId, chain().packageId]);
    const row = rows[0];
    if (!row) throw failure(404, 'NFT_GIFT_NOT_FOUND');
    requireAllowedImage(row.image_url);
    let response: Response;
    try {
      response = await fetch(row.image_url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
    } catch { throw failure(503, 'EXTERNAL_IMAGE_UNAVAILABLE'); }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    if (!response.ok || !imageTypes.has(contentType)) throw failure(503, 'EXTERNAL_IMAGE_UNAVAILABLE');
    const bytes = await readImage(response);
    if (createHash('sha256').update(bytes).digest('hex') !== row.image_hash)
      throw failure(503, 'EXTERNAL_IMAGE_HASH_MISMATCH');
    return reply.type(contentType).header('Cache-Control', 'public, max-age=3600, immutable')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .header('X-Content-Type-Options', 'nosniff').send(bytes);
  });

  app.post('/v1/nft-gifts/:productId/purchase-transaction', async req => {
    const actor = await authenticate(req, db, auth);
    const { productId } = giftParamsSchema.parse(req.params);
    z.object({}).strict().parse(req.body ?? {});
    const service = giftChain();
    if ((service.nftGiftProductIds ?? []).includes(productId)) {
      if (!service.nftGiftProduct) throw failure(503, 'NFT_GIFTS_NOT_CONFIGURED');
      const gift = await service.nftGiftProduct(productId);
      if (!gift.active || BigInt(gift.minted) >= BigInt(gift.maxSupply)) throw failure(409, 'NFT_GIFT_NOT_LIVE');
      const tx = new Transaction();
      tx.setSender(actor);
      const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(gift.priceMist)]);
      tx.moveCall({ target: `${service.packageId}::market::purchase_nft_gift`, arguments: [tx.object(productId), payment] });
      return { network: 'testnet', transaction: await tx.toJSON(), priceMist: gift.priceMist };
    }
    const marketService = chain();
    const { rows } = await db.query<ExternalOfferRow>(
      "SELECT * FROM external_nft_offers WHERE offer_id=$1 AND package_id=$2 AND status='active'",
      [productId, marketService.packageId]);
    if (!rows[0]) throw failure(404, 'NFT_GIFT_NOT_FOUND');
    const { offer, policy } = await exactExternalOffer(rows[0]);
    if (!offer.active || !policy.active) throw failure(409, 'EXTERNAL_OFFER_NOT_LIVE');
    const tx = new Transaction();
    tx.setSender(actor);
    const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(offer.priceMist)]);
    tx.moveCall({ target: `${marketService.packageId}::market::purchase_external_nft`,
      typeArguments: [offer.objectType], arguments: [tx.object(offer.id), tx.object(policy.id), payment] });
    return { network: 'testnet', transaction: await tx.toJSON(), priceMist: offer.priceMist };
  });

  app.post('/v1/external-nft-offers/:offerId/confirm', async req => {
    const actor = await authenticate(req, db, auth);
    const { offerId } = offerParamsSchema.parse(req.params);
    const { digest } = z.object({ digest: z.string().min(20).max(100) }).strict().parse(req.body);
    const service = chain();
    if (!service.verifyExternalNftSale || !service.ownedExternalNfts) throw failure(503, 'EXTERNAL_NFTS_NOT_CONFIGURED');
    const { rows } = await db.query<ExternalOfferRow>(
      'SELECT * FROM external_nft_offers WHERE offer_id=$1 AND package_id=$2', [offerId, service.packageId]);
    const row = rows[0];
    if (!row) throw failure(404, 'NFT_GIFT_NOT_FOUND');
    if (!await service.verifyExternalNftSale(digest, {
      offerId, objectId: row.object_id, buyer: actor, priceMist: row.price_mist,
    })) throw failure(409, 'TRANSACTION_NOT_CONFIRMED');
    const owned = await service.ownedExternalNfts(actor, [{ id: row.object_id, objectType: row.object_type }]);
    if (!owned.includes(row.object_id)) throw failure(422, 'EXTERNAL_NFT_RECEIPT_MISMATCH');
    await db.query("UPDATE external_nft_offers SET status='sold',buyer=$2,digest=$3 WHERE offer_id=$1 AND status IN ('active','sold')",
      [offerId, actor, digest]);
    return { status: 'confirmed', digest, objectId: row.object_id };
  });

  app.get('/v1/me/nft-gifts', async req => {
    const actor = await authenticate(req, db, auth);
    const service = giftChain();
    if (!service.ownedNftGifts) throw failure(503, 'NFT_GIFTS_NOT_CONFIGURED');
    const internal = await service.ownedNftGifts(actor);
    const marketService = chain();
    if (!marketService.ownedExternalNfts) return { gifts: internal };
    const { rows } = await db.query<ExternalOfferRow>(
      'SELECT * FROM external_nft_offers WHERE package_id=$1 ORDER BY created_at DESC LIMIT 200', [marketService.packageId]);
    const seenObjects = new Set<string>();
    const latestRows = rows.filter(row => {
      if (seenObjects.has(row.object_id)) return false;
      seenObjects.add(row.object_id);
      return true;
    });
    const ownedIds = new Set(await marketService.ownedExternalNfts(actor,
      latestRows.map(row => ({ id: row.object_id, objectType: row.object_type }))));
    const external: OwnedExternalNftGift[] = latestRows.filter(row => ownedIds.has(row.object_id)).map(row => ({
      kind: 'external', id: row.object_id, productId: row.offer_id, collectionId: row.policy_id,
      collectionName: row.collection_name, objectType: row.object_type, title: row.title,
      description: row.description, imageUrl: row.image_url, imageHash: row.image_hash, verified: true,
    }));
    return { gifts: [...internal, ...external] };
  });

  app.get('/v1/me/external-nft-preferences', async req => {
    const actor = await authenticate(req, db, auth);
    const { rows } = await db.query<{ receive_enabled: boolean; blocked_policy_ids: string[] }>(
      'SELECT receive_enabled,blocked_policy_ids FROM external_nft_preferences WHERE owner=$1', [actor]);
    return { receiveEnabled: rows[0]?.receive_enabled ?? false, blockedPolicyIds: rows[0]?.blocked_policy_ids ?? [] };
  });

  app.put('/v1/me/external-nft-preferences', async req => {
    const actor = await authenticate(req, db, auth);
    const input = externalPreferenceSchema.parse(req.body);
    const configuredIds = new Set(chain().externalCollectionPolicyIds ?? []);
    if (input.blockedPolicyIds.some(id => !configuredIds.has(id))) throw failure(400, 'UNKNOWN_EXTERNAL_COLLECTION');
    await db.query(`INSERT INTO external_nft_preferences(owner,receive_enabled,blocked_policy_ids) VALUES($1,$2,$3)
      ON CONFLICT(owner) DO UPDATE SET receive_enabled=$2,blocked_policy_ids=$3,updated_at=now()`,
      [actor, input.receiveEnabled, input.blockedPolicyIds]);
    return input;
  });
}
