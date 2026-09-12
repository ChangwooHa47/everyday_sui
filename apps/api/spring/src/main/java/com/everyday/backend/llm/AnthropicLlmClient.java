package com.everyday.backend.llm;

import com.everyday.backend.common.exception.CustomException;
import com.everyday.backend.common.exception.ErrorCode;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Component
public class AnthropicLlmClient implements LlmClient {

    private static final String ANTHROPIC_VERSION = "2023-06-01";
    private static final int DEFAULT_MAX_TOKENS = 1024;

    private final RestClient restClient;
    private final LlmProperties properties;

    public AnthropicLlmClient(LlmProperties properties) {
        this.properties = properties;
        var factory = new org.springframework.http.client.JdkClientHttpRequestFactory(java.net.http.HttpClient.newBuilder()
                .connectTimeout(java.time.Duration.ofSeconds(5)).build());
        factory.setReadTimeout(java.time.Duration.ofSeconds(60));
        this.restClient = RestClient.builder().requestFactory(factory)
                .baseUrl(properties.baseUrl())
                .build();
    }

    @Override
    public void requireConfigured() {
        if (properties.apiKey() == null || properties.apiKey().isBlank()) {
            throw new CustomException(ErrorCode.LLM_API_ERROR, "ANTHROPIC_API_KEY가 설정되지 않았습니다.");
        }
    }

    @Override
    public String generate(String systemPrompt, List<LlmMessage> messages) {
        requireConfigured();

        List<AnthropicMessage> anthropicMessages = messages.stream()
                .map(m -> new AnthropicMessage(m.role() == LlmMessage.Role.USER ? "user" : "assistant", m.content()))
                .toList();

        AnthropicRequest request = new AnthropicRequest(
                properties.model(), DEFAULT_MAX_TOKENS, systemPrompt, anthropicMessages);

        try {
            AnthropicResponse response = restClient.post()
                    .uri("/v1/messages")
                    .header("x-api-key", properties.apiKey())
                    .header("anthropic-version", ANTHROPIC_VERSION)
                    .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                    .body(request)
                    .retrieve()
                    .body(AnthropicResponse.class);

            if (response == null || response.content() == null || response.content().isEmpty()) {
                throw new CustomException(ErrorCode.LLM_API_ERROR, "AI 응답이 비어 있습니다.");
            }

            String text = response.content().stream()
                    .filter(block -> "text".equals(block.type()))
                    .map(AnthropicContentBlock::text)
                    .filter(java.util.Objects::nonNull)
                    .reduce("", String::concat);
            if (text.isBlank()) throw new CustomException(ErrorCode.LLM_API_ERROR);
            return text;
        } catch (RestClientException e) {
            throw new CustomException(ErrorCode.LLM_API_ERROR, "LLM 호출 중 오류: " + e.getMessage());
        }
    }

    private record AnthropicRequest(
            String model,
            @JsonProperty("max_tokens") int maxTokens,
            String system,
            List<AnthropicMessage> messages) {
    }

    private record AnthropicMessage(String role, String content) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record AnthropicResponse(List<AnthropicContentBlock> content) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record AnthropicContentBlock(String type, String text) {
    }
}
