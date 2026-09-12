import type { FastifyInstance } from 'fastify';
import type { EpisodeItem, EpisodeStart } from '@everyday/contracts';
import type { Database } from '../database.js';
import { numericId, ok, productError, productId, withTransaction, type ProductContext } from './core.js';
import { chatInput, claimChatTurn, completedMessage, completeChatTurn, conversationContext, messageResponse, readMessages, releaseChatTurn, saveMessage } from './conversations.js';

interface EpisodeRow extends Record<string, unknown> {
  id: string; code: string; title: string; emoji: string | null; description: string; scene_prompt_seed: string | null;
}
interface CharacterEpisodeRow extends Record<string, unknown> { id: string; status: string }

const episodeResponse = (row: EpisodeRow): EpisodeItem => ({
  id: numericId(row.id), code: row.code, title: row.title, emoji: row.emoji, description: row.description,
});

/** Seed the same existing three templates only when the catalog is empty. */
export async function seedEpisodeCatalog(db: Database): Promise<void> {
  await withTransaction(db, async tx => {
    if ((await tx.query('SELECT id FROM everyday.episodes LIMIT 1')).rows.length) return;
    const templates = [
      ['FIRST_DATE', '첫 데이트', '☕', '카페에 마주앉은 두 사람, 어색한 침묵이 흐른다',
        '두 사람은 카페에 마주앉아 첫 데이트를 시작했다. 어색한 침묵이 흐르는 상황이다. 이 분위기를 캐릭터답게 자연스럽게 풀어나가.'],
      ['NIGHT_WALK', '밤 산책', '🌙', '밤 11시, 한강 공원. 시원한 바람이 불고 있다',
        '밤 11시 한강 공원을 함께 산책하는 상황이다. 시원한 바람이 불고 분위기가 편안하다. 이 상황에 맞게 대화를 이어가.'],
      ['AFTER_FIGHT', '싸운 다음 날', '🌧️', '어제 사소한 일로 다퉜다. 하루 종일 연락이 없었다',
        '어제 사소한 일로 다툰 다음 날이다. 하루 종일 연락이 없었던 상황이다. 서운함과 화해하고 싶은 마음이 섞인 캐릭터의 감정을 자연스럽게 표현해.'],
    ];
    for (const template of templates) await tx.query(`INSERT INTO everyday.episodes(code,title,emoji,description,scene_prompt_seed,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,now(),now()) ON CONFLICT(code) DO NOTHING`, template);
  });
}

export async function importPackageEpisodes(db: Database, listingId: string, episodes: { id: string; title: string; setting: string }[]): Promise<void> {
  for (const episode of episodes) {
    const code = listingId + ':' + episode.id;
    await db.query(`INSERT INTO everyday.episodes(code,title,description,scene_prompt_seed,created_at,updated_at)
      VALUES($1,$2,$3,$4,now(),now()) ON CONFLICT(code) DO NOTHING`, [code, episode.title, episode.setting.substring(0, 500), episode.setting]);
    const row = (await db.query('SELECT id FROM everyday.episodes WHERE code=$1', [code])).rows[0]!;
    await db.query(`INSERT INTO everyday.market_episode_templates(listing_id,package_episode_id,episode_id)
      VALUES($1,$2,$3) ON CONFLICT(listing_id,package_episode_id) DO NOTHING`, [listingId, episode.id, row.id]);
  }
}

async function episodeList(db: Database, characterId?: string): Promise<EpisodeItem[]> {
  if (characterId !== undefined) {
    const authored = await db.query<EpisodeRow>(`SELECT e.* FROM everyday.episodes e JOIN everyday.market_episode_templates t ON t.episode_id=e.id
      JOIN everyday.licensed_characters l ON l.listing_id=t.listing_id WHERE l.character_id=$1 ORDER BY e.id`, [characterId]);
    if (authored.rows.length) return authored.rows.map(episodeResponse);
  }
  return (await db.query<EpisodeRow>(`SELECT e.* FROM everyday.episodes e
    WHERE NOT EXISTS(SELECT 1 FROM everyday.market_episode_templates t WHERE t.episode_id=e.id) ORDER BY e.id`)).rows.map(episodeResponse);
}

async function requireEpisodeAccess(db: Database, characterId: string, episodeId: string): Promise<void> {
  const { rows } = await db.query(`SELECT NOT EXISTS(SELECT 1 FROM everyday.market_episode_templates WHERE episode_id=$1)
    OR EXISTS(SELECT 1 FROM everyday.market_episode_templates t JOIN everyday.licensed_characters l ON l.listing_id=t.listing_id
      WHERE t.episode_id=$1 AND l.character_id=$2) AS allowed`, [episodeId, characterId]);
  if (rows[0]?.allowed !== true) throw productError('FORBIDDEN_CHARACTER_ACCESS');
}

async function getEpisode(db: Database, episodeId: string): Promise<EpisodeRow> {
  const row = (await db.query<EpisodeRow>('SELECT * FROM everyday.episodes WHERE id=$1', [episodeId])).rows[0];
  if (!row) throw productError('EPISODE_NOT_FOUND');
  return row;
}

async function getCharacterEpisode(db: Database, characterId: string, episodeId: string): Promise<CharacterEpisodeRow> {
  await requireEpisodeAccess(db, characterId, episodeId);
  const row = (await db.query<CharacterEpisodeRow>('SELECT id,status FROM everyday.character_episodes WHERE character_id=$1 AND episode_id=$2', [characterId, episodeId])).rows[0];
  if (!row) throw productError('CHARACTER_EPISODE_NOT_FOUND');
  return row;
}

async function claimEpisodeStarters(db: Database, characterEpisodeId: string): Promise<string[] | null> {
  const inserted = await db.query(`INSERT INTO everyday.episode_starter_requests(character_episode_id,status)
    VALUES($1,'pending') ON CONFLICT(character_episode_id) DO NOTHING RETURNING character_episode_id`, [characterEpisodeId]);
  if (inserted.rows.length) return null;
  const row = (await db.query('SELECT status,starters FROM everyday.episode_starter_requests WHERE character_episode_id=$1', [characterEpisodeId])).rows[0];
  if (row?.status !== 'completed') throw productError(503);
  if (!Array.isArray(row.starters) || row.starters.some(item => typeof item !== 'string')) throw productError(500);
  return row.starters as string[];
}

export function parseEpisodeStarters(raw: string): string[] {
  let trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    trimmed = trimmed.replace(/^```[a-zA-Z]*\n/, '');
    if (trimmed.endsWith('```')) trimmed = trimmed.substring(0, trimmed.length - 3);
  }
  try {
    const value: unknown = JSON.parse(trimmed.trim());
    if (!Array.isArray(value) || value.length < 2 || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 500)) throw Error('Invalid generated starters');
    return value.slice(0, 2) as string[];
  } catch { return ['안녕, 오랜만이야.', '오늘 여기서 보니까 반갑다.']; }
}

export function registerProductEpisodes(app: FastifyInstance, ctx: ProductContext): void {
  app.get('/api/episodes', async req => {
    await ctx.authenticate(req);
    return ok(await episodeList(ctx.db));
  });
  app.get<{ Params: { characterId: string } }>('/api/characters/:characterId/episodes', async req => {
    const user = await ctx.authenticate(req);
    const id = productId(req.params.characterId);
    await ctx.ownedCharacter(user.userId, id);
    await ctx.requireAccess(req, id);
    return ok(await episodeList(ctx.db, id));
  });

  type Params = { characterId: string; episodeId: string };
  const prefix = '/api/characters/:characterId/episodes/:episodeId';
  app.post<{ Params: Params }>(prefix + '/start', async req => {
    const user = await ctx.authenticate(req);
    const id = productId(req.params.characterId), episodeId = productId(req.params.episodeId);
    const character = await ctx.ownedCharacter(user.userId, id);
    await ctx.requireAccess(req, id);
    await requireEpisodeAccess(ctx.db, id, episodeId);
    const episode = await getEpisode(ctx.db, episodeId);
    const current = await withTransaction(ctx.db, async tx => {
      await ctx.ownedCharacter(user.userId, id, tx, true);
      await tx.query(`INSERT INTO everyday.character_episodes(character_id,episode_id,status,created_at,updated_at)
        VALUES($1,$2,'IN_PROGRESS',now(),now()) ON CONFLICT(character_id,episode_id) DO NOTHING`, [id, episodeId]);
      return getCharacterEpisode(tx, id, episodeId);
    });
    let starters = await claimEpisodeStarters(ctx.db, String(current.id));
    if (starters === null) {
      let providerStarted = false;
      try {
        ctx.llm.requireConfigured();
        providerStarted = true;
        const raw = await ctx.llm.chat(
          '너는 사용자가 특정 상황극(에피소드)에서 캐릭터에게 먼저 건넬 수 있는 짧고 자연스러운\n한국어 대화 시작 문장을 추천해주는 도우미야. 반드시 아래 JSON 배열 형식으로만 응답하고\n그 외 텍스트는 포함하지 마라: ["문장1", "문장2"]\n',
          [{ role: 'user', content: '캐릭터 이름: ' + character.name + '\n에피소드 상황: ' + episode.description + '\n시나리오: ' + episode.scene_prompt_seed }],
        );
        starters = parseEpisodeStarters(raw);
        const { rows } = await ctx.db.query(`UPDATE everyday.episode_starter_requests SET status='completed',starters=$2::jsonb,updated_at=now()
          WHERE character_episode_id=$1 AND status='pending' RETURNING character_episode_id`, [current.id, JSON.stringify(starters)]);
        if (rows.length !== 1) throw productError(500);
      } catch (error) {
        if (!providerStarted) await ctx.db.query("DELETE FROM everyday.episode_starter_requests WHERE character_episode_id=$1 AND status='pending'", [current.id]);
        throw error;
      }
    }
    const response: EpisodeStart = { characterEpisodeId: numericId(current.id), title: episode.title, emoji: episode.emoji,
      description: episode.description, status: current.status, starters };
    return ok(response);
  });

  app.get<{ Params: Params }>(prefix + '/messages', async req => {
    const user = await ctx.authenticate(req);
    const id = productId(req.params.characterId), episodeId = productId(req.params.episodeId);
    await ctx.ownedCharacter(user.userId, id);
    await ctx.requireAccess(req, id);
    const current = await getCharacterEpisode(ctx.db, id, episodeId);
    return ok(await readMessages(ctx.db, id, String(current.id)));
  });

  app.post<{ Params: Params }>(prefix + '/messages', async req => {
    const user = await ctx.authenticate(req);
    const id = productId(req.params.characterId), episodeId = productId(req.params.episodeId);
    const { requestId, content } = chatInput(req.body);
    await ctx.ownedCharacter(user.userId, id);
    await ctx.requireAccess(req, id);
    const current = await getCharacterEpisode(ctx.db, id, episodeId);
    const currentId = String(current.id);
    const existing = await claimChatTurn(ctx.db, requestId, id, currentId, content);
    if (existing !== null) return ok(await completedMessage(ctx.db, existing));
    let providerStarted = false;
    try {
      return await withTransaction(ctx.db, async tx => {
        const character = await ctx.ownedCharacter(user.userId, id, tx, true);
        const episode = await getEpisode(tx, episodeId);
        await saveMessage(tx, id, currentId, 'USER', content);
        const context = await conversationContext(tx, id, currentId);
        const prompt = await ctx.withApprovedMemory(req, id,
          character.system_prompt + '\n\n[현재 에피소드 상황]\n' + episode.scene_prompt_seed, content, tx);
        ctx.llm.requireConfigured();
        providerStarted = true;
        const response = await ctx.llm.chat(prompt, context);
        const message = await saveMessage(tx, id, currentId, 'AI', response);
        await completeChatTurn(tx, requestId, String(message.id));
        return ok(messageResponse(message));
      });
    } catch (error) {
      if (!providerStarted) await releaseChatTurn(ctx.db, requestId);
      throw error;
    }
  });
}
