"use client";

// 커뮤 — 포스트형 피드 (figma Develop · 03 커뮤 피드).
// 캐릭터 하나가 글 하나. 아바타 42 · 이름 18 · 등록 시점 · 키컬러 화살표(→ 프로필), 본문 16 Regular,
// 아래로 초상 267 정사각 스트립. 데이터는 공개 카탈로그(요약·대표 이미지)만 쓴다. 정렬·필터는 마켓 탭으로.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { backend } from "@/lib/api";
import { market, recommendListings } from "@/lib/market";
import { marketImageSources } from "@/lib/market-images";
import { buyerCount, filterCards, formatAgo, sortCards, toCards, turnCount, type CommunityCard } from "@/lib/community";
import { BottomNav, ResilientImage } from "../components";
import { Icon } from "../icons";

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
            style={{ width: 267, height: 267, borderRadius: 4, overflow: "hidden", border: 0, padding: 0, background: "var(--orange-100)", cursor: "pointer" }}>
            <ResilientImage sources={imageSources} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </button>
        </div>
      )}
    </article>
  );
}

export default function CommunityPage() {
  const router = useRouter();
  const [cards, setCards] = useState<CommunityCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recommendedIds, setRecommendedIds] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");

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
    // 피드는 검색 + 최신순만 쓴다. 정렬·관계 필터는 마켓 탭이 담당한다.
    const filtered = filterCards(cards, "전체", query);
    if (recommendedIds) {
      const rank = new Map(recommendedIds.map((id, i) => [id, i]));
      return [...filtered].sort((a, b) => (rank.get(a.listing.id) ?? 1e9) - (rank.get(b.listing.id) ?? 1e9));
    }
    return sortCards(filtered, "newest");
  }, [cards, query, recommendedIds]);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh", background: "#fff" }}>
      <header className="topbar">
        <span className="logo" style={{ fontSize: 24 }}>dear.</span>
        <button type="button" aria-label="채팅 목록" onClick={() => router.push("/chatlist")} style={{ border: 0, background: "none", color: "var(--key)", display: "flex", padding: 0, cursor: "pointer" }}>
          <Icon name="chat" size={22} />
        </button>
      </header>

      <div style={{ padding: "0 20px 20px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderRadius: 4, background: "var(--gray-50)" }}>
          <Icon name="search" size={18} style={{ color: "var(--gray-500)" }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="이름이나 소개로 찾기" aria-label="캐릭터 검색"
            style={{ flex: 1, border: 0, background: "transparent", font: "inherit", fontSize: 14, outline: "none", color: "var(--black)" }} />
        </label>
      </div>

      {/* 생성 직후 진입은 유사도 순이라 순서를 밝히고 되돌릴 수 있게 한다. */}
      {recommendedIds && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 20px 14px" }}>
          <span className="caption" style={{ color: "var(--gray-500)" }}>내 캐릭터와 결이 비슷한 순서예요.</span>
          <button type="button" className="chip pill" onClick={() => setRecommendedIds(null)}>최신순으로 보기</button>
        </div>
      )}

      <main style={{ flex: 1, display: "flex", flexDirection: "column", gap: 24, paddingTop: 4, paddingBottom: 8 }}>
        {error && <p role="alert" className="body2" style={{ color: "var(--gray-500)", textAlign: "center", padding: "48px 20px" }}>{error}</p>}
        {!error && cards === null && [0, 1].map(i => (
          <div key={i} style={{ padding: "0 20px" }}>
            <div className="skeleton" style={{ height: 42, width: 160, borderRadius: 21 }} />
            <div className="skeleton" style={{ height: 44, marginTop: 8, marginLeft: 32, borderRadius: 4 }} />
            <div className="skeleton" style={{ height: 267, width: 267, marginTop: 8, marginLeft: 32, borderRadius: 4 }} />
          </div>
        ))}
        {!error && cards !== null && visible.length === 0 && (
          <div style={{ margin: "0 20px", padding: "56px 20px", textAlign: "center", background: "var(--gray-50)", borderRadius: 4 }}>
            <p className="headline1" style={{ margin: "0 0 4px" }}>{cards.length === 0 ? "아직 올라온 캐릭터가 없어요" : "검색 결과가 없어요"}</p>
            <p className="caption" style={{ margin: 0, color: "var(--gray-500)" }}>
              {cards.length === 0 ? "내 캐릭터를 마켓에 등록하면 여기에 올라와요." : "검색어를 지워보세요."}
            </p>
            {cards.length === 0 && <button className="chip selected" style={{ marginTop: 14 }} onClick={() => router.push("/character")}>내 캐릭터 등록하기</button>}
          </div>
        )}
        {visible.map((card, i) => (
          <div key={card.listing.id} style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {i > 0 && <div style={{ height: 1, background: "var(--gray-100)" }} />}
            <Post card={card} onOpen={() => router.push(`/community/detail?listing=${encodeURIComponent(card.listing.id)}`)} />
          </div>
        ))}
      </main>

      <BottomNav active="community" />
    </div>
  );
}
