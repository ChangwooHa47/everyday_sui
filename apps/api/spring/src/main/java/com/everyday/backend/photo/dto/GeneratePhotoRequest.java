package com.everyday.backend.photo.dto;

public record GeneratePhotoRequest(@jakarta.validation.constraints.Size(max = 80) String concept,
        @jakarta.validation.constraints.Size(max = 4000) String customPrompt) {
}
