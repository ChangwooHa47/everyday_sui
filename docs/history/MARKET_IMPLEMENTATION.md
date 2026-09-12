# 마켓 구현·자체 코드리뷰 — 2026-09-10

> 과거 구현 기록이다. 당시 `/market`·`/viewer` 화면과 미배포·zkLogin 미구현 설명은 현재 상태가 아니다. 현재 기준은 [기획](../MARKET_PIVOT.md), [실행](../MARKET_RUNBOOK.md), [배포 리뷰](../../infra/DEPLOYMENT_REVIEW.md)다. 아래 결과를 오늘의 검증 결과로 인용하지 않는다.

## 구현

- 제작자 등록/초안/시험 대화 → Seal+Walrus 패키지 보관 → 지갑 게시 → 카탈로그.
- 구매 transaction 생성, 실제 License 검증, 서버 패키지 기반 유료 채팅과 N턴 미리보기.
- MemWal SDK 0.1.6, 사용자별 계정/위임 검증, 승인 기억 remember/job/recall.
- `/market` 및 `/viewer`, 두 Origin의 로그인과 동일 사용자 기억 연속성.
- LLM 선물 제안 → Move 금고 지출, 서명 거래 저장 후 전송, 불확실한 거래 복구.
- 서버 설정·Compose 전달·배포/연결 확인 스크립트. 실행은 MARKET_RUNBOOK.md 참고.

## 자체 리뷰에서 보완한 것

1. **스토리지 중복 지출:** 업로드 requestId·내용 해시와 암호문 참조를 기록하여 같은 요청은 재업로드하지 않는다.
2. **미리보기 유출:** full character/examples/episode/memory를 preview prompt에 넣지 않는다. client persona·system role을 거절한다.
3. **부정 이용권:** 기존 exact package/object/owner/buyer/listing 검증을 유료 채팅·설정 조회·기억 저장에도 적용한다.
4. **기억 혼합:** 지갑 세션으로 owner를 결정하고 계정 타입·owner·현재 delegate·동결을 확인한다.
   namespace는 market package+Listing에서 결정하며 사용자 입력을 받지 않는다.
5. **배포 불일치:** live relayer /config의 packageId/network를 확인한다. registry 객체 타입도 검사한다.
6. **이중 선물:** intent를 먼저 원자적으로 점유하고, 서명 bytes+digest를 저장한 뒤 전송한다.
   복구는 동일 bytes만 재사용한다. LLM은 허용 후보의 ID 또는 null만 반환할 수 있다.
7. **잘못된 완료 표시:** MemWal 접수/완료와 선물 unknown/confirmed를 구분한다.
8. **클라이언트 상태:** 지갑 변경 시 세션·개인 UI 상태를 초기화하고 async 응답을 폐기한다.
   설정 수정 시 이전 게시 transaction을 해제한다. 초안 패키지에 개인 기억 필드는 허용하지 않는다.

## 실제 외부 확인

- Sui testnet gRPC에서 Clock 조회 성공.
- MemWal staging health 200, 설치된 MemWal SDK health=ok.
- live relayer package와 GraphQL registry 발견, gRPC datatype으로 계정 BCS 필드 확인.
- 문서 예제의 배포 ID는 live relayer와 달랐으며 환경 예시에 관측값을 반영했다.
- 전용 테스트넷 지갑 생성. faucet HTTP 429로 funding 실패, Move publish 미실행.

health 성공은 서명 인증·기억 저장 성공을 뜻하지 않는다. 실제 AI 키·operator·Seal/Walrus 설정이 없으므로
실제 구매/암복호화/기억 왕복/선물 지급이 완료됐다고 표시하지 않는다.

## 최종 검증 결과

- `npm run check:backend`: API 14개 + Move 20개 통과, API/테스트 TypeScript 검사 통과.
- `npm run build`: 공통 타입·API·Next.js 빌드, 18개 정적 페이지 생성 성공.
- `npm run test:web3`: Edge 브라우저 2개 테스트 통과. 마켓/뷰어 진입과 기존 실제 서명 로그인·지갑 변경 검증.
- `npm run test:unit --workspace @everyday/web`: 4개 통과.
- 총 **40개 테스트 통과**. API provider/chain/memory 동작은 fixture를 사용하는 통합 검증이다.
- private demo key가 Git ignore 대상임을 확인했다. Docker/CI 원격 실행·실제 서비스별 인증 거래는 미검증이다.

## 제한

- 현재 operator 실행키는 공용이고 캐릭터별 금고로 자금을 분리한다. 캐릭터별 실행키 관리·가스 pool은 후속 작업이다.
- zkLogin은 아직 없다. 일반 지갑 서명으로 로그인한다.
- MemWal delegate는 계정 전체 접근 권한이다. namespace만으로 별도 보안 권한이 생기지 않는다.
- SDK에는 공통 abort 옵션이 없어 응답 대기 시간은 제한하되 진행 중 provider 요청이 취소됐다고 보장하지 않는다.
- 선물 영수증까지 연결했으며 포토부스 상품의 실제 사용/소진 처리는 아직 없다.
- 시드 10명·에피소드 편집 UI·이미지 생성 pipeline의 마켓 연결은 별도 작업이다. API 패키지는 examples/episodes를 지원한다.

공식 참고: [MemWal API](https://docs.wal.app/walrus-memory/sdk/api-reference.html),
[Seal SDK](https://sdk.mystenlabs.com/seal), [Sui 객체 조회](https://sdk.mystenlabs.com/sui/clients/querying).
