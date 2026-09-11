"use client";

// chatlist — figma 241:2511(채팅 목록) + 241:2152(채팅방 편집).
// 톱니 → 편집 모드: 행마다 체크박스, 하단 "선택 해제" / "채팅방 삭제" 2버튼.
// 백엔드에 채팅방 삭제 API가 없어 삭제 = 로컬 숨김(localStorage) 처리.
// 마지막 메시지 전용 API가 없어 캐릭터별 getMessages 병렬 호출로 뽑는다(실패 시 프리뷰 생략).

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { backend, setActiveCharacterId, type CharacterSummary } from "@/lib/api";
import { Avatar, BottomNav } from "../components";
import { Icon } from "../icons";

const HIDDEN_KEY = "everyday.v2.hiddenChatIds";
function loadHiddenIds(): number[] {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]");
  } catch {
    return [];
  }
}

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

export default function ChatListPage() {
  const router = useRouter();
  const [list, setList] = useState<CharacterSummary[] | null>(null);
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<number[]>([]);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    setHidden(loadHiddenIds());
    (async () => {
      try {
        const characters = await backend.listCharacters();
        if (characters.length === 0) {
          router.replace("/create");
          return;
        }
        setList(characters);

        // 각 캐릭터의 마지막 메시지를 병렬로 — 실패한 건 그냥 프리뷰 생략
        const entries = await Promise.all(
          characters.map(async (c) => {
            try {
              const msgs = await backend.getMessages(c.id);
              const last = msgs[msgs.length - 1];
              return [c.id, last?.content ?? ""] as const;
            } catch {
              return [c.id, ""] as const;
            }
          }),
        );
        setPreviews(Object.fromEntries(entries));
      } catch (e) {
        setError(e instanceof Error ? e.message : "백엔드 연결 실패");
      }
    })();
  }, [router]);

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitEditing() {
    setEditing(false);
    setSelected(new Set());
  }

  function deleteSelected() {
    if (selected.size === 0) return;
    const next = [...new Set([...hidden, ...selected])];
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
    setHidden(next);
    exitEditing();
  }

  if (error) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100dvh", padding: 24 }}>
        <div className="body2" style={{ color: "var(--gray-500)", textAlign: "center" }}>
          {error}
        </div>
      </div>
    );
  }
  if (!list) return null;

  const visible = list.filter((c) => !hidden.includes(c.id));

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      {editing ? (
        <header className="topbar" style={{ justifyContent: "flex-start", gap: 8 }}>
          <button
            onClick={exitEditing}
            aria-label="편집 종료"
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              cursor: "pointer",
              display: "flex",
              color: "var(--gray-800)",
            }}
          >
            <Icon name="chevron-left" size={26} />
          </button>
          <span className="h3">채팅방 편집</span>
        </header>
      ) : (
        <header className="topbar">
          <span className="h3">채팅</span>
          <button
            onClick={() => setEditing(true)}
            aria-label="채팅방 편집"
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              cursor: "pointer",
              display: "flex",
              color: "var(--gray-800)",
            }}
          >
            <Icon name="settings" size={24} />
          </button>
        </header>
      )}

      <div style={{ padding: "4px 0" }}>
        {visible.map((c) => {
          const preview = previews[c.id];
          const isSelected = selected.has(c.id);
          return (
            <button
              key={c.id}
              onClick={() => {
                if (editing) {
                  toggleSelect(c.id);
                } else {
                  setActiveCharacterId(c.id);
                  router.push("/chat");
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                padding: "12px 20px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "inherit",
              }}
            >
              <Avatar emoji="🙂" src={c.profileImageUrl ?? undefined} size={52} radius={16} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="label1" style={{ marginBottom: 2 }}>
                  {c.name}
                </div>
                <div
                  className="body2"
                  style={{
                    color: "var(--gray-500)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    minHeight: 21,
                  }}
                >
                  {preview ?? ""}
                </div>
              </div>
              {editing && (
                <span
                  aria-checked={isSelected}
                  role="checkbox"
                  style={{
                    width: 26,
                    height: 26,
                    flexShrink: 0,
                    borderRadius: 8,
                    border: "2px solid var(--gray-700)",
                    background: isSelected ? "var(--gray-700)" : "transparent",
                    transition: `background 200ms ${EASE}`,
                  }}
                />
              )}
            </button>
          );
        })}
        {visible.length === 0 && (
          <div
            className="body2"
            style={{ color: "var(--gray-500)", textAlign: "center", padding: "48px 20px" }}
          >
            채팅방이 없어요.
          </div>
        )}
      </div>

      <div style={{ flex: 1 }} />

      {editing ? (
        <>
          <div aria-hidden style={{ height: "calc(96px + env(safe-area-inset-bottom))", flexShrink: 0 }} />
          <div
            style={{
              position: "fixed",
              bottom: 0,
              left: "50%",
              transform: "translateX(-50%)",
              width: "100%",
              maxWidth: 375,
              padding: "0 20px calc(16px + env(safe-area-inset-bottom))",
              boxSizing: "border-box",
              display: "flex",
              gap: 12,
              zIndex: 50,
            }}
          >
            <button
              onClick={() => setSelected(new Set())}
              style={{
                flex: 1,
                padding: "22px 0",
                borderRadius: 28,
                border: "1.5px solid var(--gray-700)",
                background: "#fff",
                color: "var(--gray-800)",
                fontSize: 17,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: `all 200ms ${EASE}`,
              }}
            >
              선택 해제
            </button>
            <button
              onClick={deleteSelected}
              disabled={selected.size === 0}
              style={{
                flex: 1.15,
                padding: "22px 0",
                borderRadius: 28,
                border: "none",
                background: "var(--gray-800)",
                color: "#fff",
                fontSize: 17,
                fontWeight: 700,
                cursor: selected.size === 0 ? "default" : "pointer",
                opacity: selected.size === 0 ? 0.45 : 1,
                fontFamily: "inherit",
                transition: `all 200ms ${EASE}`,
              }}
            >
              채팅방 삭제
            </button>
          </div>
        </>
      ) : (
        <BottomNav active="chat" />
      )}
    </div>
  );
}
