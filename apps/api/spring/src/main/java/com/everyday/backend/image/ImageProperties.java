package com.everyday.backend.image;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.image")
public record ImageProperties(String provider, String apiKey, String apiSecret, String baseUrl) {
}
