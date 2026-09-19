"use client";

// 마켓 — NFT 선물 상품이 팔리는 곳. 캐릭터 이용권은 커뮤 탭에서 다룬다.
// 2열 상품 그리드 + 우상단 외부 NFT 등록 + 내 컬렉션 진입. 상세·구매 경로는 기존 /community/gifts/* 그대로.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { NftGiftCatalogItem } from "@everyday/contracts";
import { nftGiftImageUrl, nftGifts } from "@/lib/gifts";
import { formatPrice } from "@/lib/market";
import { BottomNav } from "../components";
import { Icon } from "../icons";

export default function MarketPage() {
  const router = useRouter();
  const [gifts, setGifts] = useState<NftGiftCatalogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suiBalance, setSuiBalance] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void nftGifts.list().then(value => { if (active) setGifts(value.filter(gift => gift.active)); })
      .catch(() => { if (active) setError("NFT 선물 목록을 불러오지 못했어요."); });
    void import("@/lib/wallet-auth").then(async ({ restoreWalletToken, walletKit }) => {
      await restoreWalletToken();
      const account = walletKit.stores.$connection.get().account;
      if (!account) return;
      const { balance } = await walletKit.getClient("testnet").getBalance({ owner: account.address });
      if (active) setSuiBalance(balance.balance);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const detail = (id: string) => router.push(`/community/gifts/detail?product=${encodeURIComponent(id)}`);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <header className="topbar">
        <span className="h3">마켓</span>
        <span className="point-badge">{suiBalance === null ? "SUI" : formatPrice(suiBalance)}</span>
      </header>

      <div style={{ display: "flex", gap: 8, padding: "0 20px 14px" }}>
        <button type="button" className="chip" onClick={() => router.push("/my/gifts")} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="gift" size={16} /> 내 컬렉션
        </button>
        <button type="button" className="chip" onClick={() => router.push("/community/gifts/create")} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="plus" size={16} /> 외부 NFT 등록
        </button>
      </div>

      <main style={{ flex: 1, padding: "0 20px 8px" }}>
        <p className="caption" style={{ margin: "0 0 12px", color: "var(--gray-500)" }}>
          직접 사서 소장하거나, 캐릭터가 대화 중에 자기 금고로 골라 보내는 선물이에요.
        </p>
        {error && <p role="alert" className="body2" style={{ color: "var(--gray-500)", textAlign: "center", padding: "48px 0" }}>{error}</p>}
        {!error && gifts === null && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[0, 1, 2, 3].map(i => <div key={i} className="skeleton" style={{ aspectRatio: "1 / 1.45", borderRadius: 16 }} />)}
          </div>
        )}
        {!error && gifts !== null && gifts.length === 0 && (
          <div style={{ padding: "56px 20px", textAlign: "center", border: "1px dashed var(--gray-200)", borderRadius: 16 }}>
            <div style={{ fontSize: 40 }}>🎁</div>
            <p className="headline2" style={{ margin: "10px 0 4px" }}>판매 준비 중인 NFT 선물이 있어요</p>
            <p className="caption" style={{ margin: 0, color: "var(--gray-500)" }}>승인된 외부 컬렉션 NFT를 직접 등록할 수도 있어요.</p>
          </div>
        )}
        {gifts !== null && gifts.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {gifts.map(gift => {
              const soldOut = gift.kind === "external" ? !gift.active : BigInt(gift.minted) >= BigInt(gift.maxSupply);
              return (
                <article key={gift.id} role="link" tabIndex={0} onClick={() => detail(gift.id)} onKeyDown={e => { if (e.key === "Enter") detail(gift.id); }}
                  style={{ border: "1px solid var(--gray-200)", borderRadius: 16, overflow: "hidden", background: "#fff", cursor: "pointer" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={nftGiftImageUrl(gift)} alt={gift.title} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", background: "var(--orange-100)", display: "block" }} />
                  <div style={{ padding: 12 }}>
                    <div className="caption" style={{ color: "var(--gray-500)", marginBottom: 4 }}>{gift.kind === "external" ? "승인 컬렉션 NFT" : "Dear Mine NFT"}</div>
                    <div className="label1" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{gift.title}</div>
                    <div className="caption" style={{ marginTop: 6, color: soldOut ? "var(--gray-500)" : "var(--orange-700)", fontWeight: 700 }}>
                      {soldOut ? "품절" : formatPrice(gift.priceMist)}
                      {gift.kind !== "external" && !soldOut && <span style={{ color: "var(--gray-500)", fontWeight: 500 }}> · {(BigInt(gift.maxSupply) - BigInt(gift.minted)).toString()}개 남음</span>}
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
