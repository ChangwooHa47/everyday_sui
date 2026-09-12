# 이전 코드 보관 영역

`spring/`은 백엔드 원본과 R0 검증 코드를 복사한 것이다. `frontend/`는 제품 앱에서 분리한 이전 Next AI API, `/measure`, `/train`, 실험 스크립트와 당시 보조 모듈이다. 프론트 보관 코드는 독립적으로 기동하는 workspace가 아니며 주변 UI는 `apps/web`에서 확인한다.

소스 기준:

- frontend: `joh537874/everyday@81ca6eb406499f657806a155b9414a04fbb1d724`
- backend: `joh537874/everday_project_backend@cb071ac2b1cc4e6a2e90609434593758fec46652`
- 위 commit 이후 이 작업에서 추가한 R0 테스트/실행 스크립트 포함.

루트 npm workspace/운영 Docker 이미지에 이 디렉터리를 포함하지 않는다. 이곳의 Spring 사본은 호환성 비교용으로만 남긴다. 현재 백엔드는 [TypeScript 제품 모듈](../apps/api/src/product)로 통합했으며 별도 실행용 Spring 소스는 정리했다. 기존 README의 Java·Gradle·배포·환경 설명은 당시 기록이다. 현재 모노레포 실행에는 [루트 README](../README.md)를 사용한다.

구독 결제·커뮤니티 백엔드는 원본에서 미구현이었고 Soul 학습·사진 느낌/재생성도 일부 연결이 빠져 있었다. 이는 보관 시점의 상태이며 현재 기능 범위는 [마켓 기획 기준](../docs/MARKET_PIVOT.md)을 따른다. 보관 소스가 현재 앱의 실행 의존성이라는 뜻은 아니다.
