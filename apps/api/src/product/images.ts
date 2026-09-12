import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { PhotoItem, PhotoJob } from '@everyday/contracts';
import type { Database } from '../database.js';
import { numericId, ok, productError, productId, withTransaction, type CharacterRow, type ProductContext } from './core.js';
import { characterResponse } from './characters.js';
import { photoMood } from './conversations.js';

const photoConcepts = [
  { code: 'CAFE_DATE', label: '카페 데이트', hint: '따뜻한 조명의 카페에서 다정하게 마주앉은 모습' },
  { code: 'NIGHT_WALK', label: '밤 산책', hint: '밤에 가로등이 켜진 산책로를 함께 걷는 모습' },
  { code: 'PHOTO_STRIP', label: '인생네컷', hint: '네컷 사진 부스 스타일의 밝고 장난스러운 표정' },
  { code: 'CUSTOM', label: '직접 만들기', hint: null },
] as const;
const photoInput = z.object({ concept: z.string().max(80).nullish(), customPrompt: z.string().max(4000).nullish() });
const requestIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).transform(value => value.toLowerCase());
type PhotoInput = z.infer<typeof photoInput>;
interface PhotoPlan { context: string; reference: string | null; concept: string; soulId: string | null; }
interface PhotoRow extends Record<string, unknown> {
  id: string | number; image_url: string; concept: string | null; type: PhotoItem['type']; selected: boolean;
}
export function photoResponse(row: PhotoRow): PhotoItem {
  return { id: numericId(row.id), imageUrl: row.image_url, concept: row.concept, type: row.type, selected: row.selected };
}
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const characterId = (req: FastifyRequest) => productId((req.params as { characterId: string }).characterId);

export async function enqueuePortrait(db: Database, id: string, prompt: string, count: number, deferred: boolean) {
  await db.query(`INSERT INTO everyday.portrait_jobs(character_id,image_prompt,image_count,status) VALUES($1,$2,$3,$4)`,
    [id, prompt, count, deferred ? 'draft' : 'pending']);
}
export async function startPortrait(db: Database, id: string, prompt: string) {
  const { rows } = await db.query(`UPDATE everyday.portrait_jobs SET image_prompt=$2,status='pending',updated_at=now()
    WHERE character_id=$1 AND status='draft' RETURNING character_id`, [id, prompt]);
  if (rows.length === 0) {
    const { rows: existing } = await db.query<{ image_prompt: string }>('SELECT image_prompt FROM everyday.portrait_jobs WHERE character_id=$1', [id]);
    if (existing[0]?.image_prompt !== prompt) throw productError(409);
  }
}
export async function portraitStatus(db: Database, id: string) {
  const { rows } = await db.query<{ status: string }>('SELECT status FROM everyday.portrait_jobs WHERE character_id=$1', [id]);
  return rows[0]?.status ?? 'completed';
}
export async function claimSoulTraining(db: Database, id: string, reference: string): Promise<string | null> {
  return withTransaction(db, async tx => {
    const fingerprint = sha(reference);
    const { rows } = await tx.query(`INSERT INTO everyday.soul_training_requests(character_id,input_hash,status)
      VALUES($1,$2,'pending') ON CONFLICT(character_id) DO NOTHING RETURNING character_id`, [id, fingerprint]);
    if (rows.length > 0) return null;
    const { rows: existing } = await tx.query<{ input_hash: string; status: string; soul_id: string | null }>(`
      SELECT r.input_hash,r.status,c.soul_id FROM everyday.soul_training_requests r
      JOIN everyday.characters c ON c.id=r.character_id WHERE r.character_id=$1`, [id]);
    if (existing[0]?.input_hash !== fingerprint) throw productError(409);
    if (existing[0].status !== 'completed' || existing[0].soul_id === null) throw productError(503);
    return existing[0].soul_id;
  });
}
export async function completeSoulTraining(db: Database, id: string) {
  const { rows } = await db.query(`UPDATE everyday.soul_training_requests SET status='completed',updated_at=now()
    WHERE character_id=$1 AND status='pending' RETURNING character_id`, [id]);
  if (rows.length !== 1) throw productError(500);
}

async function planPhoto(ctx: ProductContext, req: FastifyRequest, db: Database, owner: string, id: string, input: PhotoInput): Promise<PhotoPlan> {
  const character = await ctx.ownedCharacter(owner, id, db);
  await ctx.requireAccess(req, id, db);
  const concept = photoConcepts.find(item => item.code === input.concept?.toUpperCase() || item.label === input.concept) ?? photoConcepts[3];
  if (concept.code === 'CUSTOM' && !input.customPrompt?.trim()) throw productError('INVALID_REQUEST');
  let soulId = character.soul_id;
  if (soulId !== null && !character.soul_ready && !await ctx.image.soulReady(soulId)) soulId = null;
  let context = `캐릭터 외모: ${character.appearance}\n`;
  if (concept.code !== 'CUSTOM') context += `컨셉: ${concept.label} - ${concept.hint}\n`;
  if (input.customPrompt?.trim()) context += `추가 요청: ${input.customPrompt}\n`;
  const mood = await photoMood(db, id);
  if (mood.trim()) context += `최근 대화 분위기: ${mood}\n`;
  return { context, reference: character.profile_image_url, concept: concept.label, soulId };
}
export async function photoJobStatus(db: Database, owner: string, request: string): Promise<PhotoJob> {
  const { rows } = await db.query<{ status: PhotoJob['status']; id: string | null; image_url: string; concept: string; points: number }>(`
    SELECT j.status,p.id,p.image_url,p.concept,u.points FROM everyday.photo_jobs j
    JOIN everyday.users u ON u.id=j.user_id LEFT JOIN everyday.photos p ON p.id=j.photo_id
    WHERE j.request_id=$1 AND j.user_id=$2`, [request, owner]);
  const row = rows[0];
  if (!row) throw productError('PHOTO_NOT_FOUND');
  return { requestId: request, status: row.status,
    photo: row.id === null ? null : photoResponse({ ...row, id: row.id, type: 'PHOTOBOOTH', selected: false }), remainingPoints: row.points };
}
async function enqueuePhoto(ctx: ProductContext, req: FastifyRequest, owner: string, id: string, request: string, input: PhotoInput) {
  // Preserve ObjectMapper's record field order and explicit nulls for existing request hashes.
  const fingerprint = sha(JSON.stringify([numericId(id), { concept: input.concept ?? null, customPrompt: input.customPrompt ?? null }]));
  return withTransaction(ctx.db, async tx => {
    await tx.query('SELECT id FROM everyday.users WHERE id=$1 FOR UPDATE', [owner]);
    const { rows } = await tx.query<{ user_id: string; input_hash: string }>(
      'SELECT user_id,input_hash FROM everyday.photo_jobs WHERE request_id=$1', [request]);
    if (rows[0]) {
      if (String(rows[0].user_id) !== owner || rows[0].input_hash !== fingerprint) throw productError(409);
      return photoJobStatus(tx, owner, request);
    }
    const plan = await planPhoto(ctx, req, tx, owner, id, input);
    const { rows: reserved } = await tx.query(`UPDATE everyday.users SET points=points-1200,version=version+1
      WHERE id=$1 AND points>=1200 RETURNING id`, [owner]);
    if (reserved.length !== 1) throw productError('INSUFFICIENT_POINTS');
    await tx.query(`INSERT INTO everyday.photo_jobs(request_id,user_id,character_id,input_hash,context,reference_url,concept,soul_id,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending')`, [request, owner, id, fingerprint, plan.context, plan.reference, plan.concept, plan.soulId]);
    return photoJobStatus(tx, owner, request);
  });
}

export function registerProductImages(app: FastifyInstance, ctx: ProductContext) {
  app.get('/api/photo/concepts', async req => {
    await ctx.authenticate(req);
    return ok(photoConcepts.map(({ code, label }) => ({ code, label })));
  });
  app.post('/api/characters/:characterId/photo-jobs', async req => {
    const owner = await ctx.authenticate(req);
    const input = z.object({ requestId: requestIdSchema, photo: photoInput }).parse(req.body);
    return ok(await enqueuePhoto(ctx, req, owner.userId, characterId(req), input.requestId, input.photo));
  });
  app.get('/api/photo-jobs/:requestId', async req => {
    const owner = await ctx.authenticate(req);
    const request = requestIdSchema.parse((req.params as { requestId: string }).requestId);
    return ok(await photoJobStatus(ctx.db, owner.userId, request));
  });
  app.get('/api/characters/:characterId/portrait-status', async req => {
    const owner = await ctx.authenticate(req); const id = characterId(req);
    await ctx.ownedCharacter(owner.userId, id); await ctx.requireAccess(req, id);
    return ok({ status: await portraitStatus(ctx.db, id) });
  });
  app.post('/api/characters/:characterId/portraits', async req => {
    const owner = await ctx.authenticate(req); const id = characterId(req);
    const { style } = z.object({ style: z.string().max(1000).nullish() }).parse(req.body);
    return withTransaction(ctx.db, async tx => {
      const character = await ctx.ownedCharacter(owner.userId, id, tx);
      await ctx.requireAccess(req, id, tx); await ctx.requireEditable(id, tx);
      await startPortrait(tx, id, `${character.image_prompt}${style?.trim() ? `\nRequested expression, atmosphere and scene: ${style}` : ''}`);
      return ok({ status: await portraitStatus(tx, id) });
    });
  });
  app.post('/api/characters/:characterId/train-face', async req => {
    const owner = await ctx.authenticate(req); const id = characterId(req);
    const character = await ctx.ownedCharacter(owner.userId, id);
    await ctx.requireAccess(req, id); await ctx.requireEditable(id);
    if (character.profile_image_url === null) throw productError('INVALID_REQUEST', '대표 프로필 사진을 먼저 선택해야 합니다.');
    ctx.image.requireConfigured();
    if (character.soul_id === null && await claimSoulTraining(ctx.db, id, character.profile_image_url) === null) {
      // The durable claim precedes the paid submission; uncertain submissions cannot be repeated.
      const soulId = await ctx.image.trainSoul(character.profile_image_url);
      return withTransaction(ctx.db, async tx => {
        await ctx.ownedCharacter(owner.userId, id, tx, true);
        const { rows } = await tx.query<CharacterRow>(`UPDATE everyday.characters SET soul_id=$2,soul_ready=false,
          version=version+1,updated_at=now() WHERE id=$1 RETURNING *`, [id, soulId]);
        await completeSoulTraining(tx, id);
        return ok(await characterResponse(tx, rows[0]!));
      });
    }
    return withTransaction(ctx.db, async tx => {
      let character = await ctx.ownedCharacter(owner.userId, id, tx, true);
      if (!character.soul_ready) {
        const ready = await ctx.image.soulReady(character.soul_id!);
        const { rows } = await tx.query<CharacterRow>(`UPDATE everyday.characters SET soul_ready=$2,version=version+1,
          updated_at=now() WHERE id=$1 RETURNING *`, [id, ready]);
        character = rows[0]!;
      }
      return ok(await characterResponse(tx, character));
    });
  });
}

export async function failPhotoJob(db: Database, request: string) {
  await withTransaction(db, async tx => {
    const { rows } = await tx.query<{ user_id: string }>(`UPDATE everyday.photo_jobs SET status='failed',context='',updated_at=now()
      WHERE request_id=$1 AND status='running' RETURNING user_id`, [request]);
    for (const row of rows) await tx.query('UPDATE everyday.users SET points=points+1200,version=version+1 WHERE id=$1', [row.user_id]);
  });
}
export async function processPhotoJobs(ctx: Pick<ProductContext, 'db' | 'llm' | 'image'>) {
  const { rows: stale } = await ctx.db.query<{ request_id: string }>(`SELECT request_id FROM everyday.photo_jobs
    WHERE status='running' AND updated_at<now()-interval '30 minutes'`);
  for (const row of stale) await failPhotoJob(ctx.db, row.request_id);
  const { rows } = await ctx.db.query<{ request_id: string; character_id: string; context: string; reference_url: string | null; concept: string; soul_id: string | null }>(`
    UPDATE everyday.photo_jobs SET status='running',updated_at=now()
    WHERE request_id=(SELECT request_id FROM everyday.photo_jobs WHERE status='pending'
      ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING request_id,character_id,context,reference_url,concept,soul_id`);
  const job = rows[0]; if (!job) return;
  try {
    const prompt = (await ctx.llm.chat(`너는 캐릭터 사진 생성을 위한 이미지 프롬프트 작가야. 캐릭터의 외모와 상황 설명을 바탕으로
이미지 생성 모델에 바로 사용할 수 있는 영어 프롬프트 한 문단을 작성해. JSON이나 다른 텍스트 없이
프롬프트 문장만 응답해.
`, [{ role: 'user', content: job.context }])).trim();
    const urls = await ctx.image.generateImages(prompt, job.reference_url, 1, job.soul_id);
    if (urls.length !== 1) throw productError('IMAGE_API_ERROR');
    await withTransaction(ctx.db, async tx => {
      const { rows: states } = await tx.query<{ status: string }>('SELECT status FROM everyday.photo_jobs WHERE request_id=$1 FOR UPDATE', [job.request_id]);
      if (states[0]?.status !== 'running') return;
      const { rows: photos } = await tx.query<{ id: string }>(`INSERT INTO everyday.photos(character_id,type,concept,prompt_text,image_url,selected,created_at,updated_at)
        VALUES($1,'PHOTOBOOTH',$2,$3,$4,false,now(),now()) RETURNING id`, [job.character_id, job.concept, prompt, urls[0]]);
      await tx.query(`UPDATE everyday.photo_jobs SET status='completed',photo_id=$2,context='',updated_at=now()
        WHERE request_id=$1`, [job.request_id, photos[0]!.id]);
    });
  } catch { await failPhotoJob(ctx.db, job.request_id); }
}
export async function processPortraitJobs(ctx: Pick<ProductContext, 'db' | 'image'>) {
  await ctx.db.query(`UPDATE everyday.portrait_jobs SET status='unknown',updated_at=now()
    WHERE status='running' AND updated_at<now()-interval '30 minutes'`);
  const { rows } = await ctx.db.query<{ character_id: string; image_prompt: string; image_count: number }>(`
    UPDATE everyday.portrait_jobs SET status='running',updated_at=now()
    WHERE character_id=(SELECT character_id FROM everyday.portrait_jobs WHERE status='pending'
      ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING character_id,image_prompt,image_count`);
  const job = rows[0]; if (!job) return;
  try {
    const urls = await ctx.image.generateImages(job.image_prompt, null, job.image_count);
    if (urls.length !== job.image_count) throw productError('IMAGE_API_ERROR');
    await withTransaction(ctx.db, async tx => {
      const { rows: states } = await tx.query<{ status: string }>('SELECT status FROM everyday.portrait_jobs WHERE character_id=$1 FOR UPDATE', [job.character_id]);
      if (states[0]?.status !== 'running') return;
      for (const url of urls) await tx.query(`INSERT INTO everyday.photos(character_id,type,prompt_text,image_url,selected,created_at,updated_at)
        VALUES($1,'PROFILE',$2,$3,false,now(),now())`, [job.character_id, job.image_prompt, url]);
      await tx.query(`UPDATE everyday.portrait_jobs SET status='completed',updated_at=now() WHERE character_id=$1`, [job.character_id]);
    });
  } catch {
    await ctx.db.query(`UPDATE everyday.portrait_jobs SET status='unknown',updated_at=now() WHERE character_id=$1 AND status='running'`, [job.character_id]);
  }
}

/** Two serial workers mirror the two existing Spring scheduler threads. */
export function startProductImageWorkers(ctx: Pick<ProductContext, 'db' | 'image' | 'llm'>, onError: (error: unknown) => void,
  pollMs = 2000, drainMs = 20_000, cancelGraceMs = 5000) {
  let stopped = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const running = new Set<Promise<void>>();
  const schedule = (process: () => Promise<void>) => {
    if (stopped) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      const task = process().catch(onError).finally(() => { running.delete(task); schedule(process); });
      running.add(task);
    }, pollMs);
    timer.unref(); timers.add(timer);
  };
  schedule(() => processPhotoJobs(ctx)); schedule(() => processPortraitJobs(ctx));
  return async () => {
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
    const settled = Promise.allSettled([...running]);
    const drain = async (timeout: number) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([settled.then(() => true), new Promise<false>(resolve => {
        timer = setTimeout(() => resolve(false), timeout);
      })]); } finally { if (timer) clearTimeout(timer); }
    };
    if (await drain(drainMs)) return;
    // A canceled/uncertain paid request is failed or unknown by the existing queue transitions.
    // It is never put back in pending. The database remains available during this final drain.
    ctx.image.cancel?.(); ctx.llm.cancel?.();
    if (!await drain(cancelGraceMs)) throw Error('Product image workers did not finish during shutdown');
  };
}
