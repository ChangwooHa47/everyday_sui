"use client";

// FS-03 채팅 — Spring 백엔드 연동판.
// 대화 이력·전송·호칭 모두 백엔드 API 경유. 응답은 non-streaming이라 대기 중 타이핑 버블 표시.
// ?episode=<id> 로 진입하면 에피소드 전용 채팅 엔드포인트를 쓴다.

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  backend,
  getActiveCharacterId,
  setActiveCharacterId,
  type CharacterDetail,
  type ChatMessage,
} from "@/lib/api";
import { Icon } from "../icons";

type Msg = { role: "user" | "assistant"; content: string };

function toMsg(m: ChatMessage): Msg {
  return { role: m.sender === "USER" ? "user" : "assistant", content: m.content };
}

function ChatInner() {
  const router = useRouter();
  const params = useSearchParams();
  const episodeId = params.get("episode");
  const episodeTitle = params.get("title");
  const starter = params.get("starter");

  const [char, setChar] = useState<CharacterDetail | null>(null);
  const [nicknameInput, setNicknameInput] = useState("");
  const [askNickname, setAskNickname] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        let id = getActiveCharacterId();
        if (!id) {
          const list = await backend.listCharacters();
          if (list.length === 0) {
            router.replace("/create");
            return;
          }
          id = list[0].id;
          setActiveCharacterId(id);
        }
        const detail = await backend.getCharacter(id);
        setChar(detail);
        setAskNickname(!detail.callName);
        const history = episodeId
          ? await backend.getEpisodeMessages(id, episodeId)
          : await backend.getMessages(id);
        setMessages(history.map(toMsg));
        scrollDown();
      } catch (e) {
        setError(e instanceof Error ? e.message : "백엔드에 연결할 수 없어요");
      }
    })();
  }, [router, episodeId]);

  // 에피소드에서 starter 들고 진입 시 자동 발화
  useEffect(() => {
    if (starter && char && char.callName && !startedRef.current) {
      startedRef.current = true;
      void send(starter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starter, char]);

  function scrollDown() {
    setTimeout(
      () => scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight),
      60,
    );
  }

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (!text || busy || !char) return;
    setInput("");
    setBusy(true);
    setError(null);

    const base: Msg[] = [...messages, { role: "user", content: text }];
    setMessages([...base, { role: "assistant", content: "" }]); // 타이핑 버블
    scrollDown();

    try {
      const reply = episodeId
        ? await backend.sendEpisodeMessage(char.id, episodeId, text)
        : await backend.sendMessage(char.id, text);
      setMessages([...base, toMsg(reply)]);
    } catch (e) {
      // 정책 거절 스펙 — 캐릭터 말풍선으로 안내 + 입력바 위 배너(에러 시에만)
      setMessages([...base, { role: "assistant", content: "답변을 생성할 수 없어요." }]);
      setError(e instanceof Error ? e.message : "메시지 전송 실패");
    } finally {
      setBusy(false);
      scrollDown();
    }
  }

  async function saveNickname() {
    if (!char || !nicknameInput.trim()) return;
    const updated = await backend.setCallName(char.id, nicknameInput.trim());
    setChar(updated);
    setAskNickname(false);
  }

  if (error && !char) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100dvh", padding: 24 }}>
        <div className="body2" style={{ color: "var(--gray-500)", textAlign: "center" }}>
          {error}
          <br />
          백엔드(localhost:8080)가 켜져 있는지 확인해주세요.
        </div>
      </div>
    );
  }
  if (!char) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
      {/* 헤더 */}
      <header className="topbar" style={{ borderBottom: "1px solid var(--gray-100)" }}>
        <button
          className="nav-btn nav-prev"
          onClick={() => router.push(episodeId ? "/episode" : "/home")}
        >
          <Icon name="chevron-left" size={24} />
        </button>
        <span
          className="headline1"
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          {char.name}
          {episodeTitle && (
            <span className="point-badge" style={{ fontSize: 11 }}>
              {episodeTitle}
            </span>
          )}
        </span>
        <button
          className="nav-btn"
          style={{ color: "var(--gray-700)", display: "flex" }}
          onClick={() => router.push("/edit")}
          title="캐릭터 편집"
        >
          <Icon name="menu" size={22} />
        </button>
      </header>

      {/* 메시지 — 캐릭터 응답은 줄바꿈마다 말풍선 분리 (톡처럼 여러 번 보낸 느낌) */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        {messages.map((m, i) => {
          const isUser = m.role === "user";
          const lines =
            isUser || !m.content
              ? [m.content]
              : m.content.split("\n").map((l) => l.trim()).filter(Boolean);
          return (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: isUser ? "flex-end" : "flex-start",
                gap: 4,
                marginBottom: 10,
              }}
            >
              {lines.map((line, j) => (
                <div
                  key={j}
                  className={`bubble ${isUser ? "user" : "char"}`}
                  style={{ maxWidth: 240 }}
                >
                  {line || (
                    <span className="typing">
                      <span />
                      <span />
                      <span />
                    </span>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* 정책 거절 배너 — 에러 발생 시에만 입력바 위에 노출 */}
      {error && char && (
        <div
          style={{
            background: "var(--gray-900)",
            color: "var(--gray-300)",
            fontSize: 12,
            fontWeight: 500,
            textAlign: "center",
            padding: "10px 16px",
          }}
        >
          ※ 정책상 민감한 요청은 AI 답변을 생성할 수 없어요
        </div>
      )}

      {/* 입력바 */}
      <div className="chat-inputbar">
        <input
          className="input"
          style={{ flex: 1, borderRadius: 999 }}
          placeholder={`${char.name}에게 메시지`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) =>
            e.key === "Enter" && !e.nativeEvent.isComposing && send()
          }
          disabled={askNickname}
        />
        <button className="send-btn" onClick={() => send()} disabled={busy || askNickname}>
          <Icon name="send" size={18} />
        </button>
      </div>

      {/* 호칭 팝업 (figma chat-pop) — 백엔드 callName */}
      {askNickname && (
        <div className="dim">
          <div className="popup">
            <div className="headline1" style={{ marginBottom: 6 }}>
              {char.name}(이)가 유저 님을 뭐라고 부를까요?
            </div>
            <div className="caption" style={{ color: "var(--gray-500)", marginBottom: 18 }}>
              이름을 입력해주세요
            </div>
            <input
              className="input"
              placeholder="예: 자기야, 은우야, 야"
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.nativeEvent.isComposing &&
                  nicknameInput.trim()
                ) {
                  void saveNickname();
                }
              }}
              autoFocus
            />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button
                className="send-btn"
                disabled={!nicknameInput.trim()}
                onClick={() => void saveNickname()}
              >
                <Icon name="send" size={18} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense>
      <ChatInner />
    </Suspense>
  );
}
