"use client";

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { NftGiftProduct } from '@everyday/contracts';
import { nftGifts } from '@/lib/gifts';
import { formatPrice } from '@/lib/market';
import { Icon } from '../../../icons';

function GiftDetail() {
  const router = useRouter();
  const id = useSearchParams().get('product') ?? '';
  const [gift, setGift] = useState<NftGiftProduct | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (!id) { setError('선물 정보를 찾을 수 없어요.'); return; }
    void nftGifts.detail(id).then(value => { if (active) setGift(value); })
      .catch(() => { if (active) setError('선물 정보를 불러오지 못했어요.'); });
    return () => { active = false; };
  }, [id]);
  async function purchase() {
    if (!gift || busy) return;
    setBusy(true); setError('');
    try { await nftGifts.purchase(gift); router.push('/my/gifts'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '구매를 완료하지 못했어요.'); setBusy(false); }
  }
  const soldOut = gift ? BigInt(gift.minted) >= BigInt(gift.maxSupply) : false;
  return <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--gray-50)' }}>
    <header className="topbar" style={{ background: '#fff' }}>
      <button className="nav-btn nav-prev" onClick={() => router.back()} aria-label="이전"><Icon name="chevron-left" size={24}/></button>
      <span className="headline1">NFT 선물</span><span style={{ width: 24 }}/>
    </header>
    <main style={{ flex: 1, padding: '16px 20px 28px' }}>
      {gift && <>
        <div style={{ aspectRatio: '1', borderRadius: 24, overflow: 'hidden', background: 'var(--orange-100)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}<img src={gift.imageUrl} alt={gift.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
        </div>
        <section style={{ padding: '24px 4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <h1 className="h2" style={{ margin: 0 }}>{gift.title}</h1><strong>{formatPrice(gift.priceMist)}</strong>
          </div>
          <p className="body1" style={{ color: 'var(--gray-700)' }}>{gift.description}</p>
          <p className="caption" style={{ color: 'var(--gray-500)' }}>에디션 {gift.minted} / {gift.maxSupply}</p>
        </section>
      </>}
      {error && <p role="alert" className="body2" style={{ color: 'var(--gray-700)' }}>{error}</p>}
    </main>
    {gift && <div style={{ position: 'sticky', bottom: 0, padding: '12px 20px calc(16px + env(safe-area-inset-bottom))', background: '#fff' }}>
      <button className="cta" disabled={busy || soldOut || !gift.active} onClick={() => void purchase()}>{busy ? '구매 중…' : soldOut ? '품절' : '내 지갑으로 구매하기'}</button>
    </div>}
  </div>;
}
export default function GiftDetailPage() { return <Suspense fallback={null}><GiftDetail/></Suspense>; }
