"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OwnedNftGift } from '@everyday/contracts';
import { nftGifts } from '@/lib/gifts';
import { Icon } from '../../icons';
import { BottomNav } from '../../components';

export default function MyGiftsPage() {
  const router = useRouter(); const [gifts, setGifts] = useState<OwnedNftGift[]>([]); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; void nftGifts.owned().then(value => { if (active) setGifts(value); })
    .catch(() => { if (active) setError('보유 선물을 불러오지 못했어요.'); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  return <div style={{ minHeight: '100dvh', background: 'var(--gray-50)' }}>
    <header className="topbar" style={{ background: '#fff' }}><button className="nav-btn nav-prev" onClick={() => router.back()} aria-label="이전"><Icon name="chevron-left" size={24}/></button><span className="headline1">내 NFT 선물</span><span style={{ width: 24 }}/></header>
    <main style={{ padding: 20 }}>
      {loading && <p className="body2">불러오는 중…</p>}{error && <p role="alert" className="body2">{error}</p>}
      {!loading && !error && gifts.length === 0 && <div style={{ padding: '72px 24px', textAlign: 'center' }}><div style={{ fontSize: 44 }}>🎁</div><p className="headline2">아직 받은 NFT 선물이 없어요.</p><button className="chip" onClick={() => router.push('/community')}>선물 둘러보기</button></div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{gifts.map(gift => <article key={gift.id} style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 16, overflow: 'hidden' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}<img src={gift.imageUrl} alt={gift.title} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', background: 'var(--orange-100)' }}/>
        <div style={{ padding: 12 }}><strong className="body2">{gift.title}</strong><div className="caption" style={{ color: 'var(--gray-500)', marginTop: 4 }}>#{gift.edition}</div></div>
      </article>)}</div>
    </main>
    <BottomNav active="my" />
  </div>;
}
