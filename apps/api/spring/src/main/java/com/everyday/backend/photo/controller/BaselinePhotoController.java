package com.everyday.backend.photo.controller;

import com.everyday.backend.common.response.ApiResponse;
import com.everyday.backend.common.security.SecurityUtils;
import com.everyday.backend.photo.dto.GeneratePhotoRequest;
import com.everyday.backend.photo.dto.PhotoGenerationResponse;
import com.everyday.backend.photo.service.PhotoService;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.*;

@RestController
@Profile("baseline")
public class BaselinePhotoController {
    private final PhotoService service;
    public BaselinePhotoController(PhotoService service) { this.service = service; }
    @PostMapping("/api/characters/{characterId}/photos")
    public ApiResponse<PhotoGenerationResponse> generate(@PathVariable Long characterId,
            @jakarta.validation.Valid @RequestBody GeneratePhotoRequest request) {
        return ApiResponse.ok(service.generate(SecurityUtils.getCurrentUserId(), characterId, request));
    }
}
