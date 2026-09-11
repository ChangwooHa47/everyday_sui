// 원가 변수 ①② 자동 측정 스크립트 (OpenAI 버전)
// 스크립트된 10턴 대화를 실제로 돌리고 턴별 usage → 등급별 월 원가 추정까지 출력.
// 실행: npm run measure

import { readFileSync } from "node:fs";
import { join } from "node:path";

// .env.local 수동 로드 (tsx는 자동 로드 안 함)
try {
  for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

import OpenAI from "openai";
import { buildSystemText, PRESETS } from "../lib/character";
import { costUsd, PRICES, type Usage } from "../lib/pricing";

const MODEL = process.env.CHAT_MODEL ?? "gpt-4o-mini";
const client = new OpenAI();

// 실제 유저 패턴을 흉내낸 스크립트 대사 (짧은 카톡체)
const USER_LINES = [
  "자기야 뭐해",
  "나 오늘 회사에서 완전 털렸어 ㅠㅠ",
  "부장님이 내 기획안 다 엎으래... 담주까지 다시 하래",
  "몰라 그냥 다 때려치고 싶다",
  "ㅋㅋㅋ 뭐야 그게. 근데 좀 웃겼어",
  "저녁 뭐 먹지? 추천해줘",
  "오 좋아. 자기는 밥 먹었어?",
  "아 맞다 나 담주 금요일에 연차 냈다?",
  "같이 어디 놀러갈까? 어디 가고 싶어?",
  "좋다ㅋㅋ 그럼 그날 보는 거다? 약속!",
];

async function main() {
  const profile = PRESETS[0];
  const memory = "";
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  const usages: Usage[] = [];

  console.log(`\n모델: ${MODEL} | 캐릭터: ${profile.name}\n`);
  console.log("턴 | input | c-read | output |     $/턴 | 응답 미리보기");
  console.log("---+-------+--------+--------+----------+---------------");

  for (let i = 0; i < USER_LINES.length; i++) {
    messages.push({ role: "user", content: USER_LINES[i] });
    const res = await client.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 1024,
      messages: [
        { role: "system", content: buildSystemText(profile, memory) },
        ...messages,
      ],
    });
    const text = res.choices[0]?.message?.content ?? "";
    messages.push({ role: "assistant", content: text });

    const cached = res.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const u: Usage = {
      input_tokens: (res.usage?.prompt_tokens ?? 0) - cached,
      output_tokens: res.usage?.completion_tokens ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: cached,
    };
    usages.push(u);
    console.log(
      `${String(i + 1).padStart(2)} | ${String(u.input_tokens).padStart(5)} | ${String(
        u.cache_read_input_tokens,
      ).padStart(6)} | ${String(u.output_tokens).padStart(6)} | ${costUsd(MODEL, u).toFixed(6)} | ${text.slice(0, 24).replace(/\n/g, " ")}`,
    );
  }

  const totalCost = usages.reduce((s, u) => s + costUsd(MODEL, u), 0);
  const perTurn = totalCost / usages.length;
  const avgInput = Math.round(
    usages.reduce(
      (s, u) => s + u.input_tokens + u.cache_read_input_tokens,
      0,
    ) / usages.length,
  );
  const avgOutput = Math.round(
    usages.reduce((s, u) => s + u.output_tokens, 0) / usages.length,
  );

  const p = PRICES[MODEL];
  console.log(`\n━━━ 측정 결과 (원가 변수 ①②) ━━━`);
  console.log(`① 모델/단가     : ${MODEL} ($${p?.input}/$${p?.output} per 1M, cached $${p?.cachedInput})`);
  console.log(`② 평균 입력 토큰: ${avgInput.toLocaleString()} tok/턴 (출력 ${avgOutput} tok/턴)`);
  console.log(`   턴당 원가     : $${perTurn.toFixed(6)}`);

  console.log(`\n━━━ 등급별 월 원가 추정 (매일 쿼터 꽉 채운 헤비유저 기준) ━━━`);
  for (const [tier, daily] of [
    ["Free (10턴/일)", 10],
    ["Plus (50턴/일)", 50],
    ["Pro (150턴/일)", 150],
  ] as const) {
    const monthly = perTurn * daily * 30;
    console.log(
      `${tier.padEnd(16)}: $${monthly.toFixed(3)}/월 (~₩${Math.round(monthly * 1400).toLocaleString()})`,
    );
  }
  console.log(
    `\n⚠️ 후반 턴일수록 히스토리가 길어져 턴당 원가가 커짐 (턴별 추이 참고).`,
  );
  console.log(
    `   메모리 요약(오래된 턴 압축)이 이 증가 곡선을 꺾는 장치.\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
