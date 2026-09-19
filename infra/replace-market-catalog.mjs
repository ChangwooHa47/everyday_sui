// Remove only the superseded seed rows after the refreshed listings have been registered.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

if (!process.argv.includes('--execute')) throw Error('Use --execute for the authorized catalog replacement.');
function argument(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index < 0 ? fallback : process.argv[index + 1];
}
const root = resolve(import.meta.dirname, '..');
const previous = JSON.parse(readFileSync(resolve(root, argument('--previous', '.local-tools/market-seed-refresh-2026-09-19/previous-market-seed.json')), 'utf8'));
const current = JSON.parse(readFileSync(resolve(root, argument('--current', 'contracts/everyday/deployments/market-seed.json')), 'utf8'));
assert.equal(previous.packageId, current.packageId);
assert.equal(previous.listings.length, 10);
assert.equal(current.listings.length, 10);
const oldIds = previous.listings.map(item => item.listingId);
const newIds = current.listings.map(item => item.listingId);
assert.equal(new Set(oldIds).size, 10);
assert.equal(new Set(newIds).size, 10);
assert.equal(oldIds.some(id => newIds.includes(id)), false);

const sqlPath = argument('--sql-file');
if (sqlPath) {
  const values = ids => ids.map(id => `('${id}')`).join(',\n    ');
  const sql = `\\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE fresh_count integer;
BEGIN
  SELECT count(*) INTO fresh_count FROM market_catalog
    WHERE package_id='${current.packageId}' AND listing_id IN (SELECT id FROM (VALUES
    ${values(newIds)}
    ) AS fresh(id));
  IF fresh_count <> 10 THEN RAISE EXCEPTION 'All refreshed listings must be registered before catalog replacement'; END IF;
END $$;
DELETE FROM market_previews WHERE listing_id IN (SELECT id FROM (VALUES
    ${values(oldIds)}
  ) AS old(id));
DELETE FROM market_catalog WHERE package_id='${current.packageId}' AND listing_id IN (SELECT id FROM (VALUES
    ${values(oldIds)}
  ) AS old(id));
SELECT count(*) AS refreshed_catalog_rows FROM market_catalog
  WHERE package_id='${current.packageId}' AND listing_id IN (SELECT id FROM (VALUES
    ${values(newIds)}
  ) AS fresh(id));
COMMIT;
`;
  const target = resolve(root, sqlPath);
  writeFileSync(target, sql, { mode: 0o600 });
  console.log(target);
  process.exit(0);
}

if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
await db.connect();
try {
  await db.query('BEGIN');
  const fresh = await db.query('SELECT listing_id FROM market_catalog WHERE package_id=$1 AND listing_id=ANY($2::text[]) FOR UPDATE', [current.packageId, newIds]);
  assert.equal(fresh.rowCount, 10, 'All refreshed listings must be registered before catalog replacement');
  const old = await db.query('SELECT listing_id FROM market_catalog WHERE package_id=$1 AND listing_id=ANY($2::text[]) FOR UPDATE', [current.packageId, oldIds]);
  const previews = await db.query('DELETE FROM market_previews WHERE listing_id=ANY($1::text[])', [oldIds]);
  const catalog = await db.query('DELETE FROM market_catalog WHERE package_id=$1 AND listing_id=ANY($2::text[])', [current.packageId, oldIds]);
  await db.query('COMMIT');
  console.log(JSON.stringify({ status: 'passed', matchedOldRows: old.rowCount, removedPreviews: previews.rowCount,
    removedCatalogRows: catalog.rowCount, retainedNewRows: fresh.rowCount }));
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally {
  await db.end();
}
