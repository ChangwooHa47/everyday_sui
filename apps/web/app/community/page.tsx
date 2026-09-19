"use client";

// 커뮤 — 캐릭터 발견 피드. 이용권 판매는 여기서 일어난다.
// 정렬(인기·최신·가격)·관계 필터·검색 → 2열 프로필 카드 → 상세(미리보기·구매·후기).
// NFT 선물 상품은 /market 탭으로 분리했다. 데이터는 공개 카탈로그만 사용한다.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { backend } from "@/lib/api";
import { market, formatPrice, recommendListings } from "@/lib/market";
import { RELATIONSHIP_FILTERS, SORTS, filterCards, savedListingIds, sortCards, toCards, toggleSaved,
  type CommunityCard, type RelationshipFilter, type SortKey } from "@/lib/community";
import { BottomNav } from "../components";
import { Icon } from "../icons";
import { ListingCard } from "./ListingCard";

export default function CommunityPage() {
  const router = useRouter();
  const [cards, setCards] = useState<CommunityCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suiBalance, setSuiBalance] = useState<string | null>(null);
  const [recommendedIds, setRecommendedIds] = useState<string[] | null>(null);
  const [sort, setSort] = useState<SortKey>("popular");
  const [relationship, setRelationship] = useState<RelationshipFilter>("전체");
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    setSaved(savedListingIds());
    void market.list().then(async catalog => {
      if (!active) return;
      setCards(toCards(catalog));
      // 생성 직후 진입(?from=<id>)이면 내 캐릭터와 결이 비슷한 순서를 먼저 보여준다.
      const from = new URLSearchParams(window.location.search).get("from");
      if (from && /^[1-9]\d*$/.test(from)) {
        try {
          const draft = await backend.productDraft(Number(from));
          if (active) setRecommendedIds(recommendListings(catalog, draft).map(l => l.id));
        } catch { /* 추천 실패는 기본 정렬로 대체 */ }
      }
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : "캐릭터를 불러오지 못했어요."); });
    void import("@/lib/wallet-auth").then(async ({ restoreWalletToken, walletKit }) => {
      await restoreWalletToken();
      const account = walletKit.stores.$connection.get().account;
      if (!account) return;
      const { balance } = await walletKit.getClient("testnet").getBalance({ owner: account.address });
      if (active) setSuiBalance(balance.balance);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const visible = useMemo(() => {
    if (!cards) return [];
    const filtered = filterCards(cards, relationship, query);
    if (recommendedIds && sort === "popular") {
      const rank = new Map(recommendedIds.map((id, i) => [id, i]));
      return [...filtered].sort((a, b) => (rank.get(a.listing.id) ?? 1e9) - (rank.get(b.listing.id) ?? 1e9));
    }
    return sortCards(filtered, sort);
  }, [cards, relationship, query, sort, recommendedIds]);

  const availableRelationships = useMemo(() => {
    const present = new Set((cards ?? []).map(c => c.preview?.relationshipType).filter(Boolean));
    return RELATIONSHIP_FILTERS.filter(f => f === "전체" || present.has(f));
  }, [cards]);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <header className="topbar">
        <span className="h3">커뮤</span>
        <span className="point-badge">{suiBalance === null ? "SUI" : formatPrice(suiBalance)}</span>
      </header>

      {/* 검색 */}
      <div style={{ padding: "0 20px 10px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 999, background: "var(--gray-50)", border: "1px solid var(--gray-200)" }}>
          <Icon name="search" size={18} style={{ color: "var(--gray-500)" }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="이름이나 소개로 찾기" aria-label="캐릭터 검색"
            style={{ flex: 1, border: 0, background: "transparent", font: "inherit", fontSize: 14, outline: "none", color: "var(--black)" }} />
        </label>
      </div>

      {/* 정렬 · 관계 필터 */}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "0 20px 6px", scrollbarWidth: "none" }}>
        {SORTS.map(s => (
          <button key={s.key} type="button" className={`chip ${sort === s.key ? "selected" : ""}`} onClick={() => setSort(s.key)} style={{ flexShrink: 0 }}>
            {recommendedIds && s.key === "popular" ? "추천" : s.label}
          </button>
        ))}
      </div>
      {availableRelationships.length > 1 && (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "6px 20px 14px", scrollbarWidth: "none" }}>
          {availableRelationships.map(f => (
            <button key={f} type="button" className={`chip ${relationship === f ? "selected" : ""}`} onClick={() => setRelationship(f)}
              style={{ flexShrink: 0, padding: "6px 12px", fontSize: 13 }}>{f}</button>
          ))}
        </div>
      )}

      {/* 피드 */}
      <main style={{ padding: "4px 20px 8px", flex: 1 }}>
        {error && <p role="alert" className="body2" style={{ color: "var(--gray-500)", textAlign: "center", padding: "48px 0" }}>{error}</p>}
        {!error && cards === null && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[0, 1, 2, 3].map(i => <div key={i} className="skeleton" style={{ aspectRatio: "3 / 4.9", borderRadius: 16 }} />)}
          </div>
        )}
        {!error && cards !== null && visible.length === 0 && (
          <div style={{ padding: "56px 20px", textAlign: "center", border: "1px dashed var(--gray-200)", borderRadius: 16 }}>
            <div style={{ fontSize: 40 }}>🫧</div>
            <p className="headline2" style={{ margin: "10px 0 4px" }}>{cards.length === 0 ? "아직 등록된 캐릭터가 없어요" : "조건에 맞는 캐릭터가 없어요"}</p>
            <p className="caption" style={{ margin: 0, color: "var(--gray-500)" }}>
              {cards.length === 0 ? "내 캐릭터를 마켓에 등록하면 여기에 보여요." : "필터를 바꾸거나 검색어를 지워보세요."}
            </p>
            {cards.length === 0 && <button className="chip" style={{ marginTop: 14 }} onClick={() => router.push("/character")}>내 캐릭터 등록하기</button>}
          </div>
        )}
        {visible.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {visible.map(card => (
              <ListingCard key={card.listing.id} card={card} saved={saved.includes(card.listing.id)} onToggleSave={id => setSaved(toggleSaved(id))} />
            ))}
          </div>
        )}
      </main>

      <BottomNav active="community" />
    </div>
  );
}
