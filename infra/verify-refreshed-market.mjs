import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidence = JSON.parse(readFileSync(resolve(root, 'contracts/everyday/deployments/market-seed.json'), 'utf8'));
const api = process.argv[2] ?? 'https://everydayapi-production.up.railway.app';
const response = await fetch(`${api}/v1/market/listings?limit=20`, { signal: AbortSignal.timeout(30000) });
assert.equal(response.ok, true, `catalog request failed (${response.status})`);
const page = await response.json();
const expected = new Set(evidence.listings.map(item => item.listingId));
assert.equal(page.listings.length, 10);
assert.equal(page.nextCursor, null);
assert.equal(Object.keys(page.previews).length, 10);
assert.ok(page.listings.every(item => expected.has(item.id) && item.active && item.published));
const blobs = await Promise.all(evidence.listings.flatMap(item => [
  { name: item.name, kind: 'image', id: item.image.blobId },
  { name: item.name, kind: 'package', id: item.package.blobId },
]).map(async item => {
  const stored = await fetch(`https://aggregator.walrus-testnet.walrus.space/v1/blobs/${item.id}`,
    { signal: AbortSignal.timeout(30000) });
  return { ...item, status: stored.status };
}));
assert.ok(blobs.every(item => item.status === 200));
console.log(JSON.stringify({ status: 'passed', catalogCount: page.listings.length, previewCount: Object.keys(page.previews).length,
  activeCount: page.listings.filter(item => item.active && item.published).length, blobCount: blobs.length,
  retentionEpochs: evidence.retentionEpochs }, null, 2));
