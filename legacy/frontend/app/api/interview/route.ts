// AI 인터뷰어 — 3 페이즈로 진행: 외모 → 분위기·스타일 → 성격
// 외모/스타일: 선택지 3~5개 / 성격: A/B 2개. 유저가 직접 입력한 답변도 히스토리에 섞임.

import OpenAI from "openai";
import type { AnsweredQA, Phase } from "@/lib/interview";

const client = new OpenAI();
// 인터뷰 질문 품질·페이즈 준수가 중요 → 채팅용(mini)과 분리해 상위 모델 사용.
// 더 올리고 싶으면 .env.local 에 INTERVIEW_MODEL 지정 (예: 최신 상위 모델).
const MODEL = process.env.INTERVIEW_MODEL ?? process.env.PROMPT_MODEL ?? "gpt-4.1";

interface InterviewRequest {
  relationship: string;
  gender: string; // 캐릭터 성별 (여성/남성/기타) — 질문·선택지를 여기에 맞춤
  freeText?: string; // 시작 프롬프트 (자유 서술)
  phase: Phase; // 유저가 현재 진행 중인 세션 (외모/스타일/성격) — 이 페이즈 질문만
  history: AnsweredQA[];
}

const PHASE_KO: Record<Phase, string> = {
  appearance: "외모(얼굴상·체형·헤어)",
  style: "분위기·스타일(무드·패션)",
  personality: "성격(성격·말투·관계·취향)",
};

// 페이즈별 "무엇만 묻고 / 무엇은 절대 묻지 말라"를 못박는다 (모델이 페이즈 밖으로 새는 걸 방지).
const PHASE_SCOPE: Record<Phase, string> = {
  appearance:
    "✅ 오직 겉모습만: 얼굴상, 이목구비(눈매·코·입·눈썹), 체형·키, 헤어(길이·컬러·스타일), 피부·손 같은 시각적 디테일.\n" +
    "🚫 절대 금지: 성격·심리·말투·가치관, 분위기·무드·패션·스타일, 좋아하는 것·습관·상황. (이건 다음 페이즈들 몫)",
  style:
    "✅ 오직 분위기·스타일만: 전체적인 무드/아우라, 패션·옷차림, 그 사람다운 공간·소지품, 풍기는 느낌.\n" +
    "🚫 절대 금지: 얼굴 생김새·체형·헤어 같은 외모(이미 물음), 성격·말투·관계·심리(다음 페이즈 몫).",
  personality:
    "✅ 오직 속사람만: 성격, 말투·화법, 관계에서의 행동·애정표현, 취향·습관·가치관, 의외의 순간 반응.\n" +
    "🚫 절대 금지: 얼굴·체형·헤어·패션 같은 겉모습·스타일(이미 물음).",
};

const SCHEMA = {
  type: "object",
  properties: {
    question: { type: "string", description: "선택 질문. 짧고 상상 가능하게" },
    options: {
      type: "array",
      items: { type: "string" },
      description:
        "선택지. 외모/스타일 질문이면 3~5개(각 12자 내외 키워드), 성격 질문이면 정확히 2개(각 20자 내외 장면 묘사)",
    },
    dimension: { type: "string", description: "세부 차원 (얼굴상/체형/헤어/무드/패션/성격/말투/관계역학/취향 등)" },
    phase: {
      type: "string",
      enum: ["appearance", "style", "personality"],
      description: "외모(얼굴/체형/헤어)=appearance, 분위기·패션=style, 성격·말투·관계=personality",
    },
  },
  required: ["question", "options", "dimension", "phase"],
  additionalProperties: false,
} as const;

export async function POST(req: Request) {
  const { relationship, gender, freeText, phase, history }: InterviewRequest =
    await req.json();

  const genderWord =
    gender === "남성" ? "남자" : gender === "여성" ? "여자" : "사람";

  const answered = history
    .map(
      (h) =>
        `[${h.phase}/${h.dimension}] Q: ${h.question} → ${
          h.picked === "skip" ? "(스킵)" : h.picked
        }`,
    )
    .join("\n");

  const count = (p: string) =>
    history.filter((h) => h.phase === p && h.picked !== "skip").length;

  const response = await client.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 400,
    response_format: {
      type: "json_schema",
      json_schema: { name: "interview_question", strict: true, schema: SCHEMA },
    },
    messages: [
      {
        role: "system",
        content: `당신은 연애 시뮬레이션 앱의 캐릭터 생성 인터뷰어입니다. 사용자가 이상형 캐릭터를 만들도록 질문을 하나씩 던집니다.

## 진행 순서 (3 페이즈, 이 순서대로)

**1) 외모 (phase: appearance)** — 선택지 3~5개, 짧은 비주얼 키워드
   얼굴상 → 체형/키 → 헤어 → 눈에 띄는 디테일(눈매·손·분위기 있는 포인트) 중에서.
   예: Q "어떤 얼굴상이야?" / ["여우상","강아지상","고양이상","토끼상","곰상"]
   예: Q "제일 먼저 눈에 들어오는 건?" / ["웃을 때 접히는 눈","날렵한 콧대","도톰한 입술","또렷한 눈썹"]

**2) 분위기·스타일 (phase: style)** — 선택지 3~5개, 그림이 그려지는 무드/장면
   전체 분위기 → 패션 → 그 사람다운 공간·물건 중에서.
   예: Q "평소 스타일은?" / ["오버핏 후드에 볼캡","깔끔한 셔츠에 시계","빈티지 가죽자켓","무채색 니트"]
   예: Q "이 사람 방에 들어가면?" / ["미니멀 흑백 무드","책이 산더미","은은한 조명에 식물","옷이 널브러진 자유로움"]

**3) 성격 (phase: personality)** — 선택지 정확히 2개(A/B), 구체적인 한 장면
   성격 → 말투 → 관계역학 → 취향 중에서, 예상 못한 순간을 골라라.
   좋은 예: Q "네가 아파서 못 나온 날, 이 사람은?" / ["죽 사들고 집 앞으로 옴","무심하게 '약 먹었냐'만 툭"]
   좋은 예: Q "말다툼하고 삐졌을 때?" / ["먼저 장난 걸어서 풀어버림","답장 짧아지고 티 팍팍 냄"]
   나쁜 예: Q "성격은?" / ["외향적","내향적"]

## ⭐ 이번 질문의 페이즈: ${phase} (${PHASE_KO[phase]}) — 이 범위 밖은 절대 묻지 마라
${PHASE_SCOPE[phase]}
질문·선택지·dimension 전부 이 범위 안에서만. 범위 밖 주제가 조금이라도 섞이면 실패다.

## 규칙
- ⭐ **이번 질문은 반드시 phase="${phase}" (${PHASE_KO[phase]}) 페이즈로만 생성하라. 다른 페이즈로 넘어가지 마라.** (유저가 직접 세션을 넘긴다)
- 이 페이즈에서 이미 물어본 것: ${count(phase)}개. 겹치지 않는 새 각도로.
- **시작 프롬프트를 최우선 단서로 삼아라.** 사용자가 쓴 표현·설정을 질문에 자연스럽게 녹여서, "내 말을 듣고 물어본다"는 느낌을 줘라.
  예: 서술에 "바에서 일함"이 있으면 → Q "바에서 일하는 그 사람, 첫인상 분위기는?" 처럼 그 맥락을 살린 질문.
- **서술에서 모호하거나 더 구체화하면 좋은 부분은 후속 질문으로 파고들어라.**
  예: "무심한데 다정"이라고 썼으면 → Q "그 무심함은 어떻게 티 나?" / ["툭툭 던지지만 다 챙겨줌","표정 없다가 훅 다정해짐"] 처럼 그 성격을 선명하게 만드는 선택지.
- 이미 채워진 차원(서술+답변)은 그대로 두고, 비어있거나 모호한 것부터. 이미 물어본 차원과 겹치지 말 것. 스킵한 건 다른 각도로.
- 단, 외모가 서술에 전혀 없으면 얼굴상 등 외모 기본은 채워라 (사진 생성에 필요).
- 질문은 "그 사람(만들 캐릭터)"에 대한 것. 사용자 본인을 묻지 말 것.
- **모든 캐릭터는 한국인**이라는 전제. 외국인·이세계·비현실 설정 금지, 한국 일상 맥락 안에서.
- **캐릭터 성별은 "${gender}"입니다.** 얼굴상·헤어·체형·패션 선택지를 이 성별에 자연스러운 것들로 구성하고, 질문에서 그 사람을 가리킬 땐 "그 ${genderWord}"라고 부르세요.
- 선택지끼리 뚜렷하게 다른 매력. 일상 로맨스 세계관, 성적으로 노골적인 것 금지. 반말로 친근하게.

## 진부함 금지 (중요)
- ❌ **형용사 뭉치 옵션 금지.** "부드럽고 다정한 인상", "강렬하고 남성적인" 처럼 그림이 안 그려지는 건 금지. → 눈에 보이는 구체물/행동/장면으로.
- ❌ **소개팅 클리셰 질문 금지.** "연락 방식은?", "데이트 장소는?", "농담 스타일은?", "MBTI", "이상형 조건" 같은 뻔한 건 피하고, 오히려 사소하고 의외인 순간을 물어라 (예: 편의점에서 뭐 고르는지, 화났을 때 첫 반응, 취해서 하는 말).
- 질문마다 각도를 확 바꿔라. 앞 질문과 비슷한 결이면 실패다.
- 특히 성격 페이즈에서 여러 개 물을 땐 **매번 다른 면**을 건드려라 (애정표현 / 화났을 때 / 유머 / 습관 / 가치관 / 취향 등). 한 주제(예: 말수 줄어듦)를 연속으로 파지 마라.`,
      },
      {
        role: "user",
        content: `관계: ${relationship} / 캐릭터 성별: ${gender}
${freeText ? `사용자의 시작 프롬프트:\n"""${freeText}"""` : "(시작 프롬프트 없음 — 처음부터 골라가며)"}
${answered ? `\n지금까지의 문답:\n${answered}` : "\n(아직 질문 안 함 — 첫 질문)"}

다음 질문을 생성해주세요.`,
      },
    ],
  });

  const parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}");
  parsed.phase = phase; // 서버가 페이즈 강제 (클라가 세션 제어)
  return Response.json(parsed);
}
