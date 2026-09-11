"use client";

// 원가 계측 대시보드 (개발자용) — localhost:3000/measure
// 프리셋 캐릭터로 대화하며 턴별 usage·캐시·비용 확인. 데스크탑 전체 폭 사용.

import { useRef, useState } from "react";
import { PRESETS } from "@/lib/character";

type Msg = { role: "user" | "assistant"; content: string };
type TurnLog = {
  turn: number;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  costUsd: number;
};

const KEEP_RECENT = 8;
const SUMMARIZE_AT = 16;

export default function MeasurePage() {
  const [presetIdx, setPresetIdx] = useState(0);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [memory, setMemory] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<TurnLog[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const profile = PRESETS[presetIdx];
  const totalCost = logs.reduce((s, l) => s + l.costUsd, 0);
  const avgInput =
    logs.length === 0
      ? 0
      : Math.round(
          logs.reduce((s, l) => s + l.input + l.cacheWrite + l.cacheRead, 0) /
            logs.length,
        );

  function resetChat(idx: number) {
    setPresetIdx(idx);
    setMessages([]);
    setMemory("");
    setLogs([]);
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);

    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages([...next, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, memory, messages: next }),
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "text") {
            assistantText += ev.text;
            setMessages([...next, { role: "assistant", content: assistantText }]);
          } else if (ev.type === "usage") {
            setLogs((prev) => [
              ...prev,
              {
                turn: prev.length + 1,
                input: ev.usage.input_tokens,
                cacheWrite: ev.usage.cache_creation_input_tokens,
                cacheRead: ev.usage.cache_read_input_tokens,
                output: ev.usage.output_tokens,
                costUsd: ev.costUsd,
              },
            ]);
          } else if (ev.type === "error") {
            assistantText += `\n[에러: ${ev.message}]`;
            setMessages([...next, { role: "assistant", content: assistantText }]);
          }
        }
      }
    } finally {
      setBusy(false);
      setTimeout(
        () => scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight),
        50,
      );
    }
  }

  async function summarize() {
    if (messages.length <= KEEP_RECENT || busy) return;
    setBusy(true);
    try {
      const old = messages.slice(0, -KEEP_RECENT);
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterName: profile.name,
          existingMemory: memory,
          messages: old,
        }),
      });
      const data = await res.json();
      setMemory(data.memory);
      setMessages(messages.slice(-KEEP_RECENT));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        background: "#121212",
        color: "#eee",
        zIndex: 100,
      }}
    >
      {/* ─── 채팅 영역 ─── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid #2a2a2a",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          {PRESETS.map((p, i) => (
            <button
              key={p.name}
              onClick={() => resetChat(i)}
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                border: "1px solid #444",
                background: i === presetIdx ? "#eee" : "transparent",
                color: i === presetIdx ? "#121212" : "#aaa",
                cursor: "pointer",
              }}
            >
              {p.name}
            </button>
          ))}
          <span style={{ marginLeft: "auto", fontSize: 12, color: "#666" }}>
            {messages.length}턴{messages.length >= SUMMARIZE_AT && " — 요약 권장"}
          </span>
        </header>

        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  maxWidth: "70%",
                  padding: "10px 14px",
                  borderRadius: 16,
                  background: m.role === "user" ? "#3a5eff" : "#242424",
                  whiteSpace: "pre-wrap",
                  fontSize: 14,
                  lineHeight: 1.5,
                }}
              >
                {m.content || "…"}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, padding: 16 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && !e.nativeEvent.isComposing && send()
            }
            placeholder={`${profile.name}에게 메시지…`}
            style={{
              flex: 1,
              padding: "12px 16px",
              borderRadius: 12,
              border: "1px solid #333",
              background: "#1c1c1c",
              color: "#eee",
              fontSize: 14,
              outline: "none",
            }}
          />
          <button
            onClick={send}
            disabled={busy}
            style={{
              padding: "0 20px",
              borderRadius: 12,
              border: "none",
              background: busy ? "#333" : "#3a5eff",
              color: "#fff",
              cursor: busy ? "default" : "pointer",
            }}
          >
            전송
          </button>
        </div>
      </div>

      {/* ─── 계측 패널 ─── */}
      <aside
        style={{
          width: 360,
          borderLeft: "1px solid #2a2a2a",
          padding: 16,
          overflowY: "auto",
          fontSize: 12,
        }}
      >
        <h3 style={{ margin: "0 0 8px" }}>📊 원가 계측</h3>
        <div style={{ color: "#999", marginBottom: 12 }}>
          누적 <b style={{ color: "#eee" }}>${totalCost.toFixed(5)}</b> · 턴당 평균
          입력 <b style={{ color: "#eee" }}>{avgInput.toLocaleString()}</b> tok
          <br />
          <span style={{ color: "#666" }}>
            → Plus 50턴 기준 일{" "}
            {logs.length > 0
              ? `$${((totalCost / logs.length) * 50).toFixed(3)}`
              : "—"}
          </span>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "#666", textAlign: "right" }}>
              <th style={{ textAlign: "left" }}>턴</th>
              <th>input</th>
              <th>c-read</th>
              <th>out</th>
              <th>$</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.turn} style={{ textAlign: "right", color: "#bbb" }}>
                <td style={{ textAlign: "left" }}>{l.turn}</td>
                <td>{l.input}</td>
                <td style={{ color: l.cacheRead > 0 ? "#7fd67f" : "#bbb" }}>
                  {l.cacheRead}
                </td>
                <td>{l.output}</td>
                <td>{l.costUsd.toFixed(5)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 style={{ margin: "20px 0 8px" }}>
          🧠 기억{" "}
          <button
            onClick={summarize}
            disabled={busy || messages.length <= KEEP_RECENT}
            style={{
              fontSize: 11,
              padding: "3px 10px",
              borderRadius: 999,
              border: "1px solid #444",
              background: "transparent",
              color: "#aaa",
              cursor: "pointer",
            }}
          >
            지금 요약
          </button>
        </h3>
        <textarea
          value={memory}
          onChange={(e) => setMemory(e.target.value)}
          placeholder="요약 실행 시 캐릭터의 기억이 여기 쌓임"
          style={{
            width: "100%",
            height: 180,
            background: "#1c1c1c",
            border: "1px solid #333",
            borderRadius: 8,
            color: "#ccc",
            padding: 10,
            fontSize: 12,
            lineHeight: 1.6,
            resize: "vertical",
          }}
        />
      </aside>
    </div>
  );
}
