import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { migration } from '../src/database.js';
import type { MemoryProvider } from '../src/memory-provider.js';
import type { ProductLlm } from '../src/product/core.js';
import { migrateProduct } from '../src/product/migrations.js';
import { saveMessage } from '../src/product/conversations.js';
import {
  activeRecalledMemories,
  activeRecalledRelationshipMemories,
  enqueueAutomaticMemoryExtraction,
  processAutomaticMemoryExtraction,
  processAutomaticMemoryReceipt,
  processAutomaticMemorySubmission,
  recoverAutomaticMemoryLeases,
} from '../src/product/automatic-memory.js';

const address = (digit: string) => `0x${digit.repeat(64)}`;

test('automatic long-term memory is opted-in, mapped, receipted and superseded without UI state', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(migration); await migrateProduct(db);
  const owner = address('a'), otherOwner = address('b'), listing = address('c'), license = address('d');
  await db.query(`INSERT INTO everyday.users(id,wallet_address,points) VALUES(1,$1,0),(2,$2,0)`, [owner, otherOwner]);
  await db.query(`INSERT INTO everyday.characters(id,user_id,name,relationship_type,gender,system_prompt)
    VALUES(1,1,'mine','FRIEND','OTHER','persona'),(2,2,'other','FRIEND','OTHER','persona'),
      (3,1,'unlicensed','FRIEND','OTHER','persona')`);
  await db.query(`INSERT INTO everyday.licensed_characters(character_id,listing_id,license_id,base_prompt)
    VALUES(1,$1,$2,'persona')`, [listing, license]);

  async function chatTurn(user: string, assistant: string) {
    const userMessage = await saveMessage(db, '1', null, 'USER', user);
    const aiMessage = await saveMessage(db, '1', null, 'AI', assistant);
    await enqueueAutomaticMemoryExtraction(db, '1', '1', userMessage.id, aiMessage.id);
    return { userMessage, aiMessage };
  }

  await chatTurn('나는 라떼를 좋아해', '기억해둘게');
  assert.equal((await db.query('SELECT * FROM everyday.automatic_memory_extractions')).rows.length, 0,
    'a private memory account is the one-time opt-in boundary');
  await db.query(`INSERT INTO memory_accounts(owner,account_id,enabled,auto_store) VALUES($1,$2,true,false)`, [owner, address('e')]);
  await chatTurn('나는 차를 좋아해', '알겠어');
  assert.equal((await db.query('SELECT * FROM everyday.automatic_memory_extractions')).rows.length, 0,
    'a connected account does not imply automatic storage until opt-in');
  await db.query('UPDATE memory_accounts SET auto_store=true WHERE owner=$1', [owner]);
  const localUserMessage = await saveMessage(db, '3', null, 'USER', '로컬 캐릭터 대화');
  const localAiMessage = await saveMessage(db, '3', null, 'AI', '로컬 캐릭터 응답');
  await enqueueAutomaticMemoryExtraction(db, '1', '3', localUserMessage.id, localAiMessage.id);
  assert.equal((await db.query('SELECT * FROM everyday.automatic_memory_extractions')).rows.length, 0,
    'a character without a Listing has no MemWal namespace and is never mixed into another relationship');

  let output: unknown = { candidates: [{ kind: 'promise', summary: '사용자와 캐릭터는 나중에 함께 사진을 찍기로 했다.',
    confidence: 96, eventDate: null, promiseStatus: 'planned', supersedesId: null }] };
  const extractionInputs: string[] = [];
  const llm: ProductLlm = { requireConfigured() {}, async chat(_system, messages) {
    extractionInputs.push(messages[0]!.content); return JSON.stringify(output);
  } };
  const submissions: { owner: string; account: string; listing: string; text: string; request: string }[] = [];
  let job = 0;
  const statusChecks = new Map<string, number>();
  const memory: MemoryProvider = {
    async setup() { throw Error('unused'); }, async verify() {},
    async remember(actualOwner, account, actualListing, text, request) {
      submissions.push({ owner: actualOwner, account, listing: actualListing, text, request });
      return { job_id: `job-${++job}`, status: 'running' };
    },
    async status(_owner, _account, _listing, jobId) {
      const checked = statusChecks.get(jobId) ?? 0; statusChecks.set(jobId, checked + 1);
      if (checked === 0) return { job_id: jobId, status: 'running' };
      return { job_id: jobId, status: 'done', blob_id: 'z'.repeat(43) };
    },
    async recall() { return { results: [], total: 0 }; },
  };

  const first = await chatTurn('우리 나중에 같이 사진 찍자', '좋아, 꼭 같이 찍자');
  assert.equal(await processAutomaticMemoryExtraction(db, llm, { dailyLimit: 50, globalDailyLimit: 100 }), true);
  let records = (await db.query<{ id: string; status: string; source_user_message_id: string; source_ai_message_id: string }>(
    'SELECT id,status,source_user_message_id,source_ai_message_id FROM everyday.automatic_memories')).rows;
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'pending');
  assert.equal(String(records[0].source_user_message_id), String(first.userMessage.id));
  assert.equal(String(records[0].source_ai_message_id), String(first.aiMessage.id));
  const firstId = records[0].id;
  assert.equal((await db.query('SELECT * FROM everyday.relationship_events')).rows.length, 0,
    'an extracted or submitted memory is not a confirmed relationship event');

  assert.equal(await processAutomaticMemorySubmission(db, memory), true);
  assert.deepEqual(submissions.map(item => ({ owner: item.owner, account: item.account, listing: item.listing })),
    [{ owner, account: address('e'), listing }]);
  assert.match(submissions[0].text, new RegExp(`dear-mine-memory id=${firstId}`));
  assert.ok(!submissions[0].text.includes(first.userMessage.content), 'only the mapped summary is sent to long-term memory');
  assert.equal(await processAutomaticMemoryReceipt(db, memory), true);
  assert.equal((await db.query<{ status: string }>('SELECT status FROM everyday.automatic_memories WHERE id=$1', [firstId])).rows[0].status, 'submitted');
  assert.equal((await db.query('SELECT * FROM everyday.relationship_events')).rows.length, 0);
  assert.equal(await processAutomaticMemoryReceipt(db, memory), true);
  records = (await db.query('SELECT id,status,source_user_message_id,source_ai_message_id FROM everyday.automatic_memories')).rows as typeof records;
  assert.equal(records[0].status, 'stored');
  assert.equal((await db.query('SELECT * FROM everyday.relationship_events')).rows.length, 1);

  output = { candidates: [{ kind: 'promise', summary: '사용자와 캐릭터의 사진 약속은 취소되었다.',
    confidence: 99, eventDate: null, promiseStatus: 'cancelled', supersedesId: firstId }] };
  await chatTurn('아까 사진 찍자는 약속은 취소하자', '알겠어, 취소할게');
  assert.equal(await processAutomaticMemoryExtraction(db, llm, { dailyLimit: 50, globalDailyLimit: 100 }), true);
  assert.match(extractionInputs.at(-1)!, new RegExp(firstId), 'the extractor receives only this character’s active mapped memories');
  await processAutomaticMemorySubmission(db, memory);
  await processAutomaticMemoryReceipt(db, memory); await processAutomaticMemoryReceipt(db, memory);
  const mapped = await db.query<{ id: string; status: string; promise_status: string }>(
    'SELECT id,status,promise_status FROM everyday.automatic_memories ORDER BY created_at,id');
  assert.deepEqual(mapped.rows.map(row => row.status).sort(), ['stored', 'superseded']);
  const replacement = mapped.rows.find(row => row.status === 'stored')!;
  assert.equal(replacement.promise_status, 'cancelled');
  assert.deepEqual(await activeRecalledMemories(db, '1', [
    `[dear-mine-memory id=${firstId}]\nmemory: old`,
    `[dear-mine-memory id=${replacement.id}]\nmemory: current`,
    'legacy manually approved memory',
  ]), [`[dear-mine-memory id=${replacement.id}]\nmemory: current`, 'legacy manually approved memory']);
  assert.deepEqual(await activeRecalledRelationshipMemories(db, owner, listing, [
    `[dear-mine-memory id=${firstId}]\nmemory: old`,
    `[dear-mine-memory id=${replacement.id}]\nmemory: current`,
  ]), [`[dear-mine-memory id=${replacement.id}]\nmemory: current`]);
  assert.deepEqual(await activeRecalledRelationshipMemories(db, otherOwner, listing, [
    `[dear-mine-memory id=${replacement.id}]\nmemory: another user's private memory`,
  ]), [], 'the shared Listing namespace still filters automatic records by wallet owner');

  const missingReceipt: MemoryProvider = { ...memory, async status(_owner, _account, _listing, jobId) {
    return { job_id: jobId, status: 'not_found' };
  } };
  await db.query("UPDATE everyday.automatic_memories SET status='submitted',provider_job_id='missing-job' WHERE id=$1", [replacement.id]);
  assert.equal(await processAutomaticMemoryReceipt(db, missingReceipt), true);
  assert.equal((await db.query<{ status: string }>('SELECT status FROM everyday.automatic_memories WHERE id=$1', [replacement.id])).rows[0].status, 'failed',
    'a provider not_found receipt is terminal instead of being polled forever');

  output = { candidates: [{ kind: 'preference', summary: '사용자의 비밀번호는 hunter2이다.',
    confidence: 100, eventDate: null, promiseStatus: null, supersedesId: null }] };
  await chatTurn('내 비밀번호는 hunter2야', '그 내용은 기억하지 않을게');
  await processAutomaticMemoryExtraction(db, llm, { dailyLimit: 50, globalDailyLimit: 100 });
  assert.equal((await db.query('SELECT * FROM everyday.automatic_memories')).rows.length, 2,
    'obvious credentials are filtered even if the model asks to store them');

  output = { candidates: [{ kind: 'preference', summary: '사용자는 민트초코를 좋아한다.',
    confidence: 99, eventDate: null, promiseStatus: null, supersedesId: null }] };
  const interrupted = await chatTurn('나는 민트초코를 좋아해', '기억할게');
  let releaseExtraction!: () => void;
  let extractionStarted!: () => void;
  const started = new Promise<void>(resolve => { extractionStarted = resolve; });
  const release = new Promise<void>(resolve => { releaseExtraction = resolve; });
  const blockedLlm: ProductLlm = { requireConfigured() {}, async chat() {
    extractionStarted(); await release; return JSON.stringify(output);
  } };
  const processing = processAutomaticMemoryExtraction(db, blockedLlm, { dailyLimit: 50, globalDailyLimit: 100 });
  await started;
  await db.query("UPDATE everyday.automatic_memory_extractions SET status='skipped' WHERE source_ai_message_id=$1", [interrupted.aiMessage.id]);
  await db.query('UPDATE memory_accounts SET enabled=false,auto_store=false WHERE owner=$1', [owner]);
  await db.query('UPDATE memory_accounts SET enabled=true,auto_store=true WHERE owner=$1', [owner]);
  releaseExtraction(); await processing;
  assert.equal((await db.query('SELECT * FROM everyday.automatic_memories')).rows.length, 2,
    'an extraction cancelled by opt-out cannot write after a quick re-enable');

  await db.query('UPDATE memory_accounts SET enabled=false,auto_store=false WHERE owner=$1', [owner]);
  const extractionCount = (await db.query('SELECT * FROM everyday.automatic_memory_extractions')).rows.length;
  await chatTurn('비활성화 뒤의 대화', '저장되면 안 돼');
  assert.equal((await db.query('SELECT * FROM everyday.automatic_memory_extractions')).rows.length, extractionCount);

  await db.query("UPDATE everyday.automatic_memory_extractions SET status='running',updated_at=now()-interval '3 minutes' WHERE source_ai_message_id=$1", [first.aiMessage.id]);
  await db.query("UPDATE everyday.automatic_memories SET status='checking',updated_at=now()-interval '3 minutes' WHERE id=$1", [replacement.id]);
  await recoverAutomaticMemoryLeases(db);
  assert.equal((await db.query<{ status: string }>('SELECT status FROM everyday.automatic_memory_extractions WHERE source_ai_message_id=$1', [first.aiMessage.id])).rows[0].status, 'unknown');
  assert.equal((await db.query<{ status: string }>('SELECT status FROM everyday.automatic_memories WHERE id=$1', [replacement.id])).rows[0].status, 'submitted');
});
