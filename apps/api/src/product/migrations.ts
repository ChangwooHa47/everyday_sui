import { readFile, readdir } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import type { Database } from '../database.js';
import { withTransaction } from './core.js';

// Continue the existing SQL/history, including Flyway's signed CRC32 over UTF-8 lines.
// No product tables are recreated and no existing migration is replayed.
export const flywayChecksum = (sql: string) => crc32(Buffer.from(sql.replace(/^\uFEFF/, '').replace(/[\r\n]/g, ''), 'utf8')) | 0;
export async function migrateProduct(db: Database, directory = new URL('../../migrations/', import.meta.url)) {
  const columns = JSON.parse(await readFile(new URL('schema.json', directory), 'utf8')) as {
    table_name: string; column_name: string; udt_name: string; is_nullable: string; character_maximum_length: number | null;
  }[];
  const files = (await readdir(directory)).filter(file => /^V[1-9][0-9]*__.*\.sql$/.test(file))
    .sort((a, b) => Number(a.match(/^V(\d+)/)![1]) - Number(b.match(/^V(\d+)/)![1]));
  if (files.length !== 12 || files.some((file, index) => Number(file.match(/^V(\d+)/)![1]) !== index + 1))
    throw Error('Expected contiguous product migrations V1 through V12');
  const migrations = await Promise.all(files.map(async script => {
    const sql = await readFile(new URL(script, directory), 'utf8');
    const [, version, description] = script.match(/^V(\d+)__(.*)\.sql$/)!;
    return { script, version, description: description.replaceAll('_', ' '), sql, checksum: flywayChecksum(sql) };
  }));
  await withTransaction(db, async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(763644234112::bigint)');
    await tx.query('CREATE SCHEMA IF NOT EXISTS everyday');
    await tx.query(`CREATE TABLE IF NOT EXISTS everyday.flyway_schema_history (
      installed_rank integer NOT NULL PRIMARY KEY, version varchar(50), description varchar(200) NOT NULL,
      type varchar(20) NOT NULL, script varchar(1000) NOT NULL, checksum integer,
      installed_by varchar(100) NOT NULL, installed_on timestamp NOT NULL DEFAULT now(),
      execution_time integer NOT NULL, success boolean NOT NULL
    )`);
    const applied = (await tx.query<{ version: string | null; script: string; checksum: number | null; success: boolean; type: string }>(
      'SELECT version,script,checksum,success,type FROM everyday.flyway_schema_history ORDER BY installed_rank')).rows;
    for (const old of applied) {
      if (old.type === 'SCHEMA' && old.success && old.version === null) continue;
      const expected = migrations.find(item => item.version === old.version);
      if (!expected || !old.success || old.type !== 'SQL' || old.script !== expected.script || old.checksum !== expected.checksum)
        throw Error('Existing product migration history does not match the deployed SQL');
    }
    await tx.query('SET LOCAL search_path TO everyday, public');
    let previousMissing = false;
    for (const item of migrations) {
      if (applied.some(old => old.version === item.version)) {
        if (previousMissing) throw Error('Product migration history has a gap');
        continue;
      }
      previousMissing = true;
      const start = Date.now();
      const executor = tx as Database & { exec?: (sql: string) => Promise<unknown> };
      if (executor.exec) await executor.exec(item.sql);
      else await tx.query(item.sql);
      await tx.query(`INSERT INTO everyday.flyway_schema_history
        (installed_rank,version,description,type,script,checksum,installed_by,execution_time,success)
        SELECT coalesce(max(installed_rank),0)+1,$1,$2,'SQL',$3,$4,current_user,$5,true
        FROM everyday.flyway_schema_history`, [item.version, item.description, item.script, item.checksum, Date.now() - start]);
    }
    // Replace Hibernate's startup validation: a valid history must not conceal missing or mistyped product columns.
    const actual = (await tx.query('SELECT table_name,column_name,udt_name,is_nullable,character_maximum_length FROM information_schema.columns WHERE table_schema=$1', ['everyday'])).rows;
    for (const expected of columns) {
      const column = actual.find(item => item.table_name === expected.table_name && item.column_name === expected.column_name);
      if (!column || column.udt_name !== expected.udt_name || column.is_nullable !== expected.is_nullable
        || column.character_maximum_length !== expected.character_maximum_length)
        throw Error('Existing product schema does not match the required product columns');
    }
  });
}
