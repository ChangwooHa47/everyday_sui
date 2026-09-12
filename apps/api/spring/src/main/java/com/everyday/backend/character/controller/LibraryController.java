package com.everyday.backend.character.controller;

import com.everyday.backend.character.dto.CharacterResponse;
import com.everyday.backend.character.service.MarketProductService;
import com.everyday.backend.common.response.ApiResponse;
import com.everyday.backend.common.security.SecurityUtils;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.NotNull;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/library")
public class LibraryController {
    private final MarketProductService market;
    public LibraryController(MarketProductService market) { this.market = market; }

    @PostMapping
    public ApiResponse<CharacterResponse> importLicense(@Valid @RequestBody ImportRequest input) {
        return ApiResponse.ok(market.importLicense(SecurityUtils.getCurrentUserId(), input.listingId(), input.licenseId()));
    }
    @GetMapping("/{characterId}/license")
    public ApiResponse<MarketProductService.LicenseBinding> binding(@PathVariable Long characterId) {
        return ApiResponse.ok(market.binding(SecurityUtils.getCurrentUserId(), characterId));
    }
    public record ImportRequest(@NotNull @Pattern(regexp="0x[0-9a-f]{64}") String listingId,
            @NotNull @Pattern(regexp="0x[0-9a-f]{64}") String licenseId) {}
}
