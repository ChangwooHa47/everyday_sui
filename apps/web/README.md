# @everyday/web

일반 실행의 기본 화면은 Sui 지갑 기반 `app/Web3App.tsx`다.
`lib/web3`에 체인 객체·Seal 암호화·Walrus 저장·복원 코드를 둔다.
실행과 공개 환경변수는 [루트 README](../../README.md), 범위와 제한은
[구현 기록](../../docs/WEB3_IMPLEMENTATION.md)에 정리했다.

기존 페이지와 Spring 클라이언트는 `NEXT_PUBLIC_LEGACY_BASELINE=1`인 비교 빌드에서만 실행한다.
일반 deep link에도 Web3 화면을 표시하며 기존 페이지의 effect를 마운트하지 않는다.
기존 경로별 디자인을 Web3 데이터에 다시 연결하는 것은 후속 UI 작업이다.

`npm run test:unit`은 저장 포맷/검증, `npm run test:web3`는 지갑 브라우저 검사다.
`npm run test:e2e`는 기존 Spring 비교 검사다. 각 브라우저 검사 전에 알맞은 모드로 빌드한다.
정적 export는 가능하지만 Walrus Sites 실제 게시는 수행하지 않았다.
