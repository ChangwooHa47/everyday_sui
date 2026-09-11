package com.everyday.backend.photo.controller;

import com.everyday.backend.common.response.ApiResponse;
import com.everyday.backend.common.security.SecurityUtils;
import com.everyday.backend.photo.dto.GeneratePhotoRequest;
import com.everyday.backend.photo.dto.PhotoConceptResponse;
import com.everyday.backend.photo.dto.PhotoGenerationResponse;
import com.everyday.backend.photo.service.PhotoService;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class PhotoController {

    private final PhotoService photoService;

    public PhotoController(PhotoService photoService) {
        this.photoService = photoService;
    }

    @GetMapping("/api/photo/concepts")
    public ApiResponse<List<PhotoConceptResponse>> listConcepts() {
        return ApiResponse.ok(photoService.listConcepts());
    }

    @PostMapping("/api/characters/{characterId}/photos")
    public ApiResponse<PhotoGenerationResponse> generate(
            @PathVariable Long characterId, @RequestBody GeneratePhotoRequest request) {
        Long userId = SecurityUtils.getCurrentUserId();
        return ApiResponse.ok(photoService.generate(userId, characterId, request));
    }
}
