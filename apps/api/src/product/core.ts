import type { FastifyRequest } from 'fastify';
import type { Database } from '../database.js';
import type { GiftService } from '../gifts.js';
import type { MarketListing } from '@everyday/contracts';

export interface ProductIdentity { userId: string; address: string }
export interface CharacterRow extends Record<string, unknown> {
  id: string; user_id: string; version: string; name: string; birthday: string | Date | null;
  relationship_type: string; gender: string; summary: string | null; appearance: string | null;
  personality: string | null; system_prompt: string; image_prompt: string | null;
  profile_image_url: string | null; call_name: string | null; soul_id: string | null;
  soul_ready: boolean; created_at: string | Date | null; updated_at: string | Date | null;
}
export interface LlmMessage { role: string; content: string }
export interface ProductLlm {
  cancel?(): void;
  requireConfigured(): void;
  chat(system: string, messages: LlmMessage[]): Promise<string>;
}
export interface ProductImageProvider {
  cancel?(): void;
  requireConfigured(): void;
  generateImages(prompt: string, reference: string | null, count: number, soulId?: string | null): Promise<string[]>;
  trainSoul(reference: string): Promise<string>;
  soulReady(id: string): Promise<boolean>;
}
export interface PhotoPaymentProvider {
  readonly priceMist: string;
  transaction(sender: string): Promise<string>;
  verify(digest: string, sender: string): Promise<void>;
}
export interface ProductContext {
  db: Database;
  llm: ProductLlm;
  image: ProductImageProvider;
  gifts?: GiftService;
  photoPayments?: PhotoPaymentProvider;
  authenticate(req: FastifyRequest): Promise<ProductIdentity>;
  ownedCharacter(userId: string, characterId: string, db?: Database, lock?: boolean): Promise<CharacterRow>;
  requireAccess(req: FastifyRequest, characterId: string, db?: Database): Promise<void>;
  requireEditable(characterId: string, db?: Database): Promise<void>;
  isLicensed(characterId: string, db?: Database): Promise<boolean>;
  personalizedPrompt(characterId: string, fallback: string, callName: string | null, db?: Database): Promise<string>;
  withApprovedMemory(req: FastifyRequest, characterId: string, prompt: string, input: string, db?: Database): Promise<string>;
  approvedMemories?(req: FastifyRequest, characterId: string, input: string, db?: Database): Promise<string[]>;
  licensedListing?(characterId: string, db?: Database): Promise<MarketListing | null>;
}

const errorDefinitions = {
  INVALID_REQUEST: [400, '잘못된 요청입니다.'], UNAUTHORIZED: [401, '인증이 필요합니다.'],
  DUPLICATE_EMAIL: [409, '이미 가입된 이메일입니다.'],
  USER_NOT_FOUND: [404, '사용자를 찾을 수 없습니다.'], CHARACTER_NOT_FOUND: [404, '캐릭터를 찾을 수 없습니다.'],
  PHOTO_NOT_FOUND: [404, '사진을 찾을 수 없습니다.'], EPISODE_NOT_FOUND: [404, '에피소드를 찾을 수 없습니다.'],
  CHARACTER_EPISODE_NOT_FOUND: [404, '진행 중인 에피소드를 찾을 수 없습니다.'],
  FORBIDDEN_CHARACTER_ACCESS: [403, '본인의 캐릭터가 아닙니다.'], PAYMENT_REQUIRED: [402, 'SUI 결제가 필요합니다.'],
  LLM_API_ERROR: [502, 'AI 응답 생성에 실패했습니다.'], IMAGE_API_ERROR: [502, '이미지 생성에 실패했습니다.'],
} as const;
export function productError(code: keyof typeof errorDefinitions | number, message?: string) {
  const [statusCode, text] = typeof code === 'number'
    ? [code, message ?? '요청을 처리하지 못했어요. 다시 시도해주세요.'] : errorDefinitions[code];
  return Object.assign(new Error(message ?? text), { statusCode, productError: true });
}
export const ok = <T>(data: T) => ({ success: true, data, message: null });
export function productId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || BigInt(value) > 9223372036854775807n)
    throw productError('INVALID_REQUEST');
  return value;
}
export function numericId(value: string | number): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw productError(500);
  return n;
}
// Spring's LocalDateTime JSON has no timezone suffix. Product timestamps retain that contract.
export function productDate(value: string | Date | null): string | null {
  if (value === null) return null;
  if (!(value instanceof Date)) return value.replace(' ', 'T').replace(/Z$/, '').replace(/\.000$/, '');
  const pad = (number: number, width = 2) => String(number).padStart(width, '0');
  const base = `${pad(value.getFullYear(), 4)}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  return value.getMilliseconds() ? `${base}.${pad(value.getMilliseconds(), 3)}` : base;
}
const transactionConnections = new WeakSet<object>();
export async function withTransaction<T>(db: Database, callback: (tx: Database) => Promise<T>): Promise<T> {
  if (transactionConnections.has(db)) return callback(db);
  const candidate = db as Database & {
    connect?: () => Promise<Database & { release(): void }>;
    transaction?: (fn: (tx: Database) => Promise<T>) => Promise<T>;
  };
  if (candidate.connect) {
    const connection = await candidate.connect();
    transactionConnections.add(connection);
    try {
      await connection.query('BEGIN');
      const result = await callback(connection);
      await connection.query('COMMIT');
      return result;
    } catch (error) {
      await connection.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { transactionConnections.delete(connection); connection.release(); }
  }
  if (candidate.transaction) return candidate.transaction(async tx => {
    transactionConnections.add(tx);
    try { return await callback(tx); } finally { transactionConnections.delete(tx); }
  });
  throw Error('Product operations require a transaction-capable database');
}
