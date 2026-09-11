import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Secp256k1Keypair } from '@mysten/sui/keypairs/secp256k1';
import { Secp256r1Keypair } from '@mysten/sui/keypairs/secp256r1';
import { buildApp } from '../src/app.js';
import { migration } from '../src/database.js';

test('real signatures, atomic challenge consumption, origin binding, expiry and revocation', async t => {
  const db = new PGlite(); await db.exec(migration);
  const origin = 'http://127.0.0.1:3000';
  const app = buildApp(false,{db,auth:{origins:[origin,'https://other.example'],audience:'everyday-test',network:'testnet'}});
  t.after(async () => {await app.close();await db.close();});
  const headers = { origin };
  const key = new Ed25519Keypair();
  async function challenge(address = key.toSuiAddress()) {
    const result = await app.inject({method:'POST',url:'/v1/auth/challenges',headers,payload:{address,network:'testnet'}});
    assert.equal(result.statusCode,200); return result.json() as {id:string;message:string};
  }
  async function sign(c: {id:string;message:string}, signer = key) {
    return { challengeId:c.id,signature:(await signer.signPersonalMessage(new TextEncoder().encode(c.message))).signature };
  }
  const c = await challenge();
  assert.match(c.message,/everyday-test/); assert.match(c.message,/sui:testnet/);
  const payload = await sign(c);
  const results = await Promise.all([1,2].map(() => app.inject({method:'POST',url:'/v1/auth/sessions',headers,payload})));
  assert.deepEqual(results.map(r => r.statusCode).sort(),[200,401]);
  const session = results.find(r => r.statusCode === 200)!.json();
  const auth = {...headers,authorization:`Bearer ${session.token}`};
  assert.equal((await app.inject({url:'/v1/me',headers:auth})).json().address,key.toSuiAddress());
  assert.equal((await app.inject({url:'/v1/me',headers:{...auth,origin:'https://other.example'}})).statusCode,401);
  assert.equal((await app.inject({method:'DELETE',url:'/v1/auth/session',headers:auth})).statusCode,204);
  assert.equal((await app.inject({url:'/v1/me',headers:auth})).statusCode,401);
  const stored = await db.query<{token_hash:string}>('SELECT token_hash FROM wallet_sessions');
  assert.ok(stored.rows.every(row => row.token_hash !== session.token));

  const wrong = await challenge();
  assert.equal((await app.inject({method:'POST',url:'/v1/auth/sessions',headers,payload:await sign(wrong,new Ed25519Keypair())})).statusCode,401);
  const expired = await challenge();
  await db.query("UPDATE wallet_challenges SET expires_at=now()-interval '1 minute' WHERE id=$1",[expired.id]);
  assert.equal((await app.inject({method:'POST',url:'/v1/auth/sessions',headers,payload:await sign(expired)})).statusCode,401);
  const crossed = await challenge();
  assert.equal((await app.inject({method:'POST',url:'/v1/auth/sessions',headers:{origin:'https://other.example'},payload:await sign(crossed)})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:'/v1/auth/challenges',headers,payload:{address:key.toSuiAddress(),network:'mainnet'}})).statusCode,400);
  assert.equal((await app.inject({method:'POST',url:'/v1/auth/challenges',headers:{origin:'https://evil.example'},payload:{address:key.toSuiAddress(),network:'testnet'}})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:'/v1/auth/challenges',payload:{address:key.toSuiAddress(),network:'testnet'}})).statusCode,403);
  const tampered = await challenge();
  const badPayload = await sign({...tampered,message:tampered.message.replace('sui:testnet','sui:mainnet')});
  assert.equal((await app.inject({method:'POST',url:'/v1/auth/sessions',headers,payload:badPayload})).statusCode,401);

  for (const signer of [new Secp256k1Keypair(),new Secp256r1Keypair()]) {
    const c = await challenge(signer.toSuiAddress());
    const signed = await signer.signPersonalMessage(new TextEncoder().encode(c.message));
    const response = await app.inject({method:'POST',url:'/v1/auth/sessions',headers,payload:{challengeId:c.id,signature:signed.signature}});
    assert.equal(response.statusCode,200);
    await db.query("UPDATE wallet_sessions SET expires_at=now()-interval '1 minute'");
    assert.equal((await app.inject({url:'/v1/me',headers:{...headers,authorization:`Bearer ${response.json().token}`}})).statusCode,401);
  }
});
