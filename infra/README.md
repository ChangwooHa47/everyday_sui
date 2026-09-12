# 인프라 도구 안내

운영은 [Railway 배포 가이드](DEPLOYMENT.md), 검증 결과·미완료 항목은 [배포 리뷰](DEPLOYMENT_REVIEW.md)를 따른다. 로컬 실행 설정은 [마켓 실행 가이드](../docs/MARKET_RUNBOOK.md)에 있다.

현재 저장소의 배포 구성은 웹 하나, 단일 TypeScript/Node 백엔드 하나, PostgreSQL이다. 기존 제품 기능과 Web3 SDK가 같은 프로세스에서 실행하며 Java·내부 HTTP gateway·이중 DB 풀이 없다. PostgreSQL 연결 풀은 최대 10개다. 기존 Spring/Flyway DB의 데이터와 적용 이력을 그대로 쓰는 로컬 전환 검사를 통과했다. 새 런타임의 Railway 반영 상태는 배포 리뷰의 최신 기록을 따른다. 실제 자원 사용량이나 요금 감소는 별도 측정 없이 보장하지 않는다.

| 파일 | 역할과 실행 범위 |
| --- | --- |
| [compose.yaml](compose.yaml) | PostgreSQL 17 + Node 백엔드. 웹은 별도 개발 서버. DB/API는 로컬 호스트 5432/3001에 노출한다. |
| [Dockerfile.api](Dockerfile.api), [Dockerfile.web](Dockerfile.web) | 저장소 루트 context로 빌드하는 백엔드·웹 이미지. API는 Node만 실행한다. |
| [제품 SQL](../apps/api/migrations), [migration 실행기](../apps/api/src/product/migrations.ts) | 기존 SQL V1–V11과 Flyway 이력·checksum을 확인한다. 이미 적용된 SQL이나 데이터를 다시 생성하지 않는다. |
| [check-docs.mjs](check-docs.mjs) | Git 관리 Markdown의 UTF-8·충돌 표시·로컬 링크·문서 앵커 검사. 외부 사이트의 내용이나 실행 성공을 증명하지 않는다. |
| [test-product.mjs](test-product.mjs) | `node --import tsx infra/test-product.mjs`: 별도 Docker PostgreSQL + 실제 서명 인증 + TypeScript 제품 통합 검사. AI·이미지·마켓 응답은 fixture. |
| [smoke-deployment.mjs](smoke-deployment.mjs) | 실제 API/web 이미지의 로그인·제품 조회·DB 장애 복구·정상 종료·재시작과 API의 단일 Node 실행을 검사한다. 임시 로컬 컨테이너만 사용한다. |
| [deploy-testnet.mjs](deploy-testnet.mjs) | 전용 키·보존된 서명 상태를 사용하는 testnet 게시/재확인. `--execute --deployment-state market-testnet-v2`가 현재 상태 경로다. |
| [verify-market-testnet.mjs](verify-market-testnet.mjs) | 실제 거래·유료 저장·기억 검증. `--execute` 필수이며 일반 회귀 테스트에 포함하지 않는다. |
| [verify-market-api.mjs](verify-market-api.mjs) | 별도 PGlite와 실제 Sui/Seal/MemWal 조회를 두 Origin에서 확인. 기존 전용 계정/검증 데이터가 필요하다. |
| [register-market-seed.mjs](register-market-seed.mjs) | 이미 게시된 시드 상품을 지정 API 카탈로그에 등록. `--execute`로 DB를 변경하며 새 결제·업로드는 하지 않는다. |
| [market-seed.json](market-seed.json) | 원래 이미지 자산을 사용하는 가상 성인 캐릭터 10명의 작가 설정 |

Compose의 기본 DB 암호는 로컬 개발용이다. 운영 키는 서비스 비밀 변수에 두고, 개인 키·서명·복구 상태는 공개 기록에 넣지 않는다. PostgreSQL은 named volume을 사용하므로 데이터 삭제 목적이 아니면 `down --volumes`를 실행하지 않는다.

`npm.cmd run dev:api:local`은 PGlite에 같은 제품 SQL과 API를 실행한다. 데이터는 Docker PostgreSQL·운영 DB와 별개이며 공급자 호출에는 실제 설정이 필요하다. 자동 Walrus 보관 갱신·checkpoint indexer·가스 후원은 구성하지 않았다.
