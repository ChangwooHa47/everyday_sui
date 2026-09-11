// 프로필 컴파일러 — 자유 서술 + A/B 문답 전체를 CharacterProfile로 조립.
// 캐릭터 전용 말투 few-shot과 첫 인사까지 여기서 같이 생성 (말투 품질의 핵심).

import OpenAI from "openai";
import type { AnsweredQA } from "@/lib/interview";

const client = new OpenAI();
// 컴파일은 캐릭터당 1회 → 상위 모델로. 외모 프롬프트·성격 묘사 품질 차이가 큼.
const MODEL = process.env.PROMPT_MODEL ?? "gpt-4.1";

interface CompileRequest {
  relationship: string;
  freeText?: string;
  history: AnsweredQA[];
  name: string;
  gender: string;
  age: number;
}

const SCHEMA = {
  type: "object",
  properties: {
    emoji: {
      type: "string",
      description: "캐릭터 분위기에 맞는 동물/사물 이모지 1개 (아바타 placeholder)",
    },
    appearance: { type: "string", description: "외모 묘사 2~3문장 (이미지 생성 프롬프트로도 쓸 수 있게 구체적으로)" },
    appearancePrompt: {
      type: "string",
      description:
        "영어 이미지 생성 프롬프트. 매 생성마다 재사용될 고정 외모 블록. 아래 규칙을 반드시 지킬 것:\n" +
        "1) 한 문장, 쉼표로 구분, 6~8개 구절 이내로 짧게. (길수록 얼굴이 흐려짐)\n" +
        "2) 무조건 'good-looking' 또는 'attractive'로 시작. 호감형 외모로.\n" +
        "3) 순서: [attractive] Korean [man/woman] in [나이대] → 얼굴상/인상 → 헤어 → 눈매 → 옷차림 → 표정.\n" +
        "4) 형용사 과하게 쌓지 말 것. 각 구절당 핵심 1개. 추상어(mysterious aura 등) 금지, 시각적으로 그릴 수 있는 것만.\n" +
        "예: 'Attractive Korean man in his mid-20s, soft fox-like features, tousled black hair, warm monolid eyes, beige knit sweater, gentle smile'",
    },
    coreTrait: {
      type: "string",
      description:
        "이 캐릭터의 가장 두드러진 특징을 한 문장으로 (모든 대사에 드러날 핵심 캐릭터성). 예: '무심한 척하지만 사용자 앞에서만 서툴게 무너지는 츤데레'",
    },
    personality: { type: "string", description: "성격 2~3문장. 매력과 결점을 같이. 특징은 뾰족하게 (밋밋한 '착하고 다정' 금지)" },
    speechStyle: { type: "string", description: "말투 규칙 2~3문장 (존댓말/반말, 습관어, 이모지 사용 여부)" },
    quirks: {
      type: "array",
      items: { type: "string" },
      description:
        "이 캐릭터만의 말버릇·습관 2~3개. 자주 쓰는 표현/호칭 습관/특정 상황 반응 등, 캐릭터를 도드라지게 하는 것. 예: '말끝마다 -네 붙임', '삐지면 ㅋ 하나만 보냄', '좋으면 이름 대신 야! 라고 부름'",
    },
    background: {
      type: "string",
      description: "배경 서사 3~4문장: 직업/일상, 사용자와 어떻게 만났는지, 요즘 근황",
    },
    speechExamples: {
      type: "array",
      items: { type: "string" },
      description:
        '이 캐릭터 전용 말투 예시 5개. 형식: (사용자: ...) → "캐릭터 대사". 실제 카톡처럼 짧고 자연스럽게. AI 티 나는 상투어 금지',
    },
    greeting: {
      type: "string",
      description: "생성 직후 캐릭터가 보내는 첫 메시지 1~2문장 (이 캐릭터 말투로)",
    },
  },
  required: [
    "emoji",
    "appearance",
    "appearancePrompt",
    "coreTrait",
    "personality",
    "speechStyle",
    "quirks",
    "background",
    "speechExamples",
    "greeting",
  ],
  additionalProperties: false,
} as const;

export async function POST(req: Request) {
  const { relationship, freeText, history, name, gender, age }: CompileRequest =
    await req.json();

  const kept = history.filter((h) => h.picked !== "skip");
  const fmt = (phase: string) =>
    kept
      .filter((h) => h.phase === phase)
      .map((h) => `- ${h.dimension}: ${h.picked}`)
      .join("\n") || "(없음)";

  // 페이즈별로 분리 — 외모/분위기만 appearancePrompt에, 성격은 성격 필드에만 반영
  const appearanceAns = fmt("appearance");
  const styleAns = fmt("style");
  const personalityAns = fmt("personality");

  const response = await client.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 1200,
    response_format: {
      type: "json_schema",
      json_schema: { name: "character_profile", strict: true, schema: SCHEMA },
    },
    messages: [
      {
        role: "system",
        content: `연애 시뮬레이션 캐릭터 설정 작가입니다. 사용자의 서술과 A/B 선택 결과를 하나의 살아있는 캐릭터 프로필로 조립합니다.

규칙:
- 사용자가 명시한 정보는 절대 바꾸지 않고 반영.
- 비어있는 차원은 이미 정해진 정보와 어울리게 자연스럽게 창작 (일상 로맨스 톤, 한국 배경).
- **캐릭터성을 뾰족하게.** 무난한 '착하고 다정한 사람' 금지. coreTrait·personality·quirks가 서로 맞물려 한 사람의 뚜렷한 개성이 되게. 결점·모난 구석을 반드시 하나 넣을 것.
- quirks(말버릇)와 speechExamples는 coreTrait을 그대로 반영해야 함 (츤데레 코어면 예시도 츤데레답게, 집착형이면 예시도 매달리게).
- speechExamples가 가장 중요: 상담사·어시스턴트 말투 금지. 조사 생략, 말줄임, 추임새가 살아있는 진짜 카톡 대사로. **그 캐릭터만의 톤이 확 느껴지게.** 길이도 성격대로 — 무뚝뚝·시크는 짧게 툭, 수다·애교는 조금 길게. (대부분은 짧은 게 자연스러움)
- ⚠️ "ㅋ"/"ㅋㅋ"를 문장 끝마다 붙이지 마세요 (건방져 보임). 웃음일 때만, 발랄·장난 성격에만 가끔. quirks에도 "말끝마다 ㅋ" 같은 건 넣지 마세요.
- **모든 캐릭터는 한국인입니다.** background·appearance는 한국 배경/한국인으로, appearancePrompt는 반드시 "Korean man/woman"으로 시작.
- **appearance와 appearancePrompt는 [외모]와 [분위기·스타일] 정보만 반영합니다. [성격] 답변은 절대 외모 묘사에 넣지 마세요** (성격은 personality/speechStyle/background에만).
- 성적으로 노골적인 내용 금지.`,
      },
      {
        role: "user",
        content: `이름: ${name} / 나이: ${age} / 성별: ${gender} / 사용자와의 관계: ${relationship}
${freeText ? `\n사용자의 자유 서술:\n"""${freeText}"""` : ""}

[외모] (→ appearance, appearancePrompt에만 반영)
${appearanceAns}

[분위기·스타일] (→ appearance, appearancePrompt에만 반영)
${styleAns}

[성격] (→ personality, speechStyle, background에만 반영)
${personalityAns}

프로필을 완성해주세요.`,
      },
    ],
  });

  const json = response.choices[0]?.message?.content ?? "{}";
  return Response.json(JSON.parse(json));
}
