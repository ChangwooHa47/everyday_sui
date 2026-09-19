"use client";

import { useRouter } from 'next/navigation';
import { formatPrice } from '@/lib/market';
import type { CommunityCard } from '@/lib/community';
import { Icon } from '../icons';

/** 캐릭터 프로필 카드 — 초상 3:4, 이름·관계, 한 줄 소개, 구매자·대화 수, 가격은 작게. 찜은 기기 저장. */
export function ListingCard({ card, saved, onToggleSave }: { card: CommunityCard; saved: boolean; onToggleSave: (id: string) => void }) {
  const router = useRouter();
  const { listing, preview, engagement } = card;
  const href = `/community/detail?listing=${encodeURIComponent(listing.id)}`;
  const buyers = listing.buyerCount ? Number(listing.buyerCount) : 0;
  return (
    <article style={{ borderRadius: 16, overflow: 'hidden', background: '#fff', border: '1px solid var(--gray-200)', display: 'flex', flexDirection: 'column' }}>
      <div role="link" tabIndex={0} onClick={() => router.push(href)} onKeyDown={e => { if (e.key === 'Enter') router.push(href); }}
        style={{ position: 'relative', aspectRatio: '3 / 4', background: 'linear-gradient(160deg, var(--orange-100), var(--orange-400))', cursor: 'pointer' }}>
        {preview?.imageUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={preview.imageUrl} alt={listing.title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 44 }}>🙂</div>}
        <button type="button" aria-pressed={saved} aria-label={saved ? '찜 해제' : '찜하기'}
          onClick={e => { e.stopPropagation(); onToggleSave(listing.id); }}
          style={{ position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: '50%', border: 0, display: 'grid', placeItems: 'center',
            background: 'rgba(255,255,255,0.92)', color: saved ? 'var(--orange-700)' : 'var(--gray-500)', cursor: 'pointer', transition: 'color 200ms var(--ease)' }}>
          <Icon name="heart" size={18} />
        </button>
        {preview?.relationshipType && <span className="point-badge" style={{ position: 'absolute', left: 8, bottom: 8, padding: '3px 8px', fontSize: 11 }}>{preview.relationshipType}</span>}
      </div>
      <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
          <strong className="label1" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{listing.title}</strong>
          <span className="caption" style={{ color: 'var(--orange-700)', fontWeight: 700, flexShrink: 0 }}>{formatPrice(listing.priceMist)}</span>
        </div>
        <p className="caption" style={{ margin: 0, color: 'var(--gray-600)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 36 }}>
          {preview?.summary || '소개가 아직 없어요.'}
        </p>
        <div className="caption" style={{ color: 'var(--gray-500)', marginTop: 'auto' }}>
          {[buyers ? `${buyers}명과 함께` : '첫 구매자를 기다려요', engagement ? `대화 ${engagement.turns}회` : null].filter(Boolean).join(' · ')}
        </div>
      </div>
    </article>
  );
}
