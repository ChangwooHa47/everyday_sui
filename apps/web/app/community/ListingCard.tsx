"use client";

import { useRouter } from 'next/navigation';
import { formatPrice } from '@/lib/market';
import type { CommunityCard } from '@/lib/community';
import { Icon } from '../icons';

/**
 * 이미지 오버레이 카드 (figma Develop · 06 마켓 CharacterCard). 초상 위에 어두운 그라데이션,
 * 제목 16 · 가격은 --key-deep · 메타는 흰색 60%. 모서리 4px. 찜 하트는 우상단.
 */
export function ListingCard({ card, saved, onToggleSave }: { card: CommunityCard; saved: boolean; onToggleSave: (id: string) => void }) {
  const router = useRouter();
  const { listing, preview, engagement } = card;
  const href = `/community/detail?listing=${encodeURIComponent(listing.id)}`;
  const buyers = listing.buyerCount ? Number(listing.buyerCount) : 0;
  const meta = buyers ? `${buyers}명과 함께` : engagement ? `대화 ${engagement.turns}회` : '첫 구매자를 기다려요';
  return (
    <article role="link" tabIndex={0} onClick={() => router.push(href)} onKeyDown={e => { if (e.key === 'Enter') router.push(href); }}
      style={{ position: 'relative', aspectRatio: '159.5 / 252.5', borderRadius: 4, overflow: 'hidden', cursor: 'pointer',
        background: 'linear-gradient(160deg, var(--orange-100), var(--orange-400))', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      {preview?.imageUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={preview.imageUrl} alt={listing.title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        : <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 40 }}>🙂</div>}
      <button type="button" aria-pressed={saved} aria-label={saved ? '찜 해제' : '찜하기'}
        onClick={e => { e.stopPropagation(); onToggleSave(listing.id); }}
        style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: '50%', border: 0, display: 'grid', placeItems: 'center',
          background: saved ? 'var(--key)' : 'rgba(255,255,255,0.9)', color: saved ? '#fff' : 'var(--gray-500)', cursor: 'pointer', transition: 'all 200ms var(--ease)' }}>
        <Icon name="heart" size={16} />
      </button>
      {preview?.relationshipType && (
        <span style={{ position: 'absolute', top: 8, left: 8, padding: '3px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: 500, color: 'var(--black)' }}>
          {preview.relationshipType}
        </span>
      )}
      <div style={{ position: 'relative', padding: '28px 10px 16px', display: 'flex', flexDirection: 'column', gap: 4,
        background: 'linear-gradient(180deg, rgba(20,18,16,0) 0%, rgba(20,18,16,0.6) 36%, rgba(20,18,16,0.82) 100%)' }}>
        <strong style={{ color: '#fff', fontSize: 16, fontWeight: 500, letterSpacing: '-0.07em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{listing.title}</strong>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
          <span style={{ color: 'var(--key-deep)', fontSize: 14, fontWeight: 600, letterSpacing: '-0.02em' }}>{formatPrice(listing.priceMist)}</span>
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}><b>· </b>{meta}</span>
        </div>
      </div>
    </article>
  );
}
