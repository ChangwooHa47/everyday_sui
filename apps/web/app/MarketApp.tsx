'use client';
import { useEffect, useRef, useState } from 'react';
import { createDAppKit, DAppKitProvider, useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import type { SuiClientTypes } from '@mysten/sui/client';
import { fromBase64, normalizeSuiAddress } from '@mysten/sui/utils';
import type { MarketListing } from '@everyday/contracts';
import { client } from '@/lib/web3/chain';
import { apiUrl } from '@/lib/web3/config';
import './market.css';

const kit = createDAppKit({ networks: ['testnet'], createClient: () => client });
const licenseBcs = bcs.struct('License', { id: bcs.Address, listing: bcs.Address, buyer: bcs.Address });
type Config = { packageId: string | null; operator: string | null; previewTurns: number; chatConfigured: boolean; memoryConfigured: boolean };
type Message = { role: 'user' | 'assistant'; content: string };
type Receipt = { job_id?: string; status: string; blob_id?: string };
export default function MarketApp({ viewer = false }: { viewer?: boolean }) {
  return <DAppKitProvider dAppKit={kit}><Root viewer={viewer} /></DAppKitProvider>;
}
function Root({ viewer }: { viewer: boolean }) {
  const account = useCurrentAccount();
  return <main className="market-app"><header><div><small>everyday · Sui Testnet</small><h1>{viewer ? '나의 이야기 이어가기' : '캐릭터 마켓'}</h1></div><ConnectButton /></header>
    <nav><a href="/market">마켓</a><a href="/viewer">기억 뷰어</a><a href="/">내 캐릭터 스튜디오</a></nav>
    <p>같은 캐릭터, 나만의 이야기. 캐릭터 이용권과 나의 기억은 따로 보관돼요.</p>
    {account ? <Workspace key={account.address} owner={normalizeSuiAddress(account.address)} viewer={viewer} />
      : <section><h2>지갑으로 시작해요</h2><p>테스트넷 지갑을 연결하면 캐릭터를 살펴보고 대화를 시작할 수 있어요.</p><ConnectButton /></section>}
  </main>;
}
function Workspace({ owner, viewer }: { owner: string; viewer: boolean }) {
  const dapp = useDAppKit(); const alive = useRef(true); const running = useRef(false); const token = useRef<string | null>(null);
  const [signedIn, setSignedIn] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [status, setStatus] = useState(''); const [config, setConfig] = useState<Config>();
  const [listings, setListings] = useState<MarketListing[]>([]); const [selected, setSelected] = useState('');
  const [licenseIds, setLicenseIds] = useState<Record<string, string>>({}); const [creatorId, setCreatorId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]); const [input, setInput] = useState('');
  const [memoryAccount, setMemoryAccount] = useState(''); const [memoryConnected, setMemoryConnected] = useState(false);
  const [consent, setConsent] = useState(false); const [useMemory, setUseMemory] = useState(false);
  const [fact, setFact] = useState(''); const [recall, setRecall] = useState<string[]>([]); const [memoryJob, setMemoryJob] = useState(''); const [receipt, setReceipt] = useState<Receipt>();
  const [title, setTitle] = useState(''); const [personality, setPersonality] = useState(''); const [preview, setPreview] = useState('');
  const [price, setPrice] = useState('100000000'); const [draftId, setDraftId] = useState('');
  const [publishTx, setPublishTx] = useState(''); const [lastDigest, setLastDigest] = useState('');
  const [allowedGifts, setAllowedGifts] = useState(''); const [trial, setTrial] = useState(''); const [trialReply, setTrialReply] = useState('');
  const [giftStatus, setGiftStatus] = useState('');
  const packageRequest = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const current = listings.find(item => item.id === selected);
  const licensed = Boolean(current && (current.creator === owner || licenseIds[current.id]));
  useEffect(() => { alive.current = true; return () => { alive.current = false;
    if (token.current) void fetch(`${apiUrl}/v1/auth/session`, { method: 'DELETE', headers: { Authorization: `Bearer ${token.current}` }, keepalive: true }).catch(() => {});
    token.current = null;
  }; }, []);
  function check() { if (!alive.current || normalizeSuiAddress(dapp.stores.$connection.get().account?.address ?? '0x0') !== owner) throw Error('지갑이 변경되었습니다.'); }
  async function api<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
    check();
    const response = await fetch(`${apiUrl}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token.current ? { Authorization: `Bearer ${token.current}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    check();
    if (response.status === 204) return undefined as T;
    const data = await response.json();
    if (!response.ok) { if (response.status === 401) { token.current = null; setSignedIn(false); }
      const text: Record<string, string> = { PREVIEW_EXHAUSTED: '미리보기 대화를 모두 사용했어요. 이용권을 구매하면 이어갈 수 있어요.', LICENSE_REQUIRED: '캐릭터 이용권이 필요해요.',
        SERVICE_UNAVAILABLE: '서버 연결 또는 서비스 설정을 확인해주세요.', MEMORY_DELEGATE_REQUIRED: '기억 접근 권한을 지갑에서 허용해주세요.', MEMORY_OWNER_MISMATCH: '내 지갑의 기억 계정을 입력해주세요.' };
      throw Error(text[data.error] ?? data.error ?? '요청 실패'); }
    return data;
  }
  async function run(fn: () => Promise<void>) { if (running.current) return; running.current = true; setBusy(true); setError('');
    try { await fn(); } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '작업 실패'); }
    finally { running.current = false; if (alive.current) setBusy(false); } }
  async function owned(pkg: string) {
    const licenses: Record<string, string> = {}; let creator = '';
    for (const kind of ['Creator', 'License']) {
      let cursor: string | null = null;
      do {
        const page: SuiClientTypes.ListOwnedObjectsResponse<{ content: true }> = await client.listOwnedObjects({ owner, type: `${pkg}::market::${kind}`, include: { content: true }, cursor, limit: 50 }); check();
        for (const object of page.objects) {
          if (object.owner.$kind !== 'AddressOwner' || object.owner.AddressOwner !== owner) continue;
          if (kind === 'Creator') creator = object.objectId;
          else { const l = licenseBcs.parse(object.content); if (l.buyer === owner) licenses[l.listing] = l.id; }
        }
        if (!page.hasNextPage) break;
        if (!page.cursor || page.cursor === cursor) throw Error('자산 조회 오류'); cursor = page.cursor;
      } while (true);
    }
    setLicenseIds(licenses); setCreatorId(creator);
  }
  async function refresh() {
    const c = await api<Config>('/v1/market/config'); setConfig(c);
    if (!c.packageId) { setStatus('테스트넷 마켓 배포 설정이 필요합니다.'); return; }
    let after: string | null = null; const all: MarketListing[] = [];
    do { const page: { listings: MarketListing[]; nextCursor: string | null } = await api(`/v1/market/listings?limit=20${after ? `&after=${after}` : ''}`);
      all.push(...page.listings); if (page.nextCursor === after || all.length >= 200) break; after = page.nextCursor;
    } while (after);
    setListings(all); await owned(c.packageId);
    if (token.current) { const bound = await api<{ account: { accountId: string; enabled: boolean } | null }>('/v1/me/memory-account');
      setMemoryAccount(bound.account?.accountId ?? ''); setMemoryConnected(bound.account?.enabled ?? false); }
  }
  async function login() {
    const challenge = await api<{ id: string; message: string }>('/v1/auth/challenges', { address: owner, network: 'testnet' });
    const signature = await dapp.signPersonalMessage({ message: new TextEncoder().encode(challenge.message) }); check();
    const session = await api<{ token: string; address: string }>('/v1/auth/sessions', { challengeId: challenge.id, signature: signature.signature });
    if (session.address !== owner) throw Error('세션 주소 불일치'); token.current = session.token; setSignedIn(true); await refresh();
  }
  async function execute(json: string) {
    check(); const tx = Transaction.from(json); tx.setSender(owner);
    const signed = await dapp.signTransaction({ transaction: tx }); check();
    const bytes = fromBase64(signed.bytes); const digest = await Transaction.from(bytes).getDigest({ client });
    setLastDigest(digest); setStatus('거래 결과 확인 중. 확인 전에는 같은 거래를 다시 보내지 마세요.');
    const result = await client.executeTransaction({ transaction: bytes, signatures: [signed.signature], include: { effects: true, objectTypes: true } });
    check(); if (result.FailedTransaction) throw Error('체인 거래가 실패했습니다.');
    const confirmed = await client.waitForTransaction({ digest, include: { effects: true, objectTypes: true } }); check();
    if (!confirmed.Transaction) throw Error('체인 거래가 실패했습니다.');
    setStatus('테스트넷 거래가 확인됐어요.');
    return confirmed.Transaction;
  }
  function choose(listingId: string) { setSelected(listingId); setMessages([]); setRecall([]); setFact(''); setInput(''); setMemoryJob(''); setReceipt(undefined); setGiftStatus(''); }
  const createdId = (types: Record<string, string>, kind: string) => Object.entries(types).find(([, type]) => type.endsWith(`::${kind}`))?.[0];
  return <>
    <div className="market-actions"><button disabled={busy || signedIn} onClick={() => void run(login)}>{signedIn ? '로그인됨' : '로그인'}</button>
      <button disabled={busy} onClick={() => void run(refresh)}>마켓 새로고침</button></div>
    <p role="status">{busy ? '처리 중… ' : ''}{status}</p>{error && <p role="alert">{error}</p>}
    {lastDigest && <a target="_blank" rel="noreferrer" href={`https://suiscan.xyz/testnet/tx/${lastDigest}`}>마지막 거래 확인</a>}
    <section><h2>{viewer ? '구매한 캐릭터' : '캐릭터 둘러보기'}</h2>
      {!listings.length && <p>새로고침으로 등록된 캐릭터를 불러오세요.</p>}
      <div className="market-grid">{listings.filter(l => !viewer || licenseIds[l.id] || l.creator === owner).map(l => <button disabled={busy} aria-pressed={selected === l.id} key={l.id} onClick={() => choose(l.id)}>
        <strong>{l.title}</strong><span>{BigInt(l.priceMist) / 1000000000n}.{(BigInt(l.priceMist) % 1000000000n).toString().padStart(9, '0')} SUI</span><small>{licenseIds[l.id] ? '구매한 캐릭터' : l.active ? '미리보기 가능' : '판매 중지'}</small></button>)}</div>
    </section>
    {current && <section><h2>{current.title}</h2><p>{licensed ? '이용권 확인 후 대화해요.' : `${config?.previewTurns ?? 3}턴 미리보기 · 이용권과 AI 사용료는 별도예요.`}</p>
      <p>캐릭터 금고: {current.treasuryMist} MIST · 캐릭터 정산 비율 {current.agentBps / 100}%</p>
      {!licensed && <button disabled={busy || !signedIn || !current.active} onClick={() => void run(async () => {
        const result = await api<{ transaction: string }>(`/v1/market/listings/${selected}/purchase-transaction`, {}); await execute(result.transaction); await refresh();
      })}>테스트 SUI로 이용권 구매</button>}
      {viewer && <button disabled={busy || !signedIn} onClick={() => void run(async () => {
        const r = await api<{ characterPackage: { character: { name: string; personality: string } } }>(`/v1/market/listings/${selected}/character${licenseIds[selected] ? `?licenseId=${licenseIds[selected]}` : ''}`);
        setStatus(`${r.characterPackage.character.name} 설정을 구매 권한으로 불러왔어요.`);
      })}>캐릭터 설정 불러오기</button>}
      <div className="market-messages" aria-live="polite">{messages.map((m, i) => <p className={m.role} key={i}><b>{m.role === 'user' ? '나' : current.title}</b><br/>{m.content}</p>)}</div>
      <label>메시지<textarea value={input} disabled={busy} onChange={e => setInput(e.target.value)} maxLength={8000} /></label>
      <label className="check"><input type="checkbox" checked={useMemory} disabled={!licensed || !memoryConnected || busy} onChange={e => setUseMemory(e.target.checked)} />승인한 기억을 이번 대화에 활용</label>
      <button disabled={busy || !signedIn || !input.trim() || !config?.chatConfigured} onClick={() => void run(async () => {
        const next: Message[] = [...messages, { role: 'user', content: input.trim() }];
        const result = await api<{ content: string; gift?: { status: string; digest?: string } }>(`/v1/market/listings/${selected}/turns`, { requestId: crypto.randomUUID(), mode: licensed ? 'licensed' : 'preview',
          licenseId: licenseIds[selected], messages: next.slice(-40), useMemory: licensed && useMemory });
        setMessages([...next, { role: 'assistant', content: result.content }]); setInput('');
        if (result.gift?.status === 'confirmed') { setGiftStatus('캐릭터가 자기 금고에서 선물을 보내줬어요.'); if (result.gift.digest) setLastDigest(result.gift.digest); }
        else if (result.gift && ['unknown', 'prepared'].includes(result.gift.status)) setGiftStatus('선물 거래 결과를 확인 중이에요. 아직 도착이 확정되지 않았어요.');
      })}>보내기</button>
      {giftStatus && <p>{giftStatus}</p>}
      {licensed && <button disabled={busy || !signedIn} onClick={() => void run(async () => {
        const r = await api<{ gifts: { listingId: string; status: string; digest: string | null }[] }>('/v1/me/gifts');
        const latest = r.gifts.find(g => g.listingId === selected && g.status !== 'declined');
        if (!latest) setGiftStatus('아직 받은 선물이 없어요.');
        else { setGiftStatus(latest.status === 'confirmed' ? '선물 거래가 확인됐어요.' : `선물 상태: ${latest.status}`); if (latest.digest) setLastDigest(latest.digest); }
      })}>선물 도착 확인</button>}
    </section>}
    <section><h2>나만의 기억</h2><p>확인한 기억만 저장해요. 처리 과정에서 Everyday API·MemWal 중계 서버·AI가 내용을 볼 수 있어요.</p>
      <label className="check"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />기억 처리와 계정 접근 위임에 동의해요.</label>
      <label>내 MemWal 계정 ID<input value={memoryAccount} disabled={busy} onChange={e => { setMemoryAccount(e.target.value); setMemoryConnected(false); }} placeholder="0x…" /></label>
      <div className="market-actions"><button disabled={busy || !signedIn || !consent || !config?.memoryConfigured} onClick={() => void run(async () => {
        const r = await api<{ transaction: string }>('/v1/me/memory-account/transaction', {}); const t = await execute(r.transaction);
        const accountId = createdId(t.objectTypes!, 'account::MemWalAccount'); if (accountId) setMemoryAccount(accountId); else throw Error('거래에서 기억 계정 ID를 확인해주세요.');
      })}>기억 계정 만들기</button>
      <button disabled={busy || !signedIn || !consent || !memoryAccount} onClick={() => void run(async () => {
        const r = await api<{ transaction: string }>('/v1/me/memory-account/transaction', { accountId: memoryAccount }); await execute(r.transaction);
      })}>지갑에서 접근 허용</button>
      <button disabled={busy || !signedIn || !consent || !memoryAccount} onClick={() => void run(async () => {
        await api('/v1/me/memory-account', { accountId: memoryAccount, consent: true }); setMemoryConnected(true); setStatus('내 기억 계정을 연결했어요.');
      })}>기억 계정 연결</button></div>
      {memoryConnected && <button disabled={busy} onClick={() => void run(async () => {
        await api('/v1/me/memory-account', undefined, 'DELETE'); setMemoryConnected(false); setUseMemory(false); setRecall([]);
        const r = await api<{ transaction: string }>('/v1/me/memory-account/transaction', { accountId: memoryAccount, revoke: true }); await execute(r.transaction);
      })}>연결 해제 및 위임 철회</button>}
      {current && <><label>기억할 내용<textarea maxLength={2000} value={fact} disabled={busy} onChange={e => setFact(e.target.value)} placeholder="예: 나는 따뜻한 차를 좋아해." /></label>
        <button disabled={busy || !licensed || !memoryConnected || !consent || !fact.trim()} onClick={() => void run(async () => {
          const requestId = crypto.randomUUID(); const r = await api<{ jobId: string }>(`/v1/me/relationships/${selected}/remember`, { requestId, text: fact, consent: true, licenseId: licenseIds[selected] });
          setMemoryJob(requestId); setReceipt({ status: 'accepted', job_id: r.jobId }); setStatus('저장 요청을 접수했어요. 저장 결과를 확인해주세요.');
        })}>확인한 기억 저장</button>
        {memoryJob && <button disabled={busy} onClick={() => void run(async () => { setReceipt(await api<Receipt>(`/v1/me/memory-jobs/${memoryJob}`)); })}>저장 결과 확인</button>}
        {receipt && <p>기억 저장 상태: {receipt.status}{receipt.blob_id && ` · Walrus ${receipt.blob_id}`}</p>}
        <button disabled={busy || !memoryConnected} onClick={() => void run(async () => {
          const r = await api<{ results: { text: string }[] }>(`/v1/me/relationships/${selected}/recall`, { query: fact || '우리의 관계에서 기억할 사용자 취향과 이야기' }); setRecall(r.results.map(item => item.text));
        })}>내 기억 불러오기</button><ul>{recall.map((text, i) => <li key={i}>{text}</li>)}</ul></>}
    </section>
    {!viewer && <section><h2>크리에이터 스튜디오</h2><p>캐릭터 패키지는 게시 후 고정돼요. 개인 대화나 기억을 넣지 마세요.</p>
      {!creatorId && <button disabled={busy || !signedIn || !config?.operator} onClick={() => void run(async () => { const r = await api<{ transaction: string }>('/v1/market/creator-transaction', {}); await execute(r.transaction); await refresh(); })}>제작자 등록</button>}
      <label>캐릭터 이름<input maxLength={80} value={title} onChange={e => { setTitle(e.target.value); setPublishTx(''); }} disabled={busy} /></label>
      <label>이용권 가격 (MIST, 1 SUI = 1,000,000,000 MIST)<input value={price} onChange={e => setPrice(e.target.value)} disabled={busy} /></label>
      <label>성격·말투<textarea maxLength={4000} value={personality} onChange={e => { setPersonality(e.target.value); setPublishTx(''); }} disabled={busy} /></label>
      <label>미리보기용 성격·말투<textarea maxLength={4000} value={preview} onChange={e => { setPreview(e.target.value); setPublishTx(''); }} disabled={busy} /></label>
      <label>시험 대화<textarea maxLength={8000} value={trial} onChange={e => setTrial(e.target.value)} disabled={busy} /></label>
      <button disabled={busy || !signedIn || !title || !trial || !personality} onClick={() => void run(async () => {
        const r = await api<{ content: string }>('/v1/ai/turns', { requestId: crypto.randomUUID(), character: { name: title, personality, callName: '친구' }, messages: [{ role: 'user', content: trial }] }); setTrialReply(r.content);
      })}>시험 대화 보내기</button>{trialReply && <p>{trialReply}</p>}
      <details><summary>선물 정책 설정</summary><p>관리자가 등록한 GiftProduct ID를 쉼표로 구분해 입력하세요. 빈 목록은 자동 선물을 비활성화합니다. 건별 0.01 SUI, UTC 일별 0.03 SUI 한도예요.</p>
        <label>허용 선물 상품 ID<input value={allowedGifts} disabled={busy || Boolean(draftId)} onChange={e => setAllowedGifts(e.target.value)} /></label></details>
      <button disabled={busy || !creatorId || !title.trim()} onClick={() => void run(async () => {
        const r = await api<{ transaction: string }>('/v1/market/listing-transaction', { creatorId, title, priceMist: price, agentBps: 2000, perGiftLimitMist: '10000000', dailyLimitMist: '30000000', allowedGiftIds: allowedGifts.split(',').map(v => v.trim()).filter(Boolean) });
        const t = await execute(r.transaction); const listingId = createdId(t.objectTypes!, 'market::Listing');
        if (!listingId) throw Error('거래에서 Listing ID를 확인해주세요.'); setDraftId(listingId); setPublishTx('');
      })}>상품 초안 만들기</button>
      <label>초안 Listing ID<input value={draftId} disabled={busy} onChange={e => { setDraftId(e.target.value); setPublishTx(''); }} placeholder="0x…" /></label>
      <button disabled={busy || !draftId || !title || !personality || !preview} onClick={() => void run(async () => {
        const characterPackage = { schemaVersion: 1, network: 'testnet', packageId: config!.packageId,
          listingId: draftId, character: { name: title, personality, callName: '친구' }, preview: { name: title, personality: preview, callName: '친구' }, episodes: [] };
        const fingerprint = JSON.stringify(characterPackage);
        if (packageRequest.current?.fingerprint !== fingerprint) packageRequest.current = { fingerprint, requestId: crypto.randomUUID() };
        const r = await api<{ transaction: string }>(`/v1/market/listings/${draftId}/package`, { requestId: packageRequest.current.requestId, characterPackage });
        setPublishTx(r.transaction); setStatus('Seal 암호화와 Walrus 업로드를 확인했어요. 이제 지갑에서 게시해주세요.');
      })}>패키지 암호화·보관</button>
      <button disabled={busy || !publishTx} onClick={() => void run(async () => { await execute(publishTx); setPublishTx(''); await api('/v1/market/listings', { listingId: draftId }); await refresh(); })}>마켓에 게시</button>
      <button disabled={busy || !draftId} onClick={() => void run(async () => { await api('/v1/market/listings', { listingId: draftId }); await refresh(); })}>게시된 상품 목록 등록 재시도</button>
    </section>}
  </>;
}
