package com.everyday.backend.character.controller;

import com.everyday.backend.character.dto.CallNameRequest;
import com.everyday.backend.character.dto.CharacterResponse;
import com.everyday.backend.character.dto.CharacterSummaryResponse;
import com.everyday.backend.character.dto.CharacterUpdateRequest;
import com.everyday.backend.character.dto.CompileRequest;
import com.everyday.backend.character.dto.CompileResponse;
import com.everyday.backend.character.dto.InterviewQuestionResponse;
import com.everyday.backend.character.dto.InterviewRequest;
import com.everyday.backend.character.dto.SelectPortraitRequest;
import com.everyday.backend.character.service.CharacterService;
import com.everyday.backend.common.response.ApiResponse;
import com.everyday.backend.common.security.SecurityUtils;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/characters")
public class CharacterController {

    private final CharacterService characterService;

    public CharacterController(CharacterService characterService) {
        this.characterService = characterService;
    }

    @PostMapping("/interview")
    public ApiResponse<InterviewQuestionResponse> interview(@Valid @RequestBody InterviewRequest request) {
        return ApiResponse.ok(characterService.interview(request));
    }

    @PostMapping("/compile")
    public ApiResponse<CompileResponse> compile(@Valid @RequestBody CompileRequest request) {
        Long userId = SecurityUtils.getCurrentUserId();
        return ApiResponse.ok(characterService.compile(userId, request));
    }

    @PostMapping("/{characterId}/select-portrait")
    public ApiResponse<CharacterResponse> selectPortrait(
            @PathVariable Long characterId, @Valid @RequestBody SelectPortraitRequest request) {
        Long userId = SecurityUtils.getCurrentUserId();
        return ApiResponse.ok(characterService.selectPortrait(userId, characterId, request));
    }

    @GetMapping
    public ApiResponse<List<CharacterSummaryResponse>> list() {
        Long userId = SecurityUtils.getCurrentUserId();
        return ApiResponse.ok(characterService.list(userId));
    }

    @GetMapping("/{characterId}")
    public ApiResponse<CharacterResponse> detail(@PathVariable Long characterId) {
        Long userId = SecurityUtils.getCurrentUserId();
        return ApiResponse.ok(characterService.detail(userId, characterId));
    }

    @PatchMapping("/{characterId}")
    public ApiResponse<CharacterResponse> update(
            @PathVariable Long characterId, @RequestBody CharacterUpdateRequest request) {
        Long userId = SecurityUtils.getCurrentUserId();
        return ApiResponse.ok(characterService.update(userId, characterId, request));
    }

    @PatchMapping("/{characterId}/call-name")
    public ApiResponse<CharacterResponse> updateCallName(
            @PathVariable Long characterId, @Valid @RequestBody CallNameRequest request) {
        Long userId = SecurityUtils.getCurrentUserId();
        return ApiResponse.ok(characterService.updateCallName(userId, characterId, request));
    }

    @PostMapping("/{characterId}/train-face")
    public ApiResponse<CharacterResponse> trainFace(@PathVariable Long characterId) {
        Long userId = SecurityUtils.getCurrentUserId();
        return ApiResponse.ok(characterService.trainFace(userId, characterId));
    }
}
