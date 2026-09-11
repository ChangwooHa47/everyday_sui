import { z } from 'zod';

export const u64 = z.string().regex(/^(0|[1-9][0-9]*)$/).refine(v => BigInt(v) <= 18446744073709551615n);
export const suiId = z.string().regex(/^0x[a-f0-9]{64}$/);
export const blobId = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const referenceSchema = z.object({ blobId, contentHash: digest, endEpoch: u64 }).strict();
const metadata = {
  schemaVersion: z.literal(1), network: z.literal('testnet'), appPackage: suiId,
  revision: u64, previousRef: blobId.nullable(), createdAt: z.iso.datetime(),
};
export const publicSchema = z.object({ ...metadata, kind: z.literal('character-public'),
  name: z.string().min(1).max(80), description: z.string().max(2000),
}).strict();
const message = z.object({ id: z.uuid(), turnId: z.uuid(), role: z.enum(['user','assistant']), content: z.string().max(32000), createdAt: z.iso.datetime() }).strict();
export const vaultSchema = z.object({ ...metadata, kind: z.literal('vault'), subjectId: suiId,
  settings: z.record(suiId, z.object({ name: z.string().max(80), personality: z.string().max(4000), callName: z.string().max(80) }).strict()),
  conversations: z.array(z.object({ id: z.uuid(), characterId: suiId, kind: z.enum(['ordinary','episode']),
    episode: z.string().max(1000), messages: z.array(message).max(1000) }).strict()).max(100),
  photos: z.array(z.object({ id: z.uuid(), characterId: suiId, name: z.string().max(200),
    mime: z.enum(['image/png','image/jpeg','image/webp']), data: z.string().max(4_000_000), createdAt: z.iso.datetime() }).strict()).max(30),
}).strict();
export type Reference = z.infer<typeof referenceSchema>;
export type PublicManifest = z.infer<typeof publicSchema>;
export type VaultManifest = z.infer<typeof vaultSchema>;

// v1 canonical encoding: recursively sorted object keys, UTF-8 JSON, finite numbers only.
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  }
  throw Error('Unsupported manifest value');
}
export const encode = (value: unknown) => new TextEncoder().encode(canonical(value));
export async function sha256(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2,'0')).join('');
}
export function assertContext(manifest: PublicManifest | VaultManifest, appPackage: string, revision: string, subjectId?: string) {
  if (manifest.appPackage !== appPackage || manifest.revision !== revision ||
    (manifest.kind === 'vault' && manifest.subjectId !== subjectId)) throw Error('보관 파일의 패키지·대상·버전이 체인과 다릅니다.');
}
