"use client";

// 커뮤 — 캐릭터가 거래되는 탭. 상단 우측 필 버튼으로 두 뷰를 오간다.
//   Community (figma 27:1089) — 검색 + 포스트형 피드
//   Swipe     (figma 28:1282) — 전체화면 캐릭터 카드 캐러셀, 위쪽 키컬러 그라데이션 배경
// 두 뷰 모두 카드를 누르면 프로필 상세로 가고, 거기서 미리보기 대화와 이용권 구매를 한다.
// NFT 선물 상품은 마켓 탭이 담당한다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MarketCommunity } from "@everyday/contracts";
import { backend } from "@/lib/api";
import { market, recommendListings } from "@/lib/market";
import { marketImageSources } from "@/lib/market-images";
import { buyerCount, community, formatAgo, searchCards, sortCards, toCards, turnCount, type CommunityCard } from "@/lib/community";
import { BottomNav, ResilientImage } from "../components";
import { Icon } from "../icons";

type View = "feed" | "swipe";

/** 피드 글 하나 = 캐릭터 하나. 아바타·이름·등록 시점·소개·대표 초상. */
function Post({ card, onOpen }: { card: CommunityCard; onOpen: () => void }) {
  const { listing, preview } = card;
  const buyers = buyerCount(listing);
  const turns = turnCount(card);
  // 시드 초상은 번들 사본을, Walrus 이미지는 일관성 검사 URL을 먼저 시도한다 (lib/market-images).
  const imageSources = marketImageSources(listing, preview?.imageUrl);
  return (
    <article style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div style={{ width: 42, height: 42, borderRadius: "50%", background: "var(--orange-100)", flexShrink: 0, overflow: "hidden" }}>
            <ResilientImage sources={imageSources} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
            <span style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-0.07em", color: "var(--black)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{listing.title}</span>
            <span style={{ fontSize: 13, fontWeight: 400, letterSpacing: "-0.07em", color: "var(--gray-500)", whiteSpace: "nowrap" }}>{formatAgo(preview?.registeredAt)}</span>
          </div>
        </div>
        <button type="button" aria-label={`${listing.title} 프로필`} onClick={onOpen}
          style={{ width: 28, height: 28, borderRadius: "50%", border: 0, background: "var(--key)", color: "#fff", display: "grid", placeItems: "center", cursor: "pointer", flexShrink: 0 }}>
          <Icon name="arrow-right" size={16} />
        </button>
      </div>
      <p style={{ margin: 0, padding: "2px 0 8px 32px", fontSize: 16, fontWeight: 400, lineHeight: 1.5, letterSpacing: "-0.03em", color: "#121212" }}>
        {preview?.summary || `${listing.title}(이)가 커뮤에 왔어요.`}
        {(buyers !== "0" || turns !== "0") && (
          <span style={{ color: "var(--gray-500)" }}> {[buyers !== "0" ? `${buyers}명과 대화 중` : null, turns !== "0" ? `대화 ${turns}회` : null].filter(Boolean).join(" · ")}</span>
        )}
      </p>
      {imageSources.length > 0 && (
        <div style={{ paddingLeft: 32 }}>
          <button type="button" onClick={onOpen} aria-label={`${listing.title} 프로필 보기`}
            style={{ width: "100%", maxWidth: 267, aspectRatio: "1", borderRadius: 4, overflow: "hidden", border: 0, padding: 0, background: "var(--orange-100)", cursor: "pointer" }}>
            <ResilientImage sources={imageSources} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </button>
        </div>
      )}
    </article>
  );
}

/** 스와이프 카드. 카드 전체가 프로필 상세로 가는 버튼이고, 화살표는 장식이다. */
function SwipeCard({ card, stats, onOpen }: { card: CommunityCard; stats?: MarketCommunity; onOpen: () => void }) {
  const { listing, preview } = card;
  const buyers = buyerCount(listing);
  const imageSources = marketImageSources(listing, preview?.imageUrl);
  return (
    <article data-card
      style={{ position: "relative", flex: "0 0 calc(min(var(--app-max-width), 100vw) - 40px)", scrollSnapAlign: "center", height: "100%",
        borderRadius: 12, overflow: "hidden", background: "linear-gradient(160deg, var(--orange-100), var(--orange-400))",
        display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <ResilientImage sources={imageSources} alt=""
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      <button type="button" aria-label={`${listing.title} 프로필 보기`} onClick={onOpen}
        style={{ position: "absolute", inset: 0, zIndex: 1, border: 0, padding: 0, background: "transparent", cursor: "pointer" }} />
      <div style={{ position: "relative", zIndex: 0, display: "flex", flexDirection: "column", gap: 12, padding: "56px 20px 20px", background: "var(--overlay-scrim)" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 24, fontWeight: 500, letterSpacing: "-0.05em", color: "var(--key)" }}>Mine.</span>
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
              <span style={{ fontSize: 28, fontWeight: 400, letterSpacing: "-0.07em", color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{listing.title}</span>
              {stats && stats.reviewCount > 0 && (
                <span style={{ fontSize: 16, fontWeight: 500, letterSpacing: "-0.03em", color: "var(--key)", whiteSpace: "nowrap" }}>
                  ★ {stats.averageRating} <span style={{ color: "#d1d1d1" }}>({stats.reviewCount})</span>
                </span>
              )}
            </div>
          </div>
          <div aria-hidden style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 22, background: "var(--key)", color: "#fff", display: "grid", placeItems: "center" }}>
            <Icon name="arrow-right" size={18} />
          </div>
        </div>
        <div className="chip-row" style={{ padding: "4px 0" }}>
          <span className="chip tag"># {buyers}명과 대화 중</span>
          {stats && stats.giftsSent > 0 && <span className="chip tag"># 선물 {stats.giftsSent}번 보냄</span>}
        </div>
      </div>
    </article>
  );
}

export default function CommunityPage() {
  const router = useRouter();
  const [view, setView] = useState<View>("feed");
  const [cards, setCards] = useState<CommunityCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recommendedIds, setRecommendedIds] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [stats, setStats] = useState<Record<string, MarketCommunity>>({});
  const [activeIdx, setActiveIdx] = useState(0);
  const swipeRef = useRef<HTMLDivElement>(null);
  const requestedStats = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    void market.list().then(async catalog => {
      if (!active) return;
      setCards(toCards(catalog));
      const from = new URLSearchParams(window.location.search).get("from");
      if (from && /^[1-9]\d*$/.test(from)) {
        try {
          const draft = await backend.productDraft(Number(from));
          if (active) setRecommendedIds(recommendListings(catalog, draft).map(l => l.id));
        } catch { /* 추천 실패는 기본 정렬로 대체 */ }
      }
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : "캐릭터를 불러오지 못했어요."); });
    return () => { active = false; };
  }, []);

  const visible = useMemo(() => {
    if (!cards) return [];
    // 피드는 검색 + 최신순만 쓴다. 스와이프는 같은 목록을 순서대로 넘긴다.
    const filtered = searchCards(cards, query);
    if (recommendedIds) {
      const rank = new Map(recommendedIds.map((id, i) => [id, i]));
      return [...filtered].sort((a, b) => (rank.get(a.listing.id) ?? 1e9) - (rank.get(b.listing.id) ?? 1e9));
    }
    return sortCards(filtered, "newest");
  }, [cards, query, recommendedIds]);

  // 평점·선물 수는 상품별 조회라 스와이프에서 보이는 카드 주변만 한 번씩 가져온다.
  const loadStats = useCallback((listingId: string) => {
    if (!listingId || requestedStats.current.has(listingId)) return;
    requestedStats.current.add(listingId);
    void community.of(listingId)
      .then(result => setStats(prev => ({ ...prev, [listingId]: result })))
      .catch(() => { /* 신호가 없어도 카드는 그대로 보여준다 */ });
  }, []);

  useEffect(() => {
    if (view !== "swipe") return;
    for (const card of visible.slice(Math.max(0, activeIdx - 1), activeIdx + 2)) loadStats(card.listing.id);
  }, [view, visible, activeIdx, loadStats]);

  function onSwipeScroll() {
    const strip = swipeRef.current;
    if (!strip) return;
    const center = strip.scrollLeft + strip.clientWidth / 2;
    let nearest = 0;
    let best = Infinity;
    strip.querySelectorAll<HTMLElement>("[data-card]").forEach((el, index) => {
      const distance = Math.abs(el.offsetLeft + el.offsetWidth / 2 - center);
      if (distance < best) { best = distance; nearest = index; }
    });
    setActiveIdx(nearest);
  }

  const open = (listingId: string) => router.push(`/community/detail?listing=${encodeURIComponent(listingId)}`);
  const swiping = view === "swipe";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", overflow: "hidden",
      background: swiping ? "linear-gradient(0deg, rgba(255,255,255,0) 57.4%, var(--key) 98.4%), #fff" : "#fff" }}>
      <style>{`.swipe-strip::-webkit-scrollbar{display:none}`}</style>

      <header className="topbar">
        <span className="logo" style={{ fontSize: 24, color: swiping ? "#fff" : "var(--key)" }}>dear.</span>
        {/* 현재 보고 있는 뷰의 이름이 적힌 버튼. 누르면 반대 뷰로 바뀐다. */}
        <button type="button" onClick={() => setView(swiping ? "feed" : "swipe")}
          aria-label={swiping ? "피드로 보기" : "스와이프로 보기"}
          style={{ padding: "12px 20px", borderRadius: 999, border: 0, background: "var(--gray-900)", cursor: "pointer",
            fontFamily: '"Helvetica Neue", Helvetica, Arial, "Pretendard", sans-serif', fontSize: 13, letterSpacing: "-0.07em",
            color: swiping ? "var(--key)" : "#fff", transition: "color 200ms var(--ease)" }}>
          {swiping ? "Swipe" : "Community"}
        </button>
      </header>

      {error && <p role="alert" className="body2" style={{ color: "var(--gray-500)", textAlign: "center", padding: "48px 20px" }}>{error}</p>}

      {!error && swiping && (
        <div ref={swipeRef} className="swipe-strip" onScroll={onSwipeScroll}
          style={{ flex: 1, minHeight: 0, display: "flex", gap: 12, padding: "28px 20px", overflowX: "auto", overflowY: "hidden",
            scrollSnapType: "x mandatory", scrollbarWidth: "none" }}>
          {cards === null && <div className="skeleton" style={{ flex: "0 0 calc(min(var(--app-max-width), 100vw) - 40px)", height: "100%", borderRadius: 12 }} />}
          {cards !== null && visible.length === 0 && (
            <div style={{ flex: 1, display: "grid", placeItems: "center", textAlign: "center", color: "var(--gray-500)" }}>
              <p className="body2">아직 넘겨볼 캐릭터가 없어요.</p>
            </div>
          )}
          {visible.map(card => (
            <SwipeCard key={card.listing.id} card={card} stats={stats[card.listing.id]} onOpen={() => open(card.listing.id)} />
          ))}
        </div>
      )}

      {!error && !swiping && (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "12px 20px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderRadius: 4, background: "var(--gray-50)" }}>
              <Icon name="search" size={18} style={{ color: "var(--gray-500)" }} />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="이름이나 소개로 찾기" aria-label="캐릭터 검색"
                style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", font: "inherit", fontSize: 14, outline: "none", color: "var(--black)" }} />
            </label>
          </div>

          {/* 생성 직후 진입은 유사도 순이라 순서를 밝히고 되돌릴 수 있게 한다. */}
          {recommendedIds && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 20px 14px" }}>
              <span className="caption" style={{ color: "var(--gray-500)" }}>내 캐릭터와 결이 비슷한 순서예요.</span>
              <button type="button" className="chip pill" onClick={() => setRecommendedIds(null)}>최신순으로 보기</button>
            </div>
          )}

          <main style={{ display: "flex", flexDirection: "column", gap: 24, paddingTop: 4, paddingBottom: 8 }}>
            {cards === null && [0, 1].map(i => (
              <div key={i} style={{ padding: "0 20px" }}>
                <div className="skeleton" style={{ height: 42, width: 160, borderRadius: 21 }} />
                <div className="skeleton" style={{ height: 44, marginTop: 8, marginLeft: 32, borderRadius: 4 }} />
                <div className="skeleton" style={{ height: 267, width: 267, marginTop: 8, marginLeft: 32, borderRadius: 4 }} />
              </div>
            ))}
            {cards !== null && visible.length === 0 && (
              <div style={{ margin: "0 20px", padding: "56px 20px", textAlign: "center", background: "var(--gray-50)", borderRadius: 4 }}>
                <p className="headline1" style={{ margin: "0 0 4px" }}>{cards.length === 0 ? "아직 올라온 캐릭터가 없어요" : "검색 결과가 없어요"}</p>
                <p className="caption" style={{ margin: 0, color: "var(--gray-500)" }}>
                  {cards.length === 0 ? "내 캐릭터를 등록하면 여기에 올라와요." : "검색어를 지워보세요."}
                </p>
                {cards.length === 0 && <button className="chip selected" style={{ marginTop: 14 }} onClick={() => router.push("/character")}>내 캐릭터 등록하기</button>}
              </div>
            )}
            {visible.map((card, i) => (
              <div key={card.listing.id} style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                {i > 0 && <div style={{ height: 1, background: "var(--gray-100)" }} />}
                <Post card={card} onOpen={() => open(card.listing.id)} />
              </div>
            ))}
          </main>
        </div>
      )}

      <BottomNav active="community" />
    </div>
  );
}
