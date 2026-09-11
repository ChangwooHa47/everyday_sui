# 인프라

Railway API + Vercel 웹 배포는 [배포 가이드](DEPLOYMENT.md)를 따른다.

`compose.yaml`은 Postgres 17과 지갑 인증·AI gateway API를 실행한다.
DB와 API는 로컬 호스트 5432/3001에만 바인딩한다. 기본 DB 암호는 로컬 개발용이다.
운영에서는 별도 비밀값, 접근 제어, 백업, TLS를 설정해야 한다.

```powershell
docker compose -f infra/compose.yaml up --build
```

Docker build context는 모노레포 루트이며 API는 `node` 사용자로 실행한다.
Postgres healthcheck가 통과한 후 API를 시작하고 SQL 스키마를 멱등 적용한다.
API readiness는 DB 조회로 판정한다. PostgreSQL 데이터는 named volume에 저장된다.

AI 제공자는 `AI_ENDPOINT`, `AI_MODEL`, `AI_API_KEY`를 서버에 설정하면 활성화한다.
미설정 상태에서는 AI 요청을 거절한다. 키를 웹 환경변수에 넣지 않는다.

Docker 없이 인증을 확인할 때는 루트의 `npm.cmd run dev:api:local`을 사용한다.
이는 PGlite 기반 개발 실행이며 운영 Postgres 대체 배포 구성이 아니다.

worker/indexer, Walrus publisher, 가스 후원과 자동 연장은 아직 구성하지 않았다.
현재 환경에서는 Compose 파싱만 확인했으며 Docker daemon 미실행으로 이미지 기동은 미검증이다.
전체 결과는 [구현 기록](../docs/WEB3_IMPLEMENTATION.md)을 참조한다.
