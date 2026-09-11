package com.everyday.backend.baseline;

import com.everyday.backend.common.exception.CustomException;
import com.everyday.backend.common.exception.ErrorCode;
import com.everyday.backend.image.ImageClient;
import com.everyday.backend.llm.LlmClient;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.stream.IntStream;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/** Fixed responses exercise the real HTTP, auth, service and persistence layers. */
@TestConfiguration(proxyBeanMethods = false)
public class BaselineAiConfiguration {
    @Bean
    @Primary
    LlmClient baselineLlmClient() {
        return (system, messages) -> {
            if (messages.stream().anyMatch(m -> m.content().contains("BASELINE_FAIL_LLM"))) {
                throw new CustomException(ErrorCode.LLM_API_ERROR, "Baseline LLM failure");
            }
            if (system.contains("AI 캐릭터 생성 인터뷰어")) {
                return """
                        {"category":"성격","question":"어떤 성격인가요?",
                        "suggestedAnswers":["다정한 친구","조용한 친구"],"done":false}
                        """;
            }
            if (system.contains("설정을 완성하는 작가")) {
                return """
                        {"summary":"테스트용 친구","appearance":"검은 머리",
                        "personality":"다정하고 차분함","speechStyles":["반말"],
                        "imagePrompt":"baseline portrait"}
                        """;
            }
            if (system.contains("대화 시작 문장을 추천")) {
                return "[\"같이 산책할까?\",\"오늘 어땠어?\"]";
            }
            if (system.contains("이미지 프롬프트 작가")) {
                return messages.stream().anyMatch(m -> m.content().contains("BASELINE_FAIL_IMAGE"))
                        ? "BASELINE_FAIL_IMAGE" : "baseline scene";
            }
            return "오늘도 만나서 반가워. 무슨 이야기 할까?";
        };
    }

    @Bean
    @Primary
    ImageClient baselineImageClient() {
        return new ImageClient() {
            @Override
            public List<String> generateImages(String prompt, String reference, int count) {
                if (prompt.contains("BASELINE_FAIL_IMAGE")) {
                    throw new CustomException(ErrorCode.IMAGE_API_ERROR, "Baseline image failure");
                }
                return IntStream.range(0, count).mapToObj(i -> {
                    String svg = "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='400'>"
                            + "<rect width='300' height='400' fill='#ffd9b" + i + "'/></svg>";
                    return "data:image/svg+xml;base64," + Base64.getEncoder()
                            .encodeToString(svg.getBytes(StandardCharsets.UTF_8));
                }).toList();
            }

            @Override
            public String trainSoul(String reference) {
                return "baseline-soul-id";
            }
        };
    }
}
