"use client";

// 제작자 페이지 — 이 지갑이 게시한 캐릭터와 구매자 합계. 공개 카탈로그만 사용한다.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { market } from "@/lib/market";
import { savedListingIds, shortAddress, sortCards, toCards, toggleSaved, type CommunityCard } from "@/lib/community";
import { Icon } from "../../icons";
import { ListingCard } from "../ListingCard";

function CreatorInner() {
  const router = useRouter();
  const address = (useSearchParams().get("address") ?? "").toLowerCase();
  const [cards, setCards] = useState<CommunityCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    setSaved(savedListingIds());
    if (!/^0x[0-9a-f]{64}$/.test(address)) { setError("제작자를 찾을 수 없어요."); return () => { active = false; }; }
    void market.list().then(catalog => { if (active) setCards(sortCards(toCards(catalog).filter(c => c.listing.creator === address), "popular")); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "불러오지 못했어요."); });
    return () => { active = false; };
  }, [address]);

  const buyers = useMemo(() => (cards ?? []).reduce((sum, c) => sum + Number(c.listing.buyerCount ?? 0), 0), [cards]);

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <header className="topbar">
        <button className="nav-btn nav-prev" onClick={() => router.back()} aria-label="이전"><Icon name="chevron-left" size={24} /></button>
        <span className="page-title">Creator</span>
        <span style={{ width: 24 }} />
      </header>
      <main style={{ flex: 1, padding: "8px 20px 28px" }}>
        {error && <p role="alert" className="body2" style={{ color: "var(--gray-500)", textAlign: "center", padding: "48px 0" }}>{error}</p>}
        {!error && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "6px 0 18px" }}>
              <div aria-hidden style={{ width: 52, height: 52, borderRadius: "50%", background: "linear-gradient(160deg, var(--orange-200), var(--orange-500))", flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div className="headline1" style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 16 }}>{shortAddress(address)}</div>
                <div className="caption" style={{ color: "var(--gray-500)" }}>
                  {cards === null ? "불러오는 중…" : `캐릭터 ${cards.length}명 · 구매자 ${buyers}명`}
                </div>
              </div>
            </div>
            {cards !== null && cards.length === 0 && (
              <p className="body2" style={{ color: "var(--gray-500)", textAlign: "center", padding: "40px 0" }}>판매 중인 캐릭터가 없어요.</p>
            )}
            {cards !== null && cards.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {cards.map(card => <ListingCard key={card.listing.id} card={card} saved={saved.includes(card.listing.id)} onToggleSave={id => setSaved(toggleSaved(id))} />)}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default function CreatorPage() {
  return <Suspense fallback={null}><CreatorInner /></Suspense>;
}
