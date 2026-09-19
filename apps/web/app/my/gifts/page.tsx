"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OwnedNftGiftItem } from '@everyday/contracts';
import { nftGiftImageSources, nftGifts } from '@/lib/gifts';
import { Icon } from '../../icons';
import { BottomNav, ResilientImage } from '../../components';

export default function MyGiftsPage() {
  const router = useRouter(); const [gifts, setGifts] = useState<OwnedNftGiftItem[]>([]); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const [receiveEnabled, setReceiveEnabled] = useState(false); const [blocked, setBlocked] = useState<string[]>([]);
  const [collections, setCollections] = useState<{ id: string; name: string }[]>([]); const [saving, setSaving] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  useEffect(() => {
    let active = true;
    void nftGifts.owned().then(owned => { if (active) setGifts(owned); })
      .catch(() => { if (active) setError('보유 선물을 불러오지 못했어요.'); })
      .finally(() => { if (active) setLoading(false); });
    void Promise.all([nftGifts.preferences(), nftGifts.collections()]).then(([preferences, configured]) => {
      if (!active) return;
      setReceiveEnabled(preferences.receiveEnabled); setBlocked(preferences.blockedPolicyIds);
      setCollections(configured.map(item => ({ id: item.id, name: item.name }))); setSettingsReady(true);
    }).catch(() => { if (active) setSettingsError('외부 NFT 수신 설정을 불러오지 못했어요.'); });
    return () => { active = false; };
  }, []);
  async function save(nextEnabled: boolean, nextBlocked: string[]) {
    if (saving || !settingsReady) return; setSaving(true); setSettingsError('');
    try { const saved = await nftGifts.savePreferences(nextEnabled, nextBlocked); setReceiveEnabled(saved.receiveEnabled); setBlocked(saved.blockedPolicyIds); }
    catch { setSettingsError('외부 NFT 수신 설정을 저장하지 못했어요.'); } finally { setSaving(false); }
  }
  return <div style={{ minHeight: '100dvh', background: 'var(--gray-50)' }}>
    <header className="topbar" style={{ background: '#fff' }}><button className="nav-btn nav-prev" onClick={() => router.back()} aria-label="이전"><Icon name="chevron-left" size={24}/></button><span className="headline1">내 NFT 선물</span><span style={{ width: 24 }}/></header>
    <main style={{ padding: 20 }}>
      <section style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 16, padding: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div><strong className="body1">캐릭터의 외부 NFT 선물</strong><p className="caption" style={{ color: 'var(--gray-500)', margin: '4px 0 0' }}>직접 구매는 항상 가능하고, 이 설정은 캐릭터가 보내는 외부 NFT에만 적용돼요.</p></div>
          <button className="chip" disabled={saving || !settingsReady} onClick={() => void save(!receiveEnabled, blocked)}>{receiveEnabled ? '받는 중' : '받지 않음'}</button>
        </div>
        {receiveEnabled && collections.length > 0 && <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {collections.map(collection => { const isBlocked = blocked.includes(collection.id); return <button key={collection.id} className="chip" disabled={saving}
            onClick={() => void save(receiveEnabled, isBlocked ? blocked.filter(id => id !== collection.id) : [...blocked, collection.id])}
            style={{ opacity: isBlocked ? 0.55 : 1 }}>{collection.name} · {isBlocked ? '차단됨' : '허용'}</button>; })}
        </div>}
      </section>
      {settingsError && <p role="alert" className="body2">{settingsError}</p>}
      {loading && <p className="body2">불러오는 중…</p>}{error && <p role="alert" className="body2">{error}</p>}
      {!loading && !error && gifts.length === 0 && <div style={{ padding: '72px 24px', textAlign: 'center' }}><div style={{ fontSize: 44 }}>🎁</div><p className="headline2">아직 받은 NFT 선물이 없어요.</p><button className="chip" onClick={() => router.push('/market')}>선물 둘러보기</button></div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{gifts.map(gift => <article key={gift.id} style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ aspectRatio: '1', background: 'var(--orange-100)' }}><ResilientImage sources={nftGiftImageSources(gift)} alt={gift.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }}/></div>
        <div style={{ padding: 12 }}><strong className="body2">{gift.title}</strong><div className="caption" style={{ color: 'var(--gray-500)', marginTop: 4 }}>
          {gift.kind === 'external' ? `외부 NFT · ${gift.collectionName}` : `#${gift.edition}`}</div></div>
      </article>)}</div>
    </main>
    <BottomNav active="my" />
  </div>;
}
