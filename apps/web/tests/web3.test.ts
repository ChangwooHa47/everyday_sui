import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MarketCatalog, NftGiftCatalogItem } from '@everyday/contracts';
import { assertContext, canonical, encode, publicSchema, sha256, u64, vaultSchema } from '../lib/web3/schema';
import { parseReceipt, readLimited } from '../lib/web3/storage';
import { priceToMist } from '../lib/publish';
import { formatPrice, recommendListings, loadMarketCatalog, submitPreviewTurn, MarketRequestError, pendingPreviewMessages } from '../lib/market';
import { getActiveCharacterId, setActiveCharacterId, prepareChatRequest, getPendingChatRequest, clearChatRequest, prepareCompileRequest, getPendingCompile, clearCompileRequest, getIncompleteCharacter, saveIncompleteCharacter, clearIncompleteCharacter } from '../lib/api';
import { giftPolicyFor, nftGiftImageUrl } from '../lib/gifts';
import { sortCards, type CommunityCard } from '../lib/community';
import { marketImageSources } from '../lib/market-images';
const pkg = '0x'+'1'.repeat(64);
const metadata = {schemaVersion:1,network:'testnet',appPackage:pkg,revision:'0',previousRef:null,createdAt:'2026-09-08T00:00:00.000Z'};

test('market prices preserve a single MIST and u64 maximum without floating point rounding', () => {
  assert.equal(priceToMist('0.000000001'), '1');
  assert.equal(priceToMist('18446744073.709551615'), '18446744073709551615');
  for (const value of ['0', '-1', '1e3', '01', '0.0000000001', '18446744073.709551616']) assert.throws(() => priceToMist(value));
  assert.equal(formatPrice('18446744073709551615'), '18446744073.709551615 SUI');
});

test('Walrus market images use strict reads and deployed seeds prefer their byte-identical local copy', () => {
  const listing = { id: '0xc8827e0c92569b4cc686f884462fc9c0ed58950d1549d128b18a2dc41cbee98e', title: '시우',
    active: true, published: true, creator: pkg, operator: pkg, priceMist: '1', agentBps: 0, treasuryMist: '0',
    package: { blobId: 'a'.repeat(43), contentHash: '1234567890abcdef' + '0'.repeat(48), endEpoch: '578' },
    policy: { perGiftLimitMist: '0', dailyLimitMist: '0', allowedGiftIds: [] } };
  assert.deepEqual(marketImageSources(listing,
    'https://aggregator.walrus-testnet.walrus.space/v1/blobs/1h0jmq3Ul7xopBBMiBoMoPD__V2perIjmfp-5PThbE0'), [
    '/portraits/wangja-night-1.png',
    'https://aggregator.walrus-testnet.walrus.space/v1/blobs/1h0jmq3Ul7xopBBMiBoMoPD__V2perIjmfp-5PThbE0?strict_consistency_check=true',
    'https://aggregator.walrus-testnet.walrus.space/v1/blobs/1h0jmq3Ul7xopBBMiBoMoPD__V2perIjmfp-5PThbE0',
  ]);
  assert.deepEqual(marketImageSources({ ...listing, id: pkg }, 'not a URL'), []);
});

test('community sorting keeps u64 values as exact decimal strings', () => {
  const card = (id: string, priceMist: string, buyers: string, turns: string): CommunityCard => ({
    listing: { id, title: id, active: true, published: true, creator: pkg, operator: pkg, priceMist, buyerCount: buyers,
      agentBps: 0, treasuryMist: '0', package: { blobId: '', contentHash: '', endEpoch: '1' },
      policy: { perGiftLimitMist: '0', dailyLimitMist: '0', allowedGiftIds: [] } },
    preview: undefined,
    engagement: { turns, revisitPercent: 0 },
  });
  const lower = card('lower', '9007199254740992', '18446744073709551614', '18446744073709551614');
  const higher = card('higher', '9007199254740993', '18446744073709551615', '18446744073709551615');
  assert.deepEqual(sortCards([lower, higher], 'popular').map(item => item.listing.id), ['higher', 'lower']);
  assert.deepEqual(sortCards([higher, lower], 'price').map(item => item.listing.id), ['lower', 'higher']);
});

test('gift policy includes available external offers and external images always use the verified proxy', () => {
  const internal = (id: string, minted: string, maxSupply: string, priceMist: string): NftGiftCatalogItem => ({
    kind: 'everyday', id, title: id, description: '', imageUrl: 'https://example.com/internal.png', imageHash: '0'.repeat(64),
    merchant: pkg, priceMist, maxSupply, minted, active: true,
  });
  const external: NftGiftCatalogItem = { kind: 'external', id: 'external-offer', collectionId: 'policy', collectionName: 'Fixture',
    objectId: 'object', objectType: `${pkg}::fixture::Nft`, title: 'External', description: '',
    imageUrl: 'https://seller.invalid/untrusted.png', imageHash: '1'.repeat(64), merchant: pkg, priceMist: '9', active: true, verified: true };
  const policy = giftPolicyFor([internal('sold-out', '1', '1', '100'), internal('available', '0', '1', '5'), external]);
  assert.deepEqual(policy, { perGiftLimitMist: '9', dailyLimitMist: '27', allowedGiftIds: ['available', 'external-offer'] });
  const image = nftGiftImageUrl(external);
  assert.ok(image.endsWith('/v1/nft-gifts/external-offer/image'));
  assert.notEqual(image, external.imageUrl);
});

test('active character selection is isolated between authenticated wallet accounts', () => {
  const prior = ['window', 'localStorage', 'sessionStorage'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const storage = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }; };
  const local = storage(), session = storage();
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: session });
    const use = (digit: string) => session.setItem('everyday.session.v1', JSON.stringify({ address: '0x' + digit.repeat(64), expiresAt: new Date(Date.now()+60000).toISOString() }));
    use('a'); setActiveCharacterId(42); assert.equal(getActiveCharacterId(), 42);
    use('b'); assert.equal(getActiveCharacterId(), null); setActiveCharacterId(99);
    use('a'); assert.equal(getActiveCharacterId(), 42);
  } finally {
    for (const [name, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
  }
});

test('recommendations rank matching authored interests without requiring relationship history', () => {
  const listings = ['art', 'music'].map((id, i) => ({ id, title: id, active: true, published: true, creator: '', operator: '', priceMist: '1', agentBps: 0, treasuryMist: '0',
    package: { blobId: '', contentHash: '', endEpoch: '1' }, policy: { perGiftLimitMist: '0', dailyLimitMist: '0', allowedGiftIds: [] } }));
  const catalog = { listings, previews: { art: { summary: '그림과 전시', imageUrl: null }, music: { summary: '기타와 공연', imageUrl: null } }, nextCursor: null };
  const result = recommendListings(catalog, { name: '가상', summary: '기타와 공연', personality: '음악을 좋아한다', appearance: '', speechStyles: [], imageUrl: null, examples: [] });
  assert.equal(result[0].id, 'music');
  listings[1].active = false; assert.equal(recommendListings(catalog, { name: '', summary: '', personality: '', appearance: '', speechStyles: [], imageUrl: null, examples: [] }).length, 1);
});

test('catalog follows server cursors and includes later pages without losing preview metadata', async () => {
  const cursor = '0x' + '2'.repeat(64), paths: string[] = [];
  const catalog = await loadMarketCatalog(async (path): Promise<MarketCatalog> => {
    paths.push(path);
    return paths.length === 1 ? { listings: [], previews: { first: { summary: 'first', imageUrl: null } }, nextCursor: cursor }
      : { listings: [], previews: { second: { summary: 'second', imageUrl: null } }, nextCursor: null };
  });
  assert.equal(paths.length, 2); assert.ok(paths[1].includes(`after=${cursor}`));
  assert.deepEqual(Object.keys(catalog.previews), ['first', 'second']);
  await assert.rejects(loadMarketCatalog(async () => ({ listings: [], previews: {}, nextCursor: cursor })));
});

test('unknown chat submissions reuse their request and isolate other accounts, characters and episodes', () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  const use = (digit: string) => storage.setItem('everyday.session.v1', JSON.stringify({ address: '0x' + digit.repeat(64), expiresAt: new Date(Date.now() + 60000).toISOString() }));
  try {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
    use('a');
    const pending = prepareChatRequest(42, null, 'fictional message');
    assert.deepEqual(prepareChatRequest(42, null, 'fictional message'), pending);
    assert.throws(() => prepareChatRequest(42, null, 'different message'));
    assert.equal(getPendingChatRequest(99, null), null); assert.equal(getPendingChatRequest(42, '1'), null);
    use('b'); assert.equal(getPendingChatRequest(42, null), null);
    use('a'); assert.deepEqual(getPendingChatRequest(42, null), pending);
    clearChatRequest(42, null, crypto.randomUUID()); assert.deepEqual(getPendingChatRequest(42, null), pending);
    clearChatRequest(42, null, pending.requestId); assert.equal(getPendingChatRequest(42, null), null);
  } finally {
    if (prior) Object.defineProperty(globalThis, 'sessionStorage', prior); else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});

test('unknown compilation retains its exact authored input and identity through retry', () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  try {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
    storage.setItem('everyday.session.v1', JSON.stringify({ address: '0x' + 'a'.repeat(64), expiresAt: new Date(Date.now() + 60000).toISOString() }));
    const input = { relationshipType: '친구', gender: '여성', freeText: undefined, name: '가상', interviewAnswers: [], birthday: undefined, deferPortraitGeneration: true };
    const pending = prepareCompileRequest(input);
    assert.equal(prepareCompileRequest(input).requestId, pending.requestId);
    assert.equal(getPendingCompile()?.name, input.name);
    assert.throws(() => prepareCompileRequest({ ...input, name: 'changed' }));
    clearCompileRequest(crypto.randomUUID()); assert.ok(getPendingCompile());
    clearCompileRequest(pending.requestId); assert.equal(getPendingCompile(), null);
  } finally {
    if (prior) Object.defineProperty(globalThis, 'sessionStorage', prior); else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});

test('preview keeps ambiguous requests but releases a completed lost response before a new authored turn', async () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  try {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
    storage.setItem('everyday.session.v1', JSON.stringify({ address: '0x' + 'a'.repeat(64), expiresAt: new Date(Date.now() + 60000).toISOString() }));
    const messages = [{ role: 'user' as const, content: 'fictional first turn' }], requests: string[] = [];
    await assert.rejects(submitPreviewTurn(pkg, messages, async (_path, body) => {
      requests.push((body as { requestId: string }).requestId);
      throw new MarketRequestError(502, 'PROVIDER_RESULT_UNKNOWN_DO_NOT_AUTO_RETRY', 'unknown');
    }));
    assert.deepEqual(pendingPreviewMessages(pkg), messages);
    await assert.rejects(submitPreviewTurn(pkg, messages, async (_path, body) => {
      requests.push((body as { requestId: string }).requestId);
      throw new MarketRequestError(409, 'TURN_COMPLETED', 'response lost');
    }));
    assert.equal(requests[0], requests[1]); assert.equal(pendingPreviewMessages(pkg), null);
    await submitPreviewTurn(pkg, [{ role: 'user', content: 'a new authored turn' }], async (_path, body) => {
      assert.notEqual((body as { requestId: string }).requestId, requests[0]); return { content: 'reply' };
    });
  } finally {
    if (prior) Object.defineProperty(globalThis, 'sessionStorage', prior); else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});

test('portrait creation resumes the same character and style only for its owner until confirmed or explicitly replaced', () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  const use = (digit: string) => storage.setItem('everyday.session.v1', JSON.stringify({ address: '0x' + digit.repeat(64), expiresAt: new Date(Date.now() + 60000).toISOString() }));
  try {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
    use('a');
    const incomplete = { characterId: 42, photoFeelText: 'fictional portrait style', photoFeelChip: 'portrait' };
    saveIncompleteCharacter(incomplete);
    assert.deepEqual(getIncompleteCharacter(), incomplete);
    use('b'); assert.equal(getIncompleteCharacter(), null);
    saveIncompleteCharacter({ ...incomplete, characterId: 99 });
    use('a'); assert.equal(getIncompleteCharacter()?.characterId, 42);
    clearIncompleteCharacter(99); assert.equal(getIncompleteCharacter()?.characterId, 42);
    clearIncompleteCharacter(42); assert.equal(getIncompleteCharacter(), null);
    saveIncompleteCharacter(incomplete); clearIncompleteCharacter(); assert.equal(getIncompleteCharacter(), null);
    use('b'); assert.equal(getIncompleteCharacter()?.characterId, 99);
  } finally {
    if (prior) Object.defineProperty(globalThis, 'sessionStorage', prior); else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});

test('storage refactoring preserves previously saved request keys and leaves them intact when a session expires', () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const owner = '0x' + 'a'.repeat(64), prefix = `everyday.v2.activeCharacterId.${owner}`;
  const requestId = '12345678-1234-4234-8234-123456789abc';
  const chat = { requestId, content: 'fictional pending message' };
  const input = { relationshipType: '친구', gender: '여성', name: '가상' };
  const compile = { ...input, requestId };
  const portrait = { characterId: 42, photoFeelText: 'fictional style', photoFeelChip: null };
  const values = new Map<string, string>([
    [`${prefix}.message.42.regular`, JSON.stringify(chat)],
    [`${prefix}.compile`, JSON.stringify(compile)],
    [`${prefix}.incompleteCharacter`, JSON.stringify(portrait)],
  ]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  try {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
    storage.setItem('everyday.session.v1', JSON.stringify({ address: owner, expiresAt: new Date(Date.now() + 60000).toISOString() }));
    assert.deepEqual(prepareChatRequest(42, null, chat.content), chat);
    assert.deepEqual(prepareCompileRequest(input), compile);
    assert.deepEqual(getIncompleteCharacter(), portrait);
    const beforeExpiry = [...values.entries()].filter(([key]) => key !== 'everyday.session.v1');
    storage.setItem('everyday.session.v1', JSON.stringify({ address: owner, expiresAt: new Date(0).toISOString() }));
    assert.throws(() => getPendingChatRequest(42, null));
    assert.throws(() => getPendingCompile());
    assert.throws(() => getIncompleteCharacter());
    assert.deepEqual([...values.entries()].filter(([key]) => key !== 'everyday.session.v1'), beforeExpiry);
  } finally {
    if (prior) Object.defineProperty(globalThis, 'sessionStorage', prior); else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});
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
