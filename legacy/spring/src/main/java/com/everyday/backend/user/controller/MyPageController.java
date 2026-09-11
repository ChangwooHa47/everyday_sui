package com.everyday.backend.user.controller;

import com.everyday.backend.common.response.ApiResponse;
import com.everyday.backend.common.security.SecurityUtils;
import com.everyday.backend.user.dto.MyPageResponse;
import com.everyday.backend.user.dto.MyPageUpdateRequest;
import com.everyday.backend.user.service.MyPageService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/me")
public class MyPageController {

    private final MyPageService myPageService;

    public MyPageController(MyPageService myPageService) {
        this.myPageService = myPageService;
    }

    @GetMapping
    public ApiResponse<MyPageResponse> getMe() {
        Long userId = SecurityUtils.getCurrentUserId();
        return ApiResponse.ok(myPageService.getMe(userId));
    }

    @PatchMapping
    public ApiResponse<MyPageResponse> updateMe(@Valid @RequestBody MyPageUpdateRequest request) {
        Long userId = SecurityUtils.getCurrentUserId();
        return ApiResponse.ok(myPageService.updateMe(userId, request));
    }
}
