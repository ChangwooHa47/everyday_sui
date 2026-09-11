# 캐릭터 마켓 실행

## 지금 실행할 수 있는 것

마켓 `/market`, 별도 기억 클라이언트 `/viewer`, 제작자 등록/초안/시험 대화/패키지 게시,
미리보기/이용권 구매/유료 채팅, 사용자 승인 기억 저장·결과 확인·검색,
LLM 선물 판단과 Move 실행·복구 코드가 연결되어 있다.
외부 설정 없이는 성공을 모사하지 않고 해당 기능을 거절한다.

## 로컬 실행

Node 24, npm 11, Sui CLI testnet-v1.79.0을 사용한다.

```powershell
npm.cmd ci --ignore-scripts
Copy-Item apps/api/.env.example apps/api/.env.local
# .env.local의 서버 전용 설정을 편집한다. 아래 필수 설정을 참고.
npm.cmd run dev:api:configured
```

다른 터미널에서 `npm.cmd run dev:web`을 실행하고 http://127.0.0.1:3000/market에 접속한다.
API는 PGlite를 사용하며 실제 체인·스토리지·AI 어댑터를 연결한다.
`.env.local`은 dev:api:configured가 명시적으로 읽는다. dev:api/local·운영 실행은 프로세스 환경을 사용한다.

두 Origin에서 시연할 때에는 **개발 서버 둘을 같은 .next 폴더에 띄우지 않는다**.
`npm.cmd run build` 후 별도 터미널에서 `npm.cmd run start:market`,
`npm.cmd run start:viewer`를 실행한다. 주소는 3000/market, 3002/viewer다.
WEB_ORIGINS에 두 Origin이 있어야 하고 각 Origin에서 별도 지갑 로그인이 필요하다.
두 UI는 현재 같은 API를 사용한다. 독립 사업자의 서비스 간 이식성 전체를 증명한 것은 아니다.

## 필수 설정

| 설정 | 용도 |
| --- | --- |
| SUI_MARKET_PACKAGE_ID | 직접 배포한 everyday 패키지 |
| SUI_OPERATOR_KEY | backend 전용 suiprivkey. 패키지 복호화·선물 거래 실행 |
| SEAL_SERVERS_JSON / SEAL_THRESHOLD | 서로 다른 키 서버 2개 이상. committee 서버는 aggregatorUrl 포함 |
| WALRUS_PUBLISHER / WALRUS_AGGREGATOR | 테스트넷 publisher/aggregator HTTPS 주소 |
| AI_ENDPOINT / AI_MODEL / AI_API_KEY | Chat Completions 호환 AI 제공자 |
| MEMWAL_DELEGATE_MASTER_KEY | 임의의 32바이트 hex. 사용자별 서버 delegate를 HMAC으로 파생 |
| MEMWAL_PACKAGE_ID / MEMWAL_REGISTRY_ID | 실제 staging relayer가 사용하는 배포 |
| AGENT_GIFTS_ENABLED=1 | P1 선물 판단·실행·복구 활성화 |

키는 API 환경/비밀 저장소에만 둔다. 웹 환경이나 채팅 메시지에 붙여넣지 않는다.
현재 operator 실행키는 공용이며 **SUI 금고·한도·정산은 Listing별로 분리**된다.
operator의 일반 주소 잔액은 가스 자금이고, 선물 대금은 Listing 금고에서만 나온다.

## 테스트넷 배포 재개

```powershell
npm.cmd run probe:testnet
npm.cmd run deploy:testnet
```

deploy:testnet은 `.local-tools/market-testnet/creator.key`의 전용 테스트넷 키만 사용한다.
키가 없으면 새로 만들고 출력하지 않는다. 공개 배포 결과는 같은 폴더의 deployment.json이다.
서명된 게시 거래를 publish.json에 먼저 저장하여 응답 단절 시 같은 거래만 재확인/제출한다.
이미 발행한 뒤 코드를 바꿨다면 이 스크립트는 재배포하지 않는다. 새 배포/업그레이드는 별도 절차다.

2026-09-10 실행 결과 faucet이 HTTP 429로 요청을 거절했다. 게시 거래는 아직 만들지 않았다.
전용 주소에 테스트 SUI를 지급한 뒤 재실행한다:

`0x97eb51ec405dfd3edf9f5cbe7f38dc8e0cba2ff6252ffe565055a52fe618aa47`

probe:testnet은 testnet Clock과 MemWal health를 읽고, relayer /config의 packageId를
기준으로 GraphQL에서 AccountRegistry를 찾는다. 문서의 오래된 ID를 그대로 복사하지 않는다.
확인된 registry/계정 타입·소유권·현재 delegate·동결 상태도 API가 검사한다.

## 데모 순서

1. `/market`에서 제작자 지갑 로그인 → 제작자 등록 → 설정 작성·시험 대화.
2. 상품 초안 생성 → Listing ID 확보 → 별도 미리보기 설정 작성 → 패키지 암호화·보관.
   업로드는 Seal 암호문만 보내고 Walrus 다운로드 해시를 확인한다. 게시 전 원문은 DB에 저장하지 않는다.
3. 마켓 게시를 지갑으로 서명하고 목록에 등록한다. 목록 등록만 실패했다면 '목록 등록 재시도'를 사용한다.
4. 구매자 지갑으로 미리보기 N턴 후 제한 확인 → 테스트 SUI 이용권 구매 → 유료 대화.
5. 구매자 MemWal 계정 생성 또는 기존 ID 입력 → 동의 → 지갑에서 delegate 추가 → 계정 연결.
6. 기억할 항목을 직접 확인하여 저장한다. 접수(202)는 저장 완료가 아니다.
   '저장 결과 확인'에서 done과 Walrus blob ID를 확인한 뒤 '내 기억 불러오기'를 실행한다.
7. 3002/viewer에서 같은 지갑으로 로그인해 구매한 캐릭터 설정·내 기억을 불러온다.
   다른 지갑은 그 기억을 읽을 수 없다. 기억을 채팅에 전달할 때는 별도 체크박스를 켠다.
8. 선물은 아래 준비 후 paid chat의 의미 있는 맥락을 바탕으로 LLM이 제안한다.
   confirmed 전에는 선물 도착으로 표시하지 않는다. 불확실하면 '선물 도착 확인'으로 조회한다.

## P1 선물 준비

패키지 게시로 받은 Admin cap 소유자가 아래 API로 GiftProduct transaction을 만든 뒤 지갑으로 서명한다.
금액 예: 5,000,000 MIST. 초안을 만들 때 이 상품 ID를 allowedGiftIds에 넣는다.
게시 후 허용 목록과 한도는 변경할 수 없다. 빈 목록이면 선물을 보내지 않는다.

`POST /v1/market/gift-product-transaction`

```json
{"adminId":"0x...","title":"포토부스 이용권","merchant":"0x...","priceMist":"5000000"}
```

operator 지갑에 가스용 테스트 SUI를 지급하고 AGENT_GIFTS_ENABLED=1로 API를 재시작한다.
구매 대금 중 agentBps 몫은 금고에 쌓인다. 지출에는 한도·allowlist·잔액·수신자 구매 권한이 강제된다.
같은 intent는 새 거래로 다시 서명하지 않는다. 30초마다 저장된 동일 서명 거래를 재확인한다.
서명 전에 중단되어 bytes가 없는 unknown 상태는 자동 재실행하지 않는다.
같은 operator 가스 객체를 동시에 쓰면 체인 충돌로 선물이 실패할 수 있다. 운영 확장에는 가스 pool/실행 큐가 필요하다.

## 추가 API

기본 카탈로그·접근 API는 MARKET_PIVOT.md 참고. 아래 요청은 Origin+Bearer 인증을 요구한다.

| 경로 | 입력·출력 |
| --- | --- |
| GET /v1/market/config | 공개 설정·기능 구성 여부 |
| POST /v1/market/creator-transaction | 제작자 등록 transaction JSON |
| POST /v1/market/listing-transaction | creatorId,title,priceMist,agentBps,perGiftLimitMist,dailyLimitMist,allowedGiftIds |
| POST /v1/market/listings/:id/package | requestId,characterPackage → 암호문 참조·게시 transaction JSON |
| GET /v1/market/listings/:id/character?licenseId=… | 권한 확인 후 캐릭터 패키지 |
| POST /v1/market/listings/:id/turns | requestId,mode(preview/licensed),messages,licenseId?,episodeId?,useMemory? |
| GET/POST/DELETE /v1/me/memory-account | 조회 / accountId+consent 연결 / API 접근 중지 |
| POST /v1/me/memory-account/transaction | accountId?·revoke? → 지갑에서 계정 생성/위임/철회 |
| POST /v1/me/relationships/:id/remember | requestId,text,consent:true,licenseId? → 202 jobId |
| GET /v1/me/memory-jobs/:requestId | 본인 요청만 상태 확인 |
| POST /v1/me/relationships/:id/recall | query → 본인 계정의 해당 캐릭터 기억 |
| GET /v1/me/gifts | 본인의 선물 상태·거래 digest |

채팅·기억·업로드 requestId는 작업마다 UUID를 사용한다. 같은 ID로 다른 입력을 보내면 409다.
provider 결과 불확실 시 자동 재시도하지 않는다. preview 한도는 시도 단위로 예약하며 실패해도 반환하지 않는다.
API 연결 해제는 DB enabled=false, 온체인 위임 철회는 별도 서명이 필요하다.
이미 복호화된 데이터 회수나 과거 delegate의 기존 키/데이터 삭제는 보장하지 않는다.
MemWal의 namespace는 검색 범위이고 접근 권한 단위는 계정 delegate다. UI 동의는 계정 전체 위임을 의미한다.

## 검증

```powershell
npm.cmd run check:backend
npm.cmd run build
npm.cmd run test:web3
npm.cmd run test:unit --workspace @everyday/web
```

인증·권한·격리·비용 제한·재실행 방지는 로컬 fixture로 검증한다.
실제 AI 비용, Walrus 저장, Seal 복호화, MemWal 기억 왕복, 선물 거래는 외부 설정·테스트 SUI 확보 후 별도 리허설해야 한다.
