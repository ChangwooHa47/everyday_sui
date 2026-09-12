package com.everyday.backend.common.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;

/**
 * 비동기 실행 활성화 — 초상 후보 생성처럼 수 분 걸리는 외부 API 작업을
 * 요청 스레드 밖에서 처리하기 위해 사용한다.
 */
@Configuration
@EnableAsync
@org.springframework.scheduling.annotation.EnableScheduling
public class AsyncConfig {
}
