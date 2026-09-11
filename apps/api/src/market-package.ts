import { createHash } from 'node:crypto';
import { z } from 'zod';
import { SealClient, SessionKey, type KeyServerConfig } from '@mysten/seal';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { fromHex } from '@mysten/sui/utils';
import type { MarketListing } from '@everyday/contracts';
import { addressSchema, failure } from './auth.js';
import { characterSchema, messagesSchema } from './turn-service.js';
export const packageSchema = z.object({ schemaVersion: z.literal(1), network: z.literal('testnet'),
  packageId: addressSchema, listingId: addressSchema, character: characterSchema, preview: characterSchema,
  examples: messagesSchema.optional(), episodes: z.array(z.object({ id: z.string().min(1).max(80),
    title: z.string().min(1).max(120), setting: z.string().max(4000) }).strict()).max(20).default([]),
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
export function createPackageStore(config: {
  packageId: string; rpcUrl: string; operatorKey: string; servers: KeyServerConfig[];
  threshold: number; publisher: string; aggregator: string; epochs: number;
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
      url.searchParams.set('epochs', String(config.epochs)); url.searchParams.set('deletable', 'false'); url.searchParams.set('send_object_to', listing.creator);
      const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(encrypted.encryptedObject), signal: AbortSignal.timeout(120000) });
      const epoch = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String);
      const receipt = z.union([
        z.object({ newlyCreated: z.object({ blobObject: z.object({ blobId: z.string(), certifiedEpoch: epoch, deletable: z.literal(false), storage: z.object({ endEpoch: epoch }) }) }) }),
        z.object({ alreadyCertified: z.object({ blobId: z.string(), endEpoch: epoch, event: z.object({ txDigest: z.string().min(1) }) }) }),
      ]).parse(JSON.parse(new TextDecoder().decode(await readBytes(response, 65536))));
      const ref = 'newlyCreated' in receipt ? { blobId: receipt.newlyCreated.blobObject.blobId, endEpoch: receipt.newlyCreated.blobObject.storage.endEpoch }
        : { blobId: receipt.alreadyCertified.blobId, endEpoch: receipt.alreadyCertified.endEpoch };
      const contentHash = sha(encrypted.encryptedObject);
      if (sha(await download(ref.blobId)) !== contentHash) throw failure(422, 'PACKAGE_HASH_MISMATCH');
      return { ...ref, contentHash };
    },
  };
}
