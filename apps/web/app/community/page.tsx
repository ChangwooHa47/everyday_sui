"use client";

// 커뮤니티 — figma 42:3227.
// HOT 캐릭터(가로 스크롤) / 인기 설정집(2열) / 자유 게시판(세로 리스트).
// 커뮤니티는 백엔드 미구현 → 표시용. HOT 캐릭터만 backend.listCharacters() 재활용 + 목데이터 보충.

import { useEffect, useState } from "react";
import { backend, type CharacterSummary } from "@/lib/api";
import { BottomNav } from "../components";

type HotCharacter = { key: string; name: string; imageUrl: string | null; emoji: string; price: number };

const MOCK_HOT: HotCharacter[] = [
  { key: "m-haru", name: "하루", imageUrl: null, emoji: "🐶", price: 1200 },
  { key: "m-seojun", name: "서준", imageUrl: null, emoji: "🌙", price: 1800 },
  { key: "m-dain", name: "다인", imageUrl: null, emoji: "🌷", price: 1500 },
  { key: "m-minjae", name: "민재", imageUrl: null, emoji: "☕", price: 2000 },
];

const SETTING_PACKS = [
  { id: 1, title: "다정한 소꿉친구 성격", author: "@haru_dev", desc: "티격태격해도 결국 챙겨주는 오랜 친구", price: 1500, emoji: "🐶" },
  { id: 2, title: "무심한 듯 다정한 선배", author: "@minji", desc: "말은 툭툭 던져도 뒤에선 늘 챙긴다", price: 2000, emoji: "🌙" },
  { id: 3, title: "장난꾸러기 강아지상", author: "@dool", desc: "사람 좋아하고 애교 많은 명랑 캐릭터", price: 1200, emoji: "🐾" },
  { id: 4, title: "차분한 밤샘 메이트", author: "@nabi", desc: "새벽까지 조용히 곁을 지켜주는 성격", price: 1800, emoji: "🕯️" },
];

const POSTS = [
  { id: 1, author: "지호", title: "첫 캐릭터 만들었어요", body: "관계를 소꿉친구로 했더니 대화가 자연스러워서 놀랐어요. 다들 어떤 관계로 시작하셨나요?" },
  { id: 2, author: "민서", title: "사진 포인트 아끼는 팁", body: "포토부스는 컨셉을 몰아서 찍는 게 이득이더라고요. 저는 주말에 한 번에 찍어둡니다." },
  { id: 3, author: "재윤", title: "에피소드 추천받아요", body: "잔잔한 일상 에피소드 위주로 하는데 다른 분들은 어떤 걸 즐기시나요?" },
  { id: 4, author: "수아", title: "말투 설정 이렇게 했어요", body: "존댓말이랑 반말을 섞으니 훨씬 사람 같아요. 설정집에도 올려봤는데 반응이 좋네요." },
];

export default function CommunityPage() {
  const [hot, setHot] = useState<HotCharacter[]>(MOCK_HOT);

  useEffect(() => {
    (async () => {
      try {
        const chars: CharacterSummary[] = await backend.listCharacters();
        const fromBackend: HotCharacter[] = chars.slice(0, 3).map((c) => ({
          key: `b-${c.id}`,
          name: c.name,
          imageUrl: c.profileImageUrl,
          emoji: "🙂",
          price: 1200,
        }));
        setHot([...fromBackend, ...MOCK_HOT]);
      } catch {
        // 백엔드 미연결이어도 목데이터로 표시
      }
    })();
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <header className="topbar">
        <span className="h3">커뮤니티</span>
        <span className="point-badge">
          <span className="p">P</span> 1,200
        </span>
      </header>

      {/* HOT 캐릭터 */}
      <section style={{ marginBottom: 26 }}>
        <div className="label1" style={{ padding: "0 20px 12px" }}>
          HOT 캐릭터
        </div>
        <div
          style={{
            display: "flex",
            gap: 12,
            overflowX: "auto",
            padding: "0 20px 2px",
            scrollbarWidth: "none",
          }}
        >
          {hot.map((c) => (
            <div
              key={c.key}
              style={{
                flexShrink: 0,
                width: 132,
                aspectRatio: "3 / 4",
                borderRadius: 14,
                position: "relative",
                overflow: "hidden",
                background: "linear-gradient(160deg, var(--orange-100), var(--orange-400))",
              }}
            >
              {c.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.imageUrl}
                  alt={c.name}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 48 }}>
                  {c.emoji}
                </div>
              )}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  padding: "22px 10px 10px",
                  background: "linear-gradient(180deg, transparent, rgba(30,30,30,0.72))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 6,
                }}
              >
                <span style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>{c.name}</span>
                <span
                  className="point-badge"
                  style={{ padding: "3px 8px", fontSize: 11 }}
                >
                  <span className="p">P</span> {c.price.toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 인기 설정집 */}
      <section style={{ marginBottom: 26 }}>
        <div className="label1" style={{ padding: "0 20px 12px" }}>
          인기 설정집
        </div>
        <div
          style={{
            padding: "0 20px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          {SETTING_PACKS.map((p) => (
            <div
              key={p.id}
              style={{
                borderRadius: 14,
                padding: "14px 14px 16px",
                background: "var(--orange-50)",
                border: "1px solid var(--orange-200)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                <div style={{ minWidth: 0 }}>
                  <div
                    className="headline2"
                    style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {p.title}
                  </div>
                  <div className="caption" style={{ color: "var(--gray-500)" }}>
                    {p.author}
                  </div>
                </div>
                <span style={{ fontSize: 22, flexShrink: 0, lineHeight: 1 }}>{p.emoji}</span>
              </div>
              <div
                className="body2"
                style={{
                  color: "var(--gray-600)",
                  margin: "10px 0 8px",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {p.desc}
              </div>
              <span className="caption" style={{ color: "var(--orange-700)", fontWeight: 700 }}>
                P {p.price.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* 자유 게시판 */}
      <section style={{ marginBottom: 8 }}>
        <div className="label1" style={{ padding: "0 20px 12px" }}>
          자유 게시판
        </div>
        <div style={{ padding: "0 20px" }}>
          {POSTS.map((post) => (
            <div
              key={post.id}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                padding: "14px 0",
                borderBottom: "1px solid var(--gray-100)",
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: "50%",
                  background: "var(--gray-200)",
                  flexShrink: 0,
                }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="body1" style={{ fontWeight: 700, color: "var(--gray-800)" }}>
                  {post.title}
                </div>
                <div
                  className="body2"
                  style={{
                    color: "var(--gray-500)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {post.body}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div style={{ flex: 1 }} />
      <BottomNav active="community" />
    </div>
  );
}
