// FS-03 대화 API — OpenAI / Claude 듀얼 프로바이더
// CHAT_MODEL이 "claude-"로 시작하면 Anthropic, 아니면 OpenAI. 둘 다 스트리밍 + usage 로그.

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { buildSystemText, type CharacterProfile } from "@/lib/character";
import { costUsd, type Usage } from "@/lib/pricing";

const MODEL = process.env.CHAT_MODEL ?? "gpt-4o-mini";
const IS_CLAUDE = MODEL.startsWith("claude-");

const openai = IS_CLAUDE ? null : new OpenAI();
const anthropic = IS_CLAUDE ? new Anthropic() : null; // ANTHROPIC_API_KEY from env

interface ChatRequest {
  profile: CharacterProfile;
  memory: string; // 요약된 기억 (markdown bullets)
  messages: { role: "user" | "assistant"; content: string }[];
  userNickname?: string; // 캐릭터가 유저를 부르는 호칭 (chat-pop에서 입력)
  scenario?: string; // FS-04 에피소드 시나리오 컨텍스트
}

export async function POST(req: Request) {
  const { profile, memory, messages, userNickname, scenario }: ChatRequest =
    await req.json();

  const system = buildSystemText(profile, memory, { userNickname, scenario });

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const push = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        if (IS_CLAUDE) {
          // ── Claude ──
          const stream = anthropic!.messages.stream({
            model: MODEL,
            max_tokens: 1024,
            system, // Claude는 system을 별도 파라미터로
            messages,
          });
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              push({ type: "text", text: event.delta.text });
            }
          }
          const final = await stream.finalMessage();
          const usage: Usage = {
            input_tokens: final.usage.input_tokens,
            output_tokens: final.usage.output_tokens,
            cache_creation_input_tokens:
              final.usage.cache_creation_input_tokens ?? 0,
            cache_read_input_tokens: final.usage.cache_read_input_tokens ?? 0,
          };
          push({
            type: "usage",
            model: MODEL,
            usage,
            costUsd: costUsd(MODEL, usage),
            stopReason: final.stop_reason,
          });
        } else {
          // ── OpenAI ──
          const stream = await openai!.chat.completions.create({
            model: MODEL,
            stream: true,
            stream_options: { include_usage: true },
            max_completion_tokens: 1024,
            messages: [{ role: "system", content: system }, ...messages],
          });
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) push({ type: "text", text: delta });
            if (chunk.usage) {
              const cached =
                chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
              const usage: Usage = {
                input_tokens: chunk.usage.prompt_tokens - cached,
                output_tokens: chunk.usage.completion_tokens,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: cached,
              };
              push({
                type: "usage",
                model: MODEL,
                usage,
                costUsd: costUsd(MODEL, usage),
                stopReason: chunk.choices[0]?.finish_reason ?? null,
              });
            }
          }
        }
      } catch (err) {
        push({ type: "error", message: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
