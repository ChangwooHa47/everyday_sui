import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertContext, canonical, encode, publicSchema, sha256, u64, vaultSchema } from '../lib/web3/schema';
import { parseReceipt, readLimited } from '../lib/web3/storage';
const pkg = '0x'+'1'.repeat(64);
const metadata = {schemaVersion:1,network:'testnet',appPackage:pkg,revision:'0',previousRef:null,createdAt:'2026-09-08T00:00:00.000Z'};
test('canonical hashes ignore key insertion order and preserve large u64 versions',async () => {
  assert.equal(canonical({z:1,a:{y:2,x:3}}),canonical({a:{x:3,y:2},z:1}));
  assert.equal(await sha256(encode({z:1,a:2})),await sha256(encode({a:2,z:1})));
  assert.equal(u64.parse('18446744073709551615'),'18446744073709551615');
  assert.throws(() => u64.parse('18446744073709551616'));
  assert.throws(() => canonical({a:undefined}));
});
test('manifest rejects foreign network, package, revision, vault, schema and private data in public profiles',() => {
  const profile = {...metadata,kind:'character-public',name:'Test',description:'Public'};
  const parsed = publicSchema.parse(profile);
  assertContext(parsed,pkg,'0');
  assert.throws(() => assertContext(parsed,'0x'+'2'.repeat(64),'0'));
  assert.throws(() => assertContext(parsed,pkg,'1'));
  assert.throws(() => publicSchema.parse({...profile,network:'mainnet'}));
  assert.throws(() => publicSchema.parse({...profile,schemaVersion:2}));
  assert.throws(() => publicSchema.parse({...profile,personality:'secret'}));
  const vault = vaultSchema.parse({...metadata,kind:'vault',subjectId:pkg,settings:{},conversations:[],photos:[]});
  assert.throws(() => assertContext(vault,pkg,'0','0x'+'2'.repeat(64)));
});
test('Walrus receipt variants normalize nested endEpoch and reject uncertified/deletable blobs',() => {
  const blobId = 'a'.repeat(43), contentHash = 'b'.repeat(64);
  assert.deepEqual(parseReceipt({newlyCreated:{blobObject:{blobId,certifiedEpoch:2,deletable:false,storage:{endEpoch:4}}}},contentHash),{blobId,contentHash,endEpoch:'4'});
  assert.equal(parseReceipt({alreadyCertified:{blobId,endEpoch:5,event:{txDigest:'tx'}}},contentHash).endEpoch,'5');
  assert.throws(() => parseReceipt({newlyCreated:{blobObject:{blobId,deletable:false,storage:{endEpoch:4}}}},contentHash));
  assert.throws(() => parseReceipt({newlyCreated:{blobObject:{blobId,certifiedEpoch:2,deletable:true,storage:{endEpoch:4}}}},contentHash));
});
test('download limits enforce actual streamed bytes, not only content-length',async () => {
  await assert.rejects(readLimited(new Response('12345'),4));
  assert.equal(new TextDecoder().decode(await readLimited(new Response('1234'),4)),'1234');
  await assert.rejects(readLimited(new Response('x',{status:404}),4));
});
