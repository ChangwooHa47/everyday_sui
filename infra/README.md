# 인프라 도구 안내

운영은 [Railway 배포 가이드](DEPLOYMENT.md), 검증 결과·미완료 항목은 [배포 리뷰](DEPLOYMENT_REVIEW.md)를 따른다. 로컬 실행 설정은 [마켓 실행 가이드](../docs/MARKET_RUNBOOK.md)에 있다.

현재 저장소의 배포 구성은 웹 하나, Node와 Spring을 함께 실행하는 백엔드 하나, PostgreSQL이다. 기존 제품 기능과 Web3 SDK를 유지하면서 양방향 내부 주소·배포 설정을 한 백엔드로 모은다. 두 런타임의 CPU·메모리와 DB 연결은 남으므로 요금 절감을 보장하지 않는다. 기존 운영 서비스의 통합·삭제는 별도 승인된 provider 전환 전까지 실행하지 않는다.

| 파일 | 역할과 실행 범위 |
| --- | --- |
| [compose.yaml](compose.yaml) | PostgreSQL 17 + 통합 백엔드. 웹은 별도 개발 서버. DB/API만 로컬 호스트 5432/3001에 노출하고 Spring은 백엔드 내부 loopback에서 실행한다. |
| [Dockerfile.api](Dockerfile.api), [Dockerfile.web](Dockerfile.web) | 저장소 루트 context로 빌드하는 통합 백엔드·웹 이미지. API 이미지에 Java와 Node를 함께 포함한다. |
| [start-backend.mjs](start-backend.mjs) | 두 백엔드 프로세스를 동시에 시작하고 로컬 통신 주소·종료를 관리한다. 자식 실패 시 함께 종료하며, 정상 종료는 Spring 다음 Node 순서로 최대 35초 안에 수행한다. |
| [check-docs.mjs](check-docs.mjs) | Git 관리 Markdown의 UTF-8·충돌 표시·로컬 링크·문서 앵커 검사. 외부 사이트의 내용이나 실행 성공을 증명하지 않는다. |
| [test-spring.mjs](test-spring.mjs) | 별도 Docker PostgreSQL + 실제 서명 인증/gateway + production Spring 통합 검사. AI·이미지·체인 응답 일부는 fixture. |
| [start-backend.test.mjs](start-backend.test.mjs), [smoke-deployment.mjs](smoke-deployment.mjs) | 프로세스 종료·포트 분리 회귀 검사와 실제 통합 이미지의 로그인·DB 장애 복구·Spring 장애 검사. 임시 로컬 컨테이너만 사용한다. |
| [deploy-testnet.mjs](deploy-testnet.mjs) | 전용 키·보존된 서명 상태를 사용하는 testnet 게시/재확인. `--execute --deployment-state market-testnet-v2`가 현재 상태 경로다. |
| [verify-market-testnet.mjs](verify-market-testnet.mjs) | 실제 거래·유료 저장·기억 검증. `--execute` 필수이며 일반 회귀 테스트에 포함하지 않는다. |
| [verify-market-api.mjs](verify-market-api.mjs) | 별도 PGlite와 실제 Sui/Seal/MemWal 조회를 두 Origin에서 확인. 기존 전용 계정/검증 데이터가 필요하다. |
| [register-market-seed.mjs](register-market-seed.mjs) | 이미 게시된 시드 상품을 지정 API 카탈로그에 등록. `--execute`로 DB를 변경하며 새 결제·업로드는 하지 않는다. |
| [market-seed.json](market-seed.json) | 원래 이미지 자산을 사용하는 가상 성인 캐릭터 10명의 작가 설정 |

Compose의 기본 DB 암호는 로컬 개발용이다. 운영 키는 서비스 비밀 변수에 두고, 개인 키·서명·복구 상태는 공개 기록에 넣지 않는다. PostgreSQL은 named volume을 사용하므로 데이터 삭제 목적이 아니면 `down --volumes`를 실행하지 않는다.

`npm.cmd run dev:api:local`은 PGlite 기반의 제한된 개발 API다. Spring은 별도 PostgreSQL을 요구하므로 이 명령만으로 기존 제품 전체가 기동되지는 않는다. 자동 Walrus 보관 갱신·checkpoint indexer·가스 후원은 구성하지 않았다.
