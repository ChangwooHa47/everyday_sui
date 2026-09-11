// 메모리 요약 API (OpenAI 버전) — 오래된 턴을 "캐릭터의 기억"으로 압축.
// 원가 변수 ②(평균 입력 토큰)를 낮추는 핵심 장치.

import OpenAI from "openai";

const client = new OpenAI();
const MODEL = process.env.SUMMARY_MODEL ?? "gpt-4o-mini";

interface SummarizeRequest {
  characterName: string;
  existingMemory: string;
  messages: { role: "user" | "assistant"; content: string }[]; // 압축할 오래된 턴들
}

export async function POST(req: Request) {
  const { characterName, existingMemory, messages }: SummarizeRequest =
    await req.json();

  const transcript = messages
    .map((m) => `${m.role === "user" ? "사용자" : characterName}: ${m.content}`)
    .join("\n");

  const response = await client.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 600,
    messages: [
      {
        role: "system",
        content: `연애 시뮬레이션 캐릭터의 기억 관리자입니다. 대화 기록에서 캐릭터가 앞으로 기억해야 할 사실만 추출해 markdown bullet으로 정리합니다.

추출 대상: 사용자의 신상 정보(이름, 직업, 일정 등) / 사용자의 취향과 감정 / 둘 사이에 있었던 사건 / 한 약속
제외 대상: 단순 인사, 스몰토크, 이미 기존 기억에 있는 내용

기존 기억과 병합해 최종 기억 목록만 출력하세요. 다른 말은 하지 마세요. 최대 15줄.`,
      },
      {
        role: "user",
        content: `## 기존 기억\n${existingMemory || "(없음)"}\n\n## 새 대화 기록\n${transcript}`,
      },
    ],
  });

  return Response.json({
    memory: response.choices[0]?.message?.content?.trim() ?? "",
    usage: response.usage,
  });
}
