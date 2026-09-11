# 모노레포 기준 검증

[루트 실행 방법](../../README.md)의 Spring 기준 서버와 `baseline:build`/`test:e2e`를 사용한다. 원본 프론트에 필요했던 가짜 AI 키 주입은 이전 Next API 분리로 제거했다.

캐릭터 인터뷰·생성 → 프로필 선택 → 호칭 → 일반 채팅 → 에피소드 → 포토부스 → 갤러리 5장 흐름을 실제 Spring API로 검증한다. AI 응답/이미지는 고정값이다. `test-results`의 채팅/갤러리 스크린샷과 실패 trace는 Git에서 제외한다.

새 TS API가 이 기능을 구현했다는 테스트는 아니다. P1~P4에서 wallet 기반 계약에 맞춰 기대 동작을 단계적으로 바꾼다. [검증 결과](../../docs/P0_VALIDATION.md).
