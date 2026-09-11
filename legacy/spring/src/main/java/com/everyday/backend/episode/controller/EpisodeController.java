package com.everyday.backend.episode.controller;

import com.everyday.backend.chat.dto.ChatMessageResponse;
import com.everyday.backend.chat.dto.SendMessageRequest;
import com.everyday.backend.common.response.ApiResponse;
import com.everyday.backend.common.security.SecurityUtils;
import com.everyday.backend.episode.dto.EpisodeResponse;
import com.everyday.backend.episode.dto.EpisodeStartResponse;
import com.everyday.backend.episode.service.EpisodeService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class EpisodeController {

    private final EpisodeService episodeService;

    public EpisodeController(EpisodeService episodeService) {
        this.episodeService = episodeService;
    }

    @GetMapping("/api/episodes")
    public ApiResponse<List<EpisodeResponse>> list() {
        return ApiResponse.ok(episodeService.list());
    }

    @PostMapping("/api/characters/{characterId}/episodes/{episodeId}/start")
    public ApiResponse<EpisodeStartResponse> start(@PathVariable Long characterId, @PathVariable Long episodeId) {
        Long userId = SecurityUtils.getCurrentUserId();
        return ApiResponse.ok(episodeService.start(userId, characterId, episodeId));
    }

    @GetMapping("/api/characters/{characterId}/episodes/{episodeId}/messages")
    public ApiResponse<List<ChatMessageResponse>> getMessages(
            @PathVariable Long characterId, @PathVariable Long episodeId) {
        Long userId = SecurityUtils.getCurrentUserId();
        return ApiResponse.ok(episodeService.getMessages(userId, characterId, episodeId));
    }

    @PostMapping("/api/characters/{characterId}/episodes/{episodeId}/messages")
    public ApiResponse<ChatMessageResponse> sendMessage(
            @PathVariable Long characterId, @PathVariable Long episodeId,
            @Valid @RequestBody SendMessageRequest request) {
        Long userId = SecurityUtils.getCurrentUserId();
        return ApiResponse.ok(episodeService.sendMessage(userId, characterId, episodeId, request.content()));
    }
}
