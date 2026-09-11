# @everyday/web

기존 Everyday 화면과 경로를 그대로 사용한다. 공통 layout은 각 페이지의 children을 렌더링하며 시작 화면의 하단 로그인 버튼만 Sui 지갑 연결·메시지 서명을 수행한다.

Web3App, MarketApp, Web3Entry와 전용 CSS, /market 및 /viewer 대체 UI는 제거했다. 기존 globals.css, 홈·생성·채팅 등 페이지 디자인은 변경하지 않았다.

로그인은 실제 API /v1/auth/challenges 및 /v1/auth/sessions를 사용한다. 개인키를 저장하지 않고 세션 토큰은 메모리에만 보관한다. 지갑 변경·연결 해제 시 기존 세션을 폐기한다.

기존 화면의 생성·채팅·프로필 데이터는 원래 Spring /api 계약을 사용한다. 현재 Railway /v1 API에는 그 계약이 구현돼 있지 않으므로, 해당 기능은 연결 준비 중 오류를 표시한다. 지갑 세션을 Spring 데모 계정으로 바꾸거나 성공을 모사하지 않는다. NEXT_PUBLIC_LEGACY_BASELINE=1은 원래 Spring 비교 테스트에만 사용한다.

`npm run test:web3`는 기존 시작 화면 → 실제 지갑 메시지 서명 → 기존 생성 화면과 지갑 변경 시 세션 격리를 확인한다. `npm run test:e2e`는 별도 Spring 비교 환경에서 기존 전체 흐름을 확인한다. 테스트용 지갑/데이터는 운영 빌드에 포함되지 않는다.
