import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addressSchema, authenticate, failure, hash, type AuthConfig } from './auth.js';
import type { Database } from './database.js';
import type { MemoryProvider } from './memory-provider.js';
import type { MarketChain } from './market-chain.js';
import { requireMarketAccess } from './market.js';
import { activeRecalledRelationshipMemories } from './product/automatic-memory.js';

export async function memoryAccount(db: Database, owner: string) {
  const { rows } = await db.query<{ account_id: string }>('SELECT account_id FROM memory_accounts WHERE owner=$1 AND enabled=true', [owner]);
  if (!rows[0]) throw failure(409, 'MEMORY_NOT_CONNECTED');
  return rows[0].account_id;
}
export function registerMemory(app: FastifyInstance, db: Database, auth: AuthConfig, provider?: MemoryProvider, chain?: MarketChain) {
  const service = () => { if (!provider) throw failure(503, 'MEMORY_NOT_CONFIGURED'); return provider; };
  const params = z.object({ listingId: addressSchema });
  app.get('/v1/me/memory-account', async req => {
    const owner = await authenticate(req, db, auth);
    const { rows } = await db.query('SELECT account_id AS "accountId",enabled,auto_store AS "autoStore" FROM memory_accounts WHERE owner=$1', [owner]);
    return { account: rows[0] ?? null };
  });
  app.post('/v1/me/memory-account/transaction', async req => {
    const owner = await authenticate(req, db, auth);
    const data = z.object({ accountId: addressSchema.optional(), revoke: z.boolean().default(false) }).strict().parse(req.body);
    return service().setup(owner, data.accountId, data.revoke);
  });
  app.post('/v1/me/memory-account', async req => {
    const owner = await authenticate(req, db, auth);
    const data = z.object({ accountId: addressSchema, consent: z.literal(true) }).strict().parse(req.body);
    await service().verify(owner, data.accountId);
    // Connecting the private memory account is the one-time opt-in. Individual
    // conversations stay interruption-free after this explicit wallet/delegate flow.
    await db.query(`INSERT INTO memory_accounts(owner,account_id,enabled,auto_store) VALUES($1,$2,true,true)
      ON CONFLICT(owner) DO UPDATE SET account_id=$2,enabled=true,auto_store=true`, [owner, data.accountId]);
    return { accountId: data.accountId, autoStore: true };
  });
  app.delete('/v1/me/memory-account', async (req, reply) => {
    const owner = await authenticate(req, db, auth);
    await db.query('UPDATE memory_accounts SET enabled=false,auto_store=false WHERE owner=$1', [owner]);
    const productTables = await db.query<{ count: number }>(`SELECT count(*)::integer AS count FROM information_schema.tables
      WHERE table_schema='everyday' AND table_name IN ('users','automatic_memory_extractions','automatic_memories')`);
    if (productTables.rows[0]?.count === 3) await db.query(`WITH product_user AS (
        SELECT id FROM everyday.users WHERE wallet_address=$1
      ), skipped AS (
        UPDATE everyday.automatic_memory_extractions SET status='skipped',updated_at=now()
        WHERE user_id IN (SELECT id FROM product_user) AND status IN ('pending','running')
      ) UPDATE everyday.automatic_memories SET status='filtered',updated_at=now()
        WHERE user_id IN (SELECT id FROM product_user)
          AND status IN ('pending','submitting','submitted','checking')`, [owner]);
    return reply.code(204).send();
  });
  app.post('/v1/me/relationships/:listingId/remember', async (req, reply) => {
    const owner = await authenticate(req, db, auth);
    const { listingId } = params.parse(req.params);
    const data = z.object({ requestId: z.uuid(), text: z.string().trim().min(1).max(2000), consent: z.literal(true), licenseId: addressSchema.optional() }).strict().parse(req.body);
    if (!chain) throw failure(503, 'MARKET_NOT_CONFIGURED');
    const memory = service();
    await requireMarketAccess(chain, owner, listingId, data.licenseId);
    const accountId = await memoryAccount(db, owner);
    await memory.verify(owner, accountId);
    const fingerprint = hash(JSON.stringify([accountId, listingId, data.text]));
    const inserted = await db.query(`INSERT INTO memory_jobs(owner,request_id,listing_id,account_id,input_hash,status)
      VALUES($1,$2,$3,$4,$5,'running') ON CONFLICT DO NOTHING RETURNING request_id`, [owner, data.requestId, listingId, accountId, fingerprint]);
    if (!inserted.rows.length) {
      const old = await db.query<{ input_hash: string; job_id: string | null }>('SELECT input_hash,job_id FROM memory_jobs WHERE owner=$1 AND request_id=$2', [owner, data.requestId]);
      if (old.rows[0]?.input_hash !== fingerprint) throw failure(409, 'IDEMPOTENCY_CONFLICT');
      if (old.rows[0]?.job_id) return reply.code(202).send({ requestId: data.requestId, jobId: old.rows[0].job_id });
      throw failure(409, 'MEMORY_RESULT_UNKNOWN_DO_NOT_AUTO_RETRY');
    }
    try {
      const accepted = await memory.remember(owner, accountId, listingId, data.text, data.requestId);
      await db.query("UPDATE memory_jobs SET job_id=$3,status='accepted' WHERE owner=$1 AND request_id=$2", [owner, data.requestId, accepted.job_id]);
      return reply.code(202).send({ requestId: data.requestId, jobId: accepted.job_id });
    } catch {
      await db.query("UPDATE memory_jobs SET status='unknown' WHERE owner=$1 AND request_id=$2", [owner, data.requestId]);
      throw failure(502, 'MEMORY_RESULT_UNKNOWN_DO_NOT_AUTO_RETRY');
    }
  });
  app.get('/v1/me/memory-jobs/:requestId', async req => {
    const owner = await authenticate(req, db, auth);
    const { requestId } = z.object({ requestId: z.uuid() }).parse(req.params);
    const accountId = await memoryAccount(db, owner);
    const { rows } = await db.query<{ job_id: string | null; listing_id: string; status: string }>('SELECT job_id,listing_id,status FROM memory_jobs WHERE owner=$1 AND request_id=$2 AND account_id=$3', [owner, requestId, accountId]);
    if (!rows[0]) throw failure(404, 'MEMORY_JOB_NOT_FOUND');
    if (!rows[0].job_id) return { status: rows[0].status };
    return service().status(owner, accountId, rows[0].listing_id, rows[0].job_id);
  });
  app.post('/v1/me/relationships/:listingId/recall', async req => {
    const owner = await authenticate(req, db, auth);
    const { listingId } = params.parse(req.params);
    const { query } = z.object({ query: z.string().trim().min(1).max(2000) }).strict().parse(req.body);
    const recalled = await service().recall(owner, await memoryAccount(db, owner), listingId, query);
    const active = new Set(await activeRecalledRelationshipMemories(db, owner, listingId, recalled.results.map(item => item.text)));
    const results = recalled.results.filter(item => active.has(item.text));
    return { ...recalled, results, total: results.length };
  });
}
