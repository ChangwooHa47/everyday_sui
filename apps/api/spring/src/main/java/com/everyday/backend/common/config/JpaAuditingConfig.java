package com.everyday.backend.common.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;

@Configuration
@EnableJpaAuditing(dateTimeProviderRef = "databasePrecisionTime")
public class JpaAuditingConfig {
    @org.springframework.context.annotation.Bean
    public org.springframework.data.auditing.DateTimeProvider databasePrecisionTime() {
        // PostgreSQL timestamps retain microseconds; use the same precision before the first response.
        return () -> java.util.Optional.of(java.time.LocalDateTime.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS));
    }
}
