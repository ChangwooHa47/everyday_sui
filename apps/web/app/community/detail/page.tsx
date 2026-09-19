"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { MarketCommunity, MarketPreview } from "@everyday/contracts";
import { formatPrice, market, purchaseCharacter } from "@/lib/market";
import { setActiveCharacterId } from "@/lib/api";
import { community, savedListingIds, shortAddress, toggleSaved } from "@/lib/community";
import { marketImageSources } from "@/lib/market-images";
import { Icon } from "../../icons";
import { ResilientImage } from "../../components";

const stars = (n: number) => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));

/** 구매자 후기 — 이용권 보유 지갑만 한 줄(100자)과 별점을 남긴다. 대화 원문은 올라가지 않는다. */
function Reviews({ listingId, data, onChange }: { listingId: string; data: MarketCommunity | null; onChange: (next: MarketCommunity) => void }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit() {
    if (busy || !text.trim()) return;
    setBusy(true); setMessage("");
    try { onChange(await community.review(listingId, rating, text.trim())); setOpen(false); setText(""); setMessage("후기를 남겼어요."); }
    catch (e) { setMessage(e instanceof Error ? e.message : "후기를 남기지 못했어요."); }
    finally { setBusy(false); }
  }
  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <h2 className="label1" style={{ margin: 0 }}>
          구매자 후기 {data && data.reviewCount > 0 && <span className="caption" style={{ color: "var(--gray-500)", fontWeight: 500 }}>{data.averageRating} · {data.reviewCount}개</span>}
        </h2>
        <button type="button" className="chip" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => setOpen(v => !v)}>후기 쓰기</button>
      </div>
      {open && (
        <div style={{ marginTop: 10, padding: 14, borderRadius: 14, background: "var(--orange-50)", border: "1px solid var(--orange-200)" }}>
          <div role="radiogroup" aria-label="별점" style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} type="button" role="radio" aria-checked={rating === n} onClick={() => setRating(n)}
                style={{ border: 0, background: "transparent", fontSize: 22, cursor: "pointer", color: n <= rating ? "var(--orange-700)" : "var(--gray-300)", padding: 0 }}>★</button>
            ))}
          </div>
          <input className="input" maxLength={100} value={text} onChange={e => setText(e.target.value)} placeholder="이 캐릭터, 어땠어요? (100자)" disabled={busy} />
          <p className="caption" style={{ margin: "6px 0 10px", color: "var(--gray-500)" }}>이용권을 구매한 지갑만 남길 수 있어요. 대화 내용은 올라가지 않아요.</p>
          <button type="button" className="cta" disabled={busy || !text.trim()} onClick={() => void submit()} style={{ padding: "12px 0" }}>{busy ? "남기는 중…" : "남기기"}</button>
        </div>
      )}
      {message && <p className="caption" role="status" style={{ margin: "8px 0 0", color: "var(--gray-600)" }}>{message}</p>}
      {data && data.reviews.length === 0 && !open && (
        <p className="body2" style={{ margin: "10px 0 0", color: "var(--gray-500)" }}>아직 후기가 없어요. 첫 후기를 남겨보세요.</p>
      )}
      {data && data.reviews.map(review => (
        <div key={review.owner} style={{ padding: "12px 0", borderBottom: "1px solid var(--gray-100)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span className="caption" style={{ color: "var(--orange-700)", letterSpacing: 1 }}>{stars(review.rating)}</span>
            <span className="caption" style={{ color: "var(--gray-400)", fontFamily: "ui-monospace, Menlo, monospace" }}>{shortAddress(review.owner)}</span>
          </div>
          <p className="body2" style={{ margin: "4px 0 0", color: "var(--gray-800)" }}>{review.text}</p>
        </div>
      ))}
    </div>
  );
}

function MarketCharacterDetail() {
  const router = useRouter();
  const params = useSearchParams();
  const listingId = params.get("listing") ?? "";
  const [preview, setPreview] = useState<MarketPreview | null>(null);
  const [stats, setStats] = useState<MarketCommunity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!listingId) {
      setError("프로필을 찾을 수 없어요.");
      return () => { active = false; };
    }
    setSaved(savedListingIds().includes(listingId));
    void market.preview(listingId)
      .then((result) => { if (active) setPreview(result); })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "프로필을 불러오지 못했어요.");
      });
    void community.of(listingId).then(result => { if (active) setStats(result); }).catch(() => { /* 후기·통계는 없어도 프로필은 보여준다 */ });
    return () => { active = false; };
  }, [listingId]);

  async function buy() {
    if (!preview || buying) return;
    setBuying(true); setBuyError(null);
    try {
      const character = await purchaseCharacter(preview.listing);
      setActiveCharacterId(character.id);
      router.push("/chat");
    } catch (e) { setBuyError(e instanceof Error ? e.message : "구매를 완료하지 못했어요."); }
    finally { setBuying(false); }
  }

  if (error) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
        <header className="topbar">
          <button className="nav-btn nav-prev" onClick={() => router.back()} aria-label="이전">
            <Icon name="chevron-left" size={24} />
          </button>
          <span className="headline1">프로필</span>
          <span style={{ width: 24 }} />
        </header>
        <div className="body2" role="alert" style={{ flex: 1, display: "grid", placeItems: "center", padding: 24, color: "var(--gray-500)", textAlign: "center" }}>
          {error}
        </div>
      </div>
    );
  }

  if (!preview) return null;
  const { character, listing } = preview;
  const metadata = [character.gender].filter(Boolean);
  const imageSources = marketImageSources(listing, character.imageUrl);

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: "var(--gray-50)" }}>
      <header className="topbar" style={{ background: "#fff" }}>
        <button className="nav-btn nav-prev" onClick={() => router.back()} aria-label="이전">
          <Icon name="chevron-left" size={24} />
        </button>
        <span className="headline1">프로필</span>
        <button className="nav-btn" aria-pressed={saved} aria-label={saved ? "찜 해제" : "찜하기"} onClick={() => setSaved(toggleSaved(listing.id).includes(listing.id))}
          style={{ color: saved ? "var(--orange-700)" : "var(--gray-400)", display: "flex", transition: "color 200ms var(--ease)" }}>
          <Icon name="heart" size={22} />
        </button>
      </header>

      <main style={{ flex: 1, padding: "12px 20px 28px" }}>
        <div
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "4 / 5",
            overflow: "hidden",
            borderRadius: 24,
            background: "linear-gradient(160deg, var(--orange-100), var(--orange-400))",
          }}
        >
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 72 }} aria-hidden>🙂</div>
          <ResilientImage sources={imageSources} alt={character.name}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        </div>

        <section style={{ padding: "24px 4px 0" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
            <div style={{ minWidth: 0 }}>
              <h1 className="h2" style={{ margin: 0 }}>{character.name}</h1>
              {metadata.length > 0 && (
                <div className="body2" style={{ marginTop: 6, color: "var(--gray-500)" }}>{metadata.join(" · ")}</div>
              )}
            </div>
            <span className="point-badge" style={{ flexShrink: 0 }}>{formatPrice(listing.priceMist)}</span>
          </div>

          {/* 커뮤니티 신호 — 구매자 수, 후기 평점, 캐릭터가 실제로 보낸 선물 수, 제작자 */}
          <div className="chip-row" style={{ marginTop: 14 }}>
            <span className="chip" style={{ cursor: "default", padding: "6px 12px", fontSize: 13 }}>👥 {listing.buyerCount ?? '0'}명과 대화 중</span>
            {stats && stats.reviewCount > 0 && <span className="chip" style={{ cursor: "default", padding: "6px 12px", fontSize: 13 }}>★ {stats.averageRating} ({stats.reviewCount})</span>}
            {stats && stats.giftsSent > 0 && <span className="chip" style={{ cursor: "default", padding: "6px 12px", fontSize: 13 }}>🎁 선물 {stats.giftsSent}번 보냄</span>}
            <button type="button" className="chip" style={{ padding: "6px 12px", fontSize: 13 }}
              onClick={() => router.push(`/community/creator?address=${encodeURIComponent(listing.creator)}`)}>
              제작자 {shortAddress(listing.creator)}
            </button>
          </div>

          {character.summary && (
            <div style={{ marginTop: 20 }}>
              <h2 className="label1" style={{ margin: "0 0 8px" }}>한 줄 소개</h2>
              <p className="body1" style={{ margin: 0, color: "var(--gray-700)" }}>{character.summary}</p>
            </div>
          )}

          {character.background && (
            <div style={{ marginTop: 28 }}>
              <h2 className="label1" style={{ margin: "0 0 8px" }}>나에 대해</h2>
              <p className="body2" style={{ margin: 0, color: "var(--gray-700)", whiteSpace: "pre-wrap" }}>{character.background}</p>
            </div>
          )}

          {character.interests && (
            <div style={{ marginTop: 28 }}>
              <h2 className="label1" style={{ margin: "0 0 8px" }}>요즘 빠진 것</h2>
              <p className="body2" style={{ margin: 0, color: "var(--gray-700)" }}>{character.interests}</p>
            </div>
          )}

          {character.relationshipType && (
            <div style={{ marginTop: 24 }}>
              <h2 className="label1" style={{ margin: "0 0 10px" }}>원하는 관계</h2>
              <div className="chip-row">
                <span className="chip">{character.relationshipType}</span>
              </div>
            </div>
          )}

          {character.personality && (
            <div style={{ marginTop: 28 }}>
              <h2 className="label1" style={{ margin: "0 0 8px" }}>이런 사람이에요</h2>
              <p className="body2" style={{ margin: 0, color: "var(--gray-700)", whiteSpace: "pre-wrap" }}>{character.personality}</p>
            </div>
          )}

          {character.appearance && (
            <div style={{ marginTop: 24 }}>
              <h2 className="label1" style={{ margin: "0 0 8px" }}>첫인상</h2>
              <p className="body2" style={{ margin: 0, color: "var(--gray-700)", whiteSpace: "pre-wrap" }}>{character.appearance}</p>
            </div>
          )}

          {character.speechStyles && character.speechStyles.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h2 className="label1" style={{ margin: "0 0 10px" }}>대화 스타일</h2>
              <div className="chip-row">
                {character.speechStyles.map((style) => <span className="chip" key={style}>{style}</span>)}
              </div>
            </div>
          )}

          <Reviews listingId={listing.id} data={stats} onChange={setStats} />
          <p className="caption" style={{ margin: "20px 0 0", color: "var(--gray-500)" }}>
            개인 이용권이에요. 캐릭터 설정만 받고, 대화·기억은 나만의 것으로 새로 시작해요. 판매액의 {listing.agentBps / 100}%는 이 캐릭터의 선물 금고에 쌓여요.
          </p>
        </section>
      </main>

      <div style={{ position: "sticky", bottom: 0, padding: "12px 20px calc(16px + env(safe-area-inset-bottom))", background: "rgba(255,255,255,0.96)", borderTop: "1px solid var(--gray-100)" }}>
        {buyError && <p role="alert" className="caption" style={{ margin: "0 0 8px", color: "#d64545", textAlign: "center" }}>{buyError}</p>}
        <div style={{ display: "flex", gap: 10 }}>
          <button className="cta" style={{ flex: 1.3 }} disabled={buying} onClick={() => router.push(`/chat?listing=${listing.id}`)}>
            먼저 대화해보기 · {preview.previewTurns}회
          </button>
          <button className="cta" style={{ flex: 1, background: "#fff", color: "var(--gray-900)", border: "1.5px solid var(--gray-900)" }} disabled={buying} onClick={() => void buy()}>
            {buying ? "구매 중…" : `${formatPrice(listing.priceMist)}에 구매`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MarketCharacterPage() {
  return (
    <Suspense fallback={null}>
      <MarketCharacterDetail />
    </Suspense>
  );
}
