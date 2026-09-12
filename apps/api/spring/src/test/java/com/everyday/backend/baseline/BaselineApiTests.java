package com.everyday.backend.baseline;

import com.everyday.backend.BackendApplication;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.Import;
import org.springframework.http.*;
import org.springframework.test.context.ActiveProfiles;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import java.time.Duration;

@SpringBootTest(classes = BackendApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("baseline")
@Import(BaselineAiConfiguration.class)
class BaselineApiTests {
    @Autowired TestRestTemplate http;

    private ResponseEntity<JsonNode> request(HttpMethod method, String path, String token, Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (token != null) headers.setBearerAuth(token);
        return http.exchange(path, method, new HttpEntity<>(body, headers), JsonNode.class);
    }

    private JsonNode ok(HttpMethod method, String path, String token, Object body) {
        var response = request(method, path, token, body);
        assertThat(response.getStatusCode().is2xxSuccessful()).as(path + " " + response.getBody()).isTrue();
        assertThat(response.getBody().path("success").asBoolean()).isTrue();
        return response.getBody().path("data");
    }

    private String signup() {
        return ok(HttpMethod.POST, "/api/auth/signup", null,
                Map.of("email", UUID.randomUUID() + "@baseline.test", "password", "baseline123!"))
                .path("accessToken").asText();
    }

    private long character(String token) {
        return ok(HttpMethod.POST, "/api/characters/compile", token,
                Map.of("relationshipType", "FRIEND", "gender", "MALE", "name", "기준친구"))
                .path("character").path("id").asLong();
    }

    @Test void authenticationAndOwnership() {
        assertThat(request(HttpMethod.GET, "/api/me", null, null).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(request(HttpMethod.GET, "/api/me", "invalid", null).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        String owner = signup();
        long id = character(owner);
        String stranger = signup();
        assertThat(request(HttpMethod.GET, "/api/characters/" + id, stranger, null).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(request(HttpMethod.POST, "/api/characters/" + id + "/messages", stranger,
                Map.of("content", "hello")).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test void characterChatEpisodeAndPhotoFlow() {
        String token = signup();
        long id = character(token);
        String base = "/api/characters/" + id;
        await().atMost(Duration.ofSeconds(5)).untilAsserted(() ->
                assertThat(ok(HttpMethod.GET, base + "/gallery", token, null).size()).isEqualTo(4));
        long photoId = ok(HttpMethod.GET, base + "/gallery", token, null).get(0).path("id").asLong();
        assertThat(ok(HttpMethod.POST, base + "/select-portrait", token, Map.of("photoId", photoId))
                .path("profileImageUrl").asText()).startsWith("data:image/");
        assertThat(ok(HttpMethod.PATCH, base, token, Map.of("personality", "활발함"))
                .path("personality").asText()).isEqualTo("활발함");
        assertThat(ok(HttpMethod.PATCH, base + "/call-name", token, Map.of("callName", "테스터"))
                .path("callName").asText()).isEqualTo("테스터");
        assertThat(ok(HttpMethod.GET, base + "/messages", token, null).size()).isZero();
        ok(HttpMethod.POST, base + "/greeting", token, Map.of());
        ok(HttpMethod.POST, base + "/messages", token, Map.of("content", "안녕"));
        JsonNode messages = ok(HttpMethod.GET, base + "/messages", token, null);
        assertThat(messages.size()).isEqualTo(3);
        assertThat(messages.get(1).path("content").asText()).isEqualTo("안녕");
        assertThat(messages.get(2).path("sender").asText()).isEqualTo("AI");
        long episodeId = ok(HttpMethod.GET, "/api/episodes", token, null).get(0).path("id").asLong();
        String episode = base + "/episodes/" + episodeId;
        assertThat(ok(HttpMethod.POST, episode + "/start", token, null).path("starters").size()).isEqualTo(2);
        ok(HttpMethod.POST, episode + "/messages", token, Map.of("content", "산책하자"));
        assertThat(ok(HttpMethod.GET, episode + "/messages", token, null).size()).isEqualTo(2);
        assertThat(ok(HttpMethod.GET, base + "/messages", token, null).size()).isEqualTo(3);
        JsonNode generated = ok(HttpMethod.POST, base + "/photos", token, Map.of("concept", "CAFE_DATE"));
        assertThat(generated.path("remainingPoints").asInt()).isZero();
        assertThat(ok(HttpMethod.GET, base + "/gallery", token, null).size()).isEqualTo(5);
        assertThat(request(HttpMethod.POST, base + "/photos", token, Map.of("concept", "CAFE_DATE"))
                .getStatusCode()).isEqualTo(HttpStatus.PAYMENT_REQUIRED);
        assertThat(ok(HttpMethod.GET, base + "/gallery", token, null).size()).isEqualTo(5);
    }

    @Test void failedGenerationDoesNotChargeOrSavePhoto() {
        String token = signup();
        String base = "/api/characters/" + character(token);
        await().atMost(Duration.ofSeconds(5)).untilAsserted(() ->
                assertThat(ok(HttpMethod.GET, base + "/gallery", token, null).size()).isEqualTo(4));
        assertThat(request(HttpMethod.POST, base + "/photos", token,
                Map.of("concept", "CUSTOM", "customPrompt", "BASELINE_FAIL_IMAGE")).getStatusCode())
                .isEqualTo(HttpStatus.BAD_GATEWAY);
        assertThat(ok(HttpMethod.GET, "/api/me", token, null).path("points").asInt()).isEqualTo(1200);
        assertThat(ok(HttpMethod.GET, base + "/gallery", token, null).size()).isEqualTo(4);
    }

    @Test void failedChatDoesNotPersistPartialTurn() {
        String token = signup();
        String base = "/api/characters/" + character(token);
        int before = ok(HttpMethod.GET, base + "/messages", token, null).size();
        assertThat(request(HttpMethod.POST, base + "/messages", token,
                Map.of("content", "BASELINE_FAIL_LLM")).getStatusCode()).isEqualTo(HttpStatus.BAD_GATEWAY);
        assertThat(ok(HttpMethod.GET, base + "/messages", token, null).size()).isEqualTo(before);
    }
}
