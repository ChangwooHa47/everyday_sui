// 3-tier 모델 톤 비교 — 크랙 방식(모델=등급) 검증용
// 같은 캐릭터·같은 대화를 GPT-4.1-mini / Claude Haiku / Claude Sonnet에 돌려 톤+원가 비교.
// 실행: npx tsx scripts/tone-compare.ts
//   OPENAI_API_KEY, ANTHROPIC_API_KEY 둘 다 .env.local에 있어야 함 (없는 모델은 건너뜀)

import { readFileSync } from "node:fs";
import { join } from "node:path";
try {
  for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import {
  buildSystemText,
  SPEECH_STYLES,
  type CharacterProfile,
} from "../lib/character";

const openai = process.env.OPENAI_API_KEY ? new OpenAI() : null;
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

// 단가표 ($/1M): [input, output]
const PRICE: Record<string, [number, number]> = {
  "gpt-4.1-mini": [0.4, 1.6],
  "claude-haiku-4-5": [1.0, 5.0],
  "claude-sonnet-4-6": [3.0, 15.0],
};

const speech = SPEECH_STYLES.find((s) => s.label === "반말")!;
const profile: CharacterProfile = {
  name: "도윤",
  relationship: "썸",
  age: 25,
  appearance: "여우상 얼굴, 매력적인 인상",
  personality: "츤데레, 장난끼 있는",
  speechStyle: `반말. 예시 톤: "${speech.preview}"`,
  speechExamples: speech.fewshot,
  background: "성별 남성. 사용자와의 관계: 썸",
};

const TURNS = [
  "뭐해",
  "나 오늘 회사에서 부장님한테 혼났어 ㅠ",
  "몰라 그냥 다 짜증나",
  "너는 오늘 뭐했는데?",
];

type Msg = { role: "user" | "assistant"; content: string };

async function runOpenAI(model: string) {
  const msgs: Msg[] = [];
  const out: { text: string; inTok: number; outTok: number }[] = [];
  for (const t of TURNS) {
    msgs.push({ role: "user", content: t });
    const res = await openai!.chat.completions.create({
      model,
      max_completion_tokens: 300,
      messages: [
        { role: "system", content: buildSystemText(profile, "", { userNickname: "은우야" }) },
        ...msgs,
      ],
    });
    const text = res.choices[0]?.message?.content ?? "";
    msgs.push({ role: "assistant", content: text });
    out.push({
      text,
      inTok: res.usage?.prompt_tokens ?? 0,
      outTok: res.usage?.completion_tokens ?? 0,
    });
  }
  return out;
}

async function runClaude(model: string) {
  const msgs: Msg[] = [];
  const out: { text: string; inTok: number; outTok: number }[] = [];
  const system = buildSystemText(profile, "", { userNickname: "은우야" });
  for (const t of TURNS) {
    msgs.push({ role: "user", content: t });
    const res = await anthropic!.messages.create({
      model,
      max_tokens: 300,
      thinking: { type: "disabled" }, // 롤플레이 채팅은 사고과정 불필요 → 속도·비용
      system,
      messages: msgs,
    });
    const text = res.content.find((b) => b.type === "text")?.text ?? "";
    msgs.push({ role: "assistant", content: text });
    out.push({
      text,
      inTok: res.usage.input_tokens,
      outTok: res.usage.output_tokens,
    });
  }
  return out;
}

async function main() {
  const jobs: { model: string; runner: () => Promise<any> }[] = [];
  if (openai) jobs.push({ model: "gpt-4.1-mini", runner: () => runOpenAI("gpt-4.1-mini") });
  if (anthropic) {
    jobs.push({ model: "claude-haiku-4-5", runner: () => runClaude("claude-haiku-4-5") });
    jobs.push({ model: "claude-sonnet-4-6", runner: () => runClaude("claude-sonnet-4-6") });
  }
  if (jobs.length === 0) {
    console.log("키 없음 — .env.local에 OPENAI_API_KEY / ANTHROPIC_API_KEY 필요");
    return;
  }

  const results = await Promise.all(
    jobs.map(async (j) => {
      try {
        return { model: j.model, out: await j.runner(), err: null as string | null };
      } catch (e) {
        return { model: j.model, out: null, err: String(e).slice(0, 80) };
      }
    }),
  );

  for (let i = 0; i < TURNS.length; i++) {
    console.log(`\n\x1b[1m유저: ${TURNS[i]}\x1b[0m`);
    for (const r of results) {
      if (r.err) continue;
      console.log(`  [${r.model.padEnd(18)}] ${r.out![i].text.replace(/\n/g, " / ")}`);
    }
  }

  console.log(`\n━━━ 원가 (4턴 대화 1회) ━━━`);
  for (const r of results) {
    if (r.err) {
      console.log(`${r.model.padEnd(18)}: ⚠️  ${r.err}`);
      continue;
    }
    const p = PRICE[r.model];
    const inTok = r.out!.reduce((s: number, x: { inTok: number }) => s + x.inTok, 0);
    const outTok = r.out!.reduce((s: number, x: { outTok: number }) => s + x.outTok, 0);
    const cost = (inTok * p[0] + outTok * p[1]) / 1_000_000;
    const perTurn = cost / TURNS.length;
    const proMonthly = perTurn * 150 * 30; // Pro 150턴/일 헤비유저
    console.log(
      `${r.model.padEnd(18)}: 턴당 $${perTurn.toFixed(6)} · Pro헤비 월 ₩${Math.round(proMonthly * 1400).toLocaleString()}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
