import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { parseSerializedSignature } from '@mysten/sui/cryptography';
import { isValidPersonalMessageSignature } from '@mysten/sui/verify';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from './database.js';

export const addressSchema = z.string().refine(isValidSuiAddress).transform(value => normalizeSuiAddress(value));
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function failure(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}
export interface AuthConfig { origins: string[]; audience: string; network: 'testnet'; }
export function getOrigin(req: FastifyRequest, config: AuthConfig) {
  const origin = req.headers.origin;
  if (!origin || !config.origins.includes(origin)) throw failure(403, 'ORIGIN_NOT_ALLOWED');
  return origin;
}
export async function authenticate(req: FastifyRequest, db: Database, config: AuthConfig) {
  const origin = getOrigin(req, config);
  const token = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) throw failure(401, 'LOGIN_REQUIRED');
  const { rows } = await db.query<{ address: string }>(
    'SELECT address FROM wallet_sessions WHERE token_hash=$1 AND origin=$2 AND expires_at>now()', [hash(token), origin]);
  if (!rows[0]) throw failure(401, 'SESSION_EXPIRED');
  return rows[0].address;
}

export function registerAuth(app: FastifyInstance, db: Database, config: AuthConfig) {
  const signatureClient = new SuiGrpcClient({ network: 'testnet', baseUrl: 'https://fullnode.testnet.sui.io:443', timeout: 10_000 });
  app.post('/v1/auth/challenges', async req => {
    const origin = getOrigin(req, config);
    const input = z.object({ address: addressSchema, network: z.literal(config.network) }).strict().parse(req.body);
    const id = randomUUID();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 300_000);
    const message = ['Everyday wallet login v1', 'This signature signs in only; it does not authorize asset transfers.',
      `Address: ${input.address}`, `Origin: ${origin}`, `Audience: ${config.audience}`,
      `Chain: sui:${config.network}`, `Challenge: ${id}`, `Nonce: ${randomBytes(32).toString('hex')}`,
      `Issued At: ${issuedAt.toISOString()}`, `Expiration Time: ${expiresAt.toISOString()}`].join('\n');
    await db.query('INSERT INTO wallet_challenges(id,address,origin,network,message,expires_at) VALUES($1,$2,$3,$4,$5,$6)',
      [id, input.address, origin, config.network, message, expiresAt]);
    return { id, message, expiresAt: expiresAt.toISOString() };
  });
  app.post('/v1/auth/sessions', async req => {
    const origin = getOrigin(req, config);
    const input = z.object({ challengeId: z.uuid(), signature: z.string().min(1).max(4096) }).strict().parse(req.body);
    const { rows } = await db.query<{ address: string; message: string }>(
      'SELECT address,message FROM wallet_challenges WHERE id=$1 AND origin=$2 AND network=$3 AND expires_at>now() AND consumed_at IS NULL',
      [input.challengeId, origin, config.network]);
    const challenge = rows[0];
    if (!challenge) throw failure(401, 'CHALLENGE_EXPIRED_OR_USED');
    if (!challenge.message.split('\n').includes(`Audience: ${config.audience}`)) throw failure(401, 'CHALLENGE_AUDIENCE_CHANGED');
    try {
      const scheme = parseSerializedSignature(input.signature).signatureScheme;
      if (!['ED25519', 'Secp256k1', 'Secp256r1', 'ZkLogin'].includes(scheme)) throw Error('unsupported');
    } catch { throw failure(401, 'INVALID_OR_UNSUPPORTED_SIGNATURE'); }
    let valid: boolean;
    try {
      valid = await isValidPersonalMessageSignature(new TextEncoder().encode(challenge.message), input.signature,
        { address: challenge.address, client: signatureClient });
    } catch { throw failure(503, 'SIGNATURE_VERIFICATION_UNAVAILABLE'); }
    if (!valid) throw failure(401, 'INVALID_OR_UNSUPPORTED_SIGNATURE');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 1_800_000);
    const consumed = await db.query(`WITH consumed AS (
      UPDATE wallet_challenges SET consumed_at=now() WHERE id=$1 AND origin=$2 AND network=$3
      AND consumed_at IS NULL AND expires_at>now() RETURNING address,origin
    ) INSERT INTO wallet_sessions(token_hash,address,origin,expires_at)
      SELECT $4,address,origin,$5 FROM consumed RETURNING address`,
    [input.challengeId, origin, config.network, hash(token), expiresAt]);
    if (!consumed.rows[0]) throw failure(401, 'CHALLENGE_EXPIRED_OR_USED');
    return { token, address: challenge.address, expiresAt: expiresAt.toISOString() };
  });
  app.get('/v1/me', async req => ({ address: await authenticate(req, db, config), network: config.network }));
  app.delete('/v1/auth/session', async (req, reply) => {
    await authenticate(req, db, config);
    await db.query('DELETE FROM wallet_sessions WHERE token_hash=$1', [hash(req.headers.authorization!.slice(7))]);
    return reply.code(204).send();
  });
}
