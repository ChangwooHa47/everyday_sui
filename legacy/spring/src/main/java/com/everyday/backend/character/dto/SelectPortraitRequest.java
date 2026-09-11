package com.everyday.backend.character.dto;

import jakarta.validation.constraints.NotNull;

public record SelectPortraitRequest(@NotNull Long photoId) {
}
