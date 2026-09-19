import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Secp256k1Keypair } from '@mysten/sui/keypairs/secp256k1';
import { Secp256r1Keypair } from '@mysten/sui/keypairs/secp256r1';
import { buildApp } from '../src/app.js';
import { hash } from '../src/auth.js';
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
  const issued = results.find(r => r.statusCode === 200)!;
  const session = issued.json();
  const cookie = String(issued.headers['set-cookie']).split(';')[0];
  assert.match(String(issued.headers['set-cookie']), /everyday\.refresh\.v1=[A-Za-z0-9_-]{43}/);
  assert.match(String(issued.headers['set-cookie']), /HttpOnly/);
  assert.match(String(issued.headers['set-cookie']), /SameSite=Lax/);
  const auth = {...headers,authorization:`Bearer ${session.token}`};
  assert.equal((await app.inject({url:'/v1/me',headers:auth})).json().address,key.toSuiAddress());
  assert.equal((await app.inject({url:'/v1/me',headers:{...auth,origin:'https://other.example'}})).statusCode,401);
  const stored = await db.query<{token_hash:string}>('SELECT token_hash FROM wallet_sessions');
  assert.ok(stored.rows.some(row => row.token_hash === hash(session.token)));
  assert.ok(stored.rows.every(row => row.token_hash !== session.token));

  // Access tokens stay short-lived. The HttpOnly cookie restores a new tab without another wallet signature.
  await db.query("UPDATE wallet_sessions SET expires_at=now()-interval '1 minute' WHERE token_hash=$1", [hash(session.token)]);
  assert.equal((await app.inject({url:'/v1/me',headers:auth})).statusCode,401);
  const refreshed = await app.inject({method:'POST',url:'/v1/auth/session/refresh',headers:{...headers,cookie},payload:{}});
  assert.equal(refreshed.statusCode,200,refreshed.body);
  const renewed = refreshed.json(), rotatedCookie = String(refreshed.headers['set-cookie']).split(';')[0];
  assert.notEqual(renewed.token,session.token);
  assert.equal((await app.inject({url:'/v1/me',headers:{...headers,authorization:`Bearer ${renewed.token}`}})).json().address,key.toSuiAddress());
  // A second tab may race with rotation; the old cookie has a bounded grace window and gets its own rotated token.
  const parallel = await app.inject({method:'POST',url:'/v1/auth/session/refresh',headers:{...headers,cookie},payload:{}});
  assert.equal(parallel.statusCode,200,parallel.body);
  assert.notEqual(parallel.json().token,renewed.token);
  assert.equal((await app.inject({method:'POST',url:'/v1/auth/session/refresh',
    headers:{...headers,origin:'https://other.example',cookie:rotatedCookie},payload:{}})).statusCode,401);
  assert.equal((await app.inject({method:'DELETE',url:'/v1/auth/session',
    headers:{...headers,authorization:`Bearer ${renewed.token}`,cookie:rotatedCookie}})).statusCode,204);
  assert.equal((await app.inject({url:'/v1/me',headers:{...headers,authorization:`Bearer ${renewed.token}`}})).statusCode,401);
  assert.equal((await app.inject({url:'/v1/me',headers:{...headers,authorization:`Bearer ${parallel.json().token}`}})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:'/v1/auth/session/refresh',headers:{...headers,cookie:rotatedCookie},payload:{}})).statusCode,401);
  assert.equal((await db.query<{count:string}>('SELECT count(*)::text AS count FROM wallet_refresh_sessions')).rows[0].count,'0');

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
  const preflight = await app.inject({method:'OPTIONS',url:'/v1/auth/session/refresh',headers:{origin:'https://other.example','access-control-request-method':'POST'}});
  assert.equal(preflight.headers['access-control-allow-origin'],'https://other.example');
  assert.equal(preflight.headers['access-control-allow-credentials'],'true');
  const tampered = await challenge();
  const badPayload = await sign({...tampered,message:tampered.message.replace('sui:testnet','sui:mainnet')});
  assert.equal((await app.inject({method:'POST',url:'/v1/auth/sessions',headers,payload:badPayload})).statusCode,401);

  const secureKey = new Ed25519Keypair();
  const secureChallenge = await app.inject({method:'POST',url:'/v1/auth/challenges',headers:{origin:'https://other.example'},
    payload:{address:secureKey.toSuiAddress(),network:'testnet'}});
  const secureBody = secureChallenge.json();
  const secureSignature = await secureKey.signPersonalMessage(new TextEncoder().encode(secureBody.message));
  const secureSession = await app.inject({method:'POST',url:'/v1/auth/sessions',headers:{origin:'https://other.example'},
    payload:{challengeId:secureBody.id,signature:secureSignature.signature}});
  assert.equal(secureSession.statusCode,200,secureSession.body);
  assert.match(String(secureSession.headers['set-cookie']), /HttpOnly/);
  assert.match(String(secureSession.headers['set-cookie']), /Secure/);
  assert.match(String(secureSession.headers['set-cookie']), /Partitioned/);
  assert.match(String(secureSession.headers['set-cookie']), /SameSite=None/);

  for (const signer of [new Secp256k1Keypair(),new Secp256r1Keypair()]) {
    const c = await challenge(signer.toSuiAddress());
    const signed = await signer.signPersonalMessage(new TextEncoder().encode(c.message));
    const response = await app.inject({method:'POST',url:'/v1/auth/sessions',headers,payload:{challengeId:c.id,signature:signed.signature}});
    assert.equal(response.statusCode,200);
    await db.query("UPDATE wallet_sessions SET expires_at=now()-interval '1 minute'");
    assert.equal((await app.inject({url:'/v1/me',headers:{...headers,authorization:`Bearer ${response.json().token}`}})).statusCode,401);
  }
});
