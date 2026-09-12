# 리팩토링 기준 실행 (R0)

> 2026-09-07 비교용 Spring 사본의 기록이다. 현재 앱의 검증·DB 구성은 [실행 가이드](../../docs/MARKET_RUNBOOK.md)를 따른다. 아래 H2/브라우저 결과를 운영 검증으로 취급하지 않는다.

2026-09-07 기준. 제품 서비스·컨트롤러를 그대로 실행하고 AI 구현만 테스트용 고정 응답으로 교체한다. 데이터는 H2 메모리에 저장되며 서버 종료 시 사라진다. 운영 MySQL 및 실제 AI 품질을 검증하는 모드가 아니다.

## 실행

Java 21이 필요하다. `JAVA_HOME` 또는 PATH에 설정한다. Windows 스크립트는 설정이 없으면 모노레포 루트의 `.local-tools/jdk-21*`도 찾는다. 이 컴퓨터에서는 Microsoft JDK 21.0.12.1을 사용했다. 최초 실행은 Gradle 및 Maven 의존성 다운로드가 필요하다.

백엔드 저장소에서 실행:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\baseline.ps1 test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\baseline.ps1 package
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\baseline.ps1 serve
```

마지막 명령은 서버를 계속 실행한다. 주소는 `http://127.0.0.1:18080`. 종료는 Ctrl+C. 스크립트 실행 정책은 해당 PowerShell 프로세스에만 적용한다. Windows의 한글 경로에서 Gradle worker 인자 파일을 읽도록 Gradle JVM의 `file.encoding=COMPAT`를 지정한다.

Java가 설정된 다른 환경에서는 `./gradlew test bootJar`, `./gradlew bootTestRun`을 사용한다. `bootTestRun`이 테스트 클래스패스를 포함한 별도 진입점을 실행한다. 일반 `bootRun`에 프로필 이름만 붙여서는 대체 AI 구현이 등록되지 않는다.

`application-baseline.yaml`은 DB, JWT 테스트 키, AI 키, CORS를 덮어쓴다. 테스트 클래스와 H2는 배포용 `bootJar`에 포함되지 않으며 실제 JAR 목록에서도 제외됨을 확인했다. 데모 시드는 기존 동작대로 실행되지만 API/E2E 검증은 각자 생성한 계정을 사용한다.

## 검증 결과

- Spring 컨텍스트 1개, HTTP 통합 테스트 4개: 총 5개 통과, 실패·스킵 0개.
- 인증 누락/잘못된 토큰 401, 다른 사용자의 캐릭터 조회/대화 403.
- 캐릭터 생성, 프로필 4장, 프로필 선택, 성격·호칭 필드 수정.
- 일반 대화와 에피소드 기록 분리, 사진 생성 후 1200 → 0 포인트, 잔액 부족 402.
- 이미지 생성 실패 502 시 포인트·갤러리 유지, LLM 실패 502 시 부분 대화 롤백.
- `bootJar` 생성 성공. 결과: `build/reports/tests/test/index.html`.

호칭 필드 저장 성공이 실제 프롬프트 반영 성공을 뜻하지는 않는다. 현재 GET 대화 조회가 첫 인사를 만드는 동작은 비교 기준으로 기록했고 R4에서 변경할 대상이다. 동시 차감, 프로세스 재시작, 이미지 부분 성공은 이번 테스트 범위 밖이다.

고정 응답은 `BaselineAiConfiguration`에 있다. 사용자 메시지 `BASELINE_FAIL_LLM`, CUSTOM 사진 프롬프트 `BASELINE_FAIL_IMAGE`로 실패를 재현한다. 이미지는 작은 SVG 색상 견본으로 반환한다. 해당 입력은 테스트 모드 전용이다.

## 실제 MySQL 환경과 남은 검증

현재 기본 설정은 `jdbc:mysql://mysql:3306/everyday`, `ddl-auto: update`이고 `.env`를 자동으로 읽지 않는다. 별도 개발용 MySQL DB를 준비한 뒤 프로세스 환경으로 값을 전달해야 한다. 아래 값은 본인의 개발 환경 값으로 교체한다.

```powershell
$env:SPRING_DATASOURCE_URL = 'jdbc:mysql://127.0.0.1:3306/everyday_dev'
$env:SPRING_DATASOURCE_USERNAME = '<개발 DB 사용자>'
$env:SPRING_DATASOURCE_PASSWORD = '<개발 DB 비밀번호>'
$env:JWT_SECRET = '<최소 32바이트 개발용 서명 키>'
$env:ANTHROPIC_API_KEY = '<개발용 키>'
$env:HIGGSFIELD_API_KEY = '<개발용 키>'
$env:HIGGSFIELD_API_SECRET = '<개발용 키>'
$env:CORS_ALLOWED_ORIGINS = 'http://localhost:3000'
.\gradlew.bat bootRun
```

이 경로는 실제 AI 호출이 발생한다. 이번 환경에서는 Docker 데몬을 사용할 수 없어 MySQL 실행을 검증하지 않았다. H2의 MySQL 모드는 운영 DB의 SQL·잠금·동시성 검증을 대체하지 않는다. MySQL 확인은 스키마 및 트랜잭션 변경 전에 보완해야 한다.
