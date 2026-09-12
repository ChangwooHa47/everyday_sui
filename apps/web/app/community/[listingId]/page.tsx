"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { MarketPreview } from "@everyday/contracts";
import { formatPrice, market } from "@/lib/market";
import { Icon } from "../../icons";

export default function MarketCharacterPage() {
  const router = useRouter();
  const params = useParams<{ listingId: string }>();
  const listingId = params.listingId;
  const [preview, setPreview] = useState<MarketPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void market.preview(listingId)
      .then((result) => { if (active) setPreview(result); })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "캐릭터 정보를 불러오지 못했어요.");
      });
    return () => { active = false; };
  }, [listingId]);

  if (error) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
        <header className="topbar">
          <button className="nav-btn nav-prev" onClick={() => router.back()} aria-label="이전">
            <Icon name="chevron-left" size={24} />
          </button>
          <span className="headline1">캐릭터 정보</span>
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
  const metadata = [character.relationshipType, character.gender].filter(Boolean);

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: "var(--gray-50)" }}>
      <header className="topbar" style={{ background: "#fff" }}>
        <button className="nav-btn nav-prev" onClick={() => router.back()} aria-label="이전">
          <Icon name="chevron-left" size={24} />
        </button>
        <span className="headline1">캐릭터 정보</span>
        <span style={{ width: 24 }} />
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
          {character.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={character.imageUrl} alt={character.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 72 }}>🙂</div>
          )}
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

          {character.summary && (
            <p className="body1" style={{ margin: "20px 0 0", color: "var(--gray-700)" }}>{character.summary}</p>
          )}

          {character.personality && (
            <div style={{ marginTop: 28 }}>
              <h2 className="label1" style={{ margin: "0 0 8px" }}>성격</h2>
              <p className="body2" style={{ margin: 0, color: "var(--gray-700)", whiteSpace: "pre-wrap" }}>{character.personality}</p>
            </div>
          )}

          {character.appearance && (
            <div style={{ marginTop: 24 }}>
              <h2 className="label1" style={{ margin: "0 0 8px" }}>외모</h2>
              <p className="body2" style={{ margin: 0, color: "var(--gray-700)", whiteSpace: "pre-wrap" }}>{character.appearance}</p>
            </div>
          )}

          {character.speechStyles && character.speechStyles.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h2 className="label1" style={{ margin: "0 0 10px" }}>말투</h2>
              <div className="chip-row">
                {character.speechStyles.map((style) => <span className="chip" key={style}>{style}</span>)}
              </div>
            </div>
          )}
        </section>
      </main>

      <div style={{ position: "sticky", bottom: 0, padding: "12px 20px calc(16px + env(safe-area-inset-bottom))", background: "rgba(255,255,255,0.96)", borderTop: "1px solid var(--gray-100)" }}>
        <button className="cta" onClick={() => router.push(`/chat?listing=${listing.id}`)}>
          대화해보기 · {preview.previewTurns}회
        </button>
      </div>
    </div>
  );
}
