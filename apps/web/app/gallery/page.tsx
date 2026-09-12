"use client";

// 갤러리 탭 — Spring 백엔드 연동판. 캐릭터별 사진(GET /gallery) 모아보기.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  backend,
  getActiveCharacterId,
  setActiveCharacterId,
  type CharacterSummary,
  type PhotoItem,
} from "@/lib/api";
import { BottomNav } from "../components";
import { Icon } from "../icons";

export default function GalleryPage() {
  const router = useRouter();
  const [list, setList] = useState<CharacterSummary[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [viewer, setViewer] = useState<PhotoItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestSequence = useRef(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const characters = await backend.listCharacters();
        if (!alive) return;
        if (characters.length === 0) {
          router.replace("/create");
          return;
        }
        setList(characters);
        const saved = getActiveCharacterId();
        const active = characters.find((c) => c.id === saved) ?? characters[0];
        setActiveCharacterId(active.id);
        setActiveId(active.id);
        await switchTo(active.id);
      } catch (e) {
        if (alive) { setError(e instanceof Error ? e.message : '사진을 불러오지 못했어요.'); setLoading(false); }
      }
    })();
    return () => { alive = false; requestSequence.current++; };
  }, [router]);

  async function switchTo(id: number) {
    const sequence = ++requestSequence.current;
    setActiveCharacterId(id);
    setActiveId(id);
    setPhotos([]); setViewer(null); setError(null); setLoading(true);
    try {
      const next = await backend.getGallery(id);
      if (sequence === requestSequence.current) setPhotos(next);
    } catch (e) {
      if (sequence === requestSequence.current) setError(e instanceof Error ? e.message : '사진을 불러오지 못했어요.');
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }

  const char = list.find((c) => c.id === activeId);
  if (!char) return error ? <p className="caption" role="alert">{error}</p> : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <header className="topbar">
        <button
          onClick={() => router.back()}
          aria-label="뒤로"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: "none",
            border: "none",
            padding: "4px 0",
            cursor: "pointer",
            font: "inherit",
          }}
        >
          <Icon name="chevron-left" size={22} style={{ color: "var(--gray-700)" }} />
          <span className="h3">내 갤러리</span>
        </button>
        <span className="caption" style={{ color: "var(--gray-400)" }}>
          {!loading && !error ? `${photos.length}장` : ''}
        </span>
      </header>

      {/* 캐릭터 전환 (여러 명일 때) */}
      {list.length > 1 && (
        <div style={{ padding: "0 20px 12px", display: "flex", gap: 8, overflowX: "auto" }}>
          {list.map((c) => (
            <button
              key={c.id}
              onClick={() => void switchTo(c.id)}
              className={`chip ${c.id === activeId ? "selected" : ""}`}
              style={{ whiteSpace: "nowrap", flexShrink: 0 }}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* 사진 그리드 */}
      <div style={{ padding: "0 20px", flex: 1 }}>
        {error ? <p className="caption" role="alert">{error}</p> : loading ? <p className="caption">불러오는 중…</p> : photos.length === 0 ? (
          <div
            style={{
              padding: "80px 0",
              textAlign: "center",
              color: "var(--gray-400)",
              border: "1px dashed var(--gray-200)",
              borderRadius: 16,
            }}
          >
            <Icon name="camera" size={30} style={{ color: "var(--gray-400)", marginBottom: 10 }} />
            <div className="body2">{char.name}와의 사진이 아직 없어요</div>
            <button
              className="chip"
              style={{ marginTop: 14 }}
              onClick={() => router.push("/photobooth")}
            >
              포토부스에서 찍기
            </button>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              paddingBottom: 20,
            }}
          >
            {photos.map((p) => (
              <button
                key={p.id}
                onClick={() => setViewer(p)}
                style={{ border: "none", padding: 0, background: "transparent", cursor: "pointer" }}
              >
                <div style={{ position: "relative" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.imageUrl}
                    alt={p.concept ?? ""}
                    style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", borderRadius: 12, display: "block" }}
                  />
                  <span
                    style={{
                      position: "absolute",
                      left: 8,
                      bottom: 8,
                      padding: "3px 9px",
                      borderRadius: 999,
                      background: "rgba(30,30,30,0.6)",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {p.type === "PROFILE" ? "프로필" : p.concept ?? "포토부스"}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <BottomNav active="gallery" />

      {/* 전체화면 뷰어 */}
      {viewer && (
        <div className="dim" onClick={() => setViewer(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={viewer.imageUrl}
            alt=""
            style={{ maxWidth: "92vw", maxHeight: "74vh", borderRadius: 16 }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
