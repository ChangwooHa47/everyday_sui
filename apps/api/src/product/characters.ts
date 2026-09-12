import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CharacterDetail, CharacterSummary, CompileResult, InterviewAnswer, MyPage, ProductDraft } from '@everyday/contracts';
import type { Database } from '../database.js';
import { numericId, ok, productError, productId, withTransaction, type CharacterRow, type ProductContext } from './core.js';
import { buildSystemPrompt, examplePrompt, stripCodeFence, type CharacterPersona } from './llm.js';
import { enqueuePortrait, photoResponse } from './images.js';

const genderLabels = { FEMALE: '여성', MALE: '남성', OTHER: '기타' } as const;
const relationshipLabels = { LOVER: '연인', CRUSH: '썸', FRIEND: '친구', ONE_SIDED_LOVE: '짝사랑' } as const;
export function genderLabel(value: string) { return genderLabels[value as keyof typeof genderLabels] ?? value; }
export function relationshipLabel(value: string) { return relationshipLabels[value as keyof typeof relationshipLabels] ?? value; }
function enumValue<T extends Record<string, string>>(labels: T, value: string): keyof T & string {
  const found = Object.keys(labels).find(key => key.toLowerCase() === value.toLowerCase() || labels[key] === value);
  if (!found) throw productError('INVALID_REQUEST');
  return found;
}
function birthdayString(value: CharacterRow['birthday']): string | null {
  if (value === null) return null;
  // pg's DATE parser constructs local midnight; ISO conversion changes the calendar date in KST.
  return value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` : value.slice(0, 10);
}
export function characterAge(value: CharacterRow['birthday'], now = new Date()) {
  const birthday = birthdayString(value);
  if (!birthday) return 0;
  const [year, month, day] = birthday.split('-').map(Number);
  let age = now.getFullYear() - year;
  if (now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day)) age--;
  return age;
}
export async function speechStyles(db: Database, characterId: string) {
  return (await db.query<{ speech_style: string }>('SELECT speech_style FROM everyday.character_speech_style WHERE character_id=$1 ORDER BY style_order', [characterId])).rows.map(r => r.speech_style);
}
export async function authoredExamples(db: Database, characterId: string) {
  return (await db.query<{ role: 'user' | 'assistant'; content: string }>('SELECT role,content FROM everyday.character_examples WHERE character_id=$1 ORDER BY example_order', [characterId])).rows;
}
export async function characterPersona(db: Database, row: CharacterRow): Promise<CharacterPersona> {
  return { name: row.name, relationshipType: relationshipLabel(row.relationship_type), gender: genderLabel(row.gender), summary: row.summary,
    appearance: row.appearance, personality: row.personality, speechStyles: await speechStyles(db, row.id), callName: row.call_name };
}
export function summaryResponse(row: CharacterRow): CharacterSummary {
  return { id: numericId(row.id), name: row.name, age: characterAge(row.birthday), gender: genderLabel(row.gender),
    relationshipType: relationshipLabel(row.relationship_type), profileImageUrl: row.profile_image_url };
}
export async function characterResponse(db: Database, row: CharacterRow, readOnlySettings = false): Promise<CharacterDetail> {
  return { ...summaryResponse(row), birthday: birthdayString(row.birthday), summary: row.summary, appearance: row.appearance,
    personality: row.personality, speechStyles: await speechStyles(db, row.id), callName: row.call_name,
    soulTrained: row.soul_ready, readOnlySettings };
}

const nonblank = (max?: number) => (max === undefined ? z.string() : z.string().max(max)).refine(value => value.trim().length > 0);
const answerSchema = z.object({ category: nonblank(80), question: nonblank(1000), answer: nonblank(2000) });
const answersSchema = z.array(answerSchema).max(12).nullable().optional();
const interviewSchema = z.object({ relationshipType: nonblank(), gender: nonblank(), freeText: z.string().max(8000).nullable().optional(), previousAnswers: answersSchema });
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value <= birthdayString(new Date())!;
});
const compileSchema = z.object({ relationshipType: nonblank(), gender: nonblank(), freeText: z.string().max(8000).nullable().optional(),
  interviewAnswers: answersSchema, name: nonblank(80), birthday: localDateSchema.nullable().optional(),
  deferPortraitGeneration: z.boolean().nullable().optional(), requestId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).nullable().optional() });
const generatedSchema = z.object({ summary: z.string().max(500), appearance: z.string().max(4000), personality: z.string().max(4000),
  speechStyles: z.array(z.string().max(255)).max(20), imagePrompt: nonblank(8000),
  examples: z.array(z.object({ role: z.enum(['user', 'assistant']), content: nonblank(2000) })).max(12).nullable().optional() });
const interviewOutputSchema = z.object({ category: z.string().nullable().optional(), question: z.string().nullable().optional(),
  suggestedAnswers: z.array(z.string()).nullable().optional(), done: z.boolean().optional() });
const updateSchema = z.object({ appearance: z.string().max(4000).nullable().optional(), personality: z.string().max(4000).nullable().optional(),
  speechStyles: z.array(nonblank(255)).max(20).nullable().optional() });
function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw productError('INVALID_REQUEST');
  return result.data;
}
/** Retain the existing @Email contract, including local domains, quoted names and IDNs. */
export function validProfileEmail(value: string): boolean {
  if (!value) return true;
  const split = value.lastIndexOf('@');
  if (split < 0) return false;
  const local = value.slice(0, split), domain = value.slice(split + 1);
  const atom = "[a-z0-9!#$%&'*+/=?^_`{|}~\\u0080-\\uffff-]+";
  const quoted = '"(?:[a-z0-9!#$%&\'*.(),<>\\[\\]:; @+/=?^_`{|}~\\u0080-\\uffff-]|\\\\[\\\\"])+"';
  if (local.length > 64 || !new RegExp(`^(?:${atom}|${quoted})(?:\\.(?:${atom}|${quoted}))*$`, 'i').test(local)) return false;
  if (!domain || domain.endsWith('.')) return false;
  if (/^\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\]$/.test(domain)) return true;
  if (/^\[IPv6:/i.test(domain) && domain.endsWith(']')) return isIP(domain.slice(6, -1)) === 6;
  const labels = domain.split('.');
  const labelPattern = /^[a-z0-9!#$%&'*+/=?^_`{|}~\u0080-\uffff](?:[a-z0-9!#$%&'*+/=?^_`{|}~\u0080-\uffff-]*[a-z0-9!#$%&'*+/=?^_`{|}~\u0080-\uffff])?$/i;
  if (labels.some(label => !labelPattern.test(label))) return false;
  // ASCII punctuation accepted by the previous validator must not be interpreted as a URL path/query.
  const ascii = labels.map(label => /[^\x00-\x7f]/.test(label)
    ? domainToASCII(label.replace(/[!#$%&'*+/=?^_`{|}~]/g, 'a')) : label);
  return ascii.every(label => label.length > 0 && label.length <= 63) && ascii.join('.').length <= 255;
}
function routeCharacterId(req: FastifyRequest) { return productId((req.params as { characterId: string }).characterId); }
function formatAnswers(answers?: InterviewAnswer[] | null) {
  return answers?.length ? answers.map(a => `- [${a.category}] ${a.question} → ${a.answer}`).join('\n') : '(없음)';
}
const interviewPrompt = `너는 AI 캐릭터 생성 인터뷰어야. 사용자가 원하는 캐릭터상을 구체화하기 위해 짧은 질문을 던진다.
카테고리는 '외모', '분위기·스타일', '성격' 세 가지이며, 각 카테고리에서 최소 1개씩 답변을 받는 것이 목표다.
이미 받은 답변으로 각 카테고리가 1개 이상 커버되었거나 총 답변 수가 6개 이상이면 done=true로 응답하고
question/suggestedAnswers는 빈 값으로 둔다.
반드시 아래 JSON 형식으로만 응답하고 그 외 어떤 텍스트도 포함하지 마라:
{"category": "외모 또는 분위기·스타일 또는 성격", "question": "...", "suggestedAnswers": ["...","...","...","..."], "done": false}
`;
const compilePrompt = `너는 사용자가 입력한 정보를 바탕으로 AI 연애/우정 시뮬레이션 캐릭터의 설정을 완성하는 작가야.
반드시 아래 JSON 형식으로만 응답하고 그 외 텍스트는 포함하지 마라:
{"summary": "한 줄 소개(20자 내외)", "appearance": "외모 묘사 2~3문장",
 "personality": "성격 묘사 2~3문장", "speechStyles": ["말투 특징 3~5개"],
 "imagePrompt": "얼굴 프로필 사진 생성을 위한 영어 이미지 생성 프롬프트",
 "examples": [{"role":"user","content":"가상의 질문"},{"role":"assistant","content":"캐릭터다운 답변"}]}
examples에는 일상과 진지한 상황의 가상 대화 두 쌍을 작성해. 실제 사용자의 사적 경험이나 이름은 넣지 마.
`;

export function compileFingerprint(input: z.output<typeof compileSchema>) {
  // Jackson serializes the original record in this order, including absent nullable fields.
  return createHash('sha256').update(JSON.stringify({ relationshipType: input.relationshipType, gender: input.gender, freeText: input.freeText ?? null,
    interviewAnswers: input.interviewAnswers ?? null, name: input.name, birthday: input.birthday ?? null,
    deferPortraitGeneration: input.deferPortraitGeneration ?? false, requestId: input.requestId?.toLowerCase() ?? null })).digest('hex');
}
async function claimCompile(db: Database, userId: string, requestId: string | null | undefined, hash: string) {
  if (!requestId) return null;
  return withTransaction(db, async tx => {
    const inserted = await tx.query('INSERT INTO everyday.character_compile_requests(request_id,user_id,input_hash,status) VALUES($1,$2,$3,\'pending\') ON CONFLICT(request_id) DO NOTHING RETURNING request_id', [requestId, userId, hash]);
    if (inserted.rows.length) return null;
    const row = (await tx.query<{ user_id: string; input_hash: string; status: string; character_id: string | null }>('SELECT user_id,input_hash,status,character_id FROM everyday.character_compile_requests WHERE request_id=$1', [requestId])).rows[0];
    if (!row || String(row.user_id) !== userId || row.input_hash !== hash) throw productError(409);
    if (row.status !== 'completed') throw productError(503);
    return String(row.character_id);
  });
}
async function characterList(db: Database, userId: string) {
  return (await db.query<CharacterRow>('SELECT * FROM everyday.characters WHERE user_id=$1 ORDER BY id', [userId])).rows.map(summaryResponse);
}
async function myPage(db: Database, userId: string): Promise<MyPage> {
  const user = (await db.query<{ id: string; email: string | null }>('SELECT id,email FROM everyday.users WHERE id=$1', [userId])).rows[0];
  if (!user) throw productError('USER_NOT_FOUND');
  return { id: numericId(user.id), email: user.email ?? '', subscriptionTier: 'Free', characters: await characterList(db, userId) };
}

export function registerProductCharacters(app: FastifyInstance, ctx: ProductContext) {
  app.post('/api/characters/interview', async req => {
    await ctx.authenticate(req);
    const input = parse(interviewSchema, req.body);
    const context = `관계: ${input.relationshipType}\n성별: ${input.gender}\n자유 서술: ${input.freeText ?? '(없음)'}\n이전 답변:\n${formatAnswers(input.previousAnswers)}`;
    const raw = await ctx.llm.chat(interviewPrompt, [{ role: 'user', content: context }]);
    try {
      const output = interviewOutputSchema.parse(JSON.parse(stripCodeFence(raw)));
      return ok({ category: output.category ?? null, question: output.question ?? null, suggestedAnswers: output.suggestedAnswers ?? null, done: output.done ?? false });
    } catch { throw productError('LLM_API_ERROR'); }
  });
  app.post('/api/characters/compile', async req => {
    const { userId } = await ctx.authenticate(req);
    const input = parse(compileSchema, req.body);
    const relationship = enumValue(relationshipLabels, input.relationshipType);
    const gender = enumValue(genderLabels, input.gender);
    const existing = await claimCompile(ctx.db, userId, input.requestId, compileFingerprint(input));
    if (existing) {
      const character = await ctx.ownedCharacter(userId, existing);
      await ctx.requireAccess(req, existing);
      return ok({ character: await characterResponse(ctx.db, character), candidatePortraits: [] } satisfies CompileResult);
    }
    let providerStarted = false;
    try {
      return await withTransaction(ctx.db, async tx => {
        ctx.llm.requireConfigured();
        providerStarted = true;
        const context = `이름: ${input.name}\n관계: ${relationshipLabels[relationship]}\n성별: ${genderLabels[gender]}\n자유 서술: ${input.freeText ?? '(없음)'}\n인터뷰 답변:\n${formatAnswers(input.interviewAnswers)}`;
        const raw = await ctx.llm.chat(compilePrompt, [{ role: 'user', content: context }]);
        let compiled: z.output<typeof generatedSchema>;
        try { compiled = generatedSchema.parse(JSON.parse(stripCodeFence(raw))); } catch { throw productError('LLM_API_ERROR'); }
        const examples = compiled.examples ?? [];
        const prompt = buildSystemPrompt({ name: input.name, relationshipType: relationshipLabels[relationship], gender: genderLabels[gender],
          summary: compiled.summary, appearance: compiled.appearance, personality: compiled.personality, speechStyles: compiled.speechStyles, callName: null }) + examplePrompt(examples);
        const character = (await tx.query<CharacterRow>(`INSERT INTO everyday.characters(user_id,name,birthday,relationship_type,gender,summary,appearance,personality,system_prompt,image_prompt,soul_ready,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,now(),now()) RETURNING *`,
          [userId, input.name, input.birthday ?? null, relationship, gender, compiled.summary, compiled.appearance, compiled.personality, prompt, compiled.imagePrompt])).rows[0];
        for (const [i, style] of compiled.speechStyles.entries()) await tx.query('INSERT INTO everyday.character_speech_style(character_id,speech_style,style_order) VALUES($1,$2,$3)', [character.id, style, i]);
        for (const [i, example] of examples.entries()) await tx.query('INSERT INTO everyday.character_examples(character_id,example_order,role,content) VALUES($1,$2,$3,$4)', [character.id, i, example.role, example.content]);
        await enqueuePortrait(tx, String(character.id), compiled.imagePrompt, 4, input.deferPortraitGeneration ?? false);
        if (input.requestId) {
          const completed = await tx.query("UPDATE everyday.character_compile_requests SET status='completed',character_id=$1,updated_at=now() WHERE request_id=$2 AND status='pending' RETURNING request_id", [character.id, input.requestId]);
          if (completed.rows.length !== 1) throw Error('Missing compile claim');
        }
        return ok({ character: await characterResponse(tx, character), candidatePortraits: [] } satisfies CompileResult);
      });
    } catch (error) {
      if (!providerStarted && input.requestId) await ctx.db.query("DELETE FROM everyday.character_compile_requests WHERE request_id=$1 AND status='pending'", [input.requestId]);
      throw error;
    }
  });
  app.get('/api/characters', async req => ok(await characterList(ctx.db, (await ctx.authenticate(req)).userId)));
  app.get('/api/characters/:characterId', async req => {
    const { userId } = await ctx.authenticate(req), id = routeCharacterId(req);
    const row = await ctx.ownedCharacter(userId, id);
    await ctx.requireAccess(req, id);
    return ok(await characterResponse(ctx.db, row, await ctx.isLicensed(id)));
  });
  app.get('/api/characters/:characterId/product-draft', async req => {
    const { userId } = await ctx.authenticate(req), id = routeCharacterId(req);
    const row = await ctx.ownedCharacter(userId, id);
    await ctx.requireAccess(req, id); await ctx.requireEditable(id);
    return ok({ name: row.name, personality: row.personality, summary: row.summary, appearance: row.appearance,
      speechStyles: await speechStyles(ctx.db, id), imageUrl: row.profile_image_url, examples: await authoredExamples(ctx.db, id),
      gender: genderLabel(row.gender), relationshipType: relationshipLabel(row.relationship_type) } as ProductDraft);
  });
  app.patch('/api/characters/:characterId', async req => {
    const { userId } = await ctx.authenticate(req), id = routeCharacterId(req);
    const input = parse(updateSchema, req.body);
    await ctx.ownedCharacter(userId, id); await ctx.requireAccess(req, id); await ctx.requireEditable(id);
    return withTransaction(ctx.db, async tx => {
      const row = await ctx.ownedCharacter(userId, id, tx, true);
      await ctx.requireEditable(id, tx);
      const persona = await characterPersona(tx, row);
      persona.appearance = input.appearance ?? persona.appearance;
      persona.personality = input.personality ?? persona.personality;
      persona.speechStyles = input.speechStyles ?? persona.speechStyles;
      const prompt = buildSystemPrompt(persona) + examplePrompt(await authoredExamples(tx, id));
      const updated = (await tx.query<CharacterRow>('UPDATE everyday.characters SET appearance=$1,personality=$2,system_prompt=$3,version=version+1,updated_at=now() WHERE id=$4 RETURNING *', [persona.appearance, persona.personality, prompt, id])).rows[0];
      if (input.speechStyles != null) {
        await tx.query('DELETE FROM everyday.character_speech_style WHERE character_id=$1', [id]);
        for (const [i, style] of input.speechStyles.entries()) await tx.query('INSERT INTO everyday.character_speech_style(character_id,speech_style,style_order) VALUES($1,$2,$3)', [id, style, i]);
      }
      return ok(await characterResponse(tx, updated));
    });
  });
  app.patch('/api/characters/:characterId/call-name', async req => {
    const { userId } = await ctx.authenticate(req), id = routeCharacterId(req);
    const { callName } = parse(z.object({ callName: nonblank() }), req.body);
    await ctx.ownedCharacter(userId, id); await ctx.requireAccess(req, id);
    return withTransaction(ctx.db, async tx => {
      const row = await ctx.ownedCharacter(userId, id, tx, true);
      const persona = await characterPersona(tx, row); persona.callName = callName;
      const fallback = buildSystemPrompt(persona) + examplePrompt(await authoredExamples(tx, id));
      const prompt = await ctx.personalizedPrompt(id, fallback, callName, tx);
      const updated = (await tx.query<CharacterRow>('UPDATE everyday.characters SET call_name=$1,system_prompt=$2,version=version+1,updated_at=now() WHERE id=$3 RETURNING *', [callName, prompt, id])).rows[0];
      return ok(await characterResponse(tx, updated, await ctx.isLicensed(id, tx)));
    });
  });
  app.post('/api/characters/:characterId/select-portrait', async req => {
    const { userId } = await ctx.authenticate(req), id = routeCharacterId(req);
    const { photoId } = parse(z.object({ photoId: z.number().int().safe() }), req.body);
    await ctx.ownedCharacter(userId, id); await ctx.requireAccess(req, id); await ctx.requireEditable(id);
    return withTransaction(ctx.db, async tx => {
      await ctx.ownedCharacter(userId, id, tx, true); await ctx.requireEditable(id, tx);
      const photo = (await tx.query<{ image_url: string }>('SELECT image_url FROM everyday.photos WHERE id=$1 AND character_id=$2', [photoId, id])).rows[0];
      if (!photo) throw productError('PHOTO_NOT_FOUND');
      await tx.query("UPDATE everyday.photos SET selected=false,updated_at=now() WHERE character_id=$1 AND type='PROFILE'", [id]);
      await tx.query('UPDATE everyday.photos SET selected=true,updated_at=now() WHERE id=$1', [photoId]);
      const updated = (await tx.query<CharacterRow>('UPDATE everyday.characters SET profile_image_url=$1,version=version+1,updated_at=now() WHERE id=$2 RETURNING *', [photo.image_url, id])).rows[0];
      return ok(await characterResponse(tx, updated));
    });
  });
  app.get('/api/characters/:characterId/gallery', async req => {
    const { userId } = await ctx.authenticate(req), id = routeCharacterId(req);
    await ctx.ownedCharacter(userId, id); await ctx.requireAccess(req, id);
    return ok((await ctx.db.query<Parameters<typeof photoResponse>[0]>('SELECT * FROM everyday.photos WHERE character_id=$1 ORDER BY id', [id])).rows.map(photoResponse));
  });
  app.get('/api/me', async req => ok(await myPage(ctx.db, (await ctx.authenticate(req)).userId)));
  app.patch('/api/me', async req => {
    const { userId } = await ctx.authenticate(req);
    const { email } = parse(z.object({ email: z.string().refine(validProfileEmail).nullable().optional() }), req.body);
    try {
      return await withTransaction(ctx.db, async tx => {
        if (email?.trim()) {
          const duplicate = (await tx.query('SELECT id FROM everyday.users WHERE email=$1 AND id<>$2', [email, userId])).rows.length;
          if (duplicate) throw productError(409, '이미 가입된 이메일입니다.');
          await tx.query('UPDATE everyday.users SET email=$1,version=version+1,updated_at=now() WHERE id=$2 AND email IS DISTINCT FROM $1', [email, userId]);
        }
        return ok(await myPage(tx, userId));
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw productError(409, '이미 가입된 이메일입니다.');
      throw error;
    }
  });
}
