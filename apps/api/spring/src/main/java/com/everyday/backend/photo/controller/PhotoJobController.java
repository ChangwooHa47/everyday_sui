package com.everyday.backend.photo.controller;

import com.everyday.backend.common.response.ApiResponse;
import com.everyday.backend.common.security.SecurityUtils;
import com.everyday.backend.photo.dto.GeneratePhotoRequest;
import com.everyday.backend.photo.service.PhotoJobQueue;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.*;

@RestController
@Profile("!baseline")
public class PhotoJobController {
    private final PhotoJobQueue queue;
    public PhotoJobController(PhotoJobQueue queue) { this.queue = queue; }
    public record Input(@jakarta.validation.constraints.NotNull UUID requestId,
            @jakarta.validation.Valid @jakarta.validation.constraints.NotNull GeneratePhotoRequest photo) {}
    @PostMapping("/api/characters/{characterId}/photo-jobs")
    public ApiResponse<PhotoJobQueue.Result> enqueue(@PathVariable Long characterId, @jakarta.validation.Valid @RequestBody Input input) {
        return ApiResponse.ok(queue.enqueue(SecurityUtils.getCurrentUserId(), characterId, input.requestId(), input.photo()));
    }
    @GetMapping("/api/photo-jobs/{requestId}")
    public ApiResponse<PhotoJobQueue.Result> status(@PathVariable UUID requestId) {
        return ApiResponse.ok(queue.status(SecurityUtils.getCurrentUserId(), requestId));
    }
}
