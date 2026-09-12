package com.everyday.backend.character.service;

import com.everyday.backend.image.ImageClient;
import com.everyday.backend.photo.entity.Photo;
import com.everyday.backend.photo.entity.PhotoType;
import com.everyday.backend.photo.repository.PhotoRepository;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

/**
 * 초상 후보 생성을 백그라운드에서 처리한다.
 *
 * <p>이미지 생성(1080p 4장)은 Higgsfield 큐 상황에 따라 2~7분 이상 걸리므로 compile 요청 안에서
 * 동기로 기다리지 않고, compile은 프로필만 만들어 즉시 응답한 뒤 이 서비스가 뒤에서 후보를 만들어
 * PROFILE 타입 Photo로 저장한다. 프론트는 갤러리 API를 폴링해 후보가 도착하는 대로 표시한다.
 */
@Service
@org.springframework.context.annotation.Profile("baseline")
public class PortraitGenerationService {

    private static final Logger log = LoggerFactory.getLogger(PortraitGenerationService.class);

    private final ImageClient imageClient;
    private final PhotoRepository photoRepository;

    public PortraitGenerationService(ImageClient imageClient, PhotoRepository photoRepository) {
        this.imageClient = imageClient;
        this.photoRepository = photoRepository;
    }

    @Async
    @org.springframework.transaction.event.TransactionalEventListener(phase = org.springframework.transaction.event.TransactionPhase.AFTER_COMMIT)
    public void generateCandidates(Request request) {
        Long characterId = request.characterId(); String imagePrompt = request.imagePrompt(); int count = request.count();
        try {
            List<String> imageUrls = imageClient.generateImages(imagePrompt, null, count);
            List<Photo> candidates = imageUrls.stream()
                    .map(url -> Photo.builder()
                            .characterId(characterId)
                            .type(PhotoType.PROFILE)
                            .promptText(imagePrompt)
                            .imageUrl(url)
                            .build())
                    .toList();
            photoRepository.saveAll(candidates);
            log.info("초상 후보 {}장 생성 완료 (characterId={})", candidates.size(), characterId);
        } catch (Exception e) {
            // 실패해도 캐릭터는 이미 생성되어 있음 — 후보만 비어 있게 된다.
            log.warn("초상 후보 생성 실패 (characterId={}): {}", characterId, e.getMessage());
        }
    }

    public record Request(Long characterId, String imagePrompt, int count) {}
}
