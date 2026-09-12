"use client";

// 커뮤니티 — figma 42:3227.
// HOT 캐릭터(가로 스크롤) / 인기 설정집(2열) / 자유 게시판(세로 리스트).
// 기존 카드와 간격을 유지하고, 게시된 실제 상품만 표시한다.

import { useEffect, useState } from "react";
import { backend } from "@/lib/api";
import { useRouter } from "next/navigation";
import { market, formatPrice, recommendListings } from "@/lib/market";
import { BottomNav } from "../components";
import type { NftGiftProduct } from '@everyday/contracts';
import { nftGifts } from '@/lib/gifts';

type HotCharacter = { key: string; name: string; imageUrl: string | null; emoji: string; price: string; summary: string; activity: string };

export default function CommunityPage() {
  const router = useRouter();
  const [hot, setHot] = useState<HotCharacter[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [recommended, setRecommended] = useState(false);
  const [gifts, setGifts] = useState<NftGiftProduct[]>([]);
  const [giftsLoading, setGiftsLoading] = useState(true);
  const [giftsError, setGiftsError] = useState(false);
  useEffect(() => {
    let active = true;
    void market.list().then(async catalog => {
      let { listings } = catalog; const { previews } = catalog;
      const from = new URLSearchParams(window.location.search).get('from');
      if (from && /^[1-9]\d*$/.test(from)) {
        const draft = await backend.productDraft(Number(from));
        listings = recommendListings(catalog, draft);
        if (active) setRecommended(true);
      }
      if (active) setHot(listings.filter(c => c.active && c.published).map(c => ({ key: c.id, name: c.title,
        imageUrl: previews[c.id]?.imageUrl ?? null, summary: previews[c.id]?.summary ?? '', emoji: '', price: c.priceMist,
        activity: catalog.engagement?.[c.id] ? `대화 ${catalog.engagement[c.id].turns}회 · 재방문 ${catalog.engagement[c.id].revisitPercent}%` : '' })));
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    void backend.getMe().then(me => { if (active) setPoints(me.points); }).catch(() => {});
    void nftGifts.list().then(value => { if (active) setGifts(value.filter(gift => gift.active)); })
      .catch(() => { if (active) setGiftsError(true); }).finally(() => { if (active) setGiftsLoading(false); });
    return () => { active = false; };
  }, []);
  const packs = hot.map(c => ({ id: c.key, title: c.name, author: c.activity, desc: c.summary, price: c.price, emoji: c.emoji }));

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <header className="topbar">
        <span className="h3">커뮤니티</span>
        <span className="point-badge">
          <span className="p">P</span> {points?.toLocaleString() ?? ""}
        </span>
      </header>
      {error && <p className="body2" role="alert" style={{ padding: '0 20px' }}>{error}</p>}
      {!error && (loading || hot.length === 0) && <p className="body2" style={{ padding: '0 20px' }}>{loading ? '불러오는 중…' : '아직 등록된 캐릭터가 없어요.'}</p>}

      {/* HOT 캐릭터 */}
      <section style={{ marginBottom: 26 }}>
        <div className="label1" style={{ padding: "0 20px 12px" }}>
          {recommended ? '함께 둘러볼 캐릭터' : '마켓 캐릭터'}
        </div>
        <div
          style={{
            display: "flex",
            gap: 12,
            overflowX: "auto",
            padding: "0 20px 2px",
            scrollbarWidth: "none",
          }}
        >
          {hot.map((c) => (
            <div
              key={c.key}
              role="link" tabIndex={0}
              onClick={() => router.push(`/community/detail?listing=${encodeURIComponent(c.key)}`)}
              onKeyDown={e => { if (e.key === "Enter") router.push(`/community/detail?listing=${encodeURIComponent(c.key)}`); }}
              style={{
                flexShrink: 0,
                width: 132,
                aspectRatio: "3 / 4",
                borderRadius: 14,
                position: "relative",
                overflow: "hidden",
                background: "linear-gradient(160deg, var(--orange-100), var(--orange-400))",
              }}
            >
              {c.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.imageUrl}
                  alt={c.name}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 48 }}>
                  {c.emoji}
                </div>
              )}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  padding: "22px 10px 10px",
                  background: "linear-gradient(180deg, transparent, rgba(30,30,30,0.72))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 6,
                }}
              >
                <span
                  title={c.name}
                  style={{
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  {c.name}
                </span>
                <span
                  className="point-badge"
                  style={{ padding: "3px 8px", fontSize: 11 }}
                >
                  {formatPrice(c.price)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: 26 }}>
        <div style={{ padding: '0 20px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="label1">NFT 선물 마켓</span>
          <button className="caption" style={{ border: 0, background: 'none', color: 'var(--gray-500)', cursor: 'pointer' }} onClick={() => router.push('/my/gifts')}>내 선물</button>
        </div>
        {giftsLoading ? <p className="body2" style={{ padding: '0 20px', color: 'var(--gray-500)' }}>선물을 불러오는 중…</p>
          : giftsError ? <p role="alert" className="body2" style={{ padding: '0 20px', color: 'var(--gray-500)' }}>NFT 선물 목록을 불러오지 못했어요.</p>
          : gifts.length === 0 ? <p className="body2" style={{ padding: '0 20px', color: 'var(--gray-500)' }}>판매 준비 중인 NFT 선물이 있어요.</p> :
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '0 20px 2px', scrollbarWidth: 'none' }}>
            {gifts.map(gift => { const soldOut = BigInt(gift.minted) >= BigInt(gift.maxSupply); return <article key={gift.id} role="link" tabIndex={0}
              onClick={() => router.push(`/community/gifts/detail?product=${encodeURIComponent(gift.id)}`)}
              onKeyDown={event => { if (event.key === 'Enter') router.push(`/community/gifts/detail?product=${encodeURIComponent(gift.id)}`); }}
              style={{ flexShrink: 0, width: 148, border: '1px solid var(--gray-200)', borderRadius: 16, overflow: 'hidden', background: '#fff', cursor: 'pointer' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}<img src={gift.imageUrl} alt={gift.title} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', background: 'var(--orange-100)' }}/>
              <div style={{ padding: 12 }}><div className="label1" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{gift.title}</div>
                <div className="caption" style={{ marginTop: 6, color: soldOut ? 'var(--gray-500)' : 'var(--orange-700)', fontWeight: 700 }}>{soldOut ? '품절' : formatPrice(gift.priceMist)}</div></div>
            </article>; })}
          </div>}
      </section>

      {/* 인기 설정집 */}
      <section style={{ marginBottom: 26 }}>
        <div className="label1" style={{ padding: "0 20px 12px" }}>
          캐릭터 이용권
        </div>
        <div
          style={{
            padding: "0 20px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          {packs.map((p) => (
            <div
              key={p.id}
              role="link" tabIndex={0}
              onClick={() => router.push(`/community/detail?listing=${encodeURIComponent(p.id)}`)}
              onKeyDown={e => { if (e.key === "Enter") router.push(`/community/detail?listing=${encodeURIComponent(p.id)}`); }}
              style={{
                borderRadius: 14,
                padding: "14px 14px 16px",
                background: "var(--orange-50)",
                border: "1px solid var(--orange-200)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                <div style={{ minWidth: 0 }}>
                  <div
                    className="headline2"
                    style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {p.title}
                  </div>
                  <div className="caption" style={{ color: "var(--gray-500)" }}>
                    {p.author}
                  </div>
                </div>
                <span style={{ fontSize: 22, flexShrink: 0, lineHeight: 1 }}>{p.emoji}</span>
              </div>
              <div
                className="body2"
                style={{
                  color: "var(--gray-600)",
                  margin: "10px 0 8px",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {p.desc}
              </div>
              <span className="caption" style={{ color: "var(--orange-700)", fontWeight: 700 }}>
                {formatPrice(p.price)}
              </span>
            </div>
          ))}
        </div>
      </section>



      <div style={{ flex: 1 }} />
      <BottomNav active="community" />
    </div>
  );
}
