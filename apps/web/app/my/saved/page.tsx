"use client";

// 찜한 캐릭터 — 이 기기의 localStorage에 저장된 목록. 카탈로그에서 현재 판매 중인 것만 보여준다.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { market } from "@/lib/market";
import { savedListingIds, toCards, toggleSaved, type CommunityCard } from "@/lib/community";
import { BottomNav } from "../../components";
import { Icon } from "../../icons";
import { ListingCard } from "../../community/ListingCard";

export default function SavedPage() {
  const router = useRouter();
  const [saved, setSaved] = useState<string[]>([]);
  const [cards, setCards] = useState<CommunityCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSaved(savedListingIds());
    void market.list().then(catalog => { if (active) setCards(toCards(catalog)); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "불러오지 못했어요."); });
    return () => { active = false; };
  }, []);

  const visible = (cards ?? []).filter(c => saved.includes(c.listing.id));

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <header className="topbar">
        <button className="nav-btn nav-prev" onClick={() => router.back()} aria-label="이전"><Icon name="chevron-left" size={24} /></button>
        <span className="headline1">찜한 캐릭터</span>
        <span style={{ width: 24 }} />
      </header>
      <main style={{ flex: 1, padding: "8px 20px 8px" }}>
        {error && <p role="alert" className="body2" style={{ color: "var(--gray-500)", textAlign: "center", padding: "48px 0" }}>{error}</p>}
        {!error && cards !== null && visible.length === 0 && (
          <div style={{ padding: "64px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 44 }}>💛</div>
            <p className="headline2" style={{ margin: "10px 0 4px" }}>아직 찜한 캐릭터가 없어요</p>
            <p className="caption" style={{ margin: 0, color: "var(--gray-500)" }}>커뮤에서 마음에 드는 캐릭터의 하트를 눌러보세요.</p>
            <button className="chip" style={{ marginTop: 14 }} onClick={() => router.push("/community")}>커뮤 둘러보기</button>
          </div>
        )}
        {visible.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {visible.map(card => <ListingCard key={card.listing.id} card={card} saved onToggleSave={id => setSaved(toggleSaved(id))} />)}
          </div>
        )}
      </main>
      <BottomNav active="my" />
    </div>
  );
}
