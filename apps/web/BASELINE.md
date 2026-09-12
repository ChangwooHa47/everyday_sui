# 원본 Spring 비교 모드

이 문서는 기존 화면과 Spring 기능을 비교하는 fixture 모드를 설명한다. 현재 서비스 구성과 검증 범위는 [웹 안내](README.md)와 [배포 리뷰](../../infra/DEPLOYMENT_REVIEW.md)를 따른다.

비교 모드는 지갑 인증 대신 데모 JWT 인증을 사용한다. [BaselineApplication](../api/spring/src/test/java/com/everyday/backend/baseline/BaselineApplication.java)은 테스트 클래스패스에서만 실행되며 운영 JAR에는 포함되지 않는다. H2와 고정 AI·이미지 응답을 사용하므로 실제 공급자 호출이나 운영 PostgreSQL·Sui 연동을 증명하지 않는다.

Node 24, npm 11, Java 21이 준비된 환경에서 루트 기준으로 비교 서버를 실행할 수 있다.

```powershell
apps/api/spring/gradlew.bat -p apps/api/spring bootTestRun --no-daemon
```

[프론트 비교 실행 스크립트](scripts/baseline.mjs)는 API를 `http://127.0.0.1:18080`, 웹을 `http://127.0.0.1:13000`으로 고정한다. 루트에서 `npm.cmd ci`로 의존성을 설치한 다음, 별도 터미널에서 `npm.cmd run baseline:build` 후 `npm.cmd run start:baseline --workspace @everyday/web`을 사용한다. 비교 빌드는 공유 DTO 패키지를 먼저 빌드하므로 최초 체크아웃에서도 실행할 수 있다. `NEXT_PUBLIC_LEGACY_BASELINE=1`은 이 비교 모드에만 사용한다.

[브라우저 비교 테스트](tests/e2e/baseline.spec.ts)는 이전 인터뷰·생성 → 초상 선택 → 호칭 → 대화 → 에피소드 → 포토부스 → 갤러리 흐름을 기록한 수동 비교 자료다. 현재의 첫 인사·사진 작업 API 변경이 모두 반영된 테스트가 아니므로 현재 서비스의 통과 기준으로 사용하지 않는다. `npm.cmd run test:e2e` 명령과 비교용 실행 스크립트는 보존하지만, 실행 전에 현재 API와 테스트의 일치 여부를 확인해야 한다. 테스트 결과·스크린샷·실패 trace는 Git에서 제외한다.

[CI](../../.github/workflows/ci.yml)는 현재 `apps/api/spring`의 Java 테스트와 JAR 빌드, [PostgreSQL·인증 API 통합 검사](../../infra/test-spring.mjs)를 실행한다. 브라우저와 `legacy/spring` 비교 서버는 CI에서 실행하지 않는다. 이 통합 검사는 실제 DB와 인증 경로를 검증하며 AI·이미지·마켓 공급자 응답은 fixture다.

이전 실행 결과는 [2026-09-08 검증 기록](../../docs/history/P0_VALIDATION.md)이다. 당시 결과를 현재 코드의 브라우저 검증으로 간주하지 않는다. 비교 빌드와 일반 빌드는 공개 환경변수가 다르므로 운영용으로 돌아갈 때 루트 `npm.cmd run build`를 다시 실행한다.
