// 기존 캐릭터 재정리 — 이미 만들어진 캐릭터의 정체성은 유지하고,
// 말투 예시(speechExamples)·말버릇(quirks)만 현재 프롬프트로 깨끗하게 다시 뽑는다.
// (옛 캐릭터에 박힌 "ㅋ 남발" 같은 걸 제거하는 용도)

import OpenAI from "openai";

const client = new OpenAI();
const MODEL = process.env.PROMPT_MODEL ?? "gpt-4.1";

interface RecompileRequest {
  name: string;
  relationship: string;
  age: number;
  gender: string;
  coreTrait?: string;
  personality: string;
  speechStyle: string;
  background: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    coreTrait: { type: "string", description: "이 캐릭터의 가장 두드러진 특징 한 문장" },
    personality: { type: "string", description: "성격 2~3문장. 기존 성격을 유지하되 뾰족하게 다듬기" },
    speechStyle: { type: "string", description: "말투 규칙 2~3문장" },
    quirks: {
      type: "array",
      items: { type: "string" },
      description: "말버릇·습관 2~3개. '말끝마다 ㅋ' 같은 건 절대 금지",
    },
    speechExamples: {
      type: "array",
      items: { type: "string" },
      description:
        '말투 예시 5개. 형식: (사용자: ...) → "캐릭터 대사". 진짜 카톡체, 그 캐릭터 톤. "ㅋ"를 문장 끝마다 붙이지 말 것',
    },
    greeting: { type: "string", description: "다시 만난 첫 인사 1~2문장 (이 캐릭터 말투로)" },
  },
  required: [
    "coreTrait",
    "personality",
    "speechStyle",
    "quirks",
    "speechExamples",
    "greeting",
  ],
  additionalProperties: false,
} as const;

export async function POST(req: Request) {
  const p: RecompileRequest = await req.json();

  const response = await client.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 900,
    response_format: {
      type: "json_schema",
      json_schema: { name: "recompiled", strict: true, schema: SCHEMA },
    },
    messages: [
      {
        role: "system",
        content: `연애 시뮬레이션 캐릭터 설정 작가입니다. 이미 존재하는 캐릭터의 말투·말버릇을 자연스럽게 다시 다듬습니다.

규칙:
- 기존 캐릭터의 정체성(성격·관계·분위기)은 유지하세요. 완전히 다른 사람으로 바꾸지 마세요.
- 상담사·어시스턴트 말투 금지. 진짜 카톡체 (조사 생략, 말줄임, 추임새).
- **"ㅋ"/"ㅋㅋ"는 웃음이지 문장 끝 습관이 아닙니다. 문장마다 끝에 ㅋ 붙이는 건 절대 금지 (건방져 보임).** 대부분 캐릭터는 ㅋ 거의 안 쓰는 게 자연스럽고, 발랄·장난 성격만 가끔.
- quirks에 "말끝마다 ㅋ" 류 금지.
- 길이는 성격대로 — 무뚝뚝·시크는 짧게 툭, 수다·애교는 조금 길게.
- 성적으로 노골적인 내용 금지.`,
      },
      {
        role: "user",
        content: `이름: ${p.name} / 나이: ${p.age} / 성별: ${p.gender} / 관계: ${p.relationship}
${p.coreTrait ? `코어: ${p.coreTrait}` : ""}
성격: ${p.personality}
말투: ${p.speechStyle}
배경: ${p.background}

이 캐릭터의 coreTrait·성격·말투·말버릇·말투예시·첫인사를 자연스럽게 다시 정리해주세요.`,
      },
    ],
  });

  const json = response.choices[0]?.message?.content ?? "{}";
  return Response.json(JSON.parse(json));
}
