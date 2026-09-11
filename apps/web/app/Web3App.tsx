'use client';
import { useEffect, useRef, useState } from 'react';
import { createDAppKit, DAppKitProvider, useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64, isValidSuiAddress, normalizeSuiAddress, toBase64 } from '@mysten/sui/utils';
import { client, createVault, discover, publishCharacter, publishVault, transferCharacter, type Asset } from '@/lib/web3/chain';
import { apiUrl, network, packageId, requirePackage } from '@/lib/web3/config';
import { privacy } from '@/lib/web3/privacy';
import { download, upload, MAX_BYTES } from '@/lib/web3/storage';
import { pending, type Pending } from '@/lib/web3/pending';
import { assertContext, encode, publicSchema, vaultSchema, type PublicManifest, type VaultManifest } from '@/lib/web3/schema';
import './web3.css';

const kit = createDAppKit({ networks: ['testnet'], createClient: () => client });
declare module '@mysten/dapp-kit-react' { interface Register { dAppKit: typeof kit; } }

function saveFile(bytes: Uint8Array, name: string, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function Web3App() {
  return <DAppKitProvider dAppKit={kit}><WalletRoot /></DAppKitProvider>;
}
function WalletRoot() {
  const account = useCurrentAccount();
  return <main className="web3"><header><div><span className="w3-eyebrow">YOUR WORLD, YOUR WALLET</span><h1>everyday<span> · Sui</span></h1></div><ConnectButton /></header>
    <div className="w3-network">Sui Testnet <span>개발 베타</span></div>
    <nav><a href="/market">캐릭터 마켓</a> · <a href="/viewer">기억 뷰어</a></nav>
    {account ? <Workspace key={account.address} owner={normalizeSuiAddress(account.address)} /> : <section className="w3-hero">
      <div className="w3-orb">e.</div><h2>우리의 이야기를<br/>내 지갑에 담아요.</h2>
      <p>캐릭터는 내가 소유하고, 개인 사진과 대화는 암호화해서 보관해요. 같은 지갑으로 다시 연결하면 확정한 기록을 찾아올 수 있어요.</p>
      <ConnectButton /><p className="w3-small">읽기·복원에는 Everyday API 로그인이 필요하지 않습니다.</p>
      {!packageId && <aside>아직 테스트넷 패키지가 설정되지 않았습니다. 지갑 연결 후에도 배포 설정 전에는 생성·보관을 실행할 수 없습니다.</aside>}
    </section>}
  </main>;
}
function Workspace({ owner }: { owner: string }) {
  const dapp = useDAppKit();
  const alive = useRef(true);
  const cryptoClient = useRef<ReturnType<typeof privacy> | null>(null);
  const token = useRef<string | null>(null);
  const requestAbort = useRef(new AbortController());
  const [signedIn,setSignedIn] = useState(false);
  const [assets,setAssets] = useState<Asset[]>([]);
  const [profiles,setProfiles] = useState<Record<string,PublicManifest>>({});
  const [selected,setSelected] = useState('');
  const [vaultId,setVaultId] = useState('');
  const [data,setData] = useState<VaultManifest | null>(null);
  const [dirty,setDirty] = useState(false);
  const [tab,setTab] = useState('characters');
  const [busy,setBusy] = useState(false);
  const [status,setStatus] = useState('지갑에서 자산을 불러와주세요.');
  const [error,setError] = useState('');
  const [savedPending,setSavedPending] = useState<Pending>();
  const [name,setName] = useState('');
  const [description,setDescription] = useState('');
  const [consent,setConsent] = useState(false);
  const [recipient,setRecipient] = useState('');
  const [message,setMessage] = useState('');
  const [episode,setEpisode] = useState('');
  const [conversationId,setConversationId] = useState('');
  const running = useRef(false);
  useEffect(() => {
    alive.current = true;
    const abort = requestAbort.current;
    return () => {
      alive.current = false; abort.abort(); cryptoClient.current = null;
      if (token.current) void fetch(`${apiUrl}/v1/auth/session`, { method: 'DELETE', headers: { Authorization: `Bearer ${token.current}` }, keepalive: true }).catch(() => {});
      token.current = null;
    };
  }, []);
  function check() {
    if (!alive.current || normalizeSuiAddress(dapp.stores.$connection.get().account?.address ?? '0x0') !== owner) throw Error('지갑이 변경되어 작업을 중단했습니다.');
  }
  function cipher() { check(); return cryptoClient.current ??= privacy(); }
  async function sign(message: Uint8Array) { check(); const result = await dapp.signPersonalMessage({ message }); check(); return result; }
  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError('');
    try { await action(); } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '작업에 실패했습니다.'); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  }
  async function api<T>(path: string, body?: unknown, bearer = token.current): Promise<T> {
    check();
    const response = await fetch(`${apiUrl}${path}`, { method: body ? 'POST' : 'GET', signal: requestAbort.current.signal,
      headers: { 'Content-Type':'application/json', ...(bearer ? { Authorization:`Bearer ${bearer}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    check();
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) { token.current = null; setSignedIn(false); }
      const errors: Record<string,string> = {
        AI_NOT_CONFIGURED:'AI 제공자 설정이 아직 없어 대화를 생성할 수 없습니다. 보관·복원 기능은 별도로 사용할 수 있습니다.',
        PROVIDER_RESULT_UNKNOWN_DO_NOT_AUTO_RETRY:'AI 제공자의 처리 결과를 확인하지 못했습니다. 자동 재시도하지 않았으며, 다시 보내면 새 요청 비용이 발생할 수 있습니다.',
        SESSION_EXPIRED:'로그인이 만료됐습니다. AI 로그인을 다시 해주세요.',
        DAILY_AI_LIMIT:'오늘의 AI 사용 한도에 도달했습니다.',
      };
      throw Error(errors[result.error] ?? result.error ?? 'API 요청 실패');
    }
    return result;
  }
  async function login() {
    const challenge = await api<{ id:string; message:string }>('/v1/auth/challenges', { address:owner, network }, null);
    const signature = await sign(new TextEncoder().encode(challenge.message));
    const session = await api<{ token:string; address:string }>('/v1/auth/sessions', { challengeId:challenge.id, signature:signature.signature }, null);
    check(); if (session.address !== owner) throw Error('세션 주소가 다릅니다.');
    token.current = session.token; setSignedIn(true); setStatus('AI 서비스 로그인 완료 · 자산 변경은 별도 지갑 서명이 필요합니다.');
  }
  async function refresh() {
    check(); const found = await discover(owner); check();
    const nextProfiles: Record<string,PublicManifest> = {};
    const warnings: string[] = [];
    for (const asset of found.filter(a => a.type === 'Character')) {
      try {
        const bytes = await download(asset.ref!); check();
        const manifest = publicSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
        assertContext(manifest, requirePackage(), asset.revision);
        nextProfiles[asset.id] = manifest;
      } catch { warnings.push(asset.id.slice(0,10)); }
    }
    check(); setAssets(found); setProfiles(nextProfiles);
    setSelected(current => found.some(a => a.id === current && a.type === 'Character') ? current : found.find(a => a.type === 'Character')?.id ?? '');
    setVaultId(current => found.some(a => a.id === current && a.type === 'UserVault') ? current : found.find(a => a.type === 'UserVault')?.id ?? '');
    const p = await pending(owner, requirePackage(), 'get'); check(); setSavedPending(p);
    setStatus(`${found.filter(a => a.type === 'Character').length}개 캐릭터 · 체인 직접 조회 완료${warnings.length ? ` · ${warnings.length}개 프로필은 저장소에서 읽지 못했습니다.` : ''}`);
  }
  async function execute(tx: Transaction, p?: Pending) {
    check(); tx.setSender(owner);
    setStatus('지갑에서 트랜잭션을 확인해주세요.');
    const signed = await dapp.signTransaction({ transaction:tx }); check();
    const bytes = fromBase64(signed.bytes);
    const digest = await Transaction.from(bytes).getDigest({ client });
    if (p) { p.digest = digest; await pending(owner, requirePackage(), 'put',p); setSavedPending({...p}); }
    check(); setStatus(`체인 확인 중 · ${digest}`);
    const result = await client.core.executeTransaction({ transaction:bytes, signatures:[signed.signature] });
    if (result.FailedTransaction) {
      if (p) { delete p.digest; await pending(owner,requirePackage(),'put',p); setSavedPending({...p}); }
      throw Error(`체인 실행 실패: ${result.FailedTransaction.status.error?.message ?? '알 수 없는 오류'}`);
    }
    await client.core.waitForTransaction({ digest }); check();
    return digest;
  }
  async function resume(p: Pending) {
    check();
    if (p.owner !== owner || p.packageId !== requirePackage()) throw Error('다른 지갑 또는 패키지의 작업입니다.');
    if (!p.digest && p.asset) {
      const fresh = (await discover(owner)).find(a => a.id === p.asset!.id);
      check();
      if (!fresh || fresh.revision !== p.asset.revision) throw Error('소유권 또는 보관 버전이 변경됐습니다. 대기 파일을 백업한 후 대기를 해제하고 최신 기록을 복원해주세요.');
    }
    if (p.digest) {
      setStatus('이전 거래 결과를 조회합니다. 새 거래를 보내지 않습니다.');
      const result = await client.core.getTransaction({ digest:p.digest });
      if (result.FailedTransaction) {
        delete p.digest; await pending(owner,requirePackage(),'put',p); setSavedPending({...p});
        throw Error('이전 거래가 실패했습니다. 최신 자산을 조회한 후 다시 확인해주세요.');
      }
    } else {
      if (!p.ref) {
        setStatus('Walrus 업로드 및 파일 무결성 확인 중…');
        p.ref = await upload(p.bytes,owner); check();
        await pending(owner,requirePackage(),'put',p); setSavedPending({...p});
      }
      await execute(p.kind === 'vault' ? publishVault(p.asset!,p.ref) : publishCharacter(owner,p.ref,p.asset),p);
    }
    check(); await pending(owner,requirePackage(),'delete'); setSavedPending(undefined);
    if (p.kind === 'vault') { setDirty(false); setData(null); }
    await refresh(); setStatus('보관 확정 완료 · 같은 지갑으로 새 브라우저에서 복원할 수 있습니다.');
  }
  async function stage(p: Pending) {
    if (savedPending || await pending(owner,requirePackage(),'get')) throw Error('먼저 이전 보관 작업을 마무리해주세요.');
    await pending(owner,requirePackage(),'put',p); setSavedPending(p); await resume(p);
  }
  async function createCharacter() {
    if (!consent) throw Error('공개 이름과 소개의 게시 동의가 필요합니다.');
    const manifest = publicSchema.parse({ schemaVersion:1,kind:'character-public',network,appPackage:requirePackage(),
      revision:'0',previousRef:null,createdAt:new Date().toISOString(),name,description });
    await stage({ owner,packageId:requirePackage(),kind:'public',bytes:encode(manifest) });
    setName(''); setDescription(''); setConsent(false);
  }
  const vault = assets.find(a => a.id === vaultId && a.type === 'UserVault');
  const character = assets.find(a => a.id === selected && a.type === 'Character');
  async function unlock() {
    if (!vault) throw Error('개인 보관함을 먼저 만들어주세요.');
    if (dirty) throw Error('변경 내용을 보관 확정한 후 복원해주세요.');
    let restored: VaultManifest;
    if (vault.ref) {
      setStatus('Seal 승인을 받아 개인 기록을 복호화합니다.');
      const bytes = await cipher().decrypt(owner,vault.id,await download(vault.ref),sign); check();
      restored = vaultSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
      assertContext(restored,requirePackage(),vault.revision,vault.id);
    } else restored = { schemaVersion:1,kind:'vault',network,appPackage:requirePackage(),subjectId:vault.id,
      revision:vault.revision,previousRef:null,createdAt:new Date().toISOString(),settings:{},conversations:[],photos:[] };
    check(); setData(restored); setConversationId(''); setStatus('개인 기록 열기 완료 · API 없이 복원했습니다.');
  }
  function change(value: VaultManifest) { setData(value); setDirty(true); }
  async function archive() {
    if (!data || !vault || data.subjectId !== vault.id) throw Error('개인 보관함을 먼저 열어주세요.');
    if (data.revision !== vault.revision) throw Error('최신 보관함을 복원한 후 변경 내용을 합쳐주세요.');
    const manifest = vaultSchema.parse({ ...data,revision:(BigInt(vault.revision)+1n).toString(),previousRef:vault.ref?.blobId ?? null,createdAt:new Date().toISOString() });
    const bytes = encode(manifest);
    if (bytes.length > MAX_BYTES - 32768) throw Error('보관함이 8MB 제한을 초과했습니다. 사진을 줄여주세요.');
    setStatus('브라우저에서 비공개 기록 암호화 중…');
    const encrypted = await cipher().encrypt(vault.id,bytes); check();
    await stage({ owner,packageId:requirePackage(),kind:'vault',asset:vault,bytes:encrypted });
  }
  async function addPhoto(file: File) {
    if (!data || !character) throw Error('캐릭터를 선택하고 보관함을 열어주세요.');
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 2_000_000) throw Error('2MB 이하 PNG·JPEG·WebP 사진을 선택해주세요.');
    const bitmap = await createImageBitmap(file);
    const pixels = bitmap.width * bitmap.height; bitmap.close();
    if (pixels > 20_000_000) throw Error('사진 해상도가 너무 큽니다.');
    const bytes = new Uint8Array(await file.arrayBuffer()); check();
    const next = vaultSchema.parse({ ...data, photos:[...data.photos,{ id:crypto.randomUUID(),characterId:character.id,name:file.name,mime:file.type,data:toBase64(bytes),createdAt:new Date().toISOString() }] });
    change(next); setStatus('사진 추가 완료 · 아직 메모리 임시 상태입니다. 보관 확정해주세요.');
  }
  const conversation = data?.conversations.find(c => c.id === conversationId && c.characterId === selected);
  function startConversation() {
    if (!data || !character) return;
    const id = crypto.randomUUID();
    change({ ...data,conversations:[...data.conversations,{ id,characterId:character.id,kind:episode ? 'episode':'ordinary',episode,messages:[] }] });
    setConversationId(id);
  }
  async function sendTurn() {
    if (!data || !character || !conversation || !message.trim()) throw Error('대화를 선택하고 메시지를 입력해주세요.');
    if (!token.current) await login();
    const id = crypto.randomUUID();
    const user = { id:crypto.randomUUID(),turnId:id,role:'user' as const,content:message,createdAt:new Date().toISOString() };
    const settings = data.settings[character.id] ?? { name:profiles[character.id]?.name ?? '캐릭터',personality:'',callName:'' };
    setStatus('AI 응답 생성 중 · 최근 대화와 설정을 AI 서비스에 전송합니다.');
    const reply = await api<{ content:string; turnId:string }>('/v1/ai/turns',{ requestId:id,character:settings,episode:conversation.episode,
      messages:[...conversation.messages.slice(-38),user].map(({role,content}) => ({role,content})) });
    check();
    change({ ...data,conversations:data.conversations.map(c => c.id === conversation.id ? {...c,messages:[...c.messages,user,
      { id:crypto.randomUUID(),turnId:reply.turnId,role:'assistant',content:reply.content,createdAt:new Date().toISOString() }]} : c) });
    setMessage(''); setStatus('응답 완료 · 대화는 아직 메모리 임시 상태입니다.');
  }
  const settings = data && character ? data.settings[character.id] ?? { name:profiles[character.id]?.name ?? '',personality:'',callName:'' } : null;
  return <>
    <section className="w3-toolbar"><code title={owner}>{owner.slice(0,10)}…{owner.slice(-6)}</code>
      <button disabled={busy} onClick={() => void run(refresh)}>자산 새로고침</button>
      <button disabled={busy || signedIn} onClick={() => void run(login)}>{signedIn ? 'AI 로그인됨' : 'AI 로그인'}</button></section>
    <div className="w3-status" role="status">{status}</div>{error && <div className="w3-error" role="alert">{error}</div>}
    {savedPending && <aside><strong>{savedPending.digest ? '체인 결과 확인 대기' : savedPending.ref ? '업로드 완료 · 체인 미확정' : '암호화/공개 파일 준비 완료'}</strong>
      <p>파일은 이 브라우저에 보관되어 있습니다. 서명을 취소했거나 화면을 닫았어도 같은 파일로 이어갈 수 있어요.</p>
      <button disabled={busy} onClick={() => void run(() => resume(savedPending))}>이전 보관 이어가기</button>
      <button disabled={busy} onClick={() => saveFile(savedPending.bytes,`everyday-pending-${savedPending.kind}.bin`)}>파일 백업</button>
      {!savedPending.digest && <button disabled={busy} onClick={() => void run(async () => {await pending(owner,requirePackage(),'delete');setSavedPending(undefined);setStatus('보관 대기를 해제했습니다. 이미 업로드한 파일은 저장소에 남아 있을 수 있습니다.');})}>보관 대기 해제</button>}</aside>}
    <nav className="w3-tabs">{[['characters','캐릭터'],['private','개인 보관함'],['chat','대화'],['gallery','사진'],['recovery','복원·내보내기']].map(([id,label]) => <button key={id} aria-current={tab === id ? 'page':undefined} onClick={() => setTab(id)}>{label}</button>)}</nav>
    <fieldset disabled={busy} style={{border:0,padding:0,margin:0,minWidth:0}}>
    {assets.some(a => a.type === 'Character') && <label className="w3-select">함께할 캐릭터<select disabled={busy} value={selected} onChange={e => {setSelected(e.target.value);setConversationId('');}}>{assets.filter(a => a.type === 'Character').map(a => <option key={a.id} value={a.id}>{profiles[a.id]?.name ?? a.id.slice(0,14)}</option>)}</select></label>}
    {tab === 'characters' && <section><h2>내가 소유한 캐릭터</h2><p>Sui 지갑이 소유권의 기준입니다. 이름과 소개는 공개로 게시됩니다.</p>
      <div className="w3-cards">{assets.filter(a => a.type === 'Character').map(a => <article key={a.id}><h3>{profiles[a.id]?.name ?? '프로필 읽기 불가'}</h3><p>{profiles[a.id]?.description}</p><code>{a.id.slice(0,14)}… · v{a.revision}</code><p className="w3-small">저장 종료 epoch {a.ref?.endEpoch}</p></article>)}</div>
      {!assets.length && <aside>자산을 새로고침해보세요. 처음이라면 캐릭터와 개인 보관함을 만들어주세요.</aside>}
      <h3>새 캐릭터 만들기</h3><label>공개 이름<input maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label>
      <label>공개 소개<textarea maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} /></label>
      <label className="w3-check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />이 이름과 소개를 누구나 읽을 수 있게 공개합니다.</label>
      <button className="w3-primary" disabled={busy || !!savedPending || !consent || !name.trim()} onClick={() => void run(createCharacter)}>Walrus 게시 후 캐릭터 생성</button>
      <p className="w3-small">설정된 publisher의 저장 비용과 내 지갑의 SUI 가스가 필요합니다. 공개된 복사본은 회수할 수 없습니다.</p>
    </section>}
    {(tab === 'private' || tab === 'chat' || tab === 'gallery') && <section className="w3-vaultbar"><h3>개인 보관함</h3>
      {assets.filter(a => a.type === 'UserVault').length > 1 && <label>보관함 선택<select value={vaultId} disabled={busy || dirty} onChange={e => { setVaultId(e.target.value);setData(null); }}>
        {assets.filter(a => a.type === 'UserVault').map(a => <option key={a.id} value={a.id}>{a.id.slice(0,14)} · v{a.revision}</option>)}</select></label>}
      {vault ? <><span>{data ? dirty ? '메모리 임시 변경 있음' : `열림 · v${data.revision}` : '잠김'} · {vault.ref ? `종료 epoch ${vault.ref.endEpoch}` : '비어 있음'}</span>
        <button disabled={busy || dirty} onClick={() => void run(unlock)}>지갑으로 열기·복원</button><button disabled={busy || !data || !dirty || !!savedPending} onClick={() => void run(archive)}>암호화 후 보관 확정</button></>
      : <button disabled={busy} onClick={() => void run(async () => { await execute(createVault());await refresh(); })}>개인 보관함 만들기</button>}
      <p className="w3-small">보관 확정 전 변경은 메모리에만 있습니다. 새로고침·지갑 전환 전에 확정해주세요. 확정 준비가 끝난 암호문은 브라우저에 저장됩니다.</p></section>}
    {tab === 'private' && <section><h2>우리만의 설정</h2>{settings && data && character ? <>
      <label>개인 이름<input maxLength={80} value={settings.name} onChange={e => change({...data,settings:{...data.settings,[character.id]:{...settings,name:e.target.value}}})} /></label>
      <label>나를 부르는 호칭<input maxLength={80} value={settings.callName} onChange={e => change({...data,settings:{...data.settings,[character.id]:{...settings,callName:e.target.value}}})} /></label>
      <label>성격·말투<textarea maxLength={4000} value={settings.personality} onChange={e => change({...data,settings:{...data.settings,[character.id]:{...settings,personality:e.target.value}}})} /></label>
      <p>설정·대화·사진은 Seal로 암호화합니다. 캐릭터를 이전해도 이 보관함은 내 지갑에 남습니다.</p></> : <p>캐릭터를 선택하고 개인 보관함을 열어주세요.</p>}</section>}
    {tab === 'chat' && <section><h2>오늘의 이야기</h2><p>AI 대화 시 최근 문맥과 설정을 AI 서비스에 보냅니다. AI 제공자는 해당 내용을 볼 수 있습니다.</p>
      <label>에피소드 상황 (비우면 일반 대화)<input maxLength={1000} value={episode} onChange={e => setEpisode(e.target.value)} /></label>
      <button disabled={busy || !data || !character} onClick={startConversation}>새 대화 시작</button>
      <label>대화 기록<select value={conversationId} onChange={e => setConversationId(e.target.value)}><option value="">대화를 선택해주세요</option>{data?.conversations.filter(c => c.characterId === selected).map((c,i) => <option key={c.id} value={c.id}>{i+1}. {c.episode || '일반 대화'} · {c.messages.length}개 메시지</option>)}</select></label>
      <div className="w3-messages">{conversation?.messages.map(m => <div className={`w3-message ${m.role}`} key={m.id}><small>{m.role === 'user' ? '나' : settings?.name || profiles[selected]?.name || '캐릭터'}</small><p>{m.content}</p></div>)}</div>
      <label>메시지<textarea value={message} maxLength={8000} onChange={e => setMessage(e.target.value)} /></label>
      <button className="w3-primary" disabled={busy || !conversation || !message.trim()} onClick={() => void run(sendTurn)}>보내기</button></section>}
    {tab === 'gallery' && <section><h2>나만의 사진</h2><p>사진은 공개하지 않고 개인 보관함에 암호화합니다. 현재는 직접 사진 추가를 지원합니다.</p>
      <label>사진 추가 (2MB 이하)<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !data || !character} onChange={e => {const file=e.target.files?.[0];if(file) void run(() => addPhoto(file));e.target.value='';}} /></label>
      <div className="w3-gallery">{data?.photos.filter(p => p.characterId === selected).map(p => <figure key={p.id}><img src={`data:${p.mime};base64,${p.data}`} alt={p.name} /><figcaption>{p.name}</figcaption><button onClick={() => saveFile(fromBase64(p.data),p.name,p.mime)}>다운로드</button></figure>)}</div></section>}
    {tab === 'recovery' && <section><h2>내 기록은 내 지갑에서</h2><p>자산 조회와 Walrus·Seal 복원은 Everyday API나 DB를 사용하지 않습니다. 같은 패키지·저장소·키 서버 설정이 필요합니다.</p>
      <button disabled={busy} onClick={() => void run(refresh)}>Sui에서 다시 찾기</button><button disabled={busy || !vault || dirty} onClick={() => void run(unlock)}>개인 기록 복원</button>
      <button disabled={busy || !data} onClick={() => data && saveFile(encode(data),'everyday-private-export.json','application/json')}>열린 기록 평문 내보내기</button>
      <p className="w3-small">평문 내보내기에는 개인 대화·사진이 포함됩니다. 본인이 보관할 파일입니다.</p>
      {assets.filter(a => a.ref).map(a => <article key={a.id}><code>{a.type} · {a.id.slice(0,14)}…</code><p>revision {a.revision} · 저장 종료 epoch {a.ref!.endEpoch}</p>
        <button disabled={busy} onClick={() => void run(async () => saveFile(await download(a.ref!),`everyday-${a.id}.${a.type === 'UserVault' ? 'seal':'json'}`))}>원본 {a.type === 'UserVault' ? '암호문':'파일'} 백업</button></article>)}
      <button disabled={!assets.length} onClick={() => saveFile(encode({ network,packageId:requirePackage(),owner,assets }), 'everyday-recovery-index.json','application/json')}>복원 참조 목록 내보내기</button>
      <aside>저장 기한 만료 후 파일 가용성은 보장되지 않습니다. 현재 자동 연장·가스 후원은 연결되지 않았습니다. 지갑이나 Seal 키 서버 접근을 잃으면 비공개 복원이 어려울 수 있습니다.</aside>
      {character && <><h3>캐릭터 소유권 이전</h3><p>공개 프로필만 이전됩니다. 기존 개인 대화·사진은 내 보관함에 남습니다.</p><label>받는 Sui 주소<input value={recipient} onChange={e => setRecipient(e.target.value)} /></label>
        <button disabled={busy || dirty || !isValidSuiAddress(recipient)} onClick={() => void run(async () => {await execute(transferCharacter(character,recipient));await refresh();setRecipient('');})}>지갑에서 이전 내용 확인</button></>}
    </section>}
    </fieldset><footer>Everyday · Sui 소유권 / Walrus 저장 / Seal 비공개 보관</footer>
  </>;
}
