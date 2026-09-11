package com.everyday.backend.image;

import com.everyday.backend.common.exception.CustomException;
import com.everyday.backend.common.exception.ErrorCode;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import java.util.Set;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * Higgsfield 이미지 생성 API 연동 (platform.higgsfield.ai — Soul 2.0).
 *
 * <p>실제 API 규약 (프론트 llm-prototype/lib/higgsfield.ts에서 실사용 검증된 스펙):
 * <ul>
 *   <li>인증: {@code Authorization: Key {KEY_ID}:{KEY_SECRET}}</li>
 *   <li>생성 제출: {@code POST /v1/text2image/soul} body {@code {"params": {...}}} → {@code {id, jobs[]}}</li>
 *   <li>폴링: {@code GET /v1/job-sets/{id}} → {@code jobs[].status}, 완료 시 {@code jobs[].results.raw.url}</li>
 *   <li>얼굴 학습: {@code POST /v1/custom-references} → {@code {id, status}} (학습 3~5분 비동기,
 *       발급된 id를 이후 생성의 custom_reference_id로 사용)</li>
 * </ul>
 * batch_size는 1 또는 4만 허용된다. 1080p 4장은 폴링이 2분을 넘기도 해서 한도를 4분대로 잡는다.
 */
@Component
public class HiggsfieldImageClient implements ImageClient {

    private static final int POLL_INTERVAL_MS = 2500;
    private static final int MAX_POLL_ATTEMPTS = 240; // 2.5s x 240 = 10분 (1080p 4장은 큐 상황 따라 7분+ 걸림)

    private static final Set<String> TERMINAL_STATUSES = Set.of("completed", "failed", "nsfw", "canceled");

    private final RestClient restClient;
    private final ImageProperties properties;

    public HiggsfieldImageClient(ImageProperties properties) {
        this.properties = properties;
        this.restClient = RestClient.builder()
                .baseUrl(properties.baseUrl())
                .build();
    }

    @Override
    public List<String> generateImages(String prompt, String referenceImageUrl, int count) {
        requireApiKey();

        int batchSize = count >= 4 ? 4 : 1; // API 제약: 1 또는 4
        ImageReference imageReference = referenceImageUrl == null || referenceImageUrl.isBlank()
                ? null
                : new ImageReference("image_url", referenceImageUrl);
        SoulParams params = new SoulParams(
                prompt, "1536x2048", "1080p", batchSize, true, imageReference);

        try {
            JobSetResponse submitted = restClient.post()
                    .uri("/v1/text2image/soul")
                    .headers(this::authHeaders)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(new GenerateRequest(params))
                    .retrieve()
                    .body(JobSetResponse.class);

            if (submitted == null || submitted.id() == null) {
                throw new CustomException(ErrorCode.IMAGE_API_ERROR, "이미지 생성 작업 등록에 실패했습니다.");
            }

            return pollForResult(submitted.id());
        } catch (RestClientException e) {
            throw new CustomException(ErrorCode.IMAGE_API_ERROR, "이미지 생성 API 호출 중 오류: " + e.getMessage());
        }
    }

    @Override
    public String trainSoul(String referenceImageUrl) {
        requireApiKey();

        try {
            CustomReferenceResponse response = restClient.post()
                    .uri("/v1/custom-references")
                    .headers(this::authHeaders)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(new CustomReferenceRequest(
                            "everyday-character",
                            List.of(new ImageReference("image_url", referenceImageUrl))))
                    .retrieve()
                    .body(CustomReferenceResponse.class);

            if (response == null || response.id() == null) {
                throw new CustomException(ErrorCode.IMAGE_API_ERROR, "Soul ID 등록에 실패했습니다.");
            }
            // 학습은 Higgsfield 쪽에서 3~5분 비동기로 진행된다. 발급된 id는 즉시 사용 등록 가능.
            return response.id();
        } catch (RestClientException e) {
            throw new CustomException(ErrorCode.IMAGE_API_ERROR, "Soul 학습 API 호출 중 오류: " + e.getMessage());
        }
    }

    private List<String> pollForResult(String jobSetId) {
        for (int attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
            JobSetResponse status = restClient.get()
                    .uri("/v1/job-sets/{id}", jobSetId)
                    .headers(this::authHeaders)
                    .retrieve()
                    .body(JobSetResponse.class);

            List<Job> jobs = status == null || status.jobs() == null ? List.of() : status.jobs();
            if (!jobs.isEmpty() && jobs.stream().allMatch(j -> TERMINAL_STATUSES.contains(lower(j.status())))) {
                List<String> urls = jobs.stream()
                        .filter(j -> "completed".equalsIgnoreCase(j.status()))
                        .map(j -> j.results() == null || j.results().raw() == null ? null : j.results().raw().url())
                        .filter(u -> u != null && !u.isBlank())
                        .toList();
                if (!urls.isEmpty()) {
                    return urls;
                }
                throw new CustomException(ErrorCode.IMAGE_API_ERROR, "이미지 생성 작업이 실패했습니다. (job-set " + jobSetId + ")");
            }

            sleep();
        }
        throw new CustomException(ErrorCode.IMAGE_API_ERROR, "이미지 생성 시간이 초과되었습니다. (job-set " + jobSetId + ")");
    }

    private String lower(String value) {
        return value == null ? "" : value.toLowerCase();
    }

    private void sleep() {
        try {
            Thread.sleep(POLL_INTERVAL_MS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new CustomException(ErrorCode.IMAGE_API_ERROR, "이미지 생성 대기 중 인터럽트가 발생했습니다.");
        }
    }

    private void authHeaders(org.springframework.http.HttpHeaders headers) {
        headers.set("Authorization", "Key " + properties.apiKey() + ":" + properties.apiSecret());
    }

    private void requireApiKey() {
        if (properties.apiKey() == null || properties.apiKey().isBlank()) {
            throw new CustomException(ErrorCode.IMAGE_API_ERROR, "HIGGSFIELD_API_KEY가 설정되지 않았습니다.");
        }
    }

    private record GenerateRequest(SoulParams params) {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    private record SoulParams(
            String prompt,
            @JsonProperty("width_and_height") String widthAndHeight,
            String quality,
            @JsonProperty("batch_size") int batchSize,
            @JsonProperty("enhance_prompt") boolean enhancePrompt,
            @JsonProperty("image_reference") ImageReference imageReference) {
    }

    private record ImageReference(String type, @JsonProperty("image_url") String imageUrl) {
    }

    private record CustomReferenceRequest(String name, @JsonProperty("input_images") List<ImageReference> inputImages) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record CustomReferenceResponse(String id, String status) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record JobSetResponse(String id, List<Job> jobs) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record Job(String status, JobResults results) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record JobResults(JobResultUrl raw, JobResultUrl min) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    private record JobResultUrl(String url) {
    }
}
