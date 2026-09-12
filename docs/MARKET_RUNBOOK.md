# 로컬 실행과 검증

기존 Next.js 화면 → 통합 백엔드(Fastify 인증/gateway → 내부 Spring) → PostgreSQL이 제품의 기본 흐름이다. 마켓 화면은 `/community`, 제작은 `/create`, 구매 후 개인 대화는 `/chat`, 설정·기억은 `/character`를 사용한다. 새 `/market`·`/viewer` 화면은 현재 코드에 없다. 기획 범위는 [MARKET_PIVOT.md](MARKET_PIVOT.md), 실제 완료/미완료와 증거는 [배포 리뷰](../infra/DEPLOYMENT_REVIEW.md)를 따른다.

## 제품 전체 로컬 실행

Node 24, npm 11, Docker가 필요하다. 호스트에서 Spring을 직접 빌드할 때에는 Java 21을 사용한다. 최초 한 번 설정 예시를 복사하고, 기존 파일이 있으면 덮어쓰지 않는다.

```powershell
npm.cmd ci --ignore-scripts
Copy-Item apps/api/.env.example apps/api/.env.local
Copy-Item apps/web/.env.local.example apps/web/.env.local
```

API 파일에는 아래 서버 설정을 입력한다. Compose가 참조할 값은 `--env-file`로 명시한다.

```powershell
docker compose --env-file apps/api/.env.local -f infra/compose.yaml up --build
```

다른 터미널에서 `npm.cmd run dev:web`을 실행한다. 웹은 `http://127.0.0.1:3000`, API는 `http://127.0.0.1:3001`이다. `localhost`는 별도 Origin이므로 혼용하지 않는다. Spring은 API 컨테이너 내부 `127.0.0.1:18080`에서만 열고 별도 공개 포트는 만들지 않는다. DB는 PostgreSQL 17의 named volume에 보존한다.

API와 Spring이 같은 PostgreSQL을 사용해야 지갑 사용자·공통 AI 한도·원래 제품 흐름을 함께 검증할 수 있다. API는 `public` schema의 멱등 DDL, Spring은 `everyday` schema의 Flyway와 Hibernate validate를 사용한다. 이미 적용된 migration은 수정하지 않는다.

## 설정별 적용 범위

| 설정 | 필요한 기능 |
| --- | --- |
| `DATABASE_URL`, `WEB_ORIGINS`, `API_AUDIENCE` | 운영 API의 DB·인증. Compose는 내부 DB URL과 로컬 Origin 기본값을 제공한다. |
| `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD` | 원래 제품 기능. Compose가 같은 DB 설정을 제공하고 supervisor가 양방향 loopback 주소를 지정한다. Railway 설정은 [배포 가이드](../infra/DEPLOYMENT.md)를 따른다. |
| `ANTHROPIC_API_KEY` | 원래 생성·대화 및 Node 마켓 미리보기. 통합 백엔드의 두 프로세스에서 사용한다. |
| `HIGGSFIELD_API_KEY`, `HIGGSFIELD_API_SECRET` | Spring 초상·사진·Soul 연동. 서버 전용이며 웹에 전달하지 않는다. |
| `AI_ENDPOINT`, `AI_MODEL`, `AI_API_KEY` | Node에서 별도 Chat Completions 호환 제공자를 선택할 때만 세 값 모두 사용한다. Spring Claude 설정을 대체하지 않는다. |
| `SUI_MARKET_PACKAGE_ID`, 웹 `NEXT_PUBLIC_SUI_PACKAGE_ID` | 같은 실제 testnet 배포를 가리켜야 한다. 현재 ID는 [배포 기록](../contracts/everyday/deployments/testnet.json)에 있다. |
| `SUI_OPERATOR_KEY`, `SEAL_SERVERS_JSON`, `SEAL_THRESHOLD` | 서버의 상품 암복호화·정책 실행. 서로 다른 키 서버 2개 이상, committee 서버는 aggregatorUrl 포함. |
| `WALRUS_PUBLISHER`, `WALRUS_AGGREGATOR`, `WALRUS_EPOCHS` | 실제 상품 저장·조회. 기본 보관 요청은 7 epochs이며 무기한 보관이 아니다. |
| `MEMWAL_DELEGATE_MASTER_KEY`, `MEMWAL_SERVER_URL`, `MEMWAL_PACKAGE_ID`, `MEMWAL_REGISTRY_ID` | 승인 기억 저장·검색. master는 32바이트 hex 비밀값, package/registry는 실제 relayer와 대조한다. |
| `AI_DAILY_LIMIT`, `AI_GLOBAL_DAILY_LIMIT`, `MARKET_PREVIEW_TURNS` | 기본 사용자 50회/전체 100회 일일 요청 한도, 상품별 미리보기 3턴. 금액 기준 비용 상한은 아니다. |
| `AGENT_GIFTS_ENABLED` | 기본 0. Node 선물 코드만 활성화하며 Spring 채팅 트리거·상품 제공까지 연결해 주는 설정은 아니다. |

전체 예시는 [API 환경변수](../apps/api/.env.example)와 [웹 공개 환경변수](../apps/web/.env.local.example)에 있다. 웹의 `NEXT_PUBLIC_API_BASE`는 브라우저가 접근하는 API Origin이고 변경 후 재빌드한다. 키·서명·delegate 비밀값은 API/Spring 환경이나 비밀 저장소에만 둔다. production에서는 baseline profile과 `NEXT_PUBLIC_LEGACY_BASELINE`을 사용하지 않는다.

`npm.cmd run dev:api:local`은 별도 PGlite 개발 API다. `dev:api:configured`는 `apps/api/.env.local`을 명시적으로 읽는 같은 개발 API다. Spring의 PostgreSQL과 공유되는 구성이 아니므로 두 명령만으로 원래 제품 전체를 실행했다고 판단하지 않는다. 일반 서버는 프로세스 환경을 사용하며 자동 dotenv 로딩을 하지 않는다.

## 기존 화면에서 확인할 흐름

1. 로그인 후 홈에서 직접 캐릭터를 만든다. 인터뷰·컴파일·사진 느낌·초상 선택은 기존 생성 화면을 사용한다. 실제 AI·이미지 키가 필요하다.
2. 개인 채팅으로 시험하고 캐릭터 설정을 수정한 뒤 같은 설정 화면에서 마켓 등록을 진행한다. 상품에는 작가 설정·가상 예시·시나리오만 포함한다. 개인 대화와 호칭은 포함하지 않는다.
3. 다른 사용자로 커뮤니티의 캐릭터를 선택해 미리보기 한도를 확인한다. 실제 testnet 이용권을 구매하면 본인 전용 사본을 가져와 기존 채팅·에피소드 화면을 사용한다. 기존 이용권이 있으면 다시 결제하지 않는다.
4. 캐릭터 설정에서 본인 기억 계정 연결에 동의하고 필요한 위임을 서명한다. 직접 확인한 항목만 저장한다. 접수 `202`와 저장 완료 `done`을 구분한다.
5. 다른 환경에서 같은 사용자로 로그인하고 같은 구매 권한·본인 기억을 확인한다. 다른 사용자에게 대화나 기억이 넘어가면 안 된다. API 활용 중지는 온체인 delegate 철회나 분산 사본 삭제를 의미하지 않는다.

이 목록은 확인 절차이며 현재 브라우저 시연을 완료했다는 보고가 아니다. 두 환경은 기존 웹을 그대로 재사용한다. 개발 서버 둘이 같은 `.next`에 쓰지 않도록 `npm.cmd run build` 후 별도 터미널에서 `npm.cmd run start:market`, `npm.cmd run start:viewer`를 실행한다. 각각 포트 3000/3002의 같은 홈·커뮤니티·캐릭터 화면이다. `WEB_ORIGINS`에 두 Origin을 추가하고 각 Origin에서 별도 로그인한다. 같은 API를 사용하는 두 환경 검증은 독립 사업자 서비스 간 이식성 전체를 증명하지 않는다.

## API와 재시도 경계

공개 설정·카탈로그·Listing 정보 조회 외의 사용자 기능은 Origin과 Bearer 세션을 검사한다. 카탈로그의 미리보기 요약 캐시는 공개지만 `/listings/:listingId/preview` 조회 자체는 인증이 필요하다. 상세 DTO는 [공통 계약](../packages/contracts/src/index.ts), 실제 경로는 아래 소스를 기준으로 한다.

| 소스 | 담당 경로/역할 |
| --- | --- |
| [market.ts](../apps/api/src/market.ts) | `/v1/market/listings`, 접근·구매 거래, 개인 기억 참조 |
| [market-flow.ts](../apps/api/src/market-flow.ts) | 제작자·Listing 거래, 패키지 게시·복호화, 미리보기/라이선스 turns, 선물 조회 |
| [publications.ts](../apps/api/src/publications.ts) | `/v1/me/publications`: 게시 작업 식별자와 서명 단계의 재접속·동시 탭 복구 |
| [memory.ts](../apps/api/src/memory.ts) | 본인 memory-account, remember/job/recall |
| [spring.ts](../apps/api/src/spring.ts) | 인증된 `/api/*` 제품 gateway와 비용 한도 |

생성·대화·기억 저장·사진 등 작업별 요청 ID와 입력 hash를 사용하는 경로에서는 같은 ID로 다른 입력을 보내면 거절한다. 단순 조회나 모든 거래 준비 요청에 UUID가 필요한 것은 아니다. 구매는 거래 digest만 믿지 않고 정확한 License 객체의 package·owner·buyer·listing을 확인한다. 체인 실패 시 접근을 허용하지 않는다.

외부 호출 결과가 불확실하면 새 요청으로 자동 재실행하지 않는다. 서명된 거래가 있으면 동일 bytes/digest를 조회하고, 공급자의 명시적인 `notFound`만 동일 서명 제출의 근거로 사용한다. 미리보기 예약은 실패해도 자동 반환하지 않는다. MemWal namespace는 검색 범위이며 계정 delegate의 권한을 캐릭터 단위로 축소하지 않는다.

## 검증 명령과 증거 수준

```powershell
node infra/check-docs.mjs
npm.cmd run check:backend
npm.cmd run test:unit --workspace @everyday/web
npm.cmd run build
apps/api/spring/gradlew.bat -p apps/api/spring test bootJar --no-daemon
node infra/test-spring.mjs
```

Move 검사는 `SUI_BIN`, 로컬 고정 Windows CLI, PATH 순으로 실행 파일을 찾는다. 기준 버전은 `testnet-v1.79.0`이다. 한글 Windows 경로에서 Gradle 문제가 발생하면 Java 21의 `JAVA_HOME`을 확인하고 `-Dorg.gradle.jvmargs=-Dfile.encoding=COMPAT`을 인자로 전달한다.

- 단위/통합 테스트: 권한·격리·요청 중복·DB 제약·비용 경쟁을 검사한다. `test-spring.mjs`의 PostgreSQL·인증·gateway는 실제이고 AI·이미지·마켓 응답은 fixture다.
- `node infra/verify-market-api.mjs`: 보존된 전용 testnet 계정과 기존 검증 데이터를 실제 Sui/Seal/MemWal로 읽는다. DB는 별도 PGlite이며 AI·이미지 호출이나 신규 거래·업로드는 하지 않는다.
- `npm.cmd run probe:testnet`: 네트워크/relayer의 상태와 배포 정보를 조회한다. health 성공은 거래·기억 저장 성공이 아니다.
- 브라우저 테스트는 이번 작업에서 실행하지 않는다. [과거 비교 기록](history/P0_VALIDATION.md)은 현재 UI 시연의 증거가 아니다.

## testnet 게시와 실제 저장 검증

현재 v2는 이미 게시되어 있다. [배포 기록](../contracts/everyday/deployments/testnet.json), [정산·저장 검증](../contracts/everyday/deployments/testnet-verification.json), [기억 검증](../contracts/everyday/deployments/memory-verification.json), [운영 검증](../contracts/everyday/deployments/railway-verification.json)을 먼저 확인한다. 오래된 `npm run deploy:testnet` bootstrap 명령은 현재 v2의 재확인 절차가 아니다.

실제 재확인/게시 도구는 `node infra/deploy-testnet.mjs --execute --deployment-state market-testnet-v2`다. 기존 키·서명 상태와 소스 hash를 대조하며 소스가 달라지면 자동으로 새 배포를 만들지 않는다. `.local-tools/market-testnet-v2`의 키와 서명 복구 파일은 삭제하지 않는다.

`node infra/verify-market-testnet.mjs --execute --with-memory`는 실제 testnet 거래와 저장 비용이 발생할 수 있는 도구다. `--seed-market`은 시드 게시도 수행한다. 일반 코드 회귀 검사에 섞지 않는다. 이미 게시한 10명만 API DB에 등록하려면 [배포 가이드](../infra/DEPLOYMENT.md)의 `register-market-seed.mjs`를 사용한다. 현재 운영 카탈로그 등록은 완료했다.

P1은 별도 미완료 범위다. Move 금고 집행 검증과 Node 선물 실행/복구 코드가 있지만 기존 Spring 채팅의 트리거·실제 상품 제공·채팅 영수증은 아직 연결하지 않았다. 일반 시드 상품의 allowlist는 비어 있고 한도는 0이다. operator 일반 잔액은 가스용이고 정책 적용 지출은 Listing 금고에서만 나온다.
