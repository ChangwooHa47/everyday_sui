import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MarketChain } from '../market-chain.js';
import type { PackageStore } from '../market-package.js';
import { requireMarketAccess } from '../market.js';
import { ok, productError, productId, withTransaction, type CharacterRow, type ProductContext } from './core.js';
import { characterResponse } from './characters.js';
import { buildSystemPrompt } from './llm.js';
import { importPackageEpisodes } from './episodes.js';

const genders: Record<string, string> = { FEMALE: '여성', MALE: '남성', OTHER: '기타' };
const relationships: Record<string, string> = { LOVER: '연인', CRUSH: '썸', FRIEND: '친구', ONE_SIDED_LOVE: '짝사랑' };
function enumKey(labels: Record<string, string>, value: string | undefined, fallback: string) {
  if (value === undefined) return fallback;
  const key = Object.keys(labels).find(key => labels[key] === value || key === value.toUpperCase());
  if (!key) throw productError('INVALID_REQUEST');
  return key;
}
export function registerProductLibrary(app: FastifyInstance, context: ProductContext, chain?: MarketChain, packages?: PackageStore) {
  app.post('/api/library', async req => {
    const { userId, address } = await context.authenticate(req);
    const input = z.object({ listingId: z.string().regex(/^0x[0-9a-f]{64}$/), licenseId: z.string().regex(/^0x[0-9a-f]{64}$/) }).parse(req.body);
    let source;
    try {
      if (!chain || !packages) throw Error('Market unavailable');
      const listing = await requireMarketAccess(chain, address, input.listingId, input.licenseId);
      source = await packages.load(listing);
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 403) throw productError('FORBIDDEN_CHARACTER_ACCESS');
      throw productError(503);
    }
    if (source.network !== 'testnet' || source.listingId !== input.listingId) throw productError('INVALID_REQUEST');
    return withTransaction(context.db, async tx => {
      if (!(await tx.query('SELECT id FROM everyday.users WHERE id=$1 FOR UPDATE', [userId])).rows[0]) throw productError('USER_NOT_FOUND');
      const old = (await tx.query<{ character_id: string }>('SELECT character_id FROM everyday.licensed_characters WHERE license_id=$1', [input.licenseId])).rows[0];
      if (old) return ok(await characterResponse(tx, await context.ownedCharacter(userId, String(old.character_id), tx), true));
      const data = source.character;
      const gender = enumKey(genders, data.gender, 'OTHER');
      const relationship = enumKey(relationships, data.relationshipType, 'FRIEND');
      const styles = data.speechStyles ?? [];
      const prompt = buildSystemPrompt({ name: data.name, relationshipType: relationships[relationship], gender: genders[gender],
        summary: data.summary ?? '', appearance: data.appearance ?? '', personality: data.personality,
        speechStyles: styles, callName: null })
        + `\n[작품 배경]\n${data.background ?? ''}\n[작가가 작성한 예시 대화]\n${source.examples === undefined ? '' : JSON.stringify(source.examples)}`;
      const row = (await tx.query<CharacterRow>(`INSERT INTO everyday.characters
        (user_id,name,relationship_type,gender,summary,appearance,personality,system_prompt,profile_image_url,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now()) RETURNING *`,
        [userId, data.name, relationship, gender, data.summary ?? '', data.appearance ?? '', data.personality, prompt, data.imageUrl ?? null])).rows[0];
      for (const [index, style] of styles.entries()) await tx.query(
        'INSERT INTO everyday.character_speech_style(character_id,speech_style,style_order) VALUES($1,$2,$3)', [row.id, style, index]);
      await tx.query('INSERT INTO everyday.licensed_characters(character_id,listing_id,license_id,base_prompt) VALUES($1,$2,$3,$4)',
        [row.id, input.listingId, input.licenseId, prompt]);
      await importPackageEpisodes(tx, input.listingId, source.episodes);
      return ok(await characterResponse(tx, row, true));
    });
  });
  app.get('/api/library/:characterId/license', async req => {
    const identity = await context.authenticate(req);
    const characterId = productId((req.params as { characterId: string }).characterId);
    await context.ownedCharacter(identity.userId, characterId);
    const row = (await context.db.query<{ listingId: string; licenseId: string }>(
      'SELECT listing_id AS "listingId",license_id AS "licenseId" FROM everyday.licensed_characters WHERE character_id=$1', [characterId])).rows[0];
    return ok(row ?? null);
  });
}
