"use client";

// 마켓 — 상품만 파는 탭. NFT 선물 상품을 직접 사거나, 내 컬렉션·외부 NFT 등록으로 간다.
// 캐릭터 이용권 거래는 커뮤 탭(피드·스와이프 → 프로필 상세)이 담당한다.
// 카드 스타일은 figma Develop의 오버레이 카드를 따른다: 모서리 4px, 제목 16, 가격 --key-deep, 메타 흰 60%.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { NftGiftCatalogItem } from "@everyday/contracts";
import { nftGiftImageSources, nftGifts } from "@/lib/gifts";
import { formatPrice } from "@/lib/market";
import { BottomNav, ResilientImage } from "../components";
import { Icon } from "../icons";

export default function MarketPage() {
  const router = useRouter();
  const [gifts, setGifts] = useState<NftGiftCatalogItem[] | null>(null);
  const [giftsError, setGiftsError] = useState(false);
  const [suiBalance, setSuiBalance] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
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

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!gifts) return [];
    if (!term) return gifts;
    return gifts.filter(gift => gift.title.toLowerCase().includes(term) || gift.description.toLowerCase().includes(term));
  }, [gifts, query]);

  const detail = (id: string) => router.push(`/community/gifts/detail?product=${encodeURIComponent(id)}`);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh", background: "#fff" }}>
      <header className="topbar">
        <span className="page-title">Market</span>
        <span className="point-badge">{suiBalance === null ? "SUI" : formatPrice(suiBalance)}</span>
      </header>

      <div style={{ padding: "0 20px 12px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderRadius: 4, background: "var(--gray-50)" }}>
          <Icon name="search" size={18} style={{ color: "var(--gray-500)" }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="선물 이름으로 찾기" aria-label="선물 검색"
            style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", font: "inherit", fontSize: 14, outline: "none", color: "var(--black)" }} />
        </label>
      </div>

      <div style={{ display: "flex", gap: 6, padding: "0 20px 14px" }}>
        <button type="button" className="chip dark" onClick={() => router.push("/my/gifts")}>내 컬렉션</button>
        <button type="button" className="chip dark" onClick={() => router.push("/community/gifts/create")}>외부 NFT 등록</button>
      </div>

      <main style={{ flex: 1, padding: "0 20px 8px", display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="caption" style={{ margin: 0, color: "var(--gray-500)" }}>
          직접 사서 소장하거나, 캐릭터가 대화 중에 자기 금고로 골라 보내는 선물이에요.
        </p>

        {giftsError && <p role="alert" className="body2" style={{ color: "var(--gray-500)", margin: 0 }}>NFT 선물 목록을 불러오지 못했어요. 잠시 후 다시 확인해주세요.</p>}

        {!giftsError && gifts === null && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
            {[0, 1, 2, 3].map(i => <div key={i} className="skeleton" style={{ aspectRatio: "159.5 / 252.5", borderRadius: 4 }} />)}
          </div>
        )}

        {!giftsError && gifts !== null && visible.length === 0 && (
          <div style={{ padding: "48px 20px", textAlign: "center", background: "var(--gray-50)", borderRadius: 4 }}>
            <p className="headline1" style={{ margin: "0 0 4px" }}>{gifts.length === 0 ? "판매 준비 중인 NFT 선물이 있어요" : "검색 결과가 없어요"}</p>
            <p className="caption" style={{ margin: 0, color: "var(--gray-500)" }}>
              {gifts.length === 0 ? "승인된 외부 컬렉션 NFT를 직접 등록할 수도 있어요." : "검색어를 지워보세요."}
            </p>
          </div>
        )}

        {visible.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
            {visible.map(gift => {
              // 공급량은 u64 문자열이므로 BigInt 하나로 계산한다 (Number는 2^53 위에서 어긋난다).
              const remain = gift.kind === "external" ? null : BigInt(gift.maxSupply) - BigInt(gift.minted);
              const soldOut = remain !== null && remain <= 0n;
              return (
                <article key={gift.id} role="link" tabIndex={0} onClick={() => detail(gift.id)} onKeyDown={e => { if (e.key === "Enter") detail(gift.id); }}
                  style={{ position: "relative", aspectRatio: "159.5 / 252.5", borderRadius: 4, overflow: "hidden", cursor: "pointer", background: "var(--orange-100)", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                  <ResilientImage sources={nftGiftImageSources(gift)} alt={gift.title} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                  <div style={{ position: "relative", padding: "28px 10px 16px", display: "flex", flexDirection: "column", gap: 4, background: "var(--overlay-scrim)" }}>
                    <strong style={{ color: "#fff", fontSize: 16, fontWeight: 500, letterSpacing: "-0.07em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{gift.title}</strong>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", overflowWrap: "anywhere" }}>
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
