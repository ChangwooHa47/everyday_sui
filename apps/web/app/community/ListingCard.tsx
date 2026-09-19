"use client";

import { useRouter } from 'next/navigation';
import { formatPrice } from '@/lib/market';
import { buyersLabel, type CommunityCard } from '@/lib/community';
import { marketImageSources } from '@/lib/market-images';
import { ResilientImage } from '../components';
import { Icon } from '../icons';

/**
 * 이미지 오버레이 카드 (figma Develop · 06 마켓 CharacterCard). 초상 위에 어두운 그라데이션,
 * 제목 16 · 가격은 --key-deep · 메타는 흰색 60%. 모서리 4px. 찜 하트는 우상단.
 */
export function ListingCard({ card, saved, onToggleSave }: { card: CommunityCard; saved: boolean; onToggleSave: (id: string) => void }) {
  const router = useRouter();
  const { listing, preview, engagement } = card;
  const href = `/community/detail?listing=${encodeURIComponent(listing.id)}`;
  const meta = buyersLabel(card);
  const imageSources = marketImageSources(listing, preview?.imageUrl);
  return (
    <article
      style={{ position: 'relative', aspectRatio: '159.5 / 252.5', borderRadius: 4, overflow: 'hidden',
        background: 'linear-gradient(160deg, var(--orange-100), var(--orange-400))', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 40 }} aria-hidden>🙂</div>
      <ResilientImage sources={imageSources} alt={listing.title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      {/* 카드 전체를 덮는 이동 버튼. 찜 버튼은 그 위(zIndex 2)에 두어 중첩 인터랙티브를 피한다. */}
      <button type="button" aria-label={`${listing.title} 프로필 보기`} onClick={() => router.push(href)}
        style={{ position: 'absolute', inset: 0, zIndex: 1, border: 0, padding: 0, background: 'transparent', cursor: 'pointer' }} />
      <button type="button" aria-pressed={saved} aria-label={saved ? '찜 해제' : '찜하기'}
        onClick={() => onToggleSave(listing.id)}
        style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, width: 28, height: 28, borderRadius: '50%', border: 0, display: 'grid', placeItems: 'center',
          background: saved ? 'var(--key)' : 'rgba(255,255,255,0.9)', color: saved ? '#fff' : 'var(--gray-500)', cursor: 'pointer', transition: 'all 200ms var(--ease)' }}>
        <Icon name="heart" size={16} />
      </button>
      {preview?.relationshipType && (
        <span style={{ position: 'absolute', top: 8, left: 8, zIndex: 2, padding: '3px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: 500, color: 'var(--black)' }}>
          {preview.relationshipType}
        </span>
      )}
      <div style={{ position: 'relative', zIndex: 0, padding: '28px 10px 16px', display: 'flex', flexDirection: 'column', gap: 4,
        background: 'var(--overlay-scrim)' }}>
        <strong style={{ color: '#fff', fontSize: 16, fontWeight: 500, letterSpacing: '-0.07em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{listing.title}</strong>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
          <span style={{ color: 'var(--key-deep)', fontSize: 14, fontWeight: 600, letterSpacing: '-0.02em' }}>{formatPrice(listing.priceMist)}</span>
          <span aria-hidden style={{ color: 'var(--on-overlay-muted)', fontSize: 12, fontWeight: 500 }}>·</span>
          <span style={{ color: 'var(--on-overlay-muted)', fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta}</span>
        </div>
      </div>
    </article>
  );
}
