import { createHash } from 'node:crypto';
import { z } from 'zod';
import { SealClient, SessionKey, type KeyServerConfig } from '@mysten/seal';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { fromHex } from '@mysten/sui/utils';
import { normalizeStructTag } from '@mysten/sui/utils';
import { bcs } from '@mysten/sui/bcs';
import type { GiftPersona, MarketListing } from '@everyday/contracts';
import { addressSchema, failure } from './auth.js';
import { messagesSchema } from './turn-service.js';
// Saleable author-authored settings only. Personal call names and relationship state are rejected.
export const productCharacterSchema = z.object({
  name: z.string().min(1).max(80), personality: z.string().max(4000),
  gender: z.enum(['남성', '여성', '기타']).optional(),
  relationshipType: z.enum(['연인', '썸', '친구', '짝사랑']).optional(),
  summary: z.string().max(500).optional(), appearance: z.string().max(4000).optional(),
  background: z.string().max(4000).optional(), speechStyles: z.array(z.string().max(255)).max(20).optional(),
  imageUrl: z.url().refine(url => new URL(url).protocol === 'https:').optional(),
}).strict();
const giftTag = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
export const giftPersonaSchema: z.ZodType<GiftPersona> = z.object({
  enabled: z.boolean(),
  archetype: z.enum(['caretaker', 'playful', 'minimalist', 'celebratory', 'practical']),
  generosity: z.number().int().min(0).max(100),
  spontaneity: z.number().int().min(0).max(100),
  triggers: z.array(z.enum(['comfort', 'milestone', 'celebration', 'encouragement'])).max(4)
    .refine(values => new Set(values).size === values.length, 'Gift triggers must be unique'),
  preferredTags: z.array(giftTag).max(12)
    .refine(values => new Set(values).size === values.length, 'Preferred gift tags must be unique'),
  blockedTags: z.array(giftTag).max(12)
    .refine(values => new Set(values).size === values.length, 'Blocked gift tags must be unique'),
  cooldownHours: z.number().int().min(0).max(24 * 30),
}).strict().refine(value => !value.preferredTags.some(tag => value.blockedTags.includes(tag)),
  'Preferred and blocked gift tags must not overlap');
export const packageSchema = z.object({ schemaVersion: z.literal(1), network: z.literal('testnet'),
  packageId: addressSchema, listingId: addressSchema, character: productCharacterSchema, preview: productCharacterSchema,
  giftPersona: giftPersonaSchema.optional(),
  examples: messagesSchema.optional(), episodes: z.array(z.object({ id: z.string().min(1).max(80),
    title: z.string().min(1).max(120), setting: z.string().max(4000) }).strict()).max(20)
    .refine(episodes => new Set(episodes.map(episode => episode.id)).size === episodes.length, 'Episode IDs must be unique').default([]),
}).strict();
export type CharacterPackage = z.infer<typeof packageSchema>;
export interface PackageStore {
  readonly operator: string;
  load(listing: MarketListing): Promise<CharacterPackage>;
  publish(listing: MarketListing, data: CharacterPackage): Promise<MarketListing['package']>;
}
export async function readBytes(response: Response, max = 1024 * 1024): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok || !response.body) throw failure(502, 'STORAGE_UNAVAILABLE');
  if (Number(response.headers.get('content-length')) > max) throw failure(413, 'STORAGE_TOO_LARGE');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const item = await reader.read(); if (item.done) break;
    size += item.value.length; if (size > max) throw failure(413, 'STORAGE_TOO_LARGE'); chunks.push(item.value);
  } } finally { await reader.cancel(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
// Type origin from MystenLabs/walrus testnet-contracts/walrus/Published.toml (2026-09-12).
export const WALRUS_TESTNET_TYPE_ORIGIN = '0xd84704c17fc870b8764832c535aa6b11f21a95cd6f5bb38a9b07d2cf42220c66';
const epochSchema = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String);
const blobIdFromNumber = (value: string) => Buffer.from(bcs.u256().serialize(value).toBytes()).toString('base64url');
const certifiedEvent = bcs.struct('BlobCertified', { epoch: bcs.u32(), blob_id: bcs.u256(), end_epoch: bcs.u32(),
  deletable: bcs.bool(), object_id: bcs.Address, is_extension: bcs.bool() });

export async function verifyStorageReceipt(raw: unknown, client: Pick<SuiGrpcClient, 'getObject' | 'getTransaction'>,
  owner: string, typeOrigin = WALRUS_TESTNET_TYPE_ORIGIN) {
  const receipt = z.union([
    z.object({ newlyCreated: z.object({ blobObject: z.object({ id: addressSchema, blobId: z.string(),
      deletable: z.literal(false), storage: z.object({ endEpoch: epochSchema }) }) }) }),
    z.object({ alreadyCertified: z.object({ blobId: z.string(), endEpoch: epochSchema, event: z.object({ txDigest: z.string().min(1) }) }) }),
  ]).parse(raw);
  if ('newlyCreated' in receipt) {
    const claimed = receipt.newlyCreated.blobObject;
    // Publisher responses may contain a pre-certification snapshot; inspect the actual Blob.
    for (let attempt = 0; attempt < 8; attempt++) {
      const { object } = await client.getObject({ objectId: claimed.id, include: { json: true }, signal: AbortSignal.timeout(10000) });
      if (normalizeStructTag(object.type) !== `${typeOrigin}::blob::Blob` || object.objectId !== claimed.id
        || object.owner.$kind !== 'AddressOwner' || object.owner.AddressOwner !== owner) throw failure(422, 'STORAGE_OBJECT_MISMATCH');
      const data = z.object({ blob_id: z.string(), certified_epoch: epochSchema.nullable(), deletable: z.literal(false),
        storage: z.object({ end_epoch: epochSchema }) }).parse(object.json);
      if (blobIdFromNumber(data.blob_id) !== claimed.blobId || BigInt(data.storage.end_epoch) < BigInt(claimed.storage.endEpoch))
        throw failure(422, 'STORAGE_OBJECT_MISMATCH');
      if (data.certified_epoch !== null) return { blobId: claimed.blobId, endEpoch: data.storage.end_epoch };
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw failure(503, 'STORAGE_NOT_CERTIFIED');
  }
  const claimed = receipt.alreadyCertified;
  const result = await client.getTransaction({ digest: claimed.event.txDigest, include: { events: true }, signal: AbortSignal.timeout(10000) });
  if (result.$kind !== 'Transaction' || !result.Transaction.status.success) throw failure(422, 'STORAGE_CERTIFICATE_INVALID');
  const certified = result.Transaction.events.filter(event => normalizeStructTag(event.eventType) === `${typeOrigin}::events::BlobCertified`)
    .map(event => certifiedEvent.parse(event.bcs)).some(event => !event.deletable && blobIdFromNumber(event.blob_id) === claimed.blobId
      && BigInt(event.end_epoch) >= BigInt(claimed.endEpoch));
  if (!certified) throw failure(422, 'STORAGE_CERTIFICATE_INVALID');
  return { blobId: claimed.blobId, endEpoch: claimed.endEpoch };
}
export function createPackageStore(config: {
  packageId: string; rpcUrl: string; operatorKey: string; servers: KeyServerConfig[];
  threshold: number; publisher: string; aggregator: string; epochs: number; walrusTypeOrigin?: string;
}): PackageStore {
  const key = Ed25519Keypair.fromSecretKey(config.operatorKey);
  const operator = key.toSuiAddress();
  const client = new SuiGrpcClient({ network: 'testnet', baseUrl: config.rpcUrl });
  const seal = new SealClient({ suiClient: client, serverConfigs: config.servers, verifyKeyServers: true });
  const download = async (blobId: string) => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(blobId)) throw failure(422, 'INVALID_BLOB_ID');
    return readBytes(await fetch(`${config.aggregator}/v1/blobs/${blobId}`, { signal: AbortSignal.timeout(30000) }));
  };
  const validate = (listing: MarketListing, data: unknown) => {
    const parsed = packageSchema.parse(data);
    if (parsed.packageId !== config.packageId || parsed.listingId !== listing.id) throw failure(422, 'PACKAGE_CONTEXT_MISMATCH');
    return parsed;
  };
  return { operator,
    async load(listing) {
      if (listing.operator !== operator) throw failure(503, 'OPERATOR_NOT_CONFIGURED');
      const bytes = await download(listing.package.blobId);
      if (sha(bytes) !== listing.package.contentHash) throw failure(422, 'PACKAGE_HASH_MISMATCH');
      const sessionKey = await SessionKey.create({ address: operator, packageId: config.packageId, ttlMin: 5, signer: key, suiClient: client });
      const tx = new Transaction(); tx.setSender(operator);
      tx.moveCall({ target: `${config.packageId}::market::seal_approve`, arguments: [tx.pure.vector('u8', fromHex(listing.id)), tx.object(listing.id)] });
      const data = await seal.decrypt({ data: bytes, sessionKey, txBytes: await tx.build({ client, onlyTransactionKind: true }) });
      try { return validate(listing, JSON.parse(new TextDecoder().decode(data))); } finally { data.fill(0); }
    },
    async publish(listing, data) {
      if (listing.operator !== operator) throw failure(503, 'OPERATOR_NOT_CONFIGURED');
      const bytes = new TextEncoder().encode(JSON.stringify(validate(listing, data)));
      const encrypted = await seal.encrypt({ threshold: config.threshold, packageId: config.packageId, id: listing.id, data: bytes });
      bytes.fill(0); encrypted.key.fill(0);
      const url = new URL(`${config.publisher}/v1/blobs`);
      url.searchParams.set('epochs', String(config.epochs)); url.searchParams.set('permanent', 'true'); url.searchParams.set('send_object_to', listing.creator);
      const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(encrypted.encryptedObject), signal: AbortSignal.timeout(120000) });
      const ref = await verifyStorageReceipt(JSON.parse(new TextDecoder().decode(await readBytes(response, 65536))), client, listing.creator, config.walrusTypeOrigin);
      const contentHash = sha(encrypted.encryptedObject);
      if (sha(await download(ref.blobId)) !== contentHash) throw failure(422, 'PACKAGE_HASH_MISMATCH');
      return { ...ref, contentHash };
    },
  };
}
