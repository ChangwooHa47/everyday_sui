"use client";

import { useEffect, useState } from 'react';
import type { MarketListing } from '@everyday/contracts';
import { backend } from '@/lib/api';
import { formatPrice, marketRequest } from '@/lib/market';

/**
 * 구매한 캐릭터의 금고 상태. 이용권 판매의 캐릭터 몫이 쌓이는 Listing 금고와 오늘 남은 선물 예산을 보여준다.
 * 직접 만든 미게시 캐릭터에는 금고가 없으므로 호출하지 않는다 (기획안 5.1).
 */
export function CharacterFunds({ characterId, name }: { characterId: number; name: string }) {
  const [listing, setListing] = useState<MarketListing | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const binding = await backend.licenseBinding(characterId);
        if (!binding) throw Error('no license');
        const found = await marketRequest<{ listing: MarketListing }>(`/v1/market/listings/${encodeURIComponent(binding.listingId)}`);
        if (active) { setListing(found.listing); setState('ready'); }
      } catch { if (active) setState('error'); }
    })();
    return () => { active = false; };
  }, [characterId]);

  const spent = BigInt(listing?.policy.spentTodayMist ?? '0');
  const daily = BigInt(listing?.policy.dailyLimitMist ?? '0');
  const remaining = daily > spent ? daily - spent : 0n;
  const giftsOn = listing ? BigInt(listing.policy.perGiftLimitMist) > 0n && listing.policy.allowedGiftIds.length > 0 : false;

  return <section style={{ marginTop: 24 }}>
    <div className="cp-secTitle" style={{ cursor: 'default' }}><span className="label1">캐릭터 자금</span></div>
    <div className="cp-callBox" style={{ marginTop: 8 }}>
      {state === 'loading' && <div className="skeleton" style={{ height: 44, borderRadius: 10 }} />}
      {state === 'error' && <p className="caption" role="alert" style={{ margin: 0 }}>금고 정보를 불러오지 못했어요.</p>}
      {state === 'ready' && listing && <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div className="caption" style={{ color: 'var(--gray-600)' }}>금고 잔액</div>
            <div className="headline1">{formatPrice(listing.treasuryMist)}</div>
          </div>
          <div>
            <div className="caption" style={{ color: 'var(--gray-600)' }}>오늘 남은 선물 예산</div>
            <div className="headline1">{giftsOn ? formatPrice(remaining.toString()) : '—'}</div>
          </div>
        </div>
        <p className="caption" style={{ marginTop: 10, marginBottom: 0, color: 'var(--gray-600)' }}>
          {giftsOn
            ? `이용권 판매액의 ${listing.agentBps / 100}%가 쌓여요. ${name}(이)가 대화 중에 선물 상품 ${listing.policy.allowedGiftIds.length}개 중 하나를 고를 수 있고, 이 캐릭터를 산 사람들이 예산을 함께 써요.`
            : `이용권 판매액의 ${listing.agentBps / 100}%가 쌓이지만, 이 캐릭터는 선물 기능이 꺼진 상태로 등록됐어요.`}
        </p>
      </>}
    </div>
  </section>;
}
