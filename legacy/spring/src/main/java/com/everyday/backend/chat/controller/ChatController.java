package com.everyday.backend.chat.controller;

import com.everyday.backend.chat.dto.ChatMessageResponse;
import com.everyday.backend.chat.dto.SendMessageRequest;
import com.everyday.backend.chat.service.ChatService;
import com.everyday.backend.common.response.ApiResponse;
import com.everyday.backend.common.security.SecurityUtils;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/characters/{characterId}/messages")
public class ChatController {

    private final ChatService chatService;

    public ChatController(ChatService chatService) {
        this.chatService = chatService;
    }

    @GetMapping
    public ApiResponse<List<ChatMessageResponse>> getMessages(@PathVariable Long characterId) {
        Long userId = SecurityUtils.getCurrentUserId();
        return ApiResponse.ok(chatService.getMessages(userId, characterId));
    }

    @PostMapping
    public ApiResponse<ChatMessageResponse> sendMessage(
            @PathVariable Long characterId, @Valid @RequestBody SendMessageRequest request) {
        Long userId = SecurityUtils.getCurrentUserId();
        return ApiResponse.ok(chatService.sendMessage(userId, characterId, request.content()));
    }
}
