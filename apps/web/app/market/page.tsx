"use client";

// 마켓 (figma Develop · 06 마켓). 캐릭터 이용권 그리드가 주인공.
// "Market" 헬베티카 제목 + 키컬러 잔액 뱃지, 검색, 정렬 칩(키컬러 사각), 관계 칩(검정 필), 2열 오버레이 카드.
// NFT 선물 상품은 같은 카드 스타일로 아래 "Gift" 섹션에 붙는다(직접 구매·외부 등록·내 컬렉션 경로 유지).

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { NftGiftCatalogItem } from "@everyday/contracts";
import { nftGiftImageUrl, nftGifts } from "@/lib/gifts";
import { market, formatPrice } from "@/lib/market";
import { RELATIONSHIP_FILTERS, SORTS, filterCards, savedListingIds, sortCards, toCards, toggleSaved,
  type CommunityCard, type RelationshipFilter, type SortKey } from "@/lib/community";
import { BottomNav } from "../components";
import { Icon } from "../icons";
import { ListingCard } from "../community/ListingCard";

export default function MarketPage() {
  const router = useRouter();
  const [cards, setCards] = useState<CommunityCard[] | null>(null);
  const [gifts, setGifts] = useState<NftGiftCatalogItem[] | null>(null);
  const [giftsError, setGiftsError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suiBalance, setSuiBalance] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("popular");
  const [relationship, setRelationship] = useState<RelationshipFilter>("전체");
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    setSaved(savedListingIds());
    void market.list().then(catalog => { if (active) setCards(toCards(catalog)); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "캐릭터를 불러오지 못했어요."); });
    void nftGifts.list().then(value => { if (active) { setGifts(value.filter(gift => gift.active)); setGiftsError(false); } })
      .catch(() => { if (active) { setGifts([]); setGiftsError(true); } });
    void import("@/lib/wallet-auth").then(async ({ restoreWalletToken, walletKit }) => {
      await restoreWalletToken();
      const account = walletKit.stores.$connection.get().account;
      if (!account) return;
      const { balance } = await walletKit.getClient("testnet").getBalance({ owner: account.address });
      if (active) setSuiBalance(balance.balance);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const visible = useMemo(() => cards ? sortCards(filterCards(cards, relationship, query), sort) : [], [cards, relationship, query, sort]);
  const availableRelationships = useMemo(() => {
    const present = new Set((cards ?? []).map(c => c.preview?.relationshipType).filter(Boolean));
    return RELATIONSHIP_FILTERS.filter(f => f === "전체" || present.has(f));
  }, [cards]);
  const giftDetail = (id: string) => router.push(`/community/gifts/detail?product=${encodeURIComponent(id)}`);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh", background: "#fff" }}>
      <header className="topbar">
        <span className="page-title">Market</span>
        <span className="point-badge">{suiBalance === null ? "SUI" : formatPrice(suiBalance)}</span>
      </header>

      <div style={{ padding: "0 20px 20px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderRadius: 4, background: "var(--gray-50)" }}>
          <Icon name="search" size={18} style={{ color: "var(--gray-500)" }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="이름이나 소개로 찾기" aria-label="검색"
            style={{ flex: 1, border: 0, background: "transparent", font: "inherit", fontSize: 14, outline: "none", color: "var(--black)" }} />
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "0 20px 6px", scrollbarWidth: "none" }}>
        {SORTS.map(s => (
          <button key={s.key} type="button" className={`chip ${sort === s.key ? "selected" : ""}`} onClick={() => setSort(s.key)}
            style={{ flexShrink: 0, color: sort === s.key ? "#fff" : "#767676" }}>{s.label}</button>
        ))}
      </div>
      {availableRelationships.length > 1 && (
        <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "6px 20px 14px", scrollbarWidth: "none" }}>
          {availableRelationships.map(f => (
            <button key={f} type="button" className={`chip pill ${relationship === f ? "selected" : ""}`} onClick={() => setRelationship(f)} style={{ flexShrink: 0 }}>{f}</button>
          ))}
        </div>
      )}

      <main style={{ flex: 1, padding: "4px 20px 8px", display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <p role="alert" className="body2" style={{ color: "var(--gray-500)", textAlign: "center", padding: "48px 0" }}>{error}</p>}
        {!error && cards === null && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[0, 1, 2, 3].map(i => <div key={i} className="skeleton" style={{ aspectRatio: "159.5 / 252.5", borderRadius: 4 }} />)}
          </div>
        )}
        {!error && cards !== null && visible.length === 0 && (
          <div style={{ padding: "48px 20px", textAlign: "center", background: "var(--gray-50)", borderRadius: 4 }}>
            <p className="headline1" style={{ margin: "0 0 4px" }}>{cards.length === 0 ? "아직 등록된 캐릭터가 없어요" : "조건에 맞는 캐릭터가 없어요"}</p>
            <p className="caption" style={{ margin: 0, color: "var(--gray-500)" }}>{cards.length === 0 ? "내 캐릭터를 등록하면 여기에 보여요." : "필터나 검색어를 바꿔보세요."}</p>
          </div>
        )}
        {visible.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {visible.map(card => <ListingCard key={card.listing.id} card={card} saved={saved.includes(card.listing.id)} onToggleSave={id => setSaved(toggleSaved(id))} />)}
          </div>
        )}

        {/* Gift — NFT 선물 상품 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 20 }}>
          <span className="page-title">Gift</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className="chip dark" onClick={() => router.push("/my/gifts")}>내 컬렉션</button>
            <button type="button" className="chip dark" onClick={() => router.push("/community/gifts/create")}>외부 NFT 등록</button>
          </div>
        </div>
        <p className="caption" style={{ margin: "-4px 0 0", color: "var(--gray-500)" }}>직접 사서 소장하거나, 캐릭터가 대화 중에 자기 금고로 골라 보내는 선물이에요.</p>
        {giftsError && <p role="alert" className="body2" style={{ color: "var(--gray-500)", margin: 0 }}>NFT 선물 목록을 불러오지 못했어요. 잠시 후 다시 확인해주세요.</p>}
        {!giftsError && gifts !== null && gifts.length === 0 && <p className="body2" style={{ color: "var(--gray-500)", margin: 0 }}>판매 준비 중인 NFT 선물이 있어요.</p>}
        {gifts !== null && gifts.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {gifts.map(gift => {
              // 공급량은 u64 문자열이므로 BigInt 하나로 계산한다 (Number는 2^53 위에서 어긋난다).
              const remain = gift.kind === "external" ? null : BigInt(gift.maxSupply) - BigInt(gift.minted);
              const soldOut = remain !== null && remain <= 0n;
              return (
                <article key={gift.id} role="link" tabIndex={0} onClick={() => giftDetail(gift.id)} onKeyDown={e => { if (e.key === "Enter") giftDetail(gift.id); }}
                  style={{ position: "relative", aspectRatio: "159.5 / 252.5", borderRadius: 4, overflow: "hidden", cursor: "pointer", background: "var(--orange-100)", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={nftGiftImageUrl(gift)} alt={gift.title} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                  <div style={{ position: "relative", padding: "28px 10px 16px", display: "flex", flexDirection: "column", gap: 4, background: "var(--overlay-scrim)" }}>
                    <strong style={{ color: "#fff", fontSize: 16, fontWeight: 500, letterSpacing: "-0.07em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{gift.title}</strong>
                    <div style={{ display: "flex", gap: 4, alignItems: "center", whiteSpace: "nowrap" }}>
                      <span style={{ color: soldOut ? "var(--on-overlay-muted)" : "var(--key-deep)", fontSize: 14, fontWeight: 600 }}>{soldOut ? "품절" : formatPrice(gift.priceMist)}</span>
                      {remain !== null && !soldOut && <span style={{ color: "var(--on-overlay-muted)", fontSize: 12 }}>· {remain.toString()}개 남음</span>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      <BottomNav active="market" />
    </div>
  );
}
