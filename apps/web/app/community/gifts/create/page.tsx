"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { nftGifts } from '@/lib/gifts';
import { priceToMist } from '@/lib/sui-amount';
import { formatPrice } from '@/lib/market';
import type { ExternalNftCollection, ExternalNftGiftProduct } from '@everyday/contracts';
import { Icon } from '../../../icons';

export default function ExternalNftOfferPage() {
  const router = useRouter();
  const [collections, setCollections] = useState<ExternalNftCollection[]>([]);
  const [policyId, setPolicyId] = useState(''); const [objectId, setObjectId] = useState('');
  const [title, setTitle] = useState(''); const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState(''); const [imageHash, setImageHash] = useState('');
  const [price, setPrice] = useState('0.001'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [offers, setOffers] = useState<ExternalNftGiftProduct[]>([]); const [withdrawing, setWithdrawing] = useState('');
  useEffect(() => { let active = true; void Promise.all([nftGifts.collections(), nftGifts.offers()]).then(([items, ownOffers]) => { if (!active) return;
    const live = items.filter(item => item.active); setCollections(live); setPolicyId(live[0]?.id ?? ''); setOffers(ownOffers);
  }).catch(() => { if (active) setError('승인된 외부 컬렉션을 불러오지 못했어요.'); }); return () => { active = false; }; }, []);
  async function submit() {
    if (busy) return; setBusy(true); setError('');
    try {
      if (!/^0x[0-9a-f]{64}$/.test(objectId) || !/^[0-9a-f]{64}$/.test(imageHash)) throw Error('NFT 주소와 이미지 해시를 확인해주세요.');
      await nftGifts.createExternalOffer({ policyId, objectId, title, description, imageUrl, imageHash, priceMist: priceToMist(price) });
      router.push('/community');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '외부 NFT를 등록하지 못했어요.'); setBusy(false); }
  }
  async function withdraw(offer: ExternalNftGiftProduct) {
    if (withdrawing) return; setWithdrawing(offer.id); setError('');
    try { await nftGifts.withdrawExternalOffer(offer); setOffers(current => current.filter(item => item.id !== offer.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'NFT를 회수하지 못했어요.'); }
    finally { setWithdrawing(''); }
  }
  return <div style={{ minHeight: '100dvh', background: 'var(--gray-50)' }}>
    <header className="topbar" style={{ background: '#fff' }}><button className="nav-btn nav-prev" onClick={() => router.back()} aria-label="이전"><Icon name="chevron-left" size={24}/></button><span className="headline1">외부 NFT 등록</span><span style={{ width: 24 }}/></header>
    <main style={{ padding: 20, maxWidth: 560, margin: '0 auto' }}>
      <section style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 18, padding: 18 }}>
        <p className="body2" style={{ color: 'var(--gray-600)', marginTop: 0 }}>운영자가 승인한 컬렉션의 전송 가능한 NFT만 등록할 수 있어요. NFT는 오퍼 안에 예치되며 판매 시 SUI 결제와 지갑 전달이 한 거래로 처리됩니다.</p>
        <label className="label1" htmlFor="external-collection">컬렉션</label>
        <select id="external-collection" className="input" value={policyId} onChange={event => setPolicyId(event.target.value)} disabled={busy || collections.length === 0}>
          {collections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <label className="label1" htmlFor="external-object" style={{ display: 'block', marginTop: 14 }}>NFT Object ID</label>
        <input id="external-object" className="input" value={objectId} onChange={event => setObjectId(event.target.value.trim())} placeholder="0x…" disabled={busy}/>
        <label className="label1" htmlFor="external-title" style={{ display: 'block', marginTop: 14 }}>상품명</label>
        <input id="external-title" className="input" value={title} maxLength={240} onChange={event => setTitle(event.target.value)} disabled={busy}/>
        <label className="label1" htmlFor="external-description" style={{ display: 'block', marginTop: 14 }}>설명</label>
        <textarea id="external-description" className="input" value={description} maxLength={2000} onChange={event => setDescription(event.target.value)} disabled={busy} style={{ minHeight: 96 }}/>
        <label className="label1" htmlFor="external-image" style={{ display: 'block', marginTop: 14 }}>HTTPS 이미지 URL</label>
        <input id="external-image" className="input" value={imageUrl} onChange={event => setImageUrl(event.target.value.trim())} placeholder="https://…" disabled={busy}/>
        <label className="label1" htmlFor="external-hash" style={{ display: 'block', marginTop: 14 }}>이미지 SHA-256</label>
        <input id="external-hash" className="input" value={imageHash} maxLength={64} onChange={event => setImageHash(event.target.value.trim().toLowerCase())} placeholder="64자리 hex" disabled={busy}/>
        <label className="label1" htmlFor="external-price" style={{ display: 'block', marginTop: 14 }}>고정 가격 (SUI)</label>
        <input id="external-price" className="input" inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} disabled={busy}/>
        {error && <p role="alert" className="body2" style={{ color: '#d64545' }}>{error}</p>}
        <button className="cta" style={{ marginTop: 18 }} disabled={busy || !policyId || !objectId || !title || !imageUrl || !imageHash}
          onClick={() => void submit()}>{busy ? '등록 중…' : 'NFT 예치하고 등록하기'}</button>
      </section>
      {offers.length > 0 && <section style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 18, padding: 18, marginTop: 16 }}>
        <h2 className="headline2" style={{ margin: '0 0 12px' }}>내 판매 등록</h2>
        {offers.map(offer => <div key={offer.id} style={{ padding: '12px 0', borderTop: '1px solid var(--gray-100)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}><div className="label1" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{offer.title}</div>
            <div className="caption" style={{ color: 'var(--gray-500)' }}>{offer.collectionName} · {formatPrice(offer.priceMist)}</div></div>
          <button className="chip" disabled={Boolean(withdrawing)} onClick={() => void withdraw(offer)}>{withdrawing === offer.id ? '회수 중…' : '판매 취소'}</button>
        </div>)}
      </section>}
    </main>
  </div>;
}
