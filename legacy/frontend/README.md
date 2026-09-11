# 미연시 LLM 프로토타입 (FS-02→03 검증용)

프로필(.md) 주입 + 프롬프트 캐싱 + 스트리밍 + **원가 변수 ①② 측정**을 한 번에 확인하는 최소 구현.
팀 레포 아님 — 검증 끝나면 로직만 수현 레포로 이식.

## 셋업

```bash
npm install
cp .env.local.example .env.local   # API 키 입력
npm run dev                         # → localhost:3000
```

⚠️ **API 키는 openai키 발급.** 

## 뭐가 들어있나

| 파일 | 역할 | 명세서 매핑 |
|---|---|---|
| `lib/character.ts` | 프로필 → system 프롬프트(.md) 조립 | FS-01→02 "프로필 주입 구조" |
| `app/api/chat/route.ts` | 스트리밍 대화 + usage 반환 | FS-03 대화 |
| `app/api/summarize/route.ts` | 오래된 턴 → 기억으로 압축 (Haiku) | FS-03 "메모리 누적·요약" |
| `app/page.tsx` | 테스트 UI + 턴별 원가 계측 패널 | — |
| `scripts/measure-cost.ts` | 10턴 자동 대화 → 등급별 월 원가 추정 | 선행과제 "원가 변수 산출" |

## 원가 측정 (수현 전달용)

```bash
npm run measure
```

출력: 턴별 usage 테이블 + ① 모델 단가 ② 평균 입력 토큰 + Free/Plus/Pro 헤비유저 월 원가.
③ Higgsfield 사진 원가는 별도 (get_cost로 측정).

## 설계 메모

- **모델**: `claude-sonnet-4-6` (명세서 확정 "중급 LLM"). `.env.local`의 `CHAT_MODEL`로 교체 가능. 요약은 `claude-haiku-4-5`.
- **캐싱**: 베이스 룰+프로필 블록에 `cache_control` → 2턴째부터 c-read(초록)가 떠야 정상.
  - Sonnet 4.6 최소 캐시 prefix는 **2048 토큰**. 지금 베이스 룰+프로필이 그보다 짧으면 캐시가 조용히 안 걸림 (c-write/c-read 둘 다 0). 실서비스에선 가드레일·시나리오 규칙이 붙어서 자연히 넘음.
- **메모리 구조**: `raw 최근 8턴 + 요약된 기억(markdown)` 2단. 요약 트리거는 16턴. 이 두 숫자가 원가 변수 ②를 결정하는 튜닝 노브.
- **가드레일**: 베이스 룰에 1차 수위 정책 포함 (로맨스 O / 노골적 성적 묘사 X). 최종 수위는 팀 결정 대기 (명세서 "결정 대기 > 서비스 정책").
- **max_tokens 1024**: 메신저 대사라 짧게. `stopReason: "max_tokens"` 뜨면 잘린 것.
