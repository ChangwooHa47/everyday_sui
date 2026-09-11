"use client";

// FS-04 에피소드 — Spring 백엔드 연동판. (figma 42:2632 / 42:2685 — 다크 톤)
// 카탈로그(GET /api/episodes) → start(진행 등록 + starters 수신) → 에피소드 전용 채팅으로 이동.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  backend,
  getActiveCharacterId,
  setActiveCharacterId,
  type CharacterSummary,
  type EpisodeItem,
  type EpisodeStart,
} from "@/lib/api";
import { Icon } from "../icons";

const DARK_BG = "#1e1e1e";

export default function EpisodePage() {
  const router = useRouter();
  const [char, setChar] = useState<CharacterSummary | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeItem[]>([]);
  const [selected, setSelected] = useState<{ episode: EpisodeItem; start: EpisodeStart } | null>(null);
  const [starting, setStarting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await backend.listCharacters();
        if (list.length === 0) {
          router.replace("/create");
          return;
        }
        const activeId = getActiveCharacterId();
        const active = list.find((c) => c.id === activeId) ?? list[0];
        setActiveCharacterId(active.id);
        setChar(active);
        setEpisodes(await backend.listEpisodes());
      } catch (e) {
        setError(e instanceof Error ? e.message : "백엔드 연결 실패");
      }
    })();
  }, [router]);

  async function select(ep: EpisodeItem) {
    if (!char || starting) return;
    setStarting(ep.id);
    try {
      const start = await backend.startEpisode(char.id, ep.id);
      setSelected({ episode: ep, start });
    } catch (e) {
      setError(e instanceof Error ? e.message : "에피소드 시작 실패");
    } finally {
      setStarting(null);
    }
  }

  if (error) {
    return (
      <div
        style={{
          display: "grid",
          placeItems: "center",
          height: "100dvh",
          padding: 24,
          background: DARK_BG,
        }}
      >
        <div className="body2" style={{ color: "var(--gray-500)", textAlign: "center" }}>
          {error}
        </div>
      </div>
    );
  }
  if (!char) return null;

  // ── 시나리오 진행 화면 (42:2685) ──
  if (selected) {
    const { episode, start } = selected;
    return (
      <div
        className="fade-in"
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: "100dvh",
          background: DARK_BG,
        }}
      >
        <header className="topbar">
          <button
            className="nav-btn nav-prev"
            style={{ color: "#fff" }}
            onClick={() => setSelected(null)}
          >
            <Icon name="chevron-left" size={24} />
          </button>
          <span className="headline1" style={{ color: "#fff" }}>
            {episode.title}
          </span>
          <span style={{ width: 24 }} />
        </header>

        {/* 장면 이미지 영역 + 지문 */}
        <div style={{ position: "relative", flex: 1, display: "flex" }}>
          <div
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 130,
              minHeight: 460,
              background:
                "linear-gradient(180deg, var(--orange-100), var(--orange-500))",
            }}
          >
            {episode.emoji}
          </div>
          <div
            className="body1 fade-in"
            style={{
              position: "absolute",
              left: 20,
              right: 20,
              bottom: 20,
              padding: "16px 18px",
              borderRadius: 14,
              background: "var(--orange-50)",
              border: "1px solid var(--orange-200)",
              color: "var(--black)",
            }}
          >
            {episode.description}
          </div>
        </div>

        {/* 선택지 */}
        <div style={{ padding: "18px 20px calc(20px + env(safe-area-inset-bottom))" }}>
          <div className="headline1" style={{ marginBottom: 14, color: "#fff" }}>
            먼저 말을 걸어주세요
          </div>
          {start.starters.map((s) => (
            <button
              key={s}
              onClick={() =>
                router.push(
                  `/chat?episode=${episode.id}&title=${encodeURIComponent(
                    `${episode.emoji} ${episode.title}`,
                  )}&starter=${encodeURIComponent(s)}`,
                )
              }
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                width: "100%",
                marginBottom: 12,
                padding: "16px 18px",
                borderRadius: 12,
                border: "1px solid var(--orange-700)",
                background: "transparent",
                color: "var(--orange-700)",
                fontFamily: "inherit",
                fontSize: 15,
                fontWeight: 600,
                textAlign: "left",
                cursor: "pointer",
                transition: "all 200ms var(--ease)",
              }}
            >
              <span>{s}</span>
              <Icon name="send" size={20} style={{ flexShrink: 0 }} />
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── 시나리오 목록 (42:2632) ──
  const [feature, ...rest] = episodes;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100dvh",
        background: DARK_BG,
      }}
    >
      <header className="topbar">
        <button
          className="nav-btn nav-prev"
          style={{ color: "#fff" }}
          onClick={() => router.push("/home")}
        >
          <Icon name="chevron-left" size={24} />
        </button>
        <span className="headline1" style={{ color: "#fff" }}>
          에피소드
        </span>
        <span style={{ color: "#fff", display: "flex" }}>
          <Icon name="menu" size={22} />
        </span>
      </header>

      <div style={{ padding: "8px 20px 40px" }}>
        {/* 신규 — 대형 가로 카드 */}
        {feature && (
          <>
            <div
              className="headline2"
              style={{ color: "var(--orange-700)", fontWeight: 700, margin: "8px 0 12px" }}
            >
              신규
            </div>
            <button
              onClick={() => void select(feature)}
              disabled={starting != null}
              style={{
                width: "100%",
                padding: 0,
                marginBottom: 28,
                borderRadius: 16,
                border: "1px solid var(--orange-700)",
                background: "#262626",
                overflow: "hidden",
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 200ms var(--ease)",
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: 200,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 90,
                  background:
                    "linear-gradient(180deg, var(--orange-100), var(--orange-500))",
                }}
              >
                {feature.emoji}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "14px 16px 16px",
                }}
              >
                <div style={{ textAlign: "left", minWidth: 0 }}>
                  <div className="headline1" style={{ color: "#fff", marginBottom: 4 }}>
                    {feature.title}
                  </div>
                  <div
                    className="body2"
                    style={{
                      color: "var(--gray-400)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {feature.description}
                  </div>
                </div>
                <span
                  style={{
                    flexShrink: 0,
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    background: "var(--orange-500)",
                    color: "var(--black)",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {starting === feature.id ? (
                    <span className="caption" style={{ fontWeight: 700 }}>
                      …
                    </span>
                  ) : (
                    <Icon name="arrow-right" size={20} />
                  )}
                </span>
              </div>
            </button>
          </>
        )}

        {/* 추천 — 2열 그리드 */}
        {rest.length > 0 && (
          <>
            <div
              className="headline2"
              style={{ color: "var(--orange-700)", fontWeight: 700, margin: "0 0 12px" }}
            >
              추천
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              {rest.map((ep) => (
                <button
                  key={ep.id}
                  onClick={() => void select(ep)}
                  disabled={starting != null}
                  style={{
                    position: "relative",
                    padding: 0,
                    borderRadius: 14,
                    border: "none",
                    overflow: "hidden",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    aspectRatio: "1 / 1",
                    background:
                      "linear-gradient(160deg, var(--orange-100), var(--orange-400))",
                    transition: "all 200ms var(--ease)",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 64,
                    }}
                  >
                    {ep.emoji}
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: 0,
                      padding: "20px 12px 10px",
                      textAlign: "left",
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: 14,
                      background:
                        "linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.55))",
                    }}
                  >
                    {starting === ep.id ? "시작하는 중…" : ep.title}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
