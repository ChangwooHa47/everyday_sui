# Everyday — Web3 네이티브 전환 실행 계획

> 폐기된 2026-09-07 전환 계획이다. Spring 제거·새 Web3 화면·개인 보관함 이전 요구는 현재 작업 지시가 아니다. 기존 제품을 재사용하는 [현재 기획](../MARKET_PIVOT.md)과 [배포 리뷰](../../infra/DEPLOYMENT_REVIEW.md)를 따른다.

> 2026-09-08 후속 구현은 [Web3 구현 기록](WEB3_IMPLEMENTATION.md)에 정리했다.
> 아래는 2026-09-07 설계 시점의 계획과 상태를 보존한 문서이며, 현재 구현 상태는 후속 기록을 기준으로 한다.

작성: 2026-09-07. **새 모노레포의 기반 구성은 이번에 실행했고, 아래 체인·인증·운영 설계는 앞으로 구현할 계획이다.** 기존 사용자/운영 DB는 이관하지 않는 새 서비스가 기본 전제다. 첫 공개 목표는 소규모 테스트넷 베타로 가정한다. 기존 R1~R6의 Spring 중심 리팩토링 순서는 이 계획으로 대체한다.

## 1. 목표와 완료의 의미

지갑 로그인만 붙인 서버 중심 앱에서 끝내지 않는다. 사용자가 지갑으로 자산을 소유하고, 서버를 거치지 않아도 자신의 확정된 데이터를 발견·검증·복원할 수 있게 한다. AI 추론과 유료 제공자 호출은 서버에서 실행한다. 이것은 남아 있는 신뢰 경계이며 온체인 추론이나 완전 탈중앙 AI라고 부르지 않는다.

최종 인수 조건:

1. 이메일·공용 데모 계정 없이 지갑으로 로그인한다. API 세션은 지갑 소유 증명에서 파생되며 자산 변경 서명을 대신하지 않는다.
2. 캐릭터 소유·최신 공개 버전은 Sui에서 판정한다. 운영자가 DB의 owner 값을 바꿔도 자산 소유권은 바뀌지 않는다.
3. 캐릭터 설정, 사진, 일반·에피소드 대화는 버전 있는 포맷으로 Walrus에 저장한다. 비공개 데이터는 업로드 전에 암호화한다.
4. 새 브라우저에서 지갑과 Sui 객체부터 출발해 확정된 데이터를 복원한다. 기존 API·DB를 중지한 상태에서도 읽기·내보내기가 가능해야 한다.
5. 저장 기간, 미확정 변경, 지갑 서명 취소, 업로드 실패를 화면에서 구분한다. 저장 기간 만료 후의 복구까지 보장한다고 표현하지 않는다.
6. 정상 서비스 실행·배포에서 Spring과 이전 Next AI API 의존을 제거한다. 비교용 소스와 테스트는 보관할 수 있다.

## 2. 이번에 만든 기반과 아직 만들지 않은 것

| 경로 | 현재 상태 | 다음 역할 |
|---|---|---|
| `apps/web` | 기존 제품 화면 복사, 이전 Next API/measure/train 분리, 빌드 성공 | 지갑 연결, 체인 상태 및 암호화 데이터 표시 |
| `apps/api` | Fastify/TypeScript 기동과 `/health/live`, 환경값 검사 | 서명 검증·AI 요청·작업 제어·읽기 인덱스 |
| `packages/contracts` | API가 사용하는 공통 타입 패키지 | `/v1` 입력·출력 스키마와 버전 있는 저장 포맷 |
| `legacy/spring` | 기존 코드와 R0 테스트를 복사하여 보존 | 기능 비교 전용, 새 운영 배포에서 제외 |
| `legacy/frontend` | 이전 Next API·실험 화면·스크립트·보조 모듈 보관 | 기능 차이 확인, 자동 배포 대상 아님 |
| `infra` | API Dockerfile 및 로컬 Compose 초안 | P1 이후 DB·worker·indexer 배포 정의 |
| `.github/workflows/ci.yml` | 새 workspace 검사와 기존 기능 비교 작업 정의 | PR 검사, 이후 testnet 배포 검증 추가 |

**현재 제품 화면은 여전히 R0 Spring API를 호출한다. 새 TS API에는 제품 기능·지갑 인증·체인 연결이 없다.** 화면이 실행된다고 전환 완료로 간주하지 않는다. 이번에 준비한 정적 export도 Walrus에 실제 게시한 상태가 아니다.

원본 `frontend/`, `backend/`의 Git 이력과 수정 사항은 로컬에 그대로 남겨 두었다. 새 루트 저장소에서는 무시하며 필요한 소스는 위 경로에 복사했다. 반입 경로는 `import-manifest.json`으로 추적한다. Node 패키지는 npm workspaces와 루트 lockfile 하나로 관리한다. 아직 규모가 작으므로 Turbo/Nx를 추가하지 않는다. [npm workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces/)

## 3. 목표 아키텍처와 신뢰 경계

```text
사용자 지갑 ── 개인 메시지 서명 ───────────→ TS API → 단기 세션
    │                                      │
    │ 자산 변경 트랜잭션 서명                ├→ Postgres: 작업·정산·인덱스
    ▼                                      └→ Worker → 기존 LLM/이미지 제공자
   Sui ←──────── 후원자가 gas 부담 ─────────────┘             │
    │ 소유권 / manifest 참조                                 ▼
    └────────→ 정적 Web ←→ Walrus: 공개 파일 / 암호문 ← 저장 작업
                   │
                   └→ Seal: Sui 정책 검증 후 복호화 키 접근

Indexer: Sui checkpoint → 이벤트/객체 변경 → Postgres 조회용 projection
Recovery client: 지갑 → Sui → Walrus/Seal (Everyday API 없이 읽기·내보내기)
```

Sui 소유 객체와 변경 검증을 권한의 기준으로 둔다. DB는 처리 상태와 빠른 조회를 담당한다. Walrus에는 바이트를, Sui에는 객체 소유와 작은 참조를 둔다. [Sui 객체 소유](https://docs.sui.io/develop/objects/object-ownership), [Walrus 저장 수명과 동작](https://docs.wal.app/docs/system-overview/operations.html)

웹은 Next의 정적 export를 Walrus Sites로 게시하는 것을 목표로 한다. Sites는 정적 자원을 Walrus에, 자원 인덱스를 Sui에 두고 HTTP portal을 통해 제공한다. SSR·서버 route가 필요한 기능은 별도 API로 둔다. 커스텀 도메인/portal의 deep link·보안 헤더·지갑 origin 동작은 P5에서 실제 검증한다. [Next 정적 export](https://nextjs.org/docs/app/guides/static-exports), [Walrus Sites 구조](https://docs.wal.app/docs/sites/introduction/technical-overview.html)

초기 운영은 외부 관리형 Sui RPC와 Walrus gateway/publisher를 사용한다. 직접 validator/fullnode/storage node/Seal key server를 운영하는 것은 MVP 필수 요건이 아니다. 특정 RPC·portal 하나가 막혀도 확정 데이터를 읽을 수 있도록 설정 가능한 대체 경로를 제공한다.

## 4. 어디에 어떤 데이터를 두는가

| 데이터 | 최종 기준 | 서버 보관 | 권한/복원 정책 |
|---|---|---|---|
| 지갑 identity | 정규화한 Sui 주소 | 내부 UUID와 주소 매핑 | 이메일/password 제거. 하나의 주소부터 시작 |
| 캐릭터 자산 | Sui `Character` 객체 | object ID·owner·version projection | 현재 소유자가 공개 버전 변경·자산 이전 |
| 공개 프로필 | Walrus public manifest와 이미지, Sui 참조 | 캐시·검색 필드 | 공개로 확정한 최소 정보만 노출 |
| 성격·호칭·개인 설정 | 암호화된 private manifest | 암호문/참조, AI 수행 중 일시 평문 | `UserVault`의 사용자 정책, 공개 프로필과 분리 |
| 개인 사진·갤러리 | 암호화 파일 및 gallery manifest | 생성 job, 임시 결과, blob 상태 | 기본 비공개. 공개 게시를 명시적으로 수행 |
| 일반/에피소드 대화 | 암호화 segment와 버전 manifest | 최근 실행 상태·암호문·인덱스 | 사용자별 보관, 종류/순서/해시 보존 |
| 에피소드 카탈로그 | 버전 있는 공개 manifest | 캐시 | 클라이언트가 동일 카탈로그 버전으로 복원 |
| 진행 상태·선택 프로필·숨김 | private manifest | UI 캐시 | DB/localStorage만 지워져도 확정 상태 복구 |
| AI job/재시도/요금 예약 | Postgres 운영 원장 | 영속 저장, 백업 | 사용자 자산과 구분. DB 백업이 필요 |
| 가스/WAL 지급 | Sui 실제 거래 내역 | budget/receipt 원장 | 사용자 서명과 운영자 비용 부담을 분리 |
| 기존 1200포인트 | 새 테스트 서비스 quota | 예약/확정/해제 원장 | 토큰으로 자동 변환하지 않음. 결제는 별도 범위 |

**DB 전체가 재구축 가능하다고 주장하지 않는다.** 확정된 자산·데이터 인덱스는 체인과 manifest에서 복원할 수 있지만, 처리 중 job·비용 예약·제공자 receipt는 별도 백업이 필요하다. 반대로 이 원장이 없다고 사용자가 이미 확정한 데이터를 읽지 못해서는 안 된다.

Walrus blob ID, Sui `Blob` object ID, 앱 `Character` object ID, DB UUID, provider job ID를 별도 필드로 유지한다. Sui u64/version은 JS number 대신 문자열로 다룬다. blob ID는 Sui hex 주소로 검사하지 않는다.

## 5. 지갑 인증과 API 권한

### 로그인 흐름

1. `POST /v1/auth/challenges`: 서버가 256비트 난수 nonce와 challenge ID를 발급한다. 주소, origin/domain, API audience, network/chain 식별자, 발급/만료 시각, 프로토콜 버전을 서버가 저장한다. TTL 기본안 5분.
2. 화면에 서비스 로그인임을 보이고 지갑의 personal message 서명을 요청한다. 주소 문자열 전달만으로 로그인시키지 않는다.
3. `POST /v1/auth/sessions`: challenge ID와 서명을 받아 **서버가 보관한 정확한 메시지 바이트**로 검증한다. 요청자가 다시 보낸 임의 message를 믿지 않는다.
4. 서명 주소·원본 challenge·만료·네트워크를 검증한 후 nonce를 원자적으로 1회 소비한다. 동시에 두 검증 요청이 와도 세션을 중복 발급하지 않는다.
5. 무작위 opaque 세션 토큰을 발급하고 DB에는 hash만 저장한다. 초기 기본안은 브라우저 메모리의 Bearer 토큰, 30분 만료, 새로고침/만료 시 재로그인이다. logout은 서버 폐기와 클라이언트 상태 초기화를 함께 한다.

Walrus portal 도메인과 API 도메인이 다르면 third-party cookie 차단 문제가 생길 수 있으므로 첫 구현부터 cross-site cookie에 의존하지 않는다. 커스텀 same-site 도메인에서 HttpOnly 쿠키로 바꾸는 것은 별도 ADR로 평가한다. CORS allowlist, CSP, 토큰 로그 마스킹을 적용하고 public portal의 wildcard origin을 허용하지 않는다.

새 dApp Kit는 `@mysten/dapp-kit-react`/core 계열을 사용한다. 현재 공식 문서는 구형 `@mysten/dapp-kit`를 JSON-RPC 전용 legacy로 안내한다. 서명은 Sui SDK의 personal-message 검증을 사용하며 지원하는 wallet signature scheme을 P1 테스트 목록에 명시한다. zkLogin/passkey/multisig를 검증 없이 지원한다고 표시하지 않는다. [dApp Kit](https://sdk.mystenlabs.com/dapp-kit), [Sui 서명 API](https://sdk.mystenlabs.com/sui/cryptography/keypairs)

### 권한과 서명은 분리

- 로그인 세션은 AI 호출자의 identity다. Move 객체 변경에는 사용자 트랜잭션 서명이 별도로 필요하다.
- private vault 읽기는 vault 소유 정책을 확인한다. 캐릭터 생성·수정 job은 요청 시 및 확정 전에 실제 Sui owner/version을 다시 확인한다.
- DB owner cache는 목록 표시용이다. 외부 transfer 이벤트가 늦어져도 이전 소유자가 새로운 자산 변경을 수행하지 못해야 한다.
- 지갑/네트워크 전환 시 세션, 활성 캐릭터, 진행 중 요청, 복호화 캐시를 지운다. 이전 응답이 새 지갑 화면을 덮지 못하도록 요청 scope를 나눈다.
- API 세션, Seal SessionKey, 트랜잭션 서명은 별개다. Seal 세션을 Move 변경 권한처럼 사용하지 않는다.

## 6. Move 객체와 개인 데이터 경계

첫 Move 설계안은 다음과 같다. 이 표는 구현 전 설계이며 아직 `.move` 코드나 package ID를 발급하지 않았다.

| 객체/모듈 | 내용 | 수정·이전 정책 |
|---|---|---|
| `Character` (`key, store`) | schema version, public manifest ref, revision | 소유자가 공개 프로필 수정·외부 이전 가능 |
| `UserVault` (`key`) | owner별 private root ref, revision | 모듈에서 임의 이전 함수를 제공하지 않음. 복구/주소 교체는 별도 흐름 |
| 공개 이벤트 | 생성/공개 버전 변경, actor, ref, revision | 평문 대화·이름·호칭 등 개인 내용을 이벤트에 싣지 않음 |
| Seal 정책 모듈 | vault/정책 ID와 복호화 허용 조건 | 올바른 객체 타입·package·사용자·domain 분리 검증 |

캐릭터의 공개 자산과 개인 vault를 분리한다. **캐릭터를 판매·이전해도 기존 사용자 대화·호칭·개인 사진은 따라가지 않는다.** 새 소유자는 공개 프로필을 받고 자신의 private 설정을 만든다. 이전 사용자는 과거 자신의 대화를 읽을 수 있지만 이전한 캐릭터의 새 owner 권한은 갖지 않는다. 이 경계를 외부 지갑 transfer로도 검사한다.

공개 manifest 변경은 `expectedRevision`으로 낙관적 동시성 제어를 한다. owned object의 버전 충돌도 처리한다. 하나의 전역 shared object에 모든 채팅 쓰기를 모으지 않는다. private root도 사용자/대화 단위 쓰기로 분산하며 여러 탭에서 revision 충돌 시 최신 manifest를 읽고 명시적으로 합친다.

체인에 참조를 쓸 수 있다고 파일 가용성이 자동 입증되지는 않는다. 앱은 blob certification·바이트/hash·포맷을 확인한 뒤 확정한다. Move가 Walrus 인증 객체를 검증할 수 있는 결합 방식은 P2에서 spike로 판단하며, 서버의 `uploaded=true`를 온체인 가용성 증명이라고 부르지 않는다.

testnet UpgradeCap은 별도 개발 지갑에, mainnet은 운영자 일상 서명 키와 분리한 multisig에 둔다. schema/version 변경과 capability 정책을 함께 검토한다. 초기 무조건 immutable 처리도, 운영자 단독의 무제한 교체도 기본값으로 삼지 않는다. [Sui package upgrade](https://docs.sui.io/develop/publish-upgrade-packages/upgrade)

## 7. Walrus 저장·암호화·복구

### 저장 포맷

`schemaVersion`, `kind`, `network`, `appPackage`, `subjectId`, `revision`, `previousRef`, `contentHash`, `createdAt`를 명시한다. canonical 직렬화와 hash 알고리즘을 버전에 고정한다. 암호화 envelope에는 cipher/format version, nonce, policy ID, key-server set/threshold 등 복호화에 필요한 참조를 기록한다. 암호화는 검증된 SDK/라이브러리를 사용하며 자체 암호 알고리즘을 만들지 않는다.

- `CharacterPublicManifest`: 공개 동의한 프로필/이미지 참조.
- `VaultManifest`: 개인 설정, 갤러리, 대화 manifest를 발견할 수 있는 암호화 root.
- `ConversationManifest`: 일반/에피소드 구분, character ID, episode/catalog version, segment 목록, 마지막 sequence.
- `ConversationSegment`: message ID, turn ID, sender, 순서, 시간, 본문; 이전 segment hash 연결. 해시는 무결성 확인이지 AI 출력의 진실성 증명이 아니다.
- `GalleryManifest`: asset ID, blob/quilt ref, MIME, 크기, ciphertext hash, 공개 범위, 선택 상태.

파일은 변경할 때 새 blob/version으로 저장한다. DB id나 제공자의 만료 가능한 URL만 manifest에 남기지 않는다. 크기·MIME·디코딩 한도를 검사하고 제공자 결과 다운로드는 허용한 host로 제한한다. 브라우저에 원본 URL을 그대로 넘겨 영구 저장처럼 취급하지 않는다.

### 비공개 처리

기본은 브라우저에서 암호화/복호화하고 Seal 정책으로 접근을 관리하는 안이다. Seal은 Sui 정책에 기반한 암호화 접근 제어를 제공하지만 키 서버와 정책의 가용성·신뢰 가정은 남는다. mainnet/testnet key-server 지원과 threshold는 P2에서 실제 확인 후 고정한다. [Seal 소개](https://docs.sui.io/sui-stack/seal), [Seal 시작](https://docs.sui.io/sui-stack/seal/getting-started)

채팅 시 브라우저가 복호화한 최근 문맥을 TLS로 AI API에 보내고 응답을 받아 암호화한다. 서버/AI 제공자는 그 실행 동안 평문을 볼 수 있으므로 **AI 제공자까지 포함한 E2EE라고 표현하지 않는다.** 로그·APM·job payload에는 평문 문맥을 저장하지 않는다. 이미지 결과도 제한된 임시 보관 후 브라우저 암호화·업로드를 기본으로 한다. 서버 측 암호화가 필요한 무인 작업은 P2에서 공개 암호화 material만으로 가능한지 검증하고 별도 worker 경계로 결정한다.

초기에는 서명에서 대칭 키를 임의 파생하지 않는다. 지갑의 비밀키/seed를 서버에 요구하지 않는다. 지갑 분실 시 서버 이메일 재설정으로 복구할 수 있다고 약속하지 않는다. 사용자가 보관하는 암호화 export와 주소 교체/복구 정책을 P2 인수 조건에 포함한다. Seal 장애 때 평문 저장으로 fallback하지 않는다.

### 업로드·확정·수명

1. 파일 준비/암호화 → 업로드 요청/등록 → 저장 노드 전송 → 인증 확인 → 다시 읽어 hash 검증 → Sui manifest 참조 갱신 → chain 확인 → 인덱스 반영.
2. `blobId`, 저장 소유 `Blob` object ID, 인증 transaction, `endEpoch`, deletable 여부, 바이트 크기, 소유자, 관련 job ID를 기록한다.
3. `이미지 생성 완료`, `Walrus 저장 완료`, `Sui 반영 완료`를 별도 상태로 표시한다. 서명 취소는 AI 생성 실패가 아니다.
4. 저장 기한은 사용자에게 보이고 갱신 scheduler를 둔다. 종료 epoch를 현재 network 상태로 판단하며 날짜 환산값을 영구 상수로 두지 않는다.
5. 최초 운영비는 서비스가 한도 내 부담하고, 사용자가 직접 연장/다른 uploader로 이관할 수 있는 경로도 제공한다. 저장 Blob 소유권도 사용자에게 넘기는 정책을 P3에서 실제 연장·삭제 호출과 함께 검증한다.
6. deletable은 모든 복사본 삭제나 비밀 보장을 뜻하지 않는다. 개인 데이터는 애초에 암호문으로 저장한다. 참조 제거·키 정책 폐기·스토리지 종료의 의미를 구분한다.

Walrus의 공개 접근과 epoch 기반 보관은 설계의 전제다. testnet 장기 지속성을 운영 보장으로 사용하지 않는다. [Walrus operations](https://docs.wal.app/docs/system-overview/operations.html)

## 8. AI 작업, 비용, 체인 거래의 일관성

HTTP 요청 안에서 외부 이미지 생성과 DB 트랜잭션을 함께 오래 유지하지 않는다. 처음에는 Postgres의 job/outbox 테이블과 lease를 사용해 API와 별도 worker 프로세스를 운영한다. Redis/BullMQ는 처리량 필요가 입증되면 추가한다. DB queue도 영속성·lease 갱신·최대 시도·복구를 직접 구현/검증해야 하므로 '무료로 단순해지는 선택'으로 보지 않는다.

```text
accepted → reserved → generating → generated → awaiting-client-encryption
  → uploading → certified → awaiting-user-signature → submitted → confirmed
                                              └→ cancelled / expired
          실패 → retryable / unknown-provider-result / terminal-failure
```

| 실패/경쟁 지점 | 처리 |
|---|---|
| 같은 생성 요청 중복 | `(actor, operation, idempotencyKey)` 유일 제약, input hash가 다르면 409 |
| 제공자 요청 timeout | job ID/receipt 조회. 제출 성공 여부 모르면 자동으로 유료 재제출하지 않음 |
| 4장 중 일부 성공 | 장별 asset ID와 성공/실패, 부분 완료 상태. 성공분을 다시 생성하지 않음 |
| 생성 후 브라우저 종료 | 임시 결과 TTL, 재로그인 후 재개. TTL 경과 시 미완료 이유와 재생성 비용 구분 |
| 업로드 성공 후 서명 취소 | blob과 생성 결과를 보관하고 같은 결과로 재확정 가능. 중복 생성/업로드 금지 |
| tx 제출 timeout | 미리 계산/저장한 digest로 결과 조회. 새 tx부터 보내지 않음 |
| 소유권/버전 변경 | 최신 owner/revision 확인 후 거절·재구성. 이전 소유자 job이 최신 자산을 덮지 못함 |
| worker 강제 종료 | lease 만료 후 다른 worker가 provider/chain receipt에서 이어감 |
| DB commit 실패 | outbox와 단계별 유일 키로 재처리. chain/Walrus를 rollback했다고 표시하지 않음 |

생성 quota는 예약→성공 확정 또는 실패 해제로 원장을 남긴다. 체인 확정이 취소돼도 이미 성공한 유료 생성 비용까지 자동 환불되는 정책으로 두지 않는다. 기존 '이미지 생성 실패 시 미차감' 기준은 유지하며, 저장·서명 실패의 비용 정책은 별도다. 실제 SUI/WAL 지출과 내부 quota를 섞지 않는다.

가스 후원은 초기 UX 기본안이다. 다만 사용자가 서명한 **동일한 transaction bytes**를 후원하고, package/function/receiver/object/input/budget/expiry를 검사한다. nonce 로그인 서명으로 자산 변경을 대행하지 않는다. wallet private key는 서버에 두지 않는다. 후원 중단 시 읽기는 계속 가능하고 사용자가 자신의 gas로 승인된 작업을 실행할 수 있게 한다. [Sui sponsored transactions](https://docs.sui.io/develop/transaction-payment/sponsor-txn)

Walrus 저장은 WAL 비용과 SUI gas가 함께 필요하다. 앱 소유 publisher가 저장비를 내고 결과 Blob 객체를 사용자 주소로 전달하는 안부터 검증한다. 이는 Sui 자산 갱신의 가스 후원과 별도 경로다. publisher를 공개 무인증으로 노출하지 않고 크기·기간·호출 수·지출을 제한한다. 동시 uploader는 소유 gas/storage 객체 충돌을 피하도록 signer/pool을 관리한다. [Walrus sponsored uploads](https://docs.wal.app/docs/sponsored-uploads.html)

## 9. 채팅 저장과 지갑 확인 횟수

매 메시지에 지갑 팝업을 띄우지는 않는다. 대화는 브라우저의 암호화된 IndexedDB 임시 기록으로 즉시 반영하고, 정해진 segment 크기로 묶어 Walrus에 저장한다. 사용자가 '보관 확정'할 때 최신 manifest root를 Sui에 반영한다. 기본 초안은 최대 20턴 또는 대화 종료 시 보관 제안이다.

화면은 `로컬 임시`, `업로드됨/아직 체인 미확정`, `보관 확정`을 구분한다. 서버·브라우저가 모두 사라져도 복원할 수 있다는 보장은 **체인 확정된 revision까지만** 제공한다. 미확정 데이터 손실 위험이 제품 요구에 맞지 않으면 scoped delegation을 별도 Move 기능으로 설계한다. 평범한 로그인/Seal 세션 키가 임의 tx 자동 서명을 허용한다고 가정하지 않는다.

대화 GET은 읽기만 수행하고 첫 인사는 명시적 start 동작에서 1회 생성한다. USER/AI를 turn ID로 묶어 재시도 중복을 방지한다. 호칭·설정은 매 생성 요청의 확정된 설정 version에서 프롬프트를 재구성한다. 에피소드 카탈로그·진행·스타터·대화는 같은 turn 규칙을 사용하면서 일반 대화와 분리한다.

## 10. 인덱서와 서비스 독립 복원

SDK는 `@mysten/sui` 2 계열의 gRPC client를 기본으로, 검색용 GraphQL을 필요 시 사용한다. 구형 JSON-RPC 기반 라이브러리를 새 기반에 넣지 않는다. 정확한 SDK·Move·Walrus 버전은 P1/P2 연결 시 lockfile 및 network manifest에 고정한다. [SuiGrpcClient](https://sdk.mystenlabs.com/sui/clients/grpc), [dApp Kit migration 안내](https://sdk.mystenlabs.com/dapp-kit)

- 체크포인트 cursor와 이벤트/객체 projection을 하나의 DB 트랜잭션에 반영한다. `(network, txDigest, eventIndex)` 등으로 중복 적용을 막는다.
- 객체의 외부 transfer/delete/wrap도 반영한다. 앱 전용 event만 읽으면 외부 지갑 이전을 놓칠 수 있으므로 checkpoint의 변경 객체/owner 조회를 포함한다.
- 처리 지연·재시작·RPC 전환·page cursor를 검사한다. historical backfill은 보관 범위가 충분한 archival/checkpoint source가 필요하다.
- API 응답에는 반영된 checkpoint/revision을 포함한다. tx 성공 직후에는 해당 digest의 결과를 우선 확인하고 '인덱싱 대기'를 표시한다.
- 공개 projection은 새 DB에 backfill 가능해야 한다. private 내용은 indexer가 복호화하지 않는다.
- 복원 클라이언트는 지갑 소유 `Character`/`UserVault` 객체 발견 → root ref 조회 → Walrus 다운로드 → Seal 승인 → schema/hash 검사 → 화면/파일 export 순서로 동작한다. 미지원 schema는 원본 암호문 export를 허용하고 파괴적 자동 변환을 하지 않는다.

## 11. 배포 인프라 변경안

| 현재/과도기 | 새 구성 | 적용 시점 |
|---|---|---|
| 프론트에 고정된 Render backend | 명시적 network/API 설정, 원격 기본 fallback 제거 | 제거 완료; 새 `/v1` 연결 P1~P4 |
| Next 서버와 이전 AI API | 정적 Next export → Walrus Sites | export 기반 P0, 실제 게시 P5 |
| Spring API | Fastify API 컨테이너 | 기반 P0, 기능 P1~P4 |
| MySQL/JPA | 관리형 Postgres + 명시적 SQL migration | P1. 기존 데이터 이관 없음 |
| `@Async` 메모리 작업 | 별도 Node worker + DB jobs/outbox | P3 |
| DB가 owner/파일 기준 | Sui owner/ref + Walrus 파일 + DB projection | P2~P4 |
| 제공자 URL만 보관 | TTL 임시 저장 → 암호화/검증 → Walrus | P3 |
| 단일 배포 로그 | job/digest/blob/checkpoint 연관 로그·지표 | P3 이후 |

Postgres 선택은 새 서비스이므로 기존 MySQL 제약에 묶이지 않고 작업 원장·JSON metadata·인덱스를 함께 운영하려는 설계 판단이다. 현재 설치하거나 DB를 생성한 상태가 아니다. 초기에는 Postgres 1개, API 1개, worker 1개, indexer 1개로 시작한다. 같은 이미지의 다른 entrypoint를 사용해 배포 복잡성을 줄인다. Kubernetes·Kafka·자체 chain 노드는 초기 범위에서 제외한다.

환경은 local / testnet staging / mainnet production으로 분리한다. network manifest에는 chain ID, RPC/GraphQL, Move original/current package ID, object/registry ID, Walrus network/endpoint, Seal policy/server set, site object ID, schema version을 기록한다. 서로 다른 네트워크의 조합은 시작 단계에서 거절한다. 지갑 선택 네트워크와 설정도 교차 검사한다.

비밀은 배포 secret manager에 보관한다. AI 키, DB URL, sponsor/publisher signer, UpgradeCap 관리자는 역할을 분리한다. 가능하면 지원되는 외부 signer/KMS를 사용하되 사용할 Sui 서명 방식의 호환성을 검증한다. public build 변수에 비밀이 들어가지 않도록 export 산출물을 검사한다.

현재 추가한 Dockerfile은 **API 기반만** 실행한다. Compose도 이에 맞춰 API만 정의했다. DB/worker/indexer를 연결한 듯한 빈 서비스를 띄우지 않는다. P1부터 실제 구현과 함께 늘린다. Docker 이미지 digest 고정·권한/자원 한도·SBOM·취약점 검사는 배포 환경 확정 시 넣는다.

CI는 lockfile 설치 → 타입 검사 → API 테스트 → 일반/정적 빌드 → 컨테이너 빌드와 별도 기존 Spring/E2E 비교를 수행하도록 작성했다. Move 도입 후 unit/권한/업그레이드 테스트를 추가한다. testnet 업로드/서명 smoke는 전용 제한 지갑을 쓰는 별도 job으로 두며 PR의 비신뢰 코드에 운영 키를 주입하지 않는다. 현재 원격 저장소·배포 계정은 만들지 않았다.

## 12. 비용·관측·장애 대응

아래 수치는 견적이 아닌 용량 계산용 가정이다. 100 DAU, 1인 20턴/일, 포토부스 20장/일, 신규 캐릭터 10개×초상 4장/일, 이미지 2MB/장으로 잡으면 이미지 약 120MB/일이다. 대화는 1턴 4KB 가정 시 8MB/일이다. 합계 약 3.84GB/30일이며 버전 이력·암호화·복제/인코딩·부분 실패·임시 데이터는 추가다. WAL 청구량을 raw 용량과 같다고 계산하지 않는다.

월 비용 모델은 `API/worker/indexer + Postgres/백업 + 임시 파일 + 관측 + RPC/portal + LLM 토큰 + 이미지 생성 + WAL 저장/연장 + SUI gas`이다. 토큰 가격·모델·제공자 요금은 구현 시 실측 견적에 넣는다. 세 가지 별도 한도: 사용자별 생성 quota, sponsor SUI 지출, publisher WAL 지출. 지갑 생성이 싸므로 주소별 rate limit만으로 Sybil 남용을 막았다고 보지 않는다. 베타 초대/전역 budget도 둔다.

| 관측 항목 | 조치 |
|---|---|
| API 오류·p95·세션 실패 | 원인별 오류 코드, 의존 서비스별 timeout, 로그에 평문/서명/토큰 금지 |
| job 지연·lease·unknown 결과 | provider receipt 확인, dead-letter 수동 재개 도구 |
| tx 실패·pending·gas 객체 충돌 | digest 확인, gas pool 분리, budget 회로 차단 |
| indexer checkpoint lag | 경고 및 stale 표시, fresh 권한 확인 실패 시 쓰기 거절 |
| blob 인증·hash 오류·만료 근접 | gateway 대체 조회, 연장 재시도, 만료 알림 |
| Seal quorum 접근 실패 | 비공개 읽기 장애 표시, 암호문 export 유지 |
| SUI/WAL 잔액·일별 소진 속도 | 임계치 경고, 자동 충전 한도, 후원 중단 모드 |

Postgres는 PITR 백업과 restore drill을 한다. 목표 초안은 운영 원장 RPO 15분/RTO 4시간이고 제공자·예산 선정 후 확정한다. 확정 자산은 API 종료 복원 시험으로 따로 검증한다. chain 확정 상태는 DB snapshot을 복원했다고 과거로 되돌리지 않는다. 새 chain 상태에서 projection을 재동기화한다.

## 13. 구현 순서와 통과 조건

아래 공수는 한 명이 개발·검증하는 작업일의 초안이며 외부 서비스 승인·사용자 검토·감사 대기는 제외한다. 단계별 결과를 본 뒤 재산정한다.

| 단계 | 작업 | 산출물/통과 조건 | 선행 | 예상 |
|---|---|---|---|---|
| P0 | 모노레포·경로 분리·TS API 기반·정적 export | 키 없이 build, 타입/API 검사, 이전 기능 E2E 유지 | 없음 | 이번 실행 |
| P1 | wallet challenge/session, Postgres migration, 새 지갑 UI | 재생·만료·주소/도메인/네트워크 오용 거절, 지갑 전환 격리 | P0 | 3~5일 |
| P2 | Move Character/Vault + Walrus/Seal 왕복 spike | 두 지갑 권한, 외부 transfer, 암호화 복원, schema/revision 충돌, 키 서버 장애 | P1 | 4~7일 |
| P3 | 캐릭터/사진 세로 흐름, jobs/outbox, storage sponsor | 생성→암호화→저장→사용자 확정→새 브라우저 갤러리, 중단/재개/부분 성공 | P2 | 5~8일 |
| P4 | 채팅·에피소드·설정·마이페이지 이전 | 첫 인사 1회, 호칭 반영, turn 재시도, segment 복원, Spring 호출 0 | P3 | 5~8일 |
| P5 | checkpoint indexer, API 독립 복원, Walrus Sites 게시 | DB/API 중지 후 읽기·export, portal deep link, 지갑 origin 검증 | P3/P4 | 3~5일 |
| P6 | 운영·후원 비용·갱신·복구·출시 검증 | 지출 한도, mainnet 구성 검토, restore drill, 취약점/Move 검토 | P5 | 4~7일 |

P1~P6 합계 24~40 작업일, 대략 5~8주 범위다. 단순 화면 데모는 이보다 먼저 가능하지만 복원·암호화·소유 이전·장애 복구를 빼고 '완전 전환'이라고 하지 않는다.

첫 번째 세로 구현은 **지갑 A가 캐릭터 하나를 만들고 사진 한 장을 비공개로 보관 → 브라우저를 비움 → 같은 지갑으로 복원 → 지갑 B는 복호화 실패**다. 모든 Spring endpoint를 먼저 TS로 복사한 뒤 체인을 붙이지 않는다. 이 세로 흐름에서 소유·저장·암호화·작업 경계를 검증하고 나머지 기능을 옮긴다.

### 기능별 이전 범위

| 기존 기능/근거 | 새 동작 | 단계 |
|---|---|---|
| `apps/web/lib/api.ts` 데모 로그인 | `/v1/auth/*`, wallet scoped state, demo 제거 | P1 |
| `CharacterService` interview/compile | AI interview/draft job → 저장 및 mint/update tx | P3 |
| `app/create/page.tsx` 폴링/느낌/선택 | 입력 revision 확정 후 생성, job 상태 폴링, 실제 재생성 명령 | P3 |
| `CharacterPromptBuilder`, call-name | private 설정 version에서 프롬프트 생성 | P4 |
| `ChatService`, `EpisodeService` | read-only 조회, 명시적 start, versioned turn/segment | P4 |
| `PhotoService`, `PortraitGenerationService` | 장별 job·재시도·정산, 생성과 저장 분리 | P3 |
| `gallery`, `home`, `chatlist` | public projection + 개인 vault, 전체 대화 조회 제거 | P4/P5 |
| `my` 포인트·이메일 | 지갑 주소·quota·보관 상태 | P4 |
| `train-face`, Soul ID | 현재 연결 불완전. P3 조사 후 포함/보류를 명시 | 별도 기능 판단 |
| community/subscription | 현재 표시용임을 유지. 토큰·거래·구독 결제 미포함 | 후속 |

## 14. 출시 전에 반드시 재현할 시나리오

- 지갑 A가 B의 캐릭터를 수정하거나 B의 vault를 복호화하지 못한다. DB owner를 위조해도 같다.
- 캐릭터를 외부 지갑에서 이전한 뒤 이전 사용자의 새 수정이 거절되고, 사적 대화는 새 소유자에게 노출되지 않는다.
- challenge 재사용·동시 소비·다른 origin·만료·다른 network·미지원 서명을 거절한다.
- 생성 timeout/worker 종료/중복 요청으로 유료 생성과 quota가 중복 반영되지 않는다. 결과 불명은 자동 성공/실패로 단정하지 않는다.
- Walrus upload 완료 후 tx 취소, tx 성공 후 DB 장애, 여러 탭 revision 충돌에서 동일 결과로 재개한다.
- 만료 전 연장과 갱신 비용 부족을 검증하고, 만료·공개 복사본·비밀키 분실의 한계를 UI에 정확히 표시한다.
- API/DB를 중단하고 새 브라우저에서 확정 캐릭터·사진·일반/에피소드 대화를 읽고 export한다. sponsor가 없어도 읽기는 가능하다.
- portal/CDN 캐시가 오래된 클라이언트를 줄 때 미지원 schema/package를 거절하고 업데이트 경로를 안내한다.

## 15. 아직 확정하지 않은 선택과 기본안

| 결정 | 기본안 | 결정 시점 |
|---|---|---|
| 첫 공개 수준 | 소규모 testnet 베타 | P1 시작 전 목표 확인 |
| 사진 공개 범위 | private, 프로필 공개만 명시적 선택 | P2 |
| Seal quorum/서버 운영자 | 환경별 공식 지원 목록에서 독립 운영자 조합 검증 | P2 spike |
| private vault 주소 복구 | 지갑 기반, 초기 암호화 export, 자동 이메일 복구 없음 | P2 |
| 무인 자동 보관 | 초기 수동 root 확정, scoped delegation은 후속 | P4 UX 검증 |
| 인프라 제공자·지역·월 상한 | 관리형 Postgres와 상시 컨테이너, 실제 사용량으로 비교 | P3 부하 실측 후 |
| mainnet 첫 보관 기간·갱신 주체 | 서비스 한도 내 초기 부담, 사용자 연장 경로 | P3/P6 |

이 선택들은 현재 기반 작업을 막지 않는다. 다만 개인 데이터 업로드, 실제 자산 배포, 비용 발생 환경을 구성할 때는 구현된 결과와 구체적인 설정을 기준으로 확정한다.
