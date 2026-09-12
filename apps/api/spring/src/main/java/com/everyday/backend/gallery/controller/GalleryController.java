package com.everyday.backend.gallery.controller;

import com.everyday.backend.common.response.ApiResponse;
import com.everyday.backend.common.security.SecurityUtils;
import com.everyday.backend.gallery.service.GalleryService;
import com.everyday.backend.photo.dto.PhotoResponse;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class GalleryController {

    private final GalleryService galleryService;

    public GalleryController(GalleryService galleryService) {
        this.galleryService = galleryService;
    }

    @GetMapping("/api/characters/{characterId}/gallery")
    public ApiResponse<List<PhotoResponse>> getGallery(@PathVariable Long characterId) {
        Long userId = SecurityUtils.getCurrentUserId();
        return ApiResponse.ok(galleryService.getGallery(userId, characterId));
    }
}
