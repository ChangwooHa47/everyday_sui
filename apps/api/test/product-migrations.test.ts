import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { migrateProduct, flywayChecksum } from '../src/product/migrations.js';

test('original Flyway checksum survives line endings/BOM and applied migrations preserve existing product records', async t => {
  const sql = await readFile(new URL('../migrations/V1__product_schema.sql', import.meta.url), 'utf8');
  assert.equal(flywayChecksum(sql), 2107348010);
  assert.equal(flywayChecksum('\uFEFF' + sql.replace(/\r?\n/g, '\r\n')), 2107348010);
  const db = new PGlite(); t.after(() => db.close());
  await migrateProduct(db);
  await db.query(`INSERT INTO everyday.users(wallet_address,points) VALUES($1,321)`, [`0x${'a'.repeat(64)}`]);
  const history = (await db.query('SELECT * FROM everyday.flyway_schema_history ORDER BY installed_rank')).rows;
  await migrateProduct(db);
  assert.deepEqual((await db.query('SELECT * FROM everyday.flyway_schema_history ORDER BY installed_rank')).rows, history);
  assert.deepEqual((await db.query('SELECT points FROM everyday.users')).rows, [{ points: 321 }]);
});

test('history mismatch or damaged schema fails startup without clearing or replaying product data', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await migrateProduct(db);
  await db.query("UPDATE everyday.flyway_schema_history SET checksum=0 WHERE version='11'");
  await assert.rejects(migrateProduct(db), /migration history/);
  await db.query("UPDATE everyday.flyway_schema_history SET checksum=1081842246 WHERE version='11'");
  await db.query('ALTER TABLE everyday.characters DROP COLUMN soul_ready');
  await assert.rejects(migrateProduct(db), /required product columns/);
  assert.equal((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM everyday.flyway_schema_history')).rows[0].count, 12);
});
