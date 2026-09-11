package com.everyday.backend.llm;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.llm")
public record LlmProperties(String provider, String apiKey, String baseUrl, String model) {
}
