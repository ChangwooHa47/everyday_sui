package com.everyday.backend.character.dto;

import com.everyday.backend.photo.dto.PhotoResponse;
import java.util.List;

public record CompileResponse(CharacterResponse character, List<PhotoResponse> candidatePortraits) {
}
