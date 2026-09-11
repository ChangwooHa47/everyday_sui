# 마켓 기반 검증·코드리뷰 — 2026-09-10

범위: 기존 npm 모노레포 위의 마켓 API, 체인 어댑터, 기억 참조,
market.move 정산/권한/선물 정책, 실행 설정. 자체 리뷰이며 별도 외부 보안 감사는 아니다.

## 확인 결과

- 전체 TypeScript typecheck 통과.
- `npm run check:backend` 통과: API 9개 테스트, Move 테스트.
- 최종 `npm run test:move` **20/20 통과** (기존 4개 + 마켓 16개).
- 기존 웹 단위 테스트 **4/4 통과**.
- `npm run build` 통과: 공통 타입, API, Next.js 16개 정적 페이지 생성.
- Move CI job 추가: 공식 testnet-v1.79.0 Linux 바이너리, 릴리스 SHA-256 검증, 캐시.
  GitHub Actions 자체는 아직 실행하지 않았다.

API 테스트는 PGlite와 체인 fixture를 사용한다. 실제 testnet 객체의 BCS 응답,
Postgres Compose, 새 마켓 브라우저 흐름, Walrus/Seal/MemWal 외부 호출을 검증한 결과는 아니다.

## 리뷰한 경계와 반영 사항

| 항목 | 결과 |
| --- | --- |
| 위조 이용권 | package 타입, 객체 ID, 실제 소유자, buyer, listing 모두 검증 |
| 부정 등록 | 카탈로그 등록자는 체인 creator만 가능 |
| 구매 처리 | 서버 가격으로 서명 전 PTB만 생성. 서버 성공 응답을 결제 완료로 기록하지 않음 |
| 금액 정밀도 | u64는 문자열 유지. Move 정산은 u128 중간값으로 곱셈 오버플로 방지 |
| 기억 분리 | owner를 body에서 받지 않고 인증 세션 사용. creator도 타인 기억 조회 불가 |
| 기억 최초 등록 | 리뷰 중 구매 권한 검증 추가. revision 비교로 동시 덮어쓰기 차단 |
| 판매 중지 | 기존 구매자 Seal 접근 유지, 신규 구매 차단 |
| 게시 후 변경 | 패키지 교체 거절. 실제 보관 갱신과 구분된 extend_retention만 추가 |
| 에이전트 자금 | 일반 지갑의 무제한 송금을 피하도록 Move 금고 구조 유지 |
| 선물 | operator, recipient 구매 여부, allowlist, 상품 활성, 건별/일별 한도, 잔액, intent 검증 |
| 비밀·프라이버시 | 신규 DB에는 원문 대화·키 없음. 카탈로그와 개인 참조를 join하지 않음 |

검토한 구현 범위에서 확인한 권한 누락은 수정했다. 위 테스트가 계약·서비스 전체의
무결함이나 실제 외부 연동을 보증하지는 않는다.

## 데모를 막는 남은 연결

1. 테스트넷 배포·실제 이용권 구매·Walrus/Seal Listing 패키지 암복호화.
2. 미리보기 N턴과 구매 검증을 붙인 서버 채팅. 기존 AI gateway는 마켓 접근 경로가 아니다.
3. MemWal SDK 공간 생성·암호화·delegate 권한 확인. 현재 memory API는 참조 등록뿐이다.
4. 세컨드 클라이언트에서 본인 기억 복원.
5. P1 캐릭터 실행키·선물 worker·LLM 제안과 onchain 영수증 UI.

추가 운영 조건: custom SUI_GRPC_URL은 운영자가 testnet으로 검증한 주소만 설정한다.
SDK의 network 옵션은 임의 endpoint가 testnet임을 증명하지 않는다.
Walrus 저장 증명/갱신 검증, UpgradeCap 관리, delegate 철회와 평문 처리 범위도 별도 점검 대상이다.

다음 실행 순서는 [피봇 문서](MARKET_PIVOT.md)에 있다. 이번 결과는
**백엔드·컨트랙트 기반 세팅 완료**이며 P0 전체 데모 완료로 표시하지 않는다.
