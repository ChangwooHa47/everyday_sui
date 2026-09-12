import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Transaction } from '@mysten/sui/transactions';
import { z } from 'zod';
import type { SignedPublicationStep } from '@everyday/contracts';
import { authenticate, failure, type AuthConfig } from './auth.js';
import type { Database } from './database.js';
import type { MarketChain } from './market-chain.js';

const steps = { creator: 'register_creator', listing: 'create_listing', publish: 'publish' } as const;
const params = z.object({ publicationId: z.uuid(), step: z.enum(['creator', 'listing', 'publish']) });
const signedStep = z.object({ bytes: z.string().min(1).max(65536).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  signature: z.string().min(1).max(8192).regex(/^[A-Za-z0-9+/]+={0,2}$/), digest: z.string().min(32).max(44).regex(/^[1-9A-HJ-NP-Za-km-z]+$/) }).strict();

/** Persist authorization before client submission so another tab resumes the same transaction. */
export function registerPublications(app: FastifyInstance, db: Database, auth: AuthConfig, chain?: MarketChain) {
  const configured = () => { if (!chain) throw failure(503, 'MARKET_NOT_CONFIGURED'); return chain; };
  const findStep = async (publicationId: string, step: string) => (await db.query<SignedPublicationStep & Record<string, unknown>>(
    'SELECT tx_bytes AS bytes,signature,digest FROM publication_steps WHERE publication_id=$1 AND step=$2', [publicationId, step])).rows[0] ?? null;
  const owned = async (owner: string, publicationId: string) => {
    const found = await db.query('SELECT id FROM publications WHERE id=$1 AND owner=$2 AND package_id=$3', [publicationId, owner, configured().packageId]);
    if (!found.rows.length) throw failure(404, 'PUBLICATION_NOT_FOUND');
  };
  app.post('/v1/me/publications', async req => {
    const owner = await authenticate(req, db, auth);
    const data = z.object({ characterId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(req.body);
    const record = await db.query<{ id: string }>(`INSERT INTO publications(id,owner,package_id,character_id,fingerprint) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(owner,package_id,character_id,fingerprint) DO UPDATE SET fingerprint=EXCLUDED.fingerprint RETURNING id`,
    [randomUUID(), owner, configured().packageId, data.characterId, data.fingerprint]);
    return { publicationId: record.rows[0].id };
  });
  app.get('/v1/me/publications/:publicationId/steps/:step', async req => {
    const owner = await authenticate(req, db, auth), data = params.parse(req.params);
    await owned(owner, data.publicationId);
    return { step: await findStep(data.publicationId, data.step) };
  });
  app.post('/v1/me/publications/:publicationId/steps/:step', async req => {
    const owner = await authenticate(req, db, auth), data = params.parse(req.params);
    await owned(owner, data.publicationId);
    const input = signedStep.parse(req.body), service = configured();
    try {
      const tx = Transaction.from(input.bytes), restored = tx.getData(), call = restored.commands[0]?.MoveCall;
      if (restored.sender !== owner || restored.commands.length !== 1 || !call || call.package !== service.packageId
        || call.module !== 'market' || call.function !== steps[data.step] || await tx.getDigest() !== input.digest) throw Error('invalid');
    } catch { throw failure(400, 'INVALID_PUBLICATION_TRANSACTION'); }
    await db.query(`INSERT INTO publication_steps(publication_id,step,tx_bytes,signature,digest) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT DO NOTHING`, [data.publicationId, data.step, input.bytes, input.signature, input.digest]);
    let current = (await findStep(data.publicationId, data.step))!;
    if (current.digest !== input.digest) {
      // Never replace a merely unobserved/ambiguous transaction. The old signed
      // authorization could still execute; only a terminal on-chain failure is safe.
      if (!service.transactionStatus) throw failure(503, 'CHAIN_UNAVAILABLE');
      if (await service.transactionStatus(current.digest) === 'failed') {
        await db.query(`UPDATE publication_steps SET tx_bytes=$3,signature=$4,digest=$5
          WHERE publication_id=$1 AND step=$2 AND digest=$6`, [data.publicationId, data.step, input.bytes, input.signature, input.digest, current.digest]);
        current = (await findStep(data.publicationId, data.step))!;
      }
    }
    return current;
  });
}
