package com.everyday.backend.photo.controller;

import com.everyday.backend.common.response.ApiResponse;
import com.everyday.backend.photo.dto.PhotoConceptResponse;
import com.everyday.backend.photo.service.PhotoService;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
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

}
