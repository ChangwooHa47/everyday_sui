import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { buildApp } from '../src/app.js';
import { hash } from '../src/auth.js';
import { migration } from '../src/database.js';

test('AI gateway enforces auth, concurrent quota, idempotency and stores no plaintext',async t => {
  const db = new PGlite();await db.exec(migration);
  const origin = 'http://127.0.0.1:3000';
  const token = 'x'.repeat(43);
  await db.query("INSERT INTO wallet_sessions VALUES($1,$2,$3,now()+interval '30 minutes')",[hash(token),'actor',origin]);
  let calls = 0;
  const provider = createServer((req,res) => {
    calls++;
    req.resume();
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({choices:[{message:{content:'안녕하세요'}}]}));
  });
  await new Promise<void>(resolve => provider.listen(0,'127.0.0.1',resolve));
  const port = (provider.address() as {port:number}).port;
  const app = buildApp(false,{db,auth:{origins:[origin],audience:'test',network:'testnet'},
    ai:{endpoint:`http://127.0.0.1:${port}`,apiKey:'test-secret',model:'fixture',dailyLimit:2}});
  t.after(async () => {await app.close();await db.close();await new Promise<void>(resolve => provider.close(() => resolve()));});
  const body = {requestId:randomUUID(),character:{name:'Test',personality:'private personality',callName:'friend'},messages:[{role:'user',content:'private message'}]};
  const headers = {origin,authorization:`Bearer ${token}`};
  assert.equal((await app.inject({method:'POST',url:'/v1/ai/turns',headers:{origin},payload:body})).statusCode,401);
  const requests = await Promise.all([body,body,{...body,requestId:randomUUID()},{...body,requestId:randomUUID()}].map(payload => app.inject({method:'POST',url:'/v1/ai/turns',headers,payload})));
  assert.deepEqual(requests.map(r=>r.statusCode).sort(),[200,200,409,429]);
  assert.equal(calls,2);
  assert.equal((await app.inject({method:'POST',url:'/v1/ai/turns',headers,payload:{...body,messages:[{role:'user',content:'different'}]}})).statusCode,409);
  const stored = JSON.stringify((await db.query('SELECT * FROM ai_requests')).rows);
  assert.ok(!stored.includes('private message') && !stored.includes('private personality') && !stored.includes('안녕하세요'));
  assert.equal((await db.query<{used:number}>('SELECT used FROM ai_daily_budget')).rows[0].used,2);
});
