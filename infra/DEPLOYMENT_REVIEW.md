# 코드·명세 대조 및 검증 — 2026-09-12

사용자가 대화에 제공한 **everyday × Blockthon 2026 캐릭터 마켓 피봇 기획**을 기준으로 한다. 이전 문서의 Notion 접근 실패, 임시 personal_characters, testnet 미배포 기록은 현재 상태가 아니다. 프론트, Spring/DB, Node/Move를 별도 에이전트가 검토하고 담당 에이전트가 통합 검증한다. 외부 보안 감사는 아니다.

## 원본 재사용

- `apps/web/app/{globals.css,components.tsx,icons.tsx,layout.tsx}`는 원본 `frontend/app`과 줄바꿈을 제외하고 동일하다. 기존 화면을 유지하고 필요한 구매·등록·기억 입력만 기존 스타일로 연결했다.
- `apps/api/spring`은 기존 Spring 원본을 PostgreSQL 및 검증된 지갑 사용자에 연결했다. 비교용 frontend/backend 체크아웃은 수정하지 않았다.
- Node는 인증·Sui/Seal/Walrus/MemWal·카탈로그·gateway, Spring은 원래 생성·대화·에피소드·사진·개인 캐릭터를 맡는다. 공개 웹은 Node만 호출하고 Spring은 private service로 둔다.
- DTO는 packages/contracts, npm lockfile은 루트 하나다. 임시 personal_characters 및 항상 실패하던 /api 차단 코드를 제거했다.

## 수정·검토한 경계

| 영역 | 내용 |
| --- | --- |
| 인증 | 실제 서명·Origin·주소·만료 검증. Slush의 ZkLogin 서명도 testnet client로 검증한다. Spring은 Node /v1/me만 사용자 식별에 사용한다. 운영 데모/JWT 로그인은 baseline 전용이다. 로그인 후 홈으로 이동한다. |
| 권한 | 개인 캐릭터·대화·갤러리·에피소드·작업은 소유자를 검사한다. 구매한 캐릭터는 현재 이용권도 검사하며 체인 장애는 503이다. |
| 구매/정산 | 배포 package/type/object ID/실제 소유자/buyer/listing 검증. 구매 전 패키지 다운로드·복호화 확인. 기존 이용권이 있으면 재결제하지 않고 개인 사본만 가져온다. MIST/u64는 문자열, 정책 자금은 Move 금고에 있다. |
| 상품 분리 | 명시적 상품 필드만 허용한다. callName·개인 대화·관계 기억을 상품에 넣지 않는다. 구매자별 사본은 빈 호칭/대화로 시작한다. 구매한 설정의 변경·재등록도 서버에서 거절한다. |
| 미리보기 | 공개 목록은 요약만 반환한다. 제한된 시험 대화는 서버에서 실제 작가 설정과 가상 few-shot을 사용하며 개인 기억과 유료 에피소드를 섞지 않는다. 이용권 없이 전체 패키지를 반환하지 않는다. |
| Walrus | Sui/Walrus epoch의 잘못된 비교를 제거했다. permanent=true를 사용한다. 실제 canonical Blob 객체 또는 BlobCertified 이벤트의 인증·삭제 불가·blob ID·보관 기간, 암호문 해시·재다운로드를 확인한다. |
| 기억 | 사용자×캐릭터 namespace와 실제 계정 소유자/delegate/active/quarantine 상태 검증. 확인한 항목만 저장한다. 개인 채팅에서 승인된 기억을 검색한다. 활용 중지는 enabled를 끄며 분산 사본 삭제/온체인 위임 철회를 했다고 표현하지 않는다. |
| 비용/동시성 | 사용자별/서버 전체 일일 요청 한도와 무료 미리보기를 DB에서 함께 예약한다. 생성/대화/첫 인사 요청 ID, 사진 작업 UUID·원자적 포인트 예약·실패 환불을 검증한다. 느린 사진 호출 중 DB 트랜잭션을 유지하지 않는다. 불확실한 유료 호출은 자동 재제출하지 않는다. |
| 원래 흐름 | lazy collection 응답 오류, PostgreSQL TEXT 매핑, PATCH CORS, 호칭의 prompt 반영, 동시 인사·에피소드 생성을 수정했다. 홈/채팅 목록은 AI 인사를 생성하지 않는 history API를 쓴다. |
| 사용자 문구 | 내부 URL/환경변수/백엔드 확인 요구를 화면에 내보내지 않는다. 실패한 채팅을 가짜 캐릭터 응답으로 추가하지 않는다. |

## DB

Spring은 Flyway V1–V11을 everyday schema에 적용하고 Hibernate는 validate만 실행한다. 기존 DB 삭제나 출처가 확인되지 않은 데이터 이관은 하지 않았다.

- users → characters → chat_messages/photos/character_episodes에 FK를 둔다. speech styles는 순서 있는 별도 관계다.
- character_episodes는 캐릭터×에피소드 unique, 메시지는 에피소드와 캐릭터 복합 FK로 다른 캐릭터 참조를 막는다.
- licensed_characters는 개인 캐릭터당 하나이며 license ID가 unique다. base_prompt는 구매 당시 불변 설정 사본이다.
- photo_jobs는 user/character 및 photo/character 복합 FK와 UUID PK를 갖는다. 예약/완료/실패/환불은 트랜잭션이며 작업 종료 시 임시 컨텍스트를 비운다.
- Node 카탈로그는 package ID에 묶인 체인 인덱스, market_previews는 content hash에 묶인 공개 미리보기 캐시다. v1의 기존 행은 삭제하지 않고 현재 package 검증을 통과한 상품만 표시한다. 권한·가격의 원본은 체인이다.
- character_examples는 작가가 생성한 가상 예시이며 개인 chat_messages와 분리된다. market_episode_templates는 상품의 불변 에피소드, character_episodes는 사용자별 진행이다. market_engagement는 대화수/재방문율 집계만 공개한다.
- publication의 owner/package/character/content fingerprint unique와 서명 단계 저장으로 재접속·동시 탭 등록을 조정한다. chat_turn_requests는 외부 호출 전 요청을 예약하고 답변과 완료 상태를 함께 커밋한다. 불확실한 호출을 새 결제로 재시도하지 않는다.
- compile_requests/soul_training_requests는 생성 결과를 요청 또는 캐릭터에 묶는다. Soul 등록 응답만으로 훈련 완료를 표시하지 않고 완료 상태를 확인한 reference만 사진 생성에 사용한다. 에피소드 시작 문장은 개인 진행에 캐시한다.
- 기억·AI·업로드·선물 요청은 owner, 요청 ID/입력 hash/상태로 구분한다. AI/기억 작업 테이블에 대화 원문을 저장하지 않는다. pointer registry만으로 기억 복원을 증명하지 않는다.
- 남은 운영 과제: Node DDL의 버전별 migration, 만료 세션/작업 보관 정책, 전체 history의 pagination, 기존 데이터 이관 범위 확정.

## 실제 증거와 한계

- 기존 로그인 기록 `e1089cb`: API 배포 `1ef32b60-99de-4782-99ae-18d04984b986`에서 실제 Slush ZkLogin 서명 후 session/me 200과 주소 일치, 서명 재사용 401을 확인했다. 이번 수정의 실연동 자동 검증은 Ed25519 계정을 사용했다. Google 신규 계정 생성부터 시작하는 전체 UI를 이번에 재검증한 것은 아니다.
- [배포 기록](../contracts/everyday/deployments/testnet.json): v2 package `0x3ff2bfc626a8b26ca76eb13045009f642103a7a623188794f5b534882d210023`, digest `HHN75UaP7YxjPVHMPWBfQxHnc4QjAYNFD6UgtHxxpV1e`.
- [testnet 검증](../contracts/everyday/deployments/testnet-verification.json): 실제 10,000,000 MIST 구매 → 제작자 8,000,000 / 금고 2,000,000. Walrus 보관 등록·재다운로드·Seal operator 및 구매자 복호화·Move 선물 집행 확인.
- [MemWal 검증](../contracts/everyday/deployments/memory-verification.json): 실제 계정/위임/기억 작업과 새 SDK 인스턴스 recall. 다른 소유자는 거절하고 다른 캐릭터 namespace는 빈 결과. 가상 대화만 사용했다.
- [API 실연동 검증](../contracts/everyday/deployments/api-verification.json): 두 Origin에서 실제 지갑 서명으로 별도 로그인하고 실제 Sui/Seal 패키지와 본인 MemWal 기억을 동일하게 읽었다. 다른 소유자 거절, 캐릭터 namespace 분리, 기억 활용 중지 후 접근 거절도 확인했다. DB는 별도 PGlite이며 운영 DB 검증과 구분한다.
- [운영 실연동 검증](../contracts/everyday/deployments/railway-verification.json): 실제 Railway API/private Spring/PostgreSQL에서 가상 전용 계정으로 로그인, Seal 패키지 접근, 이용권 import와 재시도, 타인 캐릭터 접근 거절, 빈 개인 대화, MemWal 검색·소유자·캐릭터 격리를 확인했다. AI/이미지 호출과 브라우저는 제외했다.
- [시드 10명](../contracts/everyday/deployments/market-seed.json): 원래 PNG 자산을 Walrus에 저장하고 가상 성인 캐릭터 10명의 암호화 패키지와 이용권 상품을 실제 testnet에 게시했다. 운영 카탈로그 등록과 공개 목록 조회도 확인했다.
- 검증 명령: npm run check:backend, npm run build, npm run test:unit --workspace @everyday/web, Spring test bootJar, node infra/test-spring.mjs.
- 최종 코드 검사: API 24개, Move 20개, 웹 단위 12개, Spring test/bootJar, 실제 PostgreSQL 통합 검사, web/api/spring Docker 이미지 빌드 통과. PostgreSQL에서는 별도 연결 20개의 전체 한도 경쟁과 6개의 무료 미리보기 경쟁도 검사했다.
- `npm audit --omit=dev`는 2026-09-12 공개 npm 운영 의존성 취약점 0건을 반환했다. 모든 종류의 취약점 부재를 보장하는 결과는 아니다.
- Spring 통합 검증은 실제 별도 PostgreSQL, production profile, 실제 지갑 서명, Node gateway를 사용한다. 생성/수정/채팅/에피소드/사진 작업/환불/중복 차감/구매자 격리/기억 장애 rollback을 검사한다. **AI·이미지·마켓 어댑터 응답은 fixture**다. 실제 정산/저장 증거는 위 기록과 구분한다.
- 브라우저 테스트는 사용자 지시로 실행하지 않았다. 새 SDK 인스턴스 검증을 두 실제 Origin의 UI 시연 완료로 표현하지 않는다.

## 완료로 보고할 수 없는 항목

| 우선순위 | 남은 항목 |
| --- | --- |
| P0 배포 | 코드 `252cf07`의 web 배포 `6b97a342-3e6b-40e0-9326-73939e4c1fc0`, API `133925e4-2062-4bdf-919e-1d964e2a9a2d`, private Spring `f191a723-148c-4326-873c-dace94295c3e`는 성공했다. DB migration/readiness뿐 아니라 위 실제 운영 API 흐름도 확인했다. 운영에 Claude/Higgsfield 키가 없어 실제 생성·대화·사진 공급자 왕복은 미검증이다. |
| P0 시연 | 두 Origin의 실제 API 권한/기억 연속성은 검증했다. 브라우저 전체 시연은 사용자 지시로 미실행이다. 두 번째 환경도 기존 웹을 그대로 사용한다. |
| 상품 | 생성한 가상 few-shot 예시·기존 시나리오를 상품에 포함한다. 별도 작가용 예시/에피소드 편집 UI는 만들지 않았다. 시드 이미지는 Walrus에 있지만 일반 생성 이미지 imageUrl은 아직 공급자 외부 참조다. |
| 초기 마켓 | 실제 10명 게시와 운영 카탈로그 등록, 생성 완료 시 공개 설정 기반 유사 추천, 실제 대화수/재방문율 집계 코드가 있다. 집계는 PostgreSQL 가상 대화로 확인했고 운영 대화는 아직 발생시키지 않았다. 임의 인기 수치는 사용하지 않는다. |
| P1 | 실제 LLM 판단 → 선물 구매 → 상품 제공/채팅 영수증 미완료. 금고 집행은 검증했지만 Spring 구매자 채팅에는 선물 트리거를 붙이지 않았다. 일반 등록 상품은 선물 한도 0이다. |
| 운영 | 테스트넷도 테스트 SUI 가스를 소비한다. key 복구/교체, 보관 기간 갱신, UpgradeCap 운영 정책, 공급자 과금 계정 유효성은 배포 전 확인해야 한다. |

제작자 80%/캐릭터 금고 20%는 초안이며 기획의 결정 대기 사항이 확정됐다고 취급하지 않는다. `AI_DAILY_LIMIT=50`, `AI_GLOBAL_DAILY_LIMIT=100`은 기본 요청 횟수 한도다. 달러 기준 지출 상한을 보장하지 않으며 한 생성 요청이 여러 사진을 만들 수 있다. 공급자 과금 설정도 별도다. 확장 콘텐츠 공동 정산·재판매 등 명시적 후속 로드맵은 P0 완료 조건에 넣지 않는다.

데모 추론 비용은 플랫폼 공급자 계정이 부담하고 이용권 정산과 분리한다. 토큰 원가 회계·별도 대화 사용료 청구는 구현하지 않았다. 기획의 확장 콘텐츠 공동 판매/정산은 후속 로드맵이며, P1 선물 제공의 미완료와는 구분한다.

배포 검사에서 Windows stdin 전달 시 붙은 UTF-8 BOM과 Spring의 내부 인증 URL 포트 누락을 발견해 변수 값을 수정했다. 현재 운영 변수는 원본과 정확히 대조했고 실제 import까지 다시 통과했다. DB readiness만으로 공급자·내부 서비스 연동 완료를 판단하지 않았다.

## 공식 대조

[Sui SDK](https://sdk.mystenlabs.com/sui), [Seal](https://sdk.mystenlabs.com/seal), [Walrus 저장 API](https://docs.wal.app/docs/http-api/storing-blobs), [Walrus epoch](https://docs.wal.app/docs/system-overview/operations), [testnet type origin](https://github.com/MystenLabs/walrus/blob/main/testnet-contracts/walrus/Published.toml), [MemWal TypeScript](https://docs.wal.app/walrus-memory/sdk/api-reference), [Claude Messages](https://platform.claude.com/docs/en/api/messages/create).

MemWal은 실제 relayer /config와 registry 타입을 추가 확인했다. Claude는 top-level system과 text block 응답을 처리하여 기존 키를 마켓에서도 재사용한다.
