import { aggregatorUrl, publisherUrl, endpoint } from './config';
import { referenceSchema, sha256, type Reference } from './schema';
import { z } from 'zod';

export const MAX_BYTES = 8 * 1024 * 1024;
export async function readLimited(response: Response, max = MAX_BYTES): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok || !response.body) throw Error(`저장소 응답 오류 (${response.status})`);
  if (Number(response.headers.get('content-length')) > max) throw Error('파일 크기 제한을 초과했습니다.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.length;
      if (total > max) throw Error('파일 크기 제한을 초과했습니다.');
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function download(ref: Reference, signal?: AbortSignal) {
  referenceSchema.parse(ref);
  const response = await fetch(`${endpoint(aggregatorUrl)}/v1/blobs/${ref.blobId}`, { signal: signal ?? AbortSignal.timeout(60_000) });
  const bytes = await readLimited(response);
  if (await sha256(bytes) !== ref.contentHash) throw Error('파일 무결성 검사에 실패했습니다.');
  return bytes;
}
const epoch = z.union([z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^\d+$/)]).transform(String);
export function parseReceipt(data: unknown, contentHash: string): Reference {
  const receipt = z.union([
    z.object({ newlyCreated: z.object({ blobObject: z.object({ blobId: z.string(), certifiedEpoch: epoch,
      deletable: z.literal(false), storage: z.object({ endEpoch: epoch }) }) }) }),
    z.object({ alreadyCertified: z.object({ blobId: z.string(), endEpoch: epoch, event: z.object({ txDigest: z.string() }) }) }),
  ]).parse(data);
  return referenceSchema.parse('newlyCreated' in receipt
    ? { blobId: receipt.newlyCreated.blobObject.blobId, endEpoch: receipt.newlyCreated.blobObject.storage.endEpoch, contentHash }
    : { blobId: receipt.alreadyCertified.blobId, endEpoch: receipt.alreadyCertified.endEpoch, contentHash });
}
export async function upload(bytes: Uint8Array, owner: string, epochs = 2): Promise<Reference> {
  if (!bytes.length || bytes.length > MAX_BYTES) throw Error('보관 파일은 8MB 이하만 지원합니다.');
  const url = new URL(`${endpoint(publisherUrl)}/v1/blobs`);
  url.searchParams.set('epochs', String(epochs));
  url.searchParams.set('send_object_to', owner);
  url.searchParams.set('deletable', 'false');
  const result = await fetch(url, { method: 'PUT', body: new Uint8Array(bytes),
    headers: { 'Content-Type': 'application/octet-stream' }, signal: AbortSignal.timeout(120_000) });
  const receiptBytes = await readLimited(result, 64 * 1024);
  const ref = parseReceipt(JSON.parse(new TextDecoder().decode(receiptBytes)), await sha256(bytes));
  await download(ref); // Publisher receipt alone is not trusted for the actual bytes.
  return ref;
}
