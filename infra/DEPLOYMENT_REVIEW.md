# 코드·명세 대조 및 검증 — 2026-09-12

현재 구현은 아래의 **단일 TypeScript 백엔드 전환** 기록을 따른다. 앞부분의 Spring·gateway·Gradle 설명은 이전 배포의 이력을 보존한 것이다.

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
- [시드 10명](../contracts/everyday/deployments/market-seed.json): 원래 PNG 자산을 Walrus에 저장하고 시드 캐릭터 10명의 암호화 패키지와 이용권 상품을 실제 testnet에 게시했다. 운영 카탈로그 등록과 공개 목록 조회도 확인했다.
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

## 후속 리팩토링과 문서 검사

문서 정리 커밋 `a96512a`의 GitHub Actions는 Move, Node 타입/단위/빌드/Docker, 현재 Spring/PostgreSQL 통합 작업 모두 통과했다. 오래된 `legacy/spring`·브라우저 비교 작업을 현재 서버 검사로 교체했다. 브라우저 테스트 소스는 과거 비교 자료로 보존하며 현재 서비스의 통과 증거로 사용하지 않는다.

후속 리팩토링은 unsigned Move 거래 준비, 프론트의 사용자별 저장 키/UUID 검사, Spring의 최근 대화 문맥 조회·정렬·역할 변환을 공통 처리로 모은다. API 응답·지갑 권한·저장 키·트랜잭션·유료 호출 경계와 기존 화면은 유지한다. 별도 담당자가 교차 리뷰했고, API 24개·Move 20개·웹 13개·Spring 7개 및 실제 PostgreSQL 통합 검사가 통과했다. 추가 검사는 기존 저장 키와 세션 만료, 일반/에피소드 대화 분리와 최근 10개/5개 순서를 확인한다.

비교 빌드는 공유 DTO 생성물이 없는 최초 checkout에서도 먼저 타입을 생성하도록 수정하고 실제 빈 생성물 상태에서 빌드했다. 이후 일반 전체 빌드로 복구했다. 문서나 회귀 검사에서 실 공급자·브라우저 검증을 했다고 확대해서 보고하지 않는다. 이전 공개 거래 증거는 원래 검증 시점의 기록으로 보존한다.

로컬 PGlite는 최초 데이터 폴더가 없는 경우 먼저 생성하도록 수정했다. 새 중첩 상대 경로·같은 DB 재시작·file:// 경로·memory://에서 별도 프로세스의 readiness/liveness 200을 확인했다. 운영 PostgreSQL과 기존 로컬 DB는 변경하지 않았고, 이 검사에서 만든 임시 DB만 종료 후 제거했다.

### 문서 무결성

문서 정리 시점에 Git 관리 Markdown 23개를 확인했다. 현재 실행·기획 문서와 과거 기록을 분리하고, 원본 참고 문서는 당시 기록임을 표시했다. 중복 전환 안내인 루트 REFACTOR_PLAN.md는 제거했으며 현재 진입점은 루트 README다. 파일·문서 링크·UTF-8·충돌 표시는 `node infra/check-docs.mjs`로 재검사한다. API 경로·DTO·Compose 환경 주입·Flyway 목록과 공개 증거 JSON의 package ID, Move 소스 hash, 시드 수, MIST 분배 합계를 코드와 대조했다.

문서가 참조하는 외부 HTTPS 주소 27개 중 Walrus 주소 6개는 기존 경로가 404였다. 공식 본문이 응답하는 `.html` 경로로 수정했다. HTTP 응답과 문서 제목 확인은 링크 접근성 검사이며 그 문서의 모든 주장이나 미래 가용성을 보증하지 않는다.

## 공식 대조

[Sui SDK](https://sdk.mystenlabs.com/sui), [Seal](https://sdk.mystenlabs.com/seal), [Walrus 저장 API](https://docs.wal.app/docs/http-api/storing-blobs.html), [Walrus epoch](https://docs.wal.app/docs/system-overview/operations.html), [testnet type origin](https://github.com/MystenLabs/walrus/blob/main/testnet-contracts/walrus/Published.toml), [MemWal TypeScript](https://docs.wal.app/walrus-memory/sdk/api-reference.html), [Claude Messages](https://platform.claude.com/docs/en/api/messages/create).

MemWal은 실제 relayer /config와 registry 타입을 추가 확인했다. Claude는 top-level system과 text block 응답을 처리하여 기존 키를 마켓에서도 재사용한다.

## 배포 통합과 추가 최적화 — 2026-09-12

저장소의 앱 배포 구성을 web·api·spring 세 개에서 web·통합 api 두 개로 변경했다. PostgreSQL은 별도이며 같은 DB와 스키마를 유지한다. Node의 Web3 SDK와 Spring의 기존 제품 기능을 보존하고, 한 백엔드 이미지에서 두 프로세스를 실행한다. 현재 제품 요청은 Spring에서 Node의 인증·이용권·기억 기능을 다시 호출하므로 독립 배포의 이점이 제한적이다. 이번 변경은 배포 관리와 내부 연결을 단순화하며, 단일 런타임으로의 전면 이관이나 실제 운영 비용 절감을 증명하지 않는다. Production transition completed after local validation; see the record below.

- Spring은 loopback에서만 수신한다. supervisor가 양쪽 포트·주소를 연결하고 예상치 못한 종료를 전체 실패로 처리한다. 정상 종료는 Spring의 callback 처리를 위해 Spring 다음 Node 순서로 수행한다. readiness는 두 런타임의 DB 연결을 확인한다.
- 마켓 목록의 최대 20개 개별 체인 RPC를 한 번의 SDK 배치 조회로 바꿨다. 빈 목록은 RPC를 생략하고, 매 요청마다 현재 체인을 조회한다. 패키지·타입·소유권·객체 ID·BCS 및 배치 누락·순서 검증을 유지한다.
- 요청 제한 플러그인보다 라우트가 먼저 등록되어 120회 한도가 적용되지 않던 문제를 고쳤다. 인증 결과는 같은 요청 안에서만 재사용하며 다음 요청은 세션을 다시 검증한다. Spring 인증 callback의 429와 유효한 Retry-After를 JSON으로 전달하여 재시도 안내가 502로 바뀌지 않게 했다.
- 각 Docker 빌드는 필요한 npm workspace만 설치한다. Java 변경이 Node 소스 빌드 캐시를 무효화하지 않도록 복사 범위를 줄였고, Gradle 의존성 캐시를 재사용한다. Spring 테스트는 `docker build --target spring-test -f infra/Dockerfile.api .`로 별도 실행할 수 있다.

로컬 검증: API 타입 검사·37개 테스트, supervisor 8개 테스트, 전체 앱 빌드, Spring 전체 테스트, 두 Docker 이미지 빌드, 실제 PostgreSQL 제품 통합 검사가 통과했다. 통합 이미지에서는 실제 지갑 서명·Spring gateway·내부 인증, Spring 포트 비공개, DB 중단과 복구, 정상 종료·재시작, Spring 강제 종료 시 전체 실패를 확인했다. 추가 supervisor·통합 이미지 검사는 로컬에서 실행했으며 기존 CI 설정은 유지한다.

제품 통합 검사의 AI·이미지·마켓 응답은 fixture다. 이번 검사가 실제 공급자 호출·온체인 정산·운영 비용 검증을 추가한 것은 아니다. Move 코드는 변경하지 않았고 이번 로컬 Move 검사는 실행하지 못했다. 위쪽의 운영·testnet 증거는 해당 시점의 기록으로 보존한다.


## Production consolidation verified: 2026-09-12

The user authorized the Railway transition. The existing API now runs both Node and Spring; the standalone everyday_spring service was deleted after verification. Only everyday_web, everyday_api and the original Postgres remain. Public domains, the database deployment and its volume were retained.

- API code: 087f490ee3738aa674218d1d3c073573ee059b8b. Successful deployment: 524c6601-98f2-41ca-bf67-49da0c8c1431. Logs confirm Spring on internal port 18080 in the same API container and aggregate readiness 200.
- Web deployment: 354a5320-9752-4299-a7b7-491d7d522a67, SUCCESS.
- Removed service: everyday_spring, 4dabfc2d-7528-4a63-9cec-6ee0579bd7aa.
- Existing JDBC and provider variable references were transferred and checked without recording secret values. Only the obsolete SPRING_API_URL reference was removed.
- Post-removal checks at 2026-09-12T07:33:31Z: health, catalog with 10 listings, exact Move package, signed wallet login, identity and empty product/profile reads, anonymous rejection, logout and revoked-session rejection all passed. Verification created disposable authentication/empty-user records; it did not create products or call AI, payments or chain uploads.
- [Deployed-code CI](https://github.com/ChangwooHa47/everyday_sui/actions/runs/34680889944): API 37, web 13, Move 20, typecheck, builds, Docker, Spring and real PostgreSQL integration passed.

The first API build did not complete with the generic cache ID; the previous healthy deployment continued serving. Commit 087f490 uses Railway's required service-scoped cache ID and passed build, deployment and CI. Other Railway services need their own ID, following the [official cache mount format](https://docs.railway.com/builds/dockerfiles#cache-mounts).

Anthropic and Higgsfield keys were already empty in production. Live generation/chat/image-provider calls and operating cost savings remain unverified.

## 단일 TypeScript 백엔드 전환

사용자는 기능 추가 없이 백엔드를 한 언어로 통합하고, 불필요한 코드 제거와 변경 전체의 코드 리뷰를 요청했다. Sui·Seal·MemWal의 현재 TypeScript 구현을 유지하고 기존 Spring 제품 기능을 `apps/api/src/product`로 이전했다. 웹 동작·공개 API 경로·DTO·Move 계약·기존 PostgreSQL 스키마와 데이터를 유지한다.

- 생성·인터뷰·컴파일·호칭·프로필·갤러리, 일반 대화·에피소드, 초상·사진 작업·얼굴 학습, 구매자 사본과 개인 기억 연동을 Node 내부 함수로 연결했다.
- 운영 Spring 소스·Gradle·Java 이미지·gateway·두 프로세스 supervisor와 전용 검사를 제거했다. SQL V1–V11은 바이트를 그대로 보존해 `apps/api/migrations`로 이동했다. `legacy/spring`은 기존 비교 자료이며 npm workspace·배포·CI에 포함되지 않는다.
- 기존 Flyway checksum과 적용 이력을 검증하고 이미 적용된 SQL을 다시 실행하지 않는다. 새 DB는 동일 SQL로 구성하며 제품 컬럼 검증 실패 시 서버를 열지 않는다. DB 연결 풀은 Node의 최대 10개만 사용한다.
- 동일 요청의 재사용·불확실한 유료 호출 재실행 금지·사진 포인트 차감/환불·구매자의 설정 변경 금지·개인 기억 격리를 기존 코드와 대조했다. 실제 Java/Jackson으로 확인한 컴파일 요청 hash와 이메일 검증 예시를 회귀 검사에 반영했다.
- 리뷰에서 발견한 종료 순서 문제를 수정했다. `preClose`에서 작업을 정리한 다음 HTTP 요청 종료와 DB 해제를 진행한다. 20초 안에 작업이 끝나지 않으면 공급자 호출을 취소하고, 정리 실패는 성공 종료로 처리하지 않는다. 프로세스의 기존 35초 종료 제한을 유지한다.
- PostgreSQL의 날짜/시간을 JavaScript UTC 변환으로 이동시키지 않도록 보존했다. 인증·제품 요청 제한은 동일 요청 안에서만 인증 결과를 재사용하며 이후 요청은 세션을 다시 확인한다.

로컬 검증은 단일 Node 제품 통합 검사, API 단위/회귀 검사, 타입 검사, 웹 13개 테스트 및 전체 앱 빌드를 포함한다. 이전 Spring/Flyway Docker 이미지가 만든 DB를 새 Node 이미지로 열어 전체 제품 테이블 데이터와 migration history가 변하지 않는지 확인했다. 실제 지갑 서명 로그인·제품 조회, DB 중단/복구, 정상 종료/재시작, Node 서버 프로세스 1개와 Java 실행 파일 부재를 검사했다.

독립 리뷰는 캐릭터/이미지와 대화/에피소드 담당을 교차 배정했고, 별도로 인증·이용권·개인 기억·DB 전환·종료 동작을 검토했다. 발견한 종료 순서·날짜 표현·기존 이메일 검증 차이를 수정했다. AI·이미지·마켓 어댑터 fixture 검사는 실제 유료 공급자 호출이나 신규 온체인 거래의 증거가 아니다.

### 운영 전환 검증 — 2026-09-12

앞선 Node/Spring 병행 실행 기록은 이전 단계다. 현재 배포 코드는 `b9fb67f38b97ed91a396f43973d5b64307131537`이며 API는 단일 TypeScript/Node 런타임이다.

- API 배포 `80f2e7ae-2c13-431c-9d5d-c9d89f772245`, 웹 배포 `3ab61113-812d-48cc-8085-75f42412f413` 모두 SUCCESS를 확인했다.
- 기존 Postgres 배포 `686878b4-6274-40f7-be74-44f2b3ac5dc4`와 볼륨·공개 도메인을 유지했다. 이번 언어 통합에서는 Git 자동 배포 외에 Railway 리소스·설정·환경변수를 변경하지 않았다.
- `2026-09-12T08:07:39.097Z` 운영 검사 12개가 통과했다. liveness/readiness, 정확한 testnet 패키지, 상품 10개와 문자열 금액, 실제 서명 기반 challenge/session/identity, 개인 캐릭터·프로필 조회, 익명 거부, 로그아웃과 폐기 세션 거부를 확인했다. 임시 인증·빈 사용자 레코드 외 제품 생성·유료 공급자 호출·온체인 거래는 수행하지 않았다.
- 구현 커밋은 171개 파일에서 3,182줄 추가·5,820줄 삭제했다. 운영 Java/Gradle과 중복 연결 코드를 제거했고 웹 UI와 Move 소스는 변경하지 않았다.
- [구현 커밋 CI](https://github.com/ChangwooHa47/everyday_sui/actions/runs/34682376163)에서 Move와 실제 PostgreSQL/컨테이너 제품 통합 검사가 통과했다. 문서 검사에서 삭제된 Spring 디렉터리를 가리키는 보관 문서 링크를 발견해 현재 제품 API 경로로 수정했다. 이후 전체 결과는 [main CI 실행 기록](https://github.com/ChangwooHa47/everyday_sui/actions/workflows/ci.yml?query=branch%3Amain)에서 확인한다.

운영 Anthropic·Higgsfield 키는 기존부터 비어 있어 실제 AI 대화·이미지 생성과 비용 절감은 검증하지 않았다.
