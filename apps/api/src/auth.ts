import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { parseSerializedSignature } from '@mysten/sui/cryptography';
import { isValidPersonalMessageSignature } from '@mysten/sui/verify';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from './database.js';

export const addressSchema = z.string().refine(isValidSuiAddress).transform(value => normalizeSuiAddress(value));
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function failure(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}
export interface AuthConfig { origins: string[]; audience: string; network: 'testnet'; }
const accessSessionMs = 15 * 60 * 1000;
const refreshSessionMs = 30 * 24 * 60 * 60 * 1000;
const refreshGraceSeconds = 30;
const refreshCookie = 'everyday.refresh.v1';
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

function cookieOptions(origin: string, expires?: Date) {
  const secure = new URL(origin).protocol === 'https:';
  return { path: '/v1/auth', httpOnly: true, secure, sameSite: secure ? 'none' as const : 'lax' as const,
    ...(secure ? { partitioned: true } : {}), ...(expires ? { expires } : {}) };
}
function setRefreshCookie(reply: FastifyReply, origin: string, token: string, expires: Date) {
  reply.setCookie(refreshCookie, token, cookieOptions(origin, expires));
}
function clearRefreshCookie(reply: FastifyReply, origin: string) {
  reply.clearCookie(refreshCookie, cookieOptions(origin));
}
function requestRefreshToken(req: FastifyRequest) {
  const token = req.cookies[refreshCookie];
  return token && tokenPattern.test(token) ? token : null;
}
// Share a successful validation only within this HTTP request. A later request
// must query again so session revocation and expiry remain effective immediately.
const authenticatedRequests = new WeakMap<FastifyRequest, {
  db: Database; config: AuthConfig; token: string; origin: string; address: string;
}>();
export function getOrigin(req: FastifyRequest, config: AuthConfig) {
  const origin = req.headers.origin;
  if (!origin || !config.origins.includes(origin)) throw failure(403, 'ORIGIN_NOT_ALLOWED');
  return origin;
}
export async function authenticate(req: FastifyRequest, db: Database, config: AuthConfig) {
  const origin = getOrigin(req, config);
  const token = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) throw failure(401, 'LOGIN_REQUIRED');
  const cached = authenticatedRequests.get(req);
  if (cached?.db === db && cached.config === config && cached.token === token && cached.origin === origin) return cached.address;
  const { rows } = await db.query<{ address: string }>(
    'SELECT address FROM wallet_sessions WHERE token_hash=$1 AND origin=$2 AND expires_at>now()', [hash(token), origin]);
  if (!rows[0]) throw failure(401, 'SESSION_EXPIRED');
  authenticatedRequests.set(req, { db, config, token, origin, address: rows[0].address });
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
  app.post('/v1/auth/sessions', async (req, reply) => {
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
    const refreshToken = randomBytes(32).toString('base64url');
    const familyId = randomUUID();
    const expiresAt = new Date(Date.now() + accessSessionMs);
    const refreshExpiresAt = new Date(Date.now() + refreshSessionMs);
    const previousRefresh = requestRefreshToken(req);
    const consumed = await db.query<{ address: string }>(`WITH previous_family AS (
      SELECT family_id FROM wallet_refresh_sessions WHERE token_hash=$9 AND origin=$2
    ), removed_access AS (
      DELETE FROM wallet_sessions WHERE token_hash IN (
        SELECT token_hash FROM wallet_session_families WHERE family_id IN (SELECT family_id FROM previous_family)
      )
    ), removed_refresh AS (
      DELETE FROM wallet_refresh_sessions WHERE family_id IN (SELECT family_id FROM previous_family)
    ), consumed AS (
      UPDATE wallet_challenges SET consumed_at=now() WHERE id=$1 AND origin=$2 AND network=$3
      AND consumed_at IS NULL AND expires_at>now() RETURNING address,origin
    ), access AS (
      INSERT INTO wallet_sessions(token_hash,address,origin,expires_at)
      SELECT $4,address,origin,$5 FROM consumed RETURNING token_hash,address,origin
    ), linked AS (
      INSERT INTO wallet_session_families(token_hash,family_id)
      SELECT token_hash,$7 FROM access RETURNING token_hash
    ) INSERT INTO wallet_refresh_sessions(token_hash,family_id,address,origin,expires_at)
      SELECT $6,$7,address,origin,$8 FROM access JOIN linked USING(token_hash) RETURNING address`,
    [input.challengeId, origin, config.network, hash(token), expiresAt, hash(refreshToken), familyId, refreshExpiresAt,
      previousRefresh ? hash(previousRefresh) : null]);
    if (!consumed.rows[0]) throw failure(401, 'CHALLENGE_EXPIRED_OR_USED');
    setRefreshCookie(reply, origin, refreshToken, refreshExpiresAt);
    return { token, address: consumed.rows[0].address, expiresAt: expiresAt.toISOString() };
  });
  app.post('/v1/auth/session/refresh', async (req, reply) => {
    const origin = getOrigin(req, config);
    z.object({}).strict().parse(req.body ?? {});
    const previous = requestRefreshToken(req);
    if (!previous) { clearRefreshCookie(reply, origin); throw failure(401, 'LOGIN_REQUIRED'); }
    const token = randomBytes(32).toString('base64url');
    const nextRefresh = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + accessSessionMs);
    const rotated = await db.query<{ address: string; refresh_expires_at: Date | string }>(`WITH claimed AS (
      UPDATE wallet_refresh_sessions SET rotated_at=coalesce(rotated_at,now())
      WHERE token_hash=$1 AND origin=$2 AND expires_at>now()
        AND (rotated_at IS NULL OR rotated_at>now()-make_interval(secs => $6))
      RETURNING address,origin,family_id,expires_at
    ), refreshed AS (
      INSERT INTO wallet_refresh_sessions(token_hash,family_id,address,origin,expires_at)
      SELECT $3,family_id,address,origin,expires_at FROM claimed RETURNING address,origin
    ), access AS (
      INSERT INTO wallet_sessions(token_hash,address,origin,expires_at)
      SELECT $4,address,origin,$5 FROM refreshed RETURNING token_hash,address,origin
    ), linked AS (
      INSERT INTO wallet_session_families(token_hash,family_id)
      SELECT access.token_hash,claimed.family_id FROM access CROSS JOIN claimed RETURNING token_hash
    ), cleanup AS (
      DELETE FROM wallet_refresh_sessions WHERE family_id IN (SELECT family_id FROM claimed)
        AND rotated_at<=now()-make_interval(secs => $6)
    ), cleanup_access AS (
      DELETE FROM wallet_sessions WHERE expires_at<=now() AND token_hash IN (
        SELECT token_hash FROM wallet_session_families WHERE family_id IN (SELECT family_id FROM claimed)
      )
    ) SELECT access.address,claimed.expires_at AS refresh_expires_at
      FROM access JOIN linked USING(token_hash) CROSS JOIN claimed`,
    [hash(previous), origin, hash(nextRefresh), hash(token), expiresAt, refreshGraceSeconds]);
    const session = rotated.rows[0];
    if (!session) { clearRefreshCookie(reply, origin); throw failure(401, 'SESSION_EXPIRED'); }
    setRefreshCookie(reply, origin, nextRefresh, new Date(session.refresh_expires_at));
    return { token, address: session.address, expiresAt: expiresAt.toISOString() };
  });
  app.get('/v1/me', async req => ({ address: await authenticate(req, db, config), network: config.network }));
  app.delete('/v1/auth/session', async (req, reply) => {
    const origin = getOrigin(req, config);
    const access = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1] ?? null;
    const refresh = requestRefreshToken(req);
    if (!access && !refresh) throw failure(401, 'LOGIN_REQUIRED');
    await db.query(`WITH family AS (
      SELECT family_id FROM wallet_refresh_sessions WHERE token_hash=$2 AND origin=$3
      UNION SELECT family_id FROM wallet_session_families WHERE token_hash=$1
    ), removed_access AS (
      DELETE FROM wallet_sessions WHERE token_hash=$1 OR token_hash IN (
        SELECT token_hash FROM wallet_session_families WHERE family_id IN (SELECT family_id FROM family)
      )
    ) DELETE FROM wallet_refresh_sessions WHERE family_id IN (SELECT family_id FROM family)`,
    [access ? hash(access) : null, refresh ? hash(refresh) : null, origin]);
    clearRefreshCookie(reply, origin);
    return reply.code(204).send();
  });
}
